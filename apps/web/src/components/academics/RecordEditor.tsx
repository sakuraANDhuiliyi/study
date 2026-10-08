import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Input, Popconfirm, Select } from 'antd';
import { ApiError, send } from '../../api';
import { useAuth } from '../../auth';
import { useUnsavedWarning } from '../shared';
import type { LearningRecord } from './types';

export function RecordEditor({
  record,
  onSaved,
  onRefresh,
}: {
  record: LearningRecord;
  onSaved: (record: LearningRecord) => void;
  onRefresh: () => Promise<LearningRecord | undefined>;
}) {
  const { user } = useAuth();
  const client = useQueryClient();
  const scope = [user?.organizationId, user?.id, user?.role].join(':');
  const storageKey = `academic-record-note:${user?.organizationId}:${user?.id}:${record.id}`;
  const [draft] = useState(() => {
    try {
      const item = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (
        item &&
        typeof item.title === 'string' &&
        typeof item.notes === 'string' &&
        ['DRAFT', 'COMPLETED'].includes(item.status) &&
        Number.isInteger(item.revision)
      )
        return item as Pick<LearningRecord, 'title' | 'notes' | 'status' | 'revision'>;
    } catch {
      /* The server version remains available. */
    }
    return null;
  });
  const [title, setTitle] = useState(draft?.title ?? record.title);
  const [notes, setNotes] = useState(draft?.notes ?? record.notes ?? '');
  const [status, setStatus] = useState(draft?.status ?? record.status);
  const [revision, setRevision] = useState(draft?.revision ?? record.revision);
  const [dirty, setDirty] = useState(!!draft);
  const [storageFailed, setStorageFailed] = useState(false);
  const latest = useRef({ title, notes, status });
  useUnsavedWarning(dirty && storageFailed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<LearningRecord | null>(
    draft && draft.revision !== record.revision ? record : null,
  );
  const live = useRef(false);
  const { message } = App.useApp();
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  function change(update: Partial<typeof latest.current>) {
    const next = { ...latest.current, ...update };
    latest.current = next;
    setTitle(next.title);
    setNotes(next.notes);
    setStatus(next.status);
    setDirty(true);
    try {
      localStorage.setItem(storageKey, JSON.stringify({ ...next, revision }));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }
  async function save(base = revision) {
    if (busy) return;
    setBusy(true);
    setError('');
    const snapshot = latest.current;
    try {
      const saved = (await send(
        `/academics/records/${record.id}`,
        { revision: base, ...snapshot },
        'PATCH',
      )) as LearningRecord;
      if (!live.current) return;
      setRevision(saved.revision);
      setConflict(null);
      if (latest.current === snapshot) {
        setDirty(false);
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* Already saved on the server. */
        }
      } else {
        try {
          localStorage.setItem(storageKey, JSON.stringify({ ...latest.current, revision: saved.revision }));
        } catch {
          setStorageFailed(true);
        }
      }
      onSaved(saved);
      void client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[1] === scope && String(query.queryKey[0]).startsWith('/academics/goals'),
      });
      message.success('学习记录已保存');
    } catch (err) {
      if (!live.current) return;
      if (err instanceof ApiError && err.status === 409) {
        const fresh = await onRefresh();
        if (!live.current) return;
        if (fresh) setConflict(fresh);
        setError('这条记录已在其他窗口更新。你的输入仍保留，请核对最新内容后重试。');
      } else setError((err as Error).message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <div className="academic-record-editor">
      <label>
        记录标题
        <Input
          aria-label="记录标题"
          value={title}
          maxLength={160}
          onChange={(event) => change({ title: event.target.value })}
        />
      </label>
      <label>
        学习状态
        <Select
          aria-label="学习记录状态"
          value={status}
          onChange={(value) => change({ status: value })}
          options={[
            { value: 'DRAFT', label: '继续研究' },
            { value: 'COMPLETED', label: '已完成' },
          ]}
        />
      </label>
      <label>
        我的学习笔记
        <Input.TextArea
          aria-label="学习记录笔记"
          value={notes}
          rows={7}
          maxLength={12000}
          showCount
          onChange={(event) => change({ notes: event.target.value })}
          placeholder="记录你如何理解结果、发现了什么规律，以及下一步准备尝试什么。"
        />
      </label>
      {error && (
        <Alert type="error" showIcon message={conflict ? '记录版本冲突' : '保存未完成'} description={error} />
      )}
      {dirty && (
        <span className="form-hint" role="status">
          {storageFailed ? '本机保存不可用，请及时保存记录。' : '未同步输入已保留在本机，点击保存同步。'}
        </span>
      )}
      {conflict && (
        <div className="academic-conflict">
          <h4>服务器最新笔记 · 版本 {conflict.revision}</h4>
          <pre>{conflict.notes || '（尚无笔记）'}</pre>
          <Popconfirm
            title="用当前输入更新最新版本？"
            okText="保存我的内容"
            cancelText="取消"
            onConfirm={() => save(conflict.revision)}
          >
            <Button loading={busy}>保留我的输入并重新保存</Button>
          </Popconfirm>
        </div>
      )}
      <Button type="primary" loading={busy} disabled={!title.trim() || !!conflict} onClick={() => save()}>
        保存记录与笔记
      </Button>
    </div>
  );
}
