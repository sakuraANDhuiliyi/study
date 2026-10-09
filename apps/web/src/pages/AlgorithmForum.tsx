import { useState } from 'react';
import { Alert, App, Button, Input, Modal, Pagination, Popconfirm, Select, Tabs, Tag } from 'antd';
import { ArrowLeft, MessageSquare, Plus, Pin, Lock, CheckCircle2, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { date, queryString, send, useData } from '../api';
import { EmptyState, PageTitle, QueryState, useUnsavedWarning } from '../components/shared';
import './algorithm-forum.css';
type Scope = 'public' | 'organization';
type Kind = 'question' | 'solution' | 'discussion';
type Problem = { id: string; title: string; number: number };
type ForumStatus = { canWrite: boolean; canOrganization: boolean; problems: Problem[] };
export type ForumPost = {
  id: string;
  scope: Scope;
  kind: Kind;
  title: string;
  body?: string;
  excerpt?: string;
  problemId: string | null;
  problem: Problem | null;
  revision: number;
  pinned: boolean;
  closed: boolean;
  solved: boolean;
  authorLabel: string;
  isOwn: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canModerate: boolean;
  canSolve: boolean;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
};
type Reply = {
  id: string;
  body: string;
  revision: number;
  authorLabel: string;
  isOwn: boolean;
  canDelete: boolean;
  createdAt: string;
};
type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
const kindOptions = [
  { value: 'question', label: '提问' },
  { value: 'solution', label: '题解' },
  { value: 'discussion', label: '交流' },
];
const scopeName = (scope: Scope) => (scope === 'public' ? '公共社区' : '本机构讨论');
const kindName = (kind: Kind) => kindOptions.find((item) => item.value === kind)?.label || kind;
function PostBadges({ post }: { post: ForumPost }) {
  return (
    <div className="forum-badges">
      <Tag color={post.scope === 'public' ? 'blue' : 'purple'}>{scopeName(post.scope)}</Tag>
      <Tag>{kindName(post.kind)}</Tag>
      {post.pinned && <Tag icon={<Pin size={12} />}>置顶</Tag>}
      {post.solved && (
        <Tag color="green" icon={<CheckCircle2 size={12} />}>
          已解决
        </Tag>
      )}
      {post.closed && <Tag icon={<Lock size={12} />}>已关闭</Tag>}
    </div>
  );
}
function CreatePost({
  open,
  onClose,
  scope,
  problemId,
  status,
}: {
  open: boolean;
  onClose: () => void;
  scope: Scope;
  problemId?: string;
  status: ForumStatus;
}) {
  const [selectedScope, setScope] = useState<Scope>(status.canOrganization ? scope : 'public');
  const [kind, setKind] = useState<Kind>('question');
  const [problem, setProblem] = useState<string | undefined>(problemId);
  const [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const navigate = useNavigate(),
    client = useQueryClient();
  useUnsavedWarning(Boolean(title || body));
  async function create() {
    setError('');
    setBusy(true);
    try {
      const post = await send('/algorithm-forum/posts', {
        scope: selectedScope,
        kind,
        ...(problem ? { problemId: problem } : {}),
        title,
        body,
      });
      await client.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith('/algorithm-forum'),
      });
      onClose();
      navigate(`/algorithms/forum/${post.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      title="发表算法讨论"
      onCancel={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button type="primary" loading={busy} disabled={!title.trim() || !body.trim()} onClick={create}>
            确认发表到{scopeName(selectedScope)}
          </Button>
        </>
      }
    >
      <div className="forum-form">
        <label>
          可见范围
          <Select
            aria-label="讨论可见范围"
            value={selectedScope}
            onChange={setScope}
            disabled={busy}
            options={[
              { value: 'public', label: '公共社区：全站已登录用户可见' },
              ...(status.canOrganization
                ? [{ value: 'organization', label: '本机构：仅本机构用户可见' }]
                : []),
            ]}
          />
        </label>
        <Alert
          type={selectedScope === 'public' ? 'warning' : 'info'}
          showIcon
          message={
            selectedScope === 'public'
              ? '发表后全站已登录用户可见。请勿包含真实姓名、账号、密钥或其他私人资料。'
              : '仅当前学校 / 机构用户可见。发表后不能改变可见范围。'
          }
        />
        <label>
          讨论类型
          <Select
            aria-label="讨论类型"
            value={kind}
            onChange={setKind}
            options={kindOptions}
            disabled={busy}
          />
        </label>
        <label>
          关联题目
          <Select
            aria-label="关联算法题目"
            showSearch
            optionFilterProp="label"
            allowClear
            value={problem}
            onChange={setProblem}
            disabled={busy || Boolean(problemId)}
            placeholder="可选：关联一道算法题"
            options={status.problems.map((p) => ({ value: p.id, label: `${p.number}. ${p.title}` }))}
          />
        </label>
        <label>
          讨论标题
          <Input
            aria-label="讨论标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            disabled={busy}
          />
        </label>
        <label>
          讨论内容
          <Input.TextArea
            aria-label="讨论内容"
            rows={9}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={15000}
            showCount
            disabled={busy}
            placeholder="描述问题、你的思路或代码。内容按普通文本显示，可直接粘贴代码。"
          />
        </label>
        {error && <Alert type="error" showIcon message={error} />}
      </div>
    </Modal>
  );
}
export function ForumFeed({ problemId, compact = false }: { problemId?: string; compact?: boolean }) {
  const [params, setParams] = useSearchParams();
  const [localScope, setLocalScope] = useState<Scope>('public'),
    [localPage, setLocalPage] = useState(1),
    [create, setCreate] = useState(false);
  const scope = compact ? localScope : params.get('scope') || 'public';
  const page = compact ? localPage : Math.max(1, Number(params.get('page') || 1) || 1);
  const selectedProblem = problemId || (compact ? undefined : params.get('problemId') || undefined);
  const q = compact ? undefined : params.get('q') || undefined;
  const kind = compact ? undefined : params.get('kind') || undefined;
  const status = useData<ForumStatus>('/algorithm-forum/status');
  const query = useData<Page<ForumPost>>(
    `/algorithm-forum/posts?${queryString({ scope, page, pageSize: compact ? 8 : 20, problemId: selectedProblem, q, kind })}`,
  );
  function filter(key: string, value?: string) {
    const next = new URLSearchParams(params);
    next.delete('page');
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }
  return (
    <div className={`forum-feed ${compact ? 'forum-feed-compact' : ''}`}>
      <div className="forum-feed-heading">
        <div>
          <h2>{compact ? '题目讨论' : '一起交流算法思路'}</h2>
          <p>
            {compact
              ? '提问、分享题解，或帮助其他同学。'
              : '公共社区与机构讨论分别展示，帖子使用学习者别名。'}
          </p>
        </div>
        <Button
          type="primary"
          icon={<Plus size={15} />}
          disabled={!status.data?.canWrite}
          onClick={() => setCreate(true)}
        >
          发表讨论
        </Button>
      </div>
      <QueryState query={status}>
        <Tabs
          activeKey={scope}
          onChange={(value) => {
            if (compact) {
              setLocalScope(value as Scope);
              setLocalPage(1);
            } else filter('scope', value);
          }}
          items={[
            { key: 'public', label: '公共社区' },
            ...(status.data?.canOrganization ? [{ key: 'organization', label: '本机构讨论' }] : []),
          ]}
        />
        {!compact && (
          <div className="forum-filters">
            <Input.Search
              aria-label="搜索算法讨论"
              placeholder="搜索标题或内容"
              defaultValue={q}
              allowClear
              onSearch={(value) => filter('q', value.trim())}
            />
            <Select
              aria-label="筛选讨论类型"
              allowClear
              placeholder="全部类型"
              value={kind}
              options={kindOptions}
              onChange={(value) => filter('kind', value)}
            />
            <Select
              aria-label="筛选关联题目"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="全部题目"
              value={selectedProblem}
              options={status.data?.problems.map((p) => ({ value: p.id, label: `${p.number}. ${p.title}` }))}
              onChange={(value) => filter('problemId', value)}
            />
          </div>
        )}
        <QueryState query={query}>
          {query.data?.items.length === 0 && (
            <EmptyState description="这里还没有讨论，分享你的第一个思路吧。" />
          )}
          <div className="forum-post-list">
            {query.data?.items.map((post) => (
              <article key={post.id}>
                <PostBadges post={post} />
                <h3>
                  <Link to={`/algorithms/forum/${post.id}`}>{post.title}</Link>
                </h3>
                <p className="forum-excerpt">{post.excerpt}</p>
                <div className="forum-meta">
                  <span>
                    {post.authorLabel}
                    {post.isOwn ? '（我）' : ''}
                  </span>
                  <time>{date(post.createdAt)}</time>
                  <span>
                    <MessageSquare size={13} />
                    {post.replyCount} 回复
                  </span>
                  {post.problem && (
                    <span>
                      题目 {post.problem.number} · {post.problem.title}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
          {(query.data?.total || 0) > (compact ? 8 : 20) && (
            <Pagination
              current={page}
              pageSize={compact ? 8 : 20}
              total={query.data?.total}
              showSizeChanger={false}
              onChange={(value) => {
                if (compact) setLocalPage(value);
                else {
                  const next = new URLSearchParams(params);
                  next.set('page', String(value));
                  setParams(next);
                }
              }}
            />
          )}
        </QueryState>
      </QueryState>
      {compact && (
        <Link className="forum-all-link" to={`/algorithms/forum?${queryString({ scope, problemId })}`}>
          打开完整论坛与筛选
        </Link>
      )}
      {create && status.data && (
        <CreatePost
          open
          scope={scope === 'organization' ? 'organization' : 'public'}
          problemId={selectedProblem}
          status={status.data}
          onClose={() => setCreate(false)}
        />
      )}
    </div>
  );
}
function ForumDetail({ id }: { id: string }) {
  const query = useData<ForumPost>(`/algorithm-forum/posts/${id}`),
    status = useData<ForumStatus>('/algorithm-forum/status');
  const [page, setPage] = useState(1),
    [reply, setReply] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const replies = useData<Page<Reply>>(
    `/algorithm-forum/posts/${id}/replies?page=${page}&pageSize=20`,
    Boolean(query.data),
  );
  const [edit, setEdit] = useState<{ title: string; body: string; revision: number } | null>(null);
  const client = useQueryClient(),
    navigate = useNavigate(),
    { message } = App.useApp();
  useUnsavedWarning(Boolean(reply.trim() || edit));
  const post = query.data;
  async function action(path: string, body: unknown, method = 'POST', success?: () => void) {
    setBusy(true);
    setError('');
    try {
      await send(path, body, method);
      success?.();
      await client.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith('/algorithm-forum'),
      });
      message.success('操作成功');
    } catch (e) {
      setError((e as Error).message);
      if ((e as { status?: number }).status === 409) await query.refetch();
    } finally {
      setBusy(false);
    }
  }
  function moderate(flag: string, value: boolean) {
    if (post)
      void action(
        `/algorithm-forum/posts/${id}/moderation`,
        { revision: post.revision, [flag]: value },
        'PATCH',
      );
  }
  return (
    <div className="forum-detail">
      <Link className="forum-back" to={`/algorithms/forum?scope=${post?.scope || 'public'}`}>
        <ArrowLeft size={15} />
        返回算法论坛
      </Link>
      <QueryState query={query}>
        {post && (
          <>
            <article className="forum-topic">
              <PostBadges post={post} />
              <h1>{post.title}</h1>
              <div className="forum-meta">
                <span>
                  {post.authorLabel}
                  {post.isOwn ? '（我）' : ''}
                </span>
                <time>{date(post.createdAt)}</time>
                <span>{post.replyCount} 回复</span>
              </div>
              {post.problem && (
                <Link className="forum-problem-link" to={`/algorithms/${post.problem.id}`}>
                  关联题目：{post.problem.number} · {post.problem.title}
                </Link>
              )}
              <div className="forum-plain-content">{post.body}</div>
              <div className="forum-actions">
                {post.canEdit && !post.closed && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      setEdit({ title: post.title, body: post.body || '', revision: post.revision })
                    }
                  >
                    编辑帖子
                  </Button>
                )}
                {post.canSolve && (
                  <Button disabled={busy} onClick={() => moderate('solved', !post.solved)}>
                    {post.solved ? '取消已解决' : '标记已解决'}
                  </Button>
                )}
                {post.canModerate && (
                  <>
                    <Button disabled={busy} onClick={() => moderate('pinned', !post.pinned)}>
                      {post.pinned ? '取消置顶' : '置顶讨论'}
                    </Button>
                    <Button disabled={busy} onClick={() => moderate('closed', !post.closed)}>
                      {post.closed ? '重新开放' : '关闭讨论'}
                    </Button>
                  </>
                )}
                {post.canDelete && (
                  <Popconfirm
                    title="删除这篇讨论及其展示内容？"
                    description="删除后帖子与回复不再显示，审计记录仍保留。"
                    okText="确认删除"
                    cancelText="取消"
                    onConfirm={() =>
                      action(`/algorithm-forum/posts/${id}`, { revision: post.revision }, 'DELETE', () =>
                        navigate(`/algorithms/forum?scope=${post.scope}`),
                      )
                    }
                  >
                    <Button danger disabled={busy} icon={<Trash2 size={13} />}>
                      删除讨论
                    </Button>
                  </Popconfirm>
                )}
              </div>
            </article>
            {error && (
              <Alert
                type="error"
                showIcon
                message={error}
                description="尚未发送的输入会保留，请确认最新讨论状态后重试。"
              />
            )}
            <section className="forum-replies">
              <h2>回复与讨论</h2>
              <QueryState query={replies}>
                {!replies.data?.items.length && (
                  <EmptyState description="还没有回复，试着分享一个提示或不同解法。" />
                )}
                {replies.data?.items.map((row) => (
                  <article key={row.id}>
                    <div className="forum-meta">
                      <strong>
                        {row.authorLabel}
                        {row.isOwn ? '（我）' : ''}
                      </strong>
                      <time>{date(row.createdAt)}</time>
                      {row.canDelete && (
                        <Popconfirm
                          title="删除此回复？"
                          okText="确认删除回复"
                          cancelText="取消"
                          onConfirm={() =>
                            action(
                              `/algorithm-forum/posts/${id}/replies/${row.id}`,
                              { revision: row.revision },
                              'DELETE',
                            )
                          }
                        >
                          <Button size="small" type="text" danger disabled={busy}>
                            删除回复
                          </Button>
                        </Popconfirm>
                      )}
                    </div>
                    <div className="forum-plain-content">{row.body}</div>
                  </article>
                ))}
                {(replies.data?.total || 0) > 20 && (
                  <Pagination
                    current={page}
                    pageSize={20}
                    showSizeChanger={false}
                    total={replies.data?.total}
                    onChange={setPage}
                  />
                )}
              </QueryState>
            </section>
            <section className="forum-reply-form">
              <h2>发表回复</h2>
              {post.closed ? (
                <Alert type="info" showIcon message="讨论已关闭，不再接受回复。" />
              ) : !status.data?.canWrite ? (
                <Alert type="info" showIcon message="当前身份可阅读，暂无发言权限。" />
              ) : (
                <>
                  <p>回复将与帖子一样在{scopeName(post.scope)}内可见。请勿公开私人资料。</p>
                  <Input.TextArea
                    aria-label="回复内容"
                    rows={6}
                    maxLength={15000}
                    showCount
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    disabled={busy}
                  />
                  <Button
                    type="primary"
                    loading={busy}
                    disabled={!reply.trim()}
                    onClick={() =>
                      action(
                        `/algorithm-forum/posts/${id}/replies`,
                        { postRevision: post.revision, body: reply },
                        'POST',
                        () => {
                          setReply('');
                          setPage(Math.ceil(((replies.data?.total || 0) + 1) / 20));
                        },
                      )
                    }
                  >
                    发表回复
                  </Button>
                </>
              )}
            </section>
            {edit && (
              <Modal
                open
                title="编辑讨论内容"
                onCancel={() => {
                  if (!busy) setEdit(null);
                }}
                footer={
                  <>
                    <Button disabled={busy} onClick={() => setEdit(null)}>
                      取消编辑
                    </Button>
                    <Button
                      type="primary"
                      loading={busy}
                      disabled={!edit.title.trim() || !edit.body.trim() || edit.revision !== post.revision}
                      onClick={() =>
                        action(`/algorithm-forum/posts/${id}`, edit, 'PATCH', () => setEdit(null))
                      }
                    >
                      保存讨论修改
                    </Button>
                  </>
                }
              >
                <div className="forum-form">
                  <Alert
                    type="info"
                    showIcon
                    message={`可见范围为${scopeName(post.scope)}，范围与关联题目不可在编辑时改变。`}
                  />
                  <label>
                    标题
                    <Input
                      aria-label="编辑讨论标题"
                      maxLength={160}
                      value={edit.title}
                      onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                      disabled={busy}
                    />
                  </label>
                  <label>
                    内容
                    <Input.TextArea
                      aria-label="编辑讨论内容"
                      maxLength={15000}
                      rows={10}
                      value={edit.body}
                      onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                      disabled={busy}
                    />
                  </label>
                  {error && <Alert type="error" showIcon message={error} />}
                  {edit.revision !== post.revision && (
                    <>
                      <Alert
                        type="warning"
                        showIcon
                        message="帖子已在其他页面更新。你的输入仍保留，请查看最新内容后再继续编辑。"
                      />
                      <details>
                        <summary>查看最新帖子内容</summary>
                        <strong>{post.title}</strong>
                        <div className="forum-plain-content">{post.body}</div>
                      </details>
                      <Button disabled={busy} onClick={() => setEdit({ ...edit, revision: post.revision })}>
                        基于最新版本继续编辑
                      </Button>
                    </>
                  )}
                </div>
              </Modal>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}
export default function AlgorithmForum() {
  const { postId } = useParams();
  return (
    <div className="algorithm-forum-page">
      {postId ? (
        <ForumDetail key={postId} id={postId} />
      ) : (
        <>
          <PageTitle
            eyebrow="ALGORITHM COMMUNITY"
            title="算法论坛"
            description="在公共社区交流，在学校 / 机构内展开讨论。"
          />
          <ForumFeed />
        </>
      )}
    </div>
  );
}
