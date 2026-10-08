import { useEffect, useState } from 'react';
import { Alert, App, Button, Checkbox, Input, Modal, Popconfirm, Space, Spin } from 'antd';
import { NotebookPen, Save, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, date } from '../api';
import '../notes.css';

type Note = { id: string; body: string; pinned: boolean; revision: number; updatedAt: string };
type Response = {
  note: Note | null;
  course: { id: string; title: string };
  lesson: { id: string; title: string };
};

export function LessonNote({ lessonId, compact = false }: { lessonId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Response>();
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [conflict, setConflict] = useState(false);
  const client = useQueryClient();
  const { message, modal } = App.useApp();
  const dirty = !!data && (body !== (data.note?.body || '') || pinned !== (data.note?.pinned || false));
  const path = `/lessons/${encodeURIComponent(lessonId)}/note`;

  const accept = (result: Response) => {
    setData(result);
    setBody(result.note?.body || '');
    setPinned(result.note?.pinned || false);
    setConflict(false);
    setBlocked(false);
    setError('');
  };
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setData(undefined);
    setError('');
    setBlocked(false);
    setConflict(false);
    api<Response>(path, { signal: controller.signal })
      .then(accept)
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setBlocked(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, path]);

  useEffect(() => {
    if (!open || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [open, dirty]);

  const invalidate = () =>
    client.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/notes') });
  async function reload() {
    setLoading(true);
    try {
      accept(await api<Response>(path));
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) setBlocked(true);
    } finally {
      setLoading(false);
    }
  }
  async function save() {
    setSaving(true);
    setError('');
    try {
      accept(
        await api<Response>(path, {
          method: 'PUT',
          body: JSON.stringify({ body, pinned, revision: data?.note?.revision || 0, noteId: data?.note?.id }),
        }),
      );
      await invalidate();
      message.success('私人笔记已保存');
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError) {
        setConflict(e.status === 409);
        if ([401, 403, 404].includes(e.status)) setBlocked(true);
      }
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!data?.note) return;
    setSaving(true);
    try {
      await api(path, {
        method: 'DELETE',
        body: JSON.stringify({ revision: data.note.revision, noteId: data.note.id }),
      });
      accept({ ...data, note: null });
      await invalidate();
      message.success('私人笔记已删除');
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError) {
        setConflict(e.status === 409);
        if ([401, 403, 404].includes(e.status)) setBlocked(true);
      }
    } finally {
      setSaving(false);
    }
  }
  function close() {
    if (saving) return;
    if (!dirty) return setOpen(false);
    modal.confirm({
      title: '离开未保存的笔记？',
      content: '当前修改尚未保存。留在这里可继续编辑并保存。',
      okText: '放弃修改',
      cancelText: '继续编辑',
      onOk: () => setOpen(false),
    });
  }
  return (
    <>
      <div className={compact ? 'note-entry-compact' : 'note-entry'}>
        <Button icon={<NotebookPen size={16} />} onClick={() => setOpen(true)}>
          {compact ? '编辑笔记' : '我的课时笔记'}
        </Button>
        {!compact && <span>仅你可见，记录疑问、重点与自己的理解。</span>}
      </div>
      <Modal
        open={open}
        title="私人课时笔记"
        width={700}
        onCancel={close}
        maskClosable={false}
        footer={null}
        destroyOnClose
      >
        {loading ? (
          <div className="note-loading">
            <Spin />
            正在读取你的笔记…
          </div>
        ) : (
          <>
            {error && (
              <Alert
                className="note-alert"
                type="error"
                showIcon
                message={conflict ? '笔记版本冲突，当前输入已保留' : '笔记暂时无法保存或读取'}
                description={error}
                action={
                  conflict || dirty ? (
                    <Popconfirm
                      title="用最新版本替换当前未保存内容？"
                      onConfirm={reload}
                      okText="载入最新"
                      cancelText="保留输入"
                    >
                      <Button size="small">载入最新版本</Button>
                    </Popconfirm>
                  ) : (
                    <Button size="small" onClick={reload}>
                      重试读取
                    </Button>
                  )
                }
              />
            )}
            {data && !blocked && (
              <div className="note-editor">
                <p className="note-source">
                  {data.course.title} / {data.lesson.title}
                </p>
                <label htmlFor={`note-body-${lessonId}`}>笔记内容</label>
                <Input.TextArea
                  id={`note-body-${lessonId}`}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  maxLength={10000}
                  showCount
                  autoSize={{ minRows: 8, maxRows: 18 }}
                  placeholder="用自己的话记录本课时的收获，支持纯文本。"
                  disabled={saving}
                />
                <Checkbox
                  checked={pinned}
                  onChange={(event) => setPinned(event.target.checked)}
                  disabled={saving}
                >
                  置顶这条笔记
                </Checkbox>
                <div className="note-editor-footer">
                  <span role="status" aria-live="polite">
                    {dirty
                      ? '有未保存修改'
                      : data.note
                        ? `已保存 · ${date(data.note.updatedAt)}`
                        : '尚未创建笔记'}
                  </span>
                  <Space wrap>
                    {data.note && (
                      <Popconfirm
                        title="删除这条私人笔记？"
                        description="删除后无法恢复。"
                        onConfirm={remove}
                        okText="删除"
                        cancelText="取消"
                        disabled={saving || conflict}
                      >
                        <Button danger icon={<Trash2 size={15} />} disabled={saving || conflict}>
                          删除
                        </Button>
                      </Popconfirm>
                    )}
                    <Button
                      type="primary"
                      icon={<Save size={15} />}
                      onClick={save}
                      loading={saving}
                      disabled={!body.trim() || !dirty || conflict}
                    >
                      保存笔记
                    </Button>
                  </Space>
                </div>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
