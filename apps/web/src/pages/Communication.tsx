import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Avatar,
  Badge,
  Button,
  Form,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Upload,
} from 'antd';
import {
  CheckCheck,
  MessageCircle,
  MessagesSquare,
  Plus,
  Send,
  Paperclip,
  CheckCircle2,
  ArrowUpRight,
} from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { RemoteSelect } from '../components/RemoteSelect';
import { api, date, isTeacher, queryString, send, useAction, useData } from '../api';
import { EmptyState, PageTitle, Panel, QueryState } from '../components/shared';
export function Communication() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(
    params.get('conversationId') || params.get('conversation') ? 'messages' : 'discussions',
  );
  return (
    <>
      <PageTitle
        eyebrow="CONNECT & DISCUSS"
        title="交流中心"
        description="把疑问说出来，让想法在交流中生长。"
      />
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'discussions',
            label: (
              <span className="inline-link">
                <MessagesSquare size={15} />
                课程讨论
              </span>
            ),
            children: (
              <Discussions
                initialCourse={params.get('courseId') || undefined}
                initialPost={params.get('postId') || params.get('post') || undefined}
              />
            ),
          },
          {
            key: 'messages',
            label: (
              <span className="inline-link">
                <MessageCircle size={15} />
                师生与班级交流
              </span>
            ),
            children: (
              <Messages
                initialConversation={params.get('conversationId') || params.get('conversation') || undefined}
              />
            ),
          },
        ]}
      />
    </>
  );
}
function AttachmentUploader({
  courseId,
  conversationId,
  disabled = false,
  onChange,
}: {
  courseId?: string;
  conversationId?: string;
  disabled?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [files, setFiles] = useState<any[]>([]);
  const { message } = App.useApp();
  return (
    <Upload
      disabled={disabled}
      fileList={files}
      onRemove={(file) => {
        const next = files.filter((f) => f.uid !== file.uid);
        setFiles(next);
        onChange(next.map((f) => f.id));
      }}
      customRequest={async (options) => {
        try {
          const form = new FormData();
          form.append('file', options.file as Blob);
          if (courseId) form.append('courseId', courseId);
          if (conversationId) form.append('conversationId', conversationId);
          const result = await api('/attachments', { method: 'POST', body: form });
          setFiles((previous) => {
            const next = [...previous, { uid: result.id, id: result.id, name: result.name, status: 'done' }];
            onChange(next.map((f) => f.id));
            return next;
          });
          options.onSuccess?.(result);
        } catch (e) {
          options.onError?.(e as Error);
          message.error((e as Error).message);
        }
      }}
    >
      <Button
        type="text"
        disabled={disabled || (!courseId && !conversationId)}
        icon={<Paperclip size={15} />}
      >
        添加附件
      </Button>
    </Upload>
  );
}
function AttachmentLinks({ attachments }: { attachments: any[] }) {
  return (
    <>
      {attachments?.map((a: any) => {
        const id = typeof a === 'string' ? a : a.id;
        return (
          <div key={id}>
            {a.mime?.startsWith('image/') && (
              <a href={`/api/attachments/${id}/preview`} target="_blank" rel="noreferrer">
                <img
                  className="discussion-image"
                  loading="lazy"
                  src={`/api/attachments/${id}/preview`}
                  alt={a.name || '交流附件图片'}
                />
              </a>
            )}
            {a.mime === 'video/mp4' && (
              <video controls className="discussion-image" src={`/api/attachments/${id}/preview`} />
            )}
            <a
              className="resource-link"
              style={{ fontSize: 14, padding: '10px 14px', marginTop: 10 }}
              href={`/api/attachments/${id}/download`}
              target="_blank"
              rel="noreferrer"
            >
              <Paperclip size={14} />
              {a.name || '下载附件'}
            </a>
            {a.mime === 'application/pdf' && (
              <a
                className="inline-link"
                style={{ fontSize: 13, marginTop: 8 }}
                href={`/api/attachments/${id}/preview`}
                target="_blank"
                rel="noreferrer"
              >
                预览 PDF
              </a>
            )}
          </div>
        );
      })}
    </>
  );
}
function Discussions({ initialCourse, initialPost }: { initialCourse?: string; initialPost?: string }) {
  const { user } = useAuth();
  const [courseId, setCourseId] = useState(initialCourse);
  const [authorId, setAuthorId] = useState<string>();
  const authorChoices = useRef(new Map<string, string>());
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [postId, setPostId] = useState<string | undefined>(initialPost);
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const query = useData(
    `/communication/posts?${queryString({ courseId, authorId, q: search, page, pageSize: 10, createdFrom: createdFrom ? new Date(createdFrom + 'T00:00:00+08:00').toISOString() : undefined, createdTo: createdTo ? new Date(createdTo + 'T23:59:59.999+08:00').toISOString() : undefined })}`,
  );
  if (user) authorChoices.current.set(user.id, `${user.name}（我）`);
  for (const post of query.data?.items || [])
    authorChoices.current.set(
      post.authorId,
      post.authorId === user?.id ? `${user?.name || post.authorName}（我）` : post.authorName,
    );
  const [replyPage, setReplyPage] = useState(1);
  const detail = useData(`/communication/posts/${postId}?page=${replyPage}&pageSize=20`, !!postId);
  useEffect(() => setReplyPage(1), [postId]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const postCourse = Form.useWatch('courseId', form);
  const [replyAttachments, setReplyAttachments] = useState<string[]>([]);
  const [replyUploadKey, setReplyUploadKey] = useState(0);
  const [reply, setReply] = useState('');
  const [quote, setQuote] = useState<string>();
  const [attachments, setAttachments] = useState<string[]>([]);
  const [report, setReport] = useState<any>(null);
  const [reason, setReason] = useState('');
  const action = useAction();
  const teacher = isTeacher(user);
  const canWrite = !!user?.permissions.includes('communication.write');
  const post = detail.data;
  return (
    <>
      <div className="filter-bar">
        <Input
          type="date"
          aria-label="讨论开始日期"
          value={createdFrom}
          onChange={(e) => {
            setCreatedFrom(e.target.value);
            setPage(1);
          }}
          style={{ width: 170 }}
        />
        <span>至</span>
        <Input
          type="date"
          aria-label="讨论结束日期"
          value={createdTo}
          onChange={(e) => {
            setCreatedTo(e.target.value);
            setPage(1);
          }}
          style={{ width: 170 }}
        />
        <Input.Search
          placeholder="搜索讨论关键词"
          style={{ maxWidth: 330 }}
          allowClear
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
        <RemoteSelect
          endpoint="/courses"
          labelField="title"
          placeholder="所有课程"
          value={courseId}
          style={{ width: 220 }}
          onChange={(value) => {
            setCourseId(value);
            setPage(1);
          }}
        />
        <Select
          aria-label="讨论作者"
          value={authorId}
          showSearch
          optionFilterProp="label"
          allowClear
          placeholder="当前可见作者"
          style={{ width: 190 }}
          onChange={(value) => {
            setAuthorId(value);
            setPage(1);
          }}
          options={[...authorChoices.current].map(([value, label]) => ({ value, label }))}
        />
        <Button
          type="primary"
          icon={<Plus size={16} />}
          style={{ marginLeft: 'auto' }}
          disabled={!canWrite}
          title={!canWrite ? '当前身份未获交流发言权限' : undefined}
          onClick={() => {
            setOpen(true);
            form.setFieldValue('courseId', courseId);
          }}
        >
          发起讨论
        </Button>
      </div>
      <Panel>
        <QueryState query={query}>
          {query.data?.items?.length ? (
            <div className="discussion-list">
              {query.data.items.map((p: any) => (
                <article key={p.id} className="discussion-item">
                  <Avatar style={{ background: '#e9f2fc', color: '#206bc4' }}>
                    {p.authorName?.slice(0, 1) || '学'}
                  </Avatar>
                  <div className="discussion-item-main">
                    <h3 onClick={() => setPostId(p.id)}>
                      {p.pinned && <Tag color="blue">置顶</Tag>}
                      {p.featured && <Tag color="gold">精华</Tag>}
                      {p.solved && <Tag color="green">已解决</Tag>}
                      {p.title}
                    </h3>
                    <p>{p.body}</p>
                    <div className="discussion-meta">
                      <span>{p.authorName}</span>
                      <span>{date(p.createdAt)}</span>
                      {p.closed && <Tag>讨论已关闭</Tag>}
                      <Button
                        type="text"
                        size="small"
                        onClick={() => {
                          setReport({ targetType: 'post', targetId: p.id });
                          setReason('');
                        }}
                      >
                        举报
                      </Button>
                    </div>
                  </div>
                  <button
                    className="reply-count"
                    onClick={() => setPostId(p.id)}
                    style={{ border: 0, background: 'none' }}
                  >
                    <MessageCircle size={18} />
                    <span>{p.replyCount || 0} 回复</span>
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState description="暂无讨论，分享你的第一个问题吧" />
          )}
          {query.data?.total > 10 && (
            <div className="pagination-buttons">
              <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                上一页
              </Button>
              <span>第 {page} 页</span>
              <Button disabled={page * 10 >= query.data.total} onClick={() => setPage(page + 1)}>
                下一页
              </Button>
            </div>
          )}
        </QueryState>
      </Panel>
      <Modal
        title="发起课程讨论"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={action.isPending}
        width={640}
        okText="发布讨论"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            await action.mutateAsync({
              path: '/communication/posts',
              body: { ...values, attachmentIds: attachments },
            });
            setOpen(false);
            form.resetFields();
            setAttachments([]);
          }}
        >
          <Form.Item name="courseId" label="所属课程" rules={[{ required: true, message: '请选择课程' }]}>
            <RemoteSelect endpoint="/courses" labelField="title" />
          </Form.Item>
          <Form.Item
            name="title"
            label="讨论标题"
            rules={[
              { required: true, message: '请输入标题' },
              { max: 160, message: '标题不超过 160 字' },
            ]}
          >
            <Input placeholder="用一句话描述你的问题或想法" />
          </Form.Item>
          <Form.Item name="body" label="讨论内容" rules={[{ required: true, message: '请输入讨论内容' }]}>
            <Input.TextArea rows={6} placeholder="补充背景、你的思考与需要的帮助…" />
          </Form.Item>
          <AttachmentUploader key={postCourse} courseId={postCourse} onChange={setAttachments} />
        </Form>
      </Modal>
      <Modal
        title="课程讨论"
        open={!!postId}
        onCancel={() => {
          setPostId(undefined);
          setQuote(undefined);
        }}
        footer={null}
        width={800}
      >
        <QueryState query={detail}>
          {post && (
            <>
              <h2 style={{ fontSize: 22, lineHeight: 1.7 }}>{post.title}</h2>
              <div className="discussion-meta">
                <span>{post.authorName}</span>
                <span>{date(post.createdAt)}</span>
                {post.solved && <Tag color="green">问题已解决</Tag>}
              </div>
              <div className="post-body">{post.body}</div>
              <AttachmentLinks attachments={post.attachments || post.attachmentIds} />
              <Space wrap style={{ marginBottom: 22 }}>
                {(teacher || post.authorId === user?.id) && (
                  <Button
                    size="small"
                    icon={<CheckCircle2 size={14} />}
                    onClick={() =>
                      action.mutate({
                        path: `/communication/posts/${post.id}`,
                        method: 'PATCH',
                        body: { solved: !post.solved },
                      })
                    }
                  >
                    {post.solved ? '标为未解决' : '标记已解决'}
                  </Button>
                )}
                {teacher && (
                  <>
                    <Button
                      size="small"
                      onClick={() =>
                        action.mutate({
                          path: `/communication/posts/${post.id}`,
                          method: 'PATCH',
                          body: { pinned: !post.pinned },
                        })
                      }
                    >
                      {post.pinned ? '取消置顶' : '置顶讨论'}
                    </Button>
                    <Button
                      size="small"
                      onClick={() =>
                        action.mutate({
                          path: `/communication/posts/${post.id}`,
                          method: 'PATCH',
                          body: { featured: !post.featured },
                        })
                      }
                    >
                      {post.featured ? '取消精华' : '设为精华'}
                    </Button>
                    <Button
                      size="small"
                      onClick={() =>
                        action.mutate({
                          path: `/communication/posts/${post.id}`,
                          method: 'PATCH',
                          body: { closed: !post.closed },
                        })
                      }
                    >
                      {post.closed ? '重新开放' : '关闭讨论'}
                    </Button>
                  </>
                )}
              </Space>
              <h3 style={{ fontSize: 14, margin: '15px 0' }}>
                全部回复 · {post.replyPage?.total ?? post.replies?.length ?? 0}
              </h3>
              {post.replies?.map((r: any) => (
                <div className="reply-item" key={r.id}>
                  <div className="reply-header">
                    <Avatar size={25}>{r.authorName?.slice(0, 1)}</Avatar>
                    <strong>{r.authorName}</strong>
                    <span>{date(r.createdAt)}</span>
                    <Button type="text" size="small" onClick={() => setQuote(r.id)}>
                      引用回复
                    </Button>
                  </div>
                  {r.quoteReplyId && <Tag>引用了上一条回复</Tag>}
                  <p>{r.body}</p>
                  <AttachmentLinks attachments={r.attachments || r.attachmentIds} />
                </div>
              ))}
              {post.replyPage?.total > 20 && (
                <div className="pagination-buttons">
                  <Button disabled={replyPage === 1} onClick={() => setReplyPage(replyPage - 1)}>
                    上一页回复
                  </Button>
                  <span>第 {replyPage} 页</span>
                  <Button
                    disabled={replyPage * 20 >= post.replyPage.total}
                    onClick={() => setReplyPage(replyPage + 1)}
                  >
                    下一页回复
                  </Button>
                </div>
              )}
              {post.closed ? (
                <Alert type="info" message="此讨论已关闭，无法继续回复。" />
              ) : (
                <div style={{ marginTop: 20 }}>
                  {quote && (
                    <Tag closable onClose={() => setQuote(undefined)}>
                      正在引用回复
                    </Tag>
                  )}
                  <Input.TextArea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={3}
                    placeholder="分享你的观点，友善交流…"
                  />
                  <AttachmentUploader
                    key={`${post.id}-${replyUploadKey}`}
                    courseId={post.courseId}
                    onChange={setReplyAttachments}
                  />
                  <div className="action-row">
                    <Button
                      type="primary"
                      icon={<Send size={14} />}
                      disabled={!reply.trim() || !canWrite}
                      loading={action.isPending}
                      onClick={async () => {
                        await action.mutateAsync({
                          path: `/communication/posts/${post.id}/replies`,
                          body: { body: reply, quoteReplyId: quote, attachmentIds: replyAttachments },
                        });
                        setReply('');
                        setQuote(undefined);
                        setReplyAttachments([]);
                        setReplyUploadKey(replyUploadKey + 1);
                      }}
                    >
                      发表回复
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </QueryState>
      </Modal>
      <Modal
        title="举报讨论内容"
        open={!!report}
        onCancel={() => setReport(null)}
        okButtonProps={{ disabled: !reason.trim() }}
        onOk={async () => {
          await action.mutateAsync({ path: '/communication/reports', body: { ...report, reason } });
          setReport(null);
        }}
      >
        <Input.TextArea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="请说明具体原因，以便管理员处理"
        />
      </Modal>
    </>
  );
}
function Messages({ initialConversation }: { initialConversation?: string }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [conversationPage, setConversationPage] = useState(1);
  const conversations = useData(
    `/communication/conversations?page=${conversationPage}&pageSize=20`,
    true,
    10000,
  );
  const blocks = useData('/communication/blocks');
  const [active, setActive] = useState<string | undefined>(initialConversation);
  const [page, setPage] = useState(1);
  const [body, setBody] = useState('');
  const [failed, setFailed] = useState<{
    conversationId: string;
    body: string;
    clientId: string;
    attachmentIds: string[];
  }>();
  const [sending, setSending] = useState(false);
  const [attachmentVersion, setAttachmentVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState<string>();
  const [classId, setClassId] = useState<string>();
  const classes = useData('/communication/classes');
  const [attachments, setAttachments] = useState<string[]>([]);
  const history = useData(
    `/communication/conversations/${active}/messages?${queryString({ page, pageSize: 30 })}`,
    !!active,
    5000,
  );
  const action = useAction('');
  const bottom = useRef<HTMLDivElement>(null);
  const { message } = App.useApp();
  const list = conversations.data?.items || [];
  const messages = [...(history.data?.items || [])].sort(
    (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  useEffect(() => {
    setBody('');
    setAttachments([]);
    setAttachmentVersion((v) => v + 1);
  }, [active]);
  useEffect(() => {
    if (!active && list[0]) setActive(list[0].id);
  }, [active, list[0]?.id]);
  useEffect(() => {
    if (messages.length && active) {
      const last = messages[messages.length - 1];
      send(`/communication/conversations/${active}/read`, { messageId: last.id })
        .then(() => {
          client.invalidateQueries({
            predicate: (query) => String(query.queryKey[0]).startsWith('/communication/conversations'),
          });
          client.invalidateQueries({ queryKey: ['/notifications?pageSize=1'] });
        })
        .catch(() => {});
      bottom.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [messages[messages.length - 1]?.id, active]);
  useEffect(() => {
    const sync = () => {
      history.refetch();
      conversations.refetch();
    };
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [active]);
  async function sendMessage(retry = false) {
    if (!active) return;
    const payload =
      retry && failed
        ? failed
        : {
            conversationId: active,
            body: body || '附件',
            clientId: crypto.randomUUID(),
            attachmentIds: attachments,
          };
    setSending(true);
    try {
      const { conversationId, ...request } = payload;
      await send(`/communication/conversations/${conversationId}/messages`, request);
      if (active === conversationId) setBody('');
      setFailed(undefined);
      setAttachments([]);
      setAttachmentVersion(attachmentVersion + 1);
      history.refetch();
      conversations.refetch();
    } catch (e) {
      setFailed(payload);
      message.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <div className="messaging-layout">
        <div className="conversation-list">
          <div className="conversation-heading">
            我的会话
            <Button
              size="small"
              type="text"
              icon={<Plus size={17} />}
              aria-label="新建会话"
              disabled={!user?.permissions.includes('communication.write')}
              onClick={() => setOpen(true)}
            />
          </div>
          <QueryState query={conversations}>
            {list.length ? (
              list.map((c: any) => (
                <button
                  key={c.id}
                  className={`conversation-row ${active === c.id ? 'active' : ''}`}
                  onClick={() => {
                    setActive(c.id);
                    setPage(1);
                  }}
                >
                  <Avatar style={{ background: '#e9f2fc', color: '#206bc4' }}>
                    {c.title?.slice(0, 1) || '聊'}
                  </Avatar>
                  <div>
                    <strong>{c.title || '师生交流'}</strong>
                    <p>
                      {typeof c.lastMessage === 'string'
                        ? c.lastMessage
                        : c.lastMessage?.body || '开始新的交流'}
                    </p>
                  </div>
                  <Badge count={c.unreadCount} size="small" />
                </button>
              ))
            ) : (
              <EmptyState description="还没有会话" />
            )}
          </QueryState>
          <Pagination
            simple
            current={conversationPage}
            pageSize={20}
            total={conversations.data?.total}
            onChange={setConversationPage}
            showSizeChanger={false}
            hideOnSinglePage
            style={{ padding: 12 }}
          />
        </div>
        <div className="chat-panel">
          {active ? (
            <>
              <div className="chat-header">
                <strong>{list.find((c: any) => c.id === active)?.title || '师生交流'}</strong>
                <span>消息持久化 · 自动同步</span>
              </div>
              <div className="chat-messages">
                <QueryState query={history}>
                  {history.data?.total > page * 30 && (
                    <Button size="small" type="text" onClick={() => setPage(page + 1)}>
                      查看更早的消息
                    </Button>
                  )}
                  {page > 1 && (
                    <Button size="small" type="text" onClick={() => setPage(page - 1)}>
                      返回更新的消息
                    </Button>
                  )}
                  {messages.map((m: any) => (
                    <div key={m.id} className={`chat-message ${m.senderId === user?.id ? 'mine' : ''}`}>
                      <Avatar size={29} style={{ background: '#e9f2fc', color: '#206bc4' }}>
                        {m.senderName?.slice(0, 1)}
                      </Avatar>
                      <div className="chat-message-content">
                        <span>
                          {m.senderName} · {date(m.createdAt)}
                        </span>
                        <div className={`chat-bubble ${m.retractedAt ? 'retracted' : ''}`}>
                          {m.retractedAt ? '这条消息已撤回' : m.body}
                          {!m.retractedAt && (
                            <AttachmentLinks attachments={m.attachments || m.attachmentIds} />
                          )}
                        </div>
                        {m.senderId === user?.id && !m.retractedAt && (
                          <Popconfirm
                            title="撤回这条消息？"
                            onConfirm={() =>
                              action.mutateAsync({
                                path: `/communication/messages/${m.id}`,
                                method: 'DELETE',
                              })
                            }
                          >
                            <Button type="text" size="small" style={{ fontSize: 12, color: '#626976' }}>
                              撤回
                            </Button>
                          </Popconfirm>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={bottom} />
                </QueryState>
              </div>
              {failed && (
                <Alert
                  type="error"
                  showIcon
                  message="消息未发送，请重试"
                  action={
                    <Space>
                      <Button size="small" loading={sending} onClick={() => sendMessage(true)}>
                        重试原会话消息
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          setFailed(undefined);
                          setBody('');
                        }}
                      >
                        放弃发送
                      </Button>
                    </Space>
                  }
                />
              )}
              <div className="chat-compose">
                <AttachmentUploader
                  disabled={!!failed || sending}
                  key={`${active}-${attachmentVersion}`}
                  conversationId={active}
                  onChange={setAttachments}
                />
                <Input.TextArea
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={!!failed || sending}
                  placeholder="输入消息，Ctrl + Enter 发送"
                  onKeyDown={(e) => {
                    if (!failed && (e.ctrlKey || e.metaKey) && e.key === 'Enter' && body.trim())
                      sendMessage();
                  }}
                />
                <Button
                  type="primary"
                  loading={sending}
                  disabled={
                    !!failed ||
                    (!body.trim() && !attachments.length) ||
                    !user?.permissions.includes('communication.write')
                  }
                  icon={<Send size={15} />}
                  onClick={() => sendMessage()}
                >
                  发送
                </Button>
              </div>
            </>
          ) : (
            <EmptyState description="选择会话，开始交流" />
          )}
        </div>
      </div>
      <Modal title="开始新会话" open={open} onCancel={() => setOpen(false)} footer={null}>
        <Tabs
          items={[
            {
              key: 'direct',
              label: '师生私信',
              children: (
                <>
                  <p className="form-hint">仅列出与你有共同课程、且符合师生交流策略的联系人。</p>
                  <RemoteSelect
                    endpoint="/communication/contacts"
                    searchParam="q"
                    value={contact}
                    onChange={setContact}
                    placeholder="搜索并选择联系人"
                    labelFor={(record) => `${record.name} · ${record.courseNames?.join('、') || '共同课程'}`}
                  />
                  <div className="action-row">
                    <Button
                      type="primary"
                      disabled={!contact}
                      onClick={async () => {
                        const c = await action.mutateAsync({
                          path: '/communication/conversations',
                          body: { userId: contact },
                        });
                        setActive(c.id);
                        setOpen(false);
                      }}
                    >
                      开始会话
                    </Button>
                    <Popconfirm
                      title="屏蔽后将无法互相发送私信，确认屏蔽？"
                      onConfirm={() =>
                        action.mutateAsync({ path: '/communication/blocks', body: { userId: contact } })
                      }
                    >
                      <Button danger disabled={!contact}>
                        屏蔽此人
                      </Button>
                    </Popconfirm>
                  </div>
                </>
              ),
            },
            {
              key: 'blocks',
              label: '屏蔽名单',
              children: (
                <Table
                  rowKey="userId"
                  dataSource={blocks.data?.items || []}
                  pagination={false}
                  columns={[
                    { title: '姓名', dataIndex: 'name' },
                    {
                      title: '操作',
                      render: (_, r: any) => (
                        <Button
                          type="link"
                          onClick={() =>
                            action.mutate({ path: `/communication/blocks/${r.userId}`, method: 'DELETE' })
                          }
                        >
                          取消屏蔽
                        </Button>
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'class',
              label: '班级交流',
              children: (
                <>
                  <Select
                    value={classId}
                    onChange={setClassId}
                    placeholder="选择班级"
                    style={{ width: '100%' }}
                    options={(classes.data?.items || []).map((c: any) => ({ value: c.id, label: c.name }))}
                  />
                  <div className="action-row">
                    <Button
                      type="primary"
                      disabled={!classId}
                      onClick={async () => {
                        const c = await action.mutateAsync({
                          path: `/communication/classes/${classId}/conversation`,
                        });
                        setActive(c.id);
                        setOpen(false);
                      }}
                    >
                      进入班级交流
                    </Button>
                  </div>
                </>
              ),
            },
          ]}
        />
      </Modal>
    </>
  );
}
export function Notifications() {
  const [type, setType] = useState<string>();
  const [page, setPage] = useState(1);
  const query = useData(`/notifications?${queryString({ type, page, pageSize: 15 })}`);
  const action = useAction('');
  const navigate = useNavigate();
  return (
    <>
      <PageTitle
        eyebrow="NOTIFICATIONS"
        title="消息通知"
        description={`你有 ${query.data?.unreadCount || 0} 条未读消息，及时掌握学习与教学动态。`}
        extra={
          <Button
            icon={<CheckCheck size={16} />}
            loading={action.isPending}
            onClick={() => action.mutate({ path: '/notifications/read-all' })}
          >
            全部标为已读
          </Button>
        }
      />
      <div className="filter-bar">
        <Select
          value={type}
          onChange={(value) => {
            setType(value);
            setPage(1);
          }}
          placeholder="全部消息类型"
          allowClear
          style={{ width: 180 }}
          options={[
            { value: 'assignment', label: '作业通知' },
            { value: 'exam', label: '考试通知' },
            { value: 'grade', label: '成绩通知' },
            { value: 'DISCUSSION_REPLY', label: '讨论回复' },
            { value: 'PRIVATE_MESSAGE', label: '私信通知' },
            { value: 'ANNOUNCEMENT', label: '课程公告' },
          ]}
        />
      </div>
      <Panel>
        <QueryState query={query}>
          {query.data?.items?.length ? (
            query.data.items.map((n: any) => (
              <div className={`notification ${n.readAt ? 'read' : ''}`} key={n.id}>
                <span className="notification-dot" />
                <div className="notification-main">
                  <strong>{n.title}</strong>
                  <p>{n.body || n.content}</p>
                  <time>{date(n.createdAt)}</time>
                </div>
                <Space direction="vertical">
                  {!n.readAt && (
                    <Button
                      size="small"
                      type="text"
                      onClick={() => action.mutate({ path: `/notifications/${n.id}/read` })}
                    >
                      标为已读
                    </Button>
                  )}
                  {(n.path || n.link) && (
                    <Button
                      size="small"
                      type="link"
                      onClick={async () => {
                        await action.mutateAsync({ path: `/notifications/${n.id}/read` });
                        navigate(n.path || n.link);
                      }}
                    >
                      查看详情
                      <ArrowUpRight size={13} />
                    </Button>
                  )}
                </Space>
              </div>
            ))
          ) : (
            <EmptyState description="暂无消息通知" />
          )}
          {query.data?.total > 15 && (
            <div className="pagination-buttons">
              <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                上一页
              </Button>
              <span>第 {page} 页</span>
              <Button disabled={page * 15 >= query.data.total} onClick={() => setPage(page + 1)}>
                下一页
              </Button>
            </div>
          )}
        </QueryState>
      </Panel>
    </>
  );
}
export function Moderation() {
  const [tab, setTab] = useState('reports');
  const [page, setPage] = useState(1);
  const query = useData(
    `/communication/${tab}?${queryString({ status: tab === 'reports' ? 'ALL' : undefined, page, pageSize: 15 })}`,
  );
  const people = useData('/admin/people?pageSize=100');
  const action = useAction('处理记录已保存');
  const [record, setRecord] = useState<any>();
  const [reason, setReason] = useState('');
  const [resolution, setResolution] = useState('dismiss');
  const [muteOpen, setMuteOpen] = useState(false);
  const [form] = Form.useForm();
  return (
    <>
      <PageTitle
        eyebrow="CONTENT GOVERNANCE"
        title="内容治理"
        description="根据实际举报处理内容，每次操作记录原因与处理人。"
        extra={
          tab === 'mutes' && (
            <Button type="primary" onClick={() => setMuteOpen(true)}>
              添加禁言记录
            </Button>
          )
        }
      />
      <Panel>
        <Tabs
          activeKey={tab}
          onChange={(v) => {
            setTab(v);
            setPage(1);
          }}
          items={[
            { key: 'reports', label: '内容举报' },
            { key: 'mutes', label: '禁言记录' },
          ]}
        />
        <QueryState query={query}>
          <Table
            rowKey="id"
            dataSource={query.data?.items || []}
            columns={
              tab === 'reports'
                ? [
                    { title: '举报时间', dataIndex: 'createdAt', render: (v: string) => date(v) },
                    { title: '内容类型', dataIndex: 'targetType' },
                    { title: '原因', dataIndex: 'reason' },
                    { title: '状态', dataIndex: 'status', render: (v: string) => <Tag>{v || '待处理'}</Tag> },
                    {
                      title: '操作',
                      render: (_: any, r: any) => (
                        <Button
                          type="link"
                          onClick={() => {
                            setRecord(r);
                            setReason('');
                          }}
                        >
                          查看并处理
                        </Button>
                      ),
                    },
                  ]
                : [
                    {
                      title: '用户',
                      render: (_: any, r: any) =>
                        r.userName ||
                        people.data?.items?.find((p: any) => p.id === r.userId)?.name ||
                        r.userId,
                    },
                    { title: '原因', dataIndex: 'reason' },
                    { title: '截止时间', dataIndex: 'expiresAt', render: (v: string) => date(v) },
                    {
                      title: '操作',
                      render: (_: any, r: any) => (
                        <Popconfirm
                          title="解除此禁言？"
                          onConfirm={() =>
                            action.mutateAsync({ path: `/communication/mutes/${r.id}`, method: 'DELETE' })
                          }
                        >
                          <Button type="link">解除禁言</Button>
                        </Popconfirm>
                      ),
                    },
                  ]
            }
            pagination={{
              current: page,
              pageSize: 15,
              total: query.data?.total,
              onChange: setPage,
              showSizeChanger: false,
            }}
          />
        </QueryState>
      </Panel>
      <Modal
        title="处理内容举报"
        open={!!record}
        onCancel={() => setRecord(undefined)}
        onOk={async () => {
          await action.mutateAsync({
            path: `/communication/reports/${record.id}/resolve`,
            body: { action: resolution, reason },
          });
          setRecord(undefined);
        }}
        okButtonProps={{ disabled: reason.trim().length < 3 || record?.status !== 'PENDING' }}
      >
        <Alert
          showIcon
          type="info"
          message={record?.reason || '请核对举报内容后处理'}
          style={{ marginBottom: 20 }}
        />
        {record?.target && (
          <div className="post-body">
            <strong>{record.target.title}</strong>
            <p>{record.target.body}</p>
          </div>
        )}
        {record?.privateContentRestricted && (
          <Alert type="info" message="私人内容需要独立授权，此页面仅显示举报元数据。" />
        )}
        <div className="form-hint">内容标识：{record?.targetId}</div>
        <Select
          value={resolution}
          onChange={setResolution}
          style={{ width: '100%', marginBottom: 16 }}
          options={[
            { value: 'dismiss', label: '驳回举报' },
            { value: 'hide', label: '隐藏违规内容' },
          ]}
        />
        <Input.TextArea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="填写处理理由"
        />
      </Modal>
      <Modal
        title="添加禁言记录"
        open={muteOpen}
        onCancel={() => setMuteOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={action.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            await action.mutateAsync({
              path: '/communication/mutes',
              body: { ...values, expiresAt: new Date(values.expiresAt + '+08:00').toISOString() },
            });
            setMuteOpen(false);
            form.resetFields();
          }}
        >
          <Form.Item name="userId" label="用户" rules={[{ required: true, message: '请选择用户' }]}>
            <RemoteSelect endpoint="/admin/people" />
          </Form.Item>
          <Form.Item name="courseId" label="课程范围（留空为机构范围）">
            <RemoteSelect endpoint="/courses" labelField="title" allowClear />
          </Form.Item>
          <Form.Item
            name="expiresAt"
            label="截止时间"
            rules={[{ required: true, message: '请选择截止时间' }]}
          >
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item
            name="reason"
            label="禁言原因"
            rules={[{ required: true, min: 3, message: '请填写至少 3 字的原因' }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
