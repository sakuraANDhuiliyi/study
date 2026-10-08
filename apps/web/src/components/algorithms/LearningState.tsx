import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Collapse, Input, Popconfirm, Select } from 'antd';
import { Bookmark, BookmarkCheck, Save } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, date, send, useData } from '../../api';
import { useAuth } from '../../auth';
import { QueryState, useUnsavedWarning } from '../shared';
import type { LearningState, ReviewStatus } from './types';
function useLearningSession(problemId: string) {
  const { user } = useAuth();
  const scope = [user?.organizationId, user?.id, user?.role].join(':');
  const identity = `${scope}:${problemId}`;
  const current = useRef(identity);
  const mounted = useRef(false);
  current.current = identity;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return { scope, isCurrent: () => mounted.current && current.current === identity };
}
export function LearningBookmark({ problemId }: { problemId: string }) {
  const path = `/algorithms/problems/${problemId}/learning`;
  const query = useData<LearningState>(path);
  const session = useLearningSession(problemId);
  const [busy, setBusy] = useState(false);
  const { message } = App.useApp();
  const client = useQueryClient();
  return (
    <Button
      className="algo-bookmark"
      icon={query.data?.favorite ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
      loading={busy}
      disabled={!query.data || !!query.error}
      onClick={async () => {
        if (!query.data || busy) return;
        setBusy(true);
        try {
          const saved = (await send(
            path,
            { revision: query.data.revision, favorite: !query.data.favorite },
            'PATCH',
          )) as LearningState;
          if (!session.isCurrent()) return;
          client.setQueryData([path, session.scope], saved);
          await client.invalidateQueries({
            predicate: (item) =>
              item.queryKey[1] === session.scope && String(item.queryKey[0]).startsWith('/algorithms/'),
          });
        } catch (error) {
          if (!session.isCurrent()) return;
          if (error instanceof ApiError && error.status === 409) {
            await query.refetch();
            if (!session.isCurrent()) return;
            message.warning('学习记录已在别处更新，请再试一次。');
          } else message.error((error as Error).message);
        } finally {
          if (session.isCurrent()) setBusy(false);
        }
      }}
    >
      {query.data?.favorite ? '已收藏' : '收藏题目'}
    </Button>
  );
}
export function LearningNotes({ problemId }: { problemId: string }) {
  const path = `/algorithms/problems/${problemId}/learning`;
  const query = useData<LearningState>(path);
  const session = useLearningSession(problemId);
  const client = useQueryClient();
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const [reviewStatus, setReview] = useState<ReviewStatus>('none');
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<LearningState | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const latest = useRef({ note, reviewStatus });
  const [saveStatus, setSaveStatus] = useState('');
  const storageKey = `algorithm-note:${user?.organizationId}:${user?.id}:${problemId}`;
  useUnsavedWarning(dirty && storageFailed);
  useEffect(() => {
    if (!query.data || (initialized && dirty)) return;
    const data = query.data;
    let draft: { note: string; reviewStatus: ReviewStatus; revision: number } | null = null;
    if (!initialized) {
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (
          stored &&
          typeof stored.note === 'string' &&
          ['none', 'review', 'mastered'].includes(stored.reviewStatus) &&
          Number.isInteger(stored.revision)
        )
          draft = stored;
      } catch {
        /* Keep server state if local storage is not readable. */
      }
    }
    const initial = draft || data;
    setNote(initial.note);
    setReview(initial.reviewStatus);
    setRevision(initial.revision);
    latest.current = { note: initial.note, reviewStatus: initial.reviewStatus };
    setInitialized(true);
    setDirty(!!draft);
    setSaveStatus(
      draft
        ? '已恢复本机未同步笔记'
        : data.updatedAt
          ? `已保存于 ${date(data.updatedAt)}`
          : '记录你自己的思考',
    );
    if (draft && draft.revision !== data.revision) setConflict(data);
  }, [query.data, initialized, dirty, storageKey]);
  function change(nextNote: string, nextReview = reviewStatus) {
    latest.current = { note: nextNote, reviewStatus: nextReview };
    setNote(nextNote);
    setReview(nextReview);
    setDirty(true);
    setSaveStatus('笔记已保留在本机，点击保存同步');
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ note: nextNote, reviewStatus: nextReview, revision }),
      );
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
      setSaveStatus('本机存储不可用，请及时保存笔记');
    }
  }
  async function save(baseRevision = revision) {
    if (busy) return;
    setBusy(true);
    setError('');
    const snapshot = { ...latest.current };
    try {
      const saved = (await send(path, { revision: baseRevision, ...snapshot }, 'PATCH')) as LearningState;
      if (!session.isCurrent()) return;
      client.setQueryData([path, session.scope], saved);
      setRevision(saved.revision);
      setConflict(null);
      if (latest.current.note === snapshot.note && latest.current.reviewStatus === snapshot.reviewStatus) {
        setDirty(false);
        setSaveStatus(`已保存于 ${date(saved.updatedAt || undefined)}`);
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* Server save remains successful. */
        }
      } else {
        try {
          localStorage.setItem(storageKey, JSON.stringify({ ...latest.current, revision: saved.revision }));
        } catch {
          setStorageFailed(true);
        }
      }
      await client.invalidateQueries({
        predicate: (item) =>
          item.queryKey[1] === session.scope && String(item.queryKey[0]).startsWith('/algorithms/'),
      });
    } catch (err) {
      if (!session.isCurrent()) return;
      if (err instanceof ApiError && err.status === 409) {
        const result = await query.refetch();
        if (!session.isCurrent()) return;
        if (result.data) setConflict(result.data);
        setError('其他窗口已更新这道题的笔记或学习状态。你的输入完整保留，请比较后选择。');
      } else setError((err as Error).message);
    } finally {
      if (session.isCurrent()) setBusy(false);
    }
  }
  return (
    <div className="algo-notes">
      <QueryState query={query}>
        <div className="algo-notes-intro">
          <h3>把这道题，变成自己的知识</h3>
          <p>记录解题关键、踩过的坑和下次复习要点。笔记仅自己可见。</p>
        </div>
        <label className="algo-field-label">复习状态</label>
        <Select
          aria-label="复习状态"
          disabled={!initialized}
          value={reviewStatus}
          onChange={(value) => change(note, value)}
          options={[
            { value: 'none', label: '未标记' },
            { value: 'review', label: '需要复习' },
            { value: 'mastered', label: '已经掌握' },
          ]}
        />
        <label className="algo-field-label" htmlFor="algorithm-note">
          我的解题笔记
        </label>
        <Input.TextArea
          id="algorithm-note"
          disabled={!initialized}
          value={note}
          onChange={(event) => change(event.target.value)}
          rows={15}
          maxLength={12000}
          showCount
          placeholder="可以从这些问题开始：\n1. 最关键的观察是什么？\n2. 用了哪些数据结构，为什么？\n3. 我曾经在哪个边界条件出错？\n4. 下次如何快速想起这道题？"
        />
        {error && (
          <Alert
            type="error"
            showIcon
            message={conflict ? '检测到版本冲突' : '笔记保存失败'}
            description={error}
          />
        )}
        {conflict && (
          <div className="algo-note-conflict">
            <Alert
              type="warning"
              showIcon
              message="当前输入尚未覆盖服务器版本"
              description="可以查看最新版本，再决定保留哪一份；发生新的并发编辑时会再次提示。"
            />
            <Collapse
              items={[
                {
                  key: 'server',
                  label: `查看服务器笔记（版本 ${conflict.revision}）`,
                  children: <pre className="algo-note-preview">{conflict.note || '（空笔记）'}</pre>,
                },
              ]}
            />
            <div>
              <Popconfirm
                title="用当前笔记覆盖最新服务器笔记？"
                okText="保存我的内容"
                cancelText="取消"
                onConfirm={() => save(conflict.revision)}
              >
                <Button type="primary" loading={busy}>
                  保留我的内容并重新保存
                </Button>
              </Popconfirm>
              <Popconfirm
                title="放弃当前输入，采用服务器版本？"
                okText="采用服务器版本"
                cancelText="取消"
                onConfirm={() => {
                  change(conflict.note, conflict.reviewStatus);
                  setRevision(conflict.revision);
                  setDirty(false);
                  setConflict(null);
                  setError('');
                  try {
                    localStorage.removeItem(storageKey);
                  } catch {
                    /* Nothing further required. */
                  }
                }}
              >
                <Button>采用服务器版本</Button>
              </Popconfirm>
            </div>
          </div>
        )}
        <div className="algo-note-footer">
          <span role="status">{saveStatus}</span>
          <Button
            type="primary"
            icon={<Save size={14} />}
            loading={busy}
            disabled={!initialized || !dirty || !!conflict}
            onClick={() => save()}
          >
            保存笔记与状态
          </Button>
        </div>
      </QueryState>
    </div>
  );
}
