import { useEffect, useRef, useState } from 'react';
import { Alert, Button, InputNumber, Modal, Radio } from 'antd';
import { Download } from 'lucide-react';
import { ApiError, getCsrf } from '../../api';
import { useAuth } from '../../auth';

export type RecordStatusFilter = 'all' | 'DRAFT' | 'COMPLETED';
const statusLabels: Record<RecordStatusFilter, string> = {
  all: '全部状态',
  DRAFT: '继续研究',
  COMPLETED: '已完成',
};
type ExportScope = {
  moduleId?: string;
  moduleName?: string;
  status: RecordStatusFilter;
  total: number;
};
type ExportResult = { count: number; matched: number; truncated: boolean };

function exportFilename(disposition: string, format: 'csv' | 'md') {
  const fallback = `academic-records.${format}`;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const ordinary = disposition.match(/filename="?([^";]+)"?/i);
  try {
    const raw = encoded ? decodeURIComponent(encoded[1]) : ordinary?.[1] || fallback;
    const name = [...raw]
      .map((char) =>
        char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || '/\\'.includes(char) ? '_' : char,
      )
      .join('')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 160);
    return name.endsWith(`.${format}`) ? name : fallback;
  } catch {
    return fallback;
  }
}

function exportCounts(headers: Headers): ExportResult {
  const count = headers.get('X-Export-Record-Count');
  const matched = headers.get('X-Export-Matched-Count');
  const truncated = headers.get('X-Export-Truncated');
  if (
    !count ||
    !matched ||
    !/^\d+$/.test(count) ||
    !/^\d+$/.test(matched) ||
    !Number.isSafeInteger(Number(count)) ||
    !Number.isSafeInteger(Number(matched)) ||
    Number(count) > Number(matched) ||
    !['true', 'false'].includes(truncated || '') ||
    (truncated === 'true') !== Number(count) < Number(matched)
  )
    throw new Error('未能确认文件的记录数量，请重新下载。');
  return { count: Number(count), matched: Number(matched), truncated: truncated === 'true' };
}

export function RecordsExport({
  moduleId,
  moduleName,
  status,
  total,
}: Omit<ExportScope, 'total'> & { total?: number }) {
  const { user } = useAuth();
  const scope = [user?.organizationId, user?.id, user?.role].join(':');
  const [snapshot, setSnapshot] = useState<ExportScope | null>(null);
  return (
    <>
      <Button
        icon={<Download size={16} />}
        disabled={total === undefined}
        onClick={() => total !== undefined && setSnapshot({ moduleId, moduleName, status, total })}
      >
        导出记录
      </Button>
      {snapshot && <ExportDialog key={scope} snapshot={snapshot} onClose={() => setSnapshot(null)} />}
    </>
  );
}

function ExportDialog({ snapshot, onClose }: { snapshot: ExportScope; onClose: () => void }) {
  const { user } = useAuth();
  const scope = [user?.organizationId, user?.id, user?.role].join(':');
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const live = useRef(false);
  const request = useRef<AbortController | null>(null);
  const objectUrls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [format, setFormat] = useState<'csv' | 'md'>('csv');
  const [limit, setLimit] = useState<number | null>(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ExportResult | null>(null);
  const validLimit =
    format === 'csv' || (limit !== null && Number.isInteger(limit) && limit >= 1 && limit <= 50);
  const amount = format === 'csv' ? 5000 : limit || 0;
  const expected = Math.min(snapshot.total, amount);
  useEffect(() => {
    live.current = true;
    const urls = objectUrls.current;
    const cancel = () => {
      request.current?.abort();
      request.current = null;
      for (const [url, timer] of urls) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
    window.addEventListener('auth-expired', cancel);
    return () => {
      live.current = false;
      cancel();
      window.removeEventListener('auth-expired', cancel);
    };
  }, []);

  function close() {
    request.current?.abort();
    request.current = null;
    onClose();
  }

  async function download() {
    if (request.current || !validLimit || snapshot.total === 0) return;
    const controller = new AbortController();
    request.current = controller;
    const requestScope = scope;
    const active = () =>
      live.current &&
      currentScope.current === requestScope &&
      request.current === controller &&
      !controller.signal.aborted;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/academics/records/export', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrf() },
        body: JSON.stringify({
          format,
          moduleId: snapshot.moduleId,
          status: snapshot.status,
          limit: amount,
        }),
        signal: controller.signal,
      });
      if (!active()) return;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (!active()) return;
        if (response.status === 401) window.dispatchEvent(new Event('auth-expired'));
        const description = body.message || body.error?.message;
        throw new ApiError(
          response.status,
          Array.isArray(description)
            ? description.join('；')
            : typeof description === 'string'
              ? description
              : '下载失败，请稍后重试。',
        );
      }
      const counts = exportCounts(response.headers);
      const blob = await response.blob();
      if (!active()) return;
      if (!counts.count) throw new Error('当前筛选下已没有可导出的记录，请关闭后刷新记录。');
      if (!blob.size) throw new Error('下载的文件为空，请重新下载。');
      if (blob.size > 8 * 1024 * 1024) throw new Error('文件超过 8 MiB，请缩小筛选范围或减少导出数量。');
      const url = URL.createObjectURL(blob);
      const timer = setTimeout(() => {
        URL.revokeObjectURL(url);
        objectUrls.current.delete(url);
      }, 1000);
      objectUrls.current.set(url, timer);
      if (!active()) return;
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exportFilename(response.headers.get('content-disposition') || '', format);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setResult(counts);
    } catch (err) {
      if (active())
        setError(
          err instanceof TypeError
            ? '网络连接中断，请检查连接后重新下载。'
            : (err as Error).message || '下载失败，请稍后重试。',
        );
    } finally {
      if (active()) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <Modal
      open
      className="academic-export-modal"
      title="导出学习记录"
      width={560}
      onCancel={close}
      footer={
        <div className="academic-export-footer">
          <Button aria-label={busy ? '取消下载并关闭' : '关闭'} onClick={close}>
            {busy ? '取消下载并关闭' : '关闭'}
          </Button>
          <Button
            type="primary"
            icon={<Download size={15} />}
            loading={busy}
            disabled={busy || !validLimit || snapshot.total === 0}
            onClick={() => void download()}
          >
            下载文件
          </Button>
        </div>
      }
    >
      <div className="academic-export">
        <div className="academic-export-scope">
          <strong>{snapshot.moduleName || snapshot.moduleId || '全部学习模块'}</strong>
          <span>{statusLabels[snapshot.status]} · 当前空间本人记录</span>
        </div>
        <Radio.Group
          aria-label="导出格式"
          className="academic-export-formats"
          value={format}
          disabled={busy}
          onChange={(event) => {
            setFormat(event.target.value);
            setResult(null);
            setError('');
          }}
        >
          <Radio value="csv" aria-label="CSV 总览">
            <strong>CSV 总览</strong>
            <span>适合表格整理，包含记录信息、结果摘要和笔记标记。最多 5000 条。</span>
          </Radio>
          <Radio value="md" aria-label="Markdown 详细笔记">
            <strong>Markdown 详细笔记</strong>
            <span>包含完整输入、结果与实验笔记，按创建时间从新到旧导出。</span>
          </Radio>
        </Radio.Group>
        {format === 'md' && (
          <label className="academic-export-limit">
            <span>导出数量</span>
            <InputNumber
              aria-label="导出数量"
              min={1}
              max={50}
              precision={0}
              value={limit}
              disabled={busy}
              onChange={(value) => {
                setLimit(value);
                setResult(null);
                setError('');
              }}
            />
            <small>导出最新 1–50 条，默认 20 条；不会截断单条笔记正文。</small>
          </label>
        )}
        <div className="academic-export-preview" role="status">
          当前筛选共 {snapshot.total} 条记录，预计导出 {validLimit ? expected : '—'} 条。
          <span>
            {snapshot.total === 0
              ? '当前筛选下没有可导出的记录。'
              : expected < snapshot.total
                ? `本次仅导出最新 ${expected} 条记录，不受当前列表页码影响。`
                : '包含全部匹配记录，不限当前列表页；数量以下载时的服务器记录为准。'}
          </span>
        </div>
        <p className="form-hint">仅包含服务器已保存的内容；未保存的编辑与本机草稿不会导出。</p>
        {error && (
          <Alert showIcon type="error" message="下载未完成" description={`${error} 可调整选项后重试。`} />
        )}
        {result && (
          <Alert
            showIcon
            type={result.truncated ? 'warning' : 'success'}
            message="已开始下载"
            description={`已导出 ${result.count} / ${result.matched} 条匹配记录。${result.truncated ? `本次仅包含最新 ${result.count} 条记录，可调整筛选或数量后再次导出。` : '请在浏览器下载列表中查看文件。'}`}
          />
        )}
      </div>
    </Modal>
  );
}
