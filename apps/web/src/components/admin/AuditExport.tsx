import { useEffect, useRef, useState } from 'react';
import { Alert, InputNumber, Modal } from 'antd';
import { ApiError } from '../../api';
import { auditFilterLabels, auditTimestamp, type AuditExportSnapshot } from './audit.types';

type ExportResult = { count: number; matched: number; truncated: boolean };
export function auditExportCounts(headers: Headers, limit: number): ExportResult {
  const count = headers.get('X-Export-Record-Count');
  const matched = headers.get('X-Export-Matched-Count');
  const truncated = headers.get('X-Export-Truncated');
  if (
    count === null ||
    matched === null ||
    !/^\d+$/.test(count) ||
    !/^\d+$/.test(matched) ||
    !Number.isSafeInteger(Number(count)) ||
    !Number.isSafeInteger(Number(matched)) ||
    Number(count) > limit ||
    Number(count) > Number(matched) ||
    !['true', 'false'].includes(truncated ?? '') ||
    (truncated === 'true') !== Number(count) < Number(matched)
  )
    throw new Error('无法确认导出文件的记录数量，请重试。');
  return { count: Number(count), matched: Number(matched), truncated: truncated === 'true' };
}

/** isCurrent binds the dialog to the parent's auth-cache signature and captured CSRF. */
export function AuditExport({
  snapshot,
  csrf,
  isCurrent,
  onClose,
}: {
  snapshot: AuditExportSnapshot;
  csrf: string;
  isCurrent: () => boolean;
  onClose: () => void;
}) {
  const [limit, setLimit] = useState<number | null>(5000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ExportResult | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const validLimit = limit !== null && Number.isInteger(limit) && limit >= 1 && limit <= 5000;
  function cancel() {
    generation.current++;
    request.current?.abort();
    request.current = null;
    for (const [url, timer] of urls.current) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    urls.current.clear();
  }
  useEffect(() => {
    mounted.current = true;
    const expire = () => cancel();
    window.addEventListener('auth-expired', expire);
    return () => {
      mounted.current = false;
      cancel();
      window.removeEventListener('auth-expired', expire);
    };
  }, []);
  function close() {
    cancel();
    onClose();
  }
  async function download() {
    if (request.current || !validLimit || !isCurrent()) return;
    const controller = new AbortController();
    const issued = generation.current;
    const amount = limit!;
    request.current = controller;
    const active = () =>
      mounted.current &&
      isCurrent() &&
      issued === generation.current &&
      request.current === controller &&
      !controller.signal.aborted;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      // The shared JSON api() helper cannot read a binary CSV response.
      const response = await fetch('/api/admin/audit/export', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ ...snapshot.filters, limit: amount }),
        signal: controller.signal,
      });
      if (!active()) return;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (!active()) return;
        const description = body.message || body.error?.message;
        if (response.status === 401) window.dispatchEvent(new Event('auth-expired'));
        throw new ApiError(
          response.status,
          Array.isArray(description)
            ? description.join('；')
            : typeof description === 'string'
              ? description
              : '导出失败，请稍后重试。',
        );
      }
      if (!/^text\/csv(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? ''))
        throw new Error('服务器没有返回 CSV 文件，请重试。');
      const counts = auditExportCounts(response.headers, amount);
      const blob = await response.blob();
      if (!active()) return;
      if (blob.size === 0 || blob.size > 8 * 1024 * 1024)
        throw new Error('导出文件为空或超过 8 MiB，请缩小筛选范围后重试。');
      const url = URL.createObjectURL(blob);
      const cleanup = setTimeout(() => {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }, 1000);
      urls.current.set(url, cleanup);
      const anchor = document.createElement('a');
      anchor.href = url;
      // Server contract has a fixed filename; no personal data is used in it.
      anchor.download = 'audit-records.csv';
      anchor.hidden = true;
      document.body.append(anchor);
      try {
        if (!active()) return;
        anchor.click();
      } finally {
        anchor.remove();
      }
      if (active()) setResult(counts);
    } catch (failure) {
      if (active()) setError(failure instanceof Error ? failure.message : '导出失败，请重试。');
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (mounted.current && isCurrent() && issued === generation.current) setBusy(false);
      }
    }
  }
  return (
    <Modal
      open
      title="导出机构审计 CSV"
      onCancel={close}
      onOk={() => void download()}
      okText="下载审计 CSV"
      cancelText="取消导出"
      destroyOnHidden
      maskClosable={!busy}
      keyboard={!busy}
      okButtonProps={{ loading: busy, disabled: busy || !validLimit || !isCurrent() }}
    >
      <div className="audit-export-content">
        <p>导出已应用筛选的全部匹配结果，按最新记录优先，最多 5000 条，不限当前列表页。</p>
        <ul aria-label="导出筛选快照">
          {Object.entries(snapshot.filters).length ? (
            Object.entries(snapshot.filters).map(([key, value]) => (
              <li key={key}>
                {auditFilterLabels[key as keyof typeof snapshot.filters]}：
                {key === 'from' || key === 'to' ? auditTimestamp(value!) : value}
              </li>
            ))
          ) : (
            <li>当前机构全部审计</li>
          )}
        </ul>
        <label className="audit-export-limit">
          <span>导出上限</span>
          <InputNumber
            aria-label="导出上限"
            min={1}
            max={5000}
            precision={0}
            value={limit}
            disabled={busy}
            onChange={(value) => {
              setLimit(value);
              setError('');
              setResult(null);
            }}
          />
        </label>
        <p>
          列表快照匹配 {snapshot.total} 条，预计最多导出 {validLimit ? Math.min(snapshot.total, limit!) : '—'}{' '}
          条。 实际数量以服务器下载响应为准。
        </p>
        <p className="form-hint">
          文件时间为 UTC；页面筛选为北京时间。CSV 仅含审计 ID、时间、操作人 ID/名称、
          操作、资源类型/标识与追踪 ID，不包含详情正文。
        </p>
        {error && (
          <Alert type="error" showIcon message="审计导出未完成" description={`${error} 可保留筛选后重试。`} />
        )}
        {result && (
          <div role="status" aria-label="审计导出结果">
            <Alert
              type={result.truncated ? 'warning' : 'success'}
              showIcon
              message="已开始下载"
              description={`已导出 ${result.count} / ${result.matched} 条匹配记录。${
                result.truncated
                  ? `仅包含最新 ${result.count} 条，可缩小筛选或提高上限后再次导出。`
                  : '请在浏览器下载列表查看文件。'
              }`}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
