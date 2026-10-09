import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Pagination,
  Segmented,
  Select,
  Space,
  Tabs,
  Tag,
} from 'antd';
import {
  ArrowLeft,
  Bookmark,
  Check,
  Code2,
  Download,
  ExternalLink,
  FolderPlus,
  Github,
  Play,
  Sparkles,
} from 'lucide-react';
import { queryString, send, useData } from '../api';
import { PageTitle, QueryState } from '../components/shared';
import './creative.css';

type Source = {
  repository: string;
  commit: string;
  license: string;
  licenseText?: string;
  files?: { title: string; url: string }[];
  videos: {
    platform: string;
    title: string;
    url: string;
    repository?: string;
    relation?: 'source' | 'inspiration';
  }[];
  scope?: string;
  changes?: string;
};
type Idea = {
  id: string;
  edition: 1 | 2;
  title: string;
  category: string;
  tags: string[];
  description: string;
  learningGoals: string[];
  coverUrl: string;
  saved: boolean;
  source: Source;
  revision: string;
  files?: { path: string; content: string }[];
};
type Listing = {
  items: Idea[];
  total: number;
  totalCatalog: number;
  newCount: number;
  savedCount: number;
  repositoryCount: number;
  categories: { name: string; count: number }[];
  page: number;
  pageSize: number;
};
type Preview = { url: string; nonce: string; expiresAt: string };
const failure = (error: unknown) =>
  error instanceof Error ? error.message : '操作暂时无法完成，请稍后重试。';

export function Creative() {
  const { ideaId } = useParams();
  return (
    <div className="creative-page">
      {ideaId ? <CreativeDetail key={ideaId} id={ideaId} /> : <CreativeGallery />}
    </div>
  );
}

function CreativeGallery() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [collection, setCollection] = useState('all');
  const [edition, setEdition] = useState('all');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState('');
  const [brokenCovers, setBrokenCovers] = useState<string[]>([]);
  const query = useData<Listing>(
    `/programming/creative?${queryString({ q, category, collection, edition: edition === 'all' ? undefined : edition, page, pageSize: 12 })}`,
  );
  const { message } = App.useApp();
  const client = useQueryClient();
  const total = query.data?.total;
  useEffect(() => {
    if (total === undefined) return;
    const lastPage = Math.max(1, Math.ceil(total / 12));
    if (page > lastPage) setPage(lastPage);
  }, [total, page]);
  async function favorite(item: Idea) {
    if (busy) return;
    setBusy(item.id);
    try {
      await send(`/programming/creative/${item.id}/favorite`, { saved: !item.saved }, 'PUT');
      await client.invalidateQueries({
        predicate: (query) => String(query.queryKey[0]).startsWith('/programming/creative'),
      });
    } catch (error) {
      message.error(failure(error));
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="IDEAS TO INTERFACES"
        title="创意广场"
        description="探索开源界面的布局、动效与交互，把喜欢的创意变成自己的编程作品。"
        extra={
          <Link to="/programming">
            <Button icon={<Code2 size={16} />}>我的编程项目</Button>
          </Link>
        }
      />
      <section className="creative-hero">
        <div>
          <span className="creative-hero-label">
            <Sparkles size={15} /> UI 灵感与交互实验
          </span>
          <h2>把灵感，变成可以亲手探索的世界</h2>
          <p>探索沉浸展馆、空间工作台与叙事交互，阅读对应源码，再创建自己的编程作品。</p>
        </div>
        <div className="creative-hero-count">
          <strong>{query.data?.totalCatalog ?? '—'}</strong>
          <span>独立创意作品</span>
          <small>{query.data?.repositoryCount ?? '—'} 个开源项目来源</small>
        </div>
      </section>
      {!!query.data?.newCount && (
        <div className="creative-series">
          <Segmented
            aria-label="创意批次"
            value={edition}
            options={[
              { value: 'all', label: `全部作品 · ${query.data.totalCatalog}` },
              { value: 'new', label: `本次新增 · ${query.data.newCount}` },
              { value: 'foundation', label: '第一批作品' },
            ]}
            onChange={(value) => {
              setEdition(String(value));
              setPage(1);
            }}
          />
          <span>完整场景 · 多步骤交互 · 来源可追溯</span>
        </div>
      )}
      <div className="creative-filters">
        <Input.Search
          aria-label="搜索创意"
          placeholder="搜索界面、效果、交互或 GitHub 项目"
          allowClear
          enterButton="搜索"
          onSearch={(value) => {
            setQ(value.trim());
            setPage(1);
          }}
        />
        <Select
          aria-label="创意分类"
          value={category}
          onChange={(value) => {
            setCategory(value);
            setPage(1);
          }}
          options={[
            { value: '', label: '全部分类' },
            ...(query.data?.categories || []).map((item) => ({
              value: item.name,
              label: `${item.name} · ${item.count}`,
            })),
          ]}
        />
        <Select
          aria-label="创意收藏筛选"
          value={collection}
          onChange={(value) => {
            setCollection(value);
            setPage(1);
          }}
          options={[
            { value: 'all', label: '全部作品' },
            { value: 'saved', label: `我的收藏 · ${query.data?.savedCount ?? 0}` },
          ]}
        />
      </div>
      <QueryState query={query}>
        {query.data && (
          <>
            <div className="creative-result-heading">
              <strong>
                {q
                  ? `“${q}”的搜索结果`
                  : collection === 'saved'
                    ? '我的灵感收藏'
                    : category || (edition === 'new' ? '新一批交互体验' : '精选界面实验')}
              </strong>
              <span>共 {query.data.total} 件</span>
            </div>
            {query.data.items.length ? (
              <div className="creative-grid">
                {query.data.items.map((item) => (
                  <Card key={item.id} className="creative-card" styles={{ body: { padding: 0 } }}>
                    <Link
                      className="creative-cover-link"
                      to={`/programming/creative/${item.id}`}
                      aria-label={`查看 ${item.title}`}
                    >
                      {brokenCovers.includes(item.id) ? (
                        <div className="creative-cover-fallback">
                          <Sparkles size={32} />
                          <strong>{item.title}</strong>
                          <span>打开互动预览</span>
                        </div>
                      ) : (
                        <img
                          className="creative-cover"
                          src={item.coverUrl}
                          alt={`${item.title}的界面预览`}
                          loading="lazy"
                          onError={() =>
                            setBrokenCovers((previous) =>
                              previous.includes(item.id) ? previous : [...previous, item.id],
                            )
                          }
                        />
                      )}
                      <span className="creative-cover-category">{item.category}</span>
                      {item.edition === 2 && <span className="creative-cover-new">NEW</span>}
                    </Link>
                    <div className="creative-card-body">
                      <div className="creative-card-title">
                        <Link to={`/programming/creative/${item.id}`}>
                          <h3>{item.title}</h3>
                        </Link>
                        <Button
                          type="text"
                          aria-label={item.saved ? `取消收藏 ${item.title}` : `收藏 ${item.title}`}
                          disabled={!!busy}
                          loading={busy === item.id}
                          icon={item.saved ? <Check size={17} /> : <Bookmark size={17} />}
                          onClick={() => void favorite(item)}
                        />
                      </div>
                      <p>{item.description}</p>
                      <div className="creative-card-tags">
                        {item.tags.slice(0, 3).map((tag) => (
                          <Tag key={tag}>{tag}</Tag>
                        ))}
                      </div>
                      <div className="creative-card-footer">
                        <span>
                          <Github size={13} /> {item.source.repository.split('/').slice(-2).join('/')}
                        </span>
                        <Tag color="blue">{item.source.license}</Tag>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <Empty
                  description={
                    collection === 'saved'
                      ? '还没有收藏，先挑一件想研究的作品吧。'
                      : '没有匹配的创意，请试试其他关键词或分类。'
                  }
                />
              </Card>
            )}
            {!!query.data.total && (
              <Pagination
                className="creative-pagination"
                current={page}
                total={query.data.total}
                pageSize={12}
                showSizeChanger={false}
                onChange={setPage}
              />
            )}
          </>
        )}
      </QueryState>
    </>
  );
}

function CreativeDetail({ id }: { id: string }) {
  const query = useData<Idea>(`/programming/creative/${encodeURIComponent(id)}`);
  const status = useData<{ preview: { available: boolean; origin: string; reason: string } }>(
    '/programming/status',
  );
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [expired, setExpired] = useState(false);
  const [path, setPath] = useState('index.html');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const frame = useRef<HTMLIFrameElement | null>(null);
  const { message } = App.useApp();
  const client = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    if (!preview) return;
    setExpired(false);
    const timer = setInterval(() => setExpired(Date.parse(preview.expiresAt) <= Date.now()), 1000);
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        data.type !== 'programming-preview-log' ||
        data.nonce !== preview.nonce ||
        !['log', 'info', 'warn', 'error', 'debug'].includes(data.level) ||
        typeof data.text !== 'string' ||
        data.text.length > 2000 ||
        Date.parse(preview.expiresAt) <= Date.now()
      )
        return;
      setLogs((previous) => [...previous, `${data.level}: ${data.text}`].slice(-200));
    };
    window.addEventListener('message', receive);
    return () => {
      clearInterval(timer);
      window.removeEventListener('message', receive);
    };
  }, [preview]);
  async function perform(action: string, operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    try {
      await operation();
    } catch (error) {
      message.error(failure(error));
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  }
  function run(item: Idea) {
    void perform('preview', async () => {
      const result = (await send(`/programming/creative/${id}/preview`, {
        revision: item.revision,
      })) as Preview;
      const url = new URL(result.url);
      if (
        !status.data?.preview.origin ||
        url.origin !== new URL(status.data.preview.origin).origin ||
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        typeof result.nonce !== 'string' ||
        !result.nonce ||
        !Number.isFinite(Date.parse(result.expiresAt))
      )
        throw new Error('预览地址无效，请重新载入。');
      setLogs([]);
      setPreview(result);
    });
  }
  async function exportSource() {
    await perform('export', async () => {
      const response = await fetch(`/api/programming/creative/${encodeURIComponent(id)}/export`, {
        credentials: 'include',
      });
      if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new Event('auth-expired'));
        throw new Error('源码下载暂时不可用，请重新登录或稍后重试。');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `creative-${id}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function create(item: Idea) {
    if (!title.trim()) return;
    void perform('create', async () => {
      const project = await send(`/programming/creative/${id}/projects`, {
        title: title.trim(),
        revision: item.revision,
      });
      await client.invalidateQueries({
        predicate: (query) => String(query.queryKey[0]).startsWith('/programming/projects'),
      });
      message.success('创意已创建为你的项目，可以继续编辑和使用 AI 助手。');
      navigate(`/programming/${encodeURIComponent(project.id)}`);
    });
  }
  return (
    <QueryState query={query}>
      {query.data && (
        <>
          <PageTitle
            eyebrow="EXPLORE & REMIX"
            title={query.data.title}
            description={query.data.description}
            extra={
              <Link to="/programming/creative">
                <Button icon={<ArrowLeft size={16} />}>返回创意广场</Button>
              </Link>
            }
          />
          <div className="creative-detail-toolbar">
            <Space wrap>
              <Tag color="blue">{query.data.category}</Tag>
              {query.data.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
              <Tag>{query.data.source.license}</Tag>
              {query.data.edition === 2 && <Tag color="cyan">本次新增</Tag>}
            </Space>
            <Space wrap>
              <Button
                icon={<Bookmark size={16} />}
                disabled={!!busy}
                onClick={() =>
                  void perform('favorite', async () => {
                    await send(`/programming/creative/${id}/favorite`, { saved: !query.data!.saved }, 'PUT');
                    await query.refetch();
                    await client.invalidateQueries({
                      predicate: (query) => String(query.queryKey[0]).startsWith('/programming/creative?'),
                    });
                  })
                }
              >
                {query.data.saved ? '已收藏' : '收藏创意'}
              </Button>
              <Button
                icon={<Download size={16} />}
                disabled={!!busy}
                loading={busy === 'export'}
                onClick={() => void exportSource()}
              >
                下载 UI 源码
              </Button>
              <Button
                type="primary"
                icon={<FolderPlus size={16} />}
                disabled={!!busy}
                onClick={() => {
                  setTitle(`${query.data!.title} · 我的练习`.slice(0, 160));
                  setCreating(true);
                }}
              >
                创建为我的项目
              </Button>
            </Space>
          </div>
          <div className="creative-detail-layout">
            <Card className="creative-experiment">
              <Tabs
                items={[
                  {
                    key: 'preview',
                    label: '互动预览',
                    children: (
                      <>
                        <div className="creative-preview-heading">
                          <p>演示界面布局、动画与交互；可以在自己的项目中继续完善。</p>
                          <Button
                            type="primary"
                            icon={<Play size={15} />}
                            loading={busy === 'preview'}
                            disabled={!!busy || !status.data?.preview.available}
                            onClick={() => run(query.data!)}
                          >
                            {preview ? '重新运行预览' : '运行互动预览'}
                          </Button>
                        </div>
                        {status.data && !status.data.preview.available && (
                          <Alert
                            type="warning"
                            showIcon
                            message="预览暂不可用"
                            description={status.data.preview.reason}
                          />
                        )}
                        {preview && expired ? (
                          <Alert type="info" message="预览已到期，请重新运行。" />
                        ) : preview ? (
                          <iframe
                            key={preview.nonce}
                            ref={frame}
                            title="创意互动预览"
                            src={preview.url}
                            sandbox="allow-scripts"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="creative-preview-poster">
                            <img src={query.data!.coverUrl} alt={`${query.data!.title}的界面预览`} />
                            <span>点击运行，亲手体验交互</span>
                          </div>
                        )}
                        {!!logs.length && (
                          <div role="log" aria-label="创意预览日志" className="creative-preview-logs">
                            {logs.map((line, index) => (
                              <pre key={index}>{line}</pre>
                            ))}
                          </div>
                        )}
                      </>
                    ),
                  },
                  {
                    key: 'source',
                    label: 'UI 源码',
                    children: (
                      <>
                        <Select
                          className="creative-source-select"
                          aria-label="创意源码文件"
                          value={path}
                          onChange={setPath}
                          options={query.data!.files?.map((file) => ({ value: file.path, label: file.path }))}
                        />
                        <pre className="creative-source">
                          {query.data!.files?.find((file) => file.path === path)?.content || '（空文件）'}
                        </pre>
                      </>
                    ),
                  },
                  {
                    key: 'sources',
                    label: '来源与许可',
                    children: (
                      <div className="creative-provenance">
                        <h3>对应的 GitHub 项目</h3>
                        <a href={query.data!.source.repository} target="_blank" rel="noopener noreferrer">
                          <Github size={16} />
                          {query.data!.source.repository}
                          <ExternalLink size={13} />
                        </a>
                        <p>
                          来源版本：<code>{query.data!.source.commit}</code>
                        </p>
                        <h3>UI 提取范围</h3>
                        <p>{query.data!.source.scope}</p>
                        <h3>本地适配</h3>
                        <p>{query.data!.source.changes}</p>
                        <h3>源码定位</h3>
                        <ul>
                          {query.data!.source.files?.map((file) => (
                            <li key={file.url}>
                              <a href={file.url} target="_blank" rel="noopener noreferrer">
                                {file.title} <ExternalLink size={12} />
                              </a>
                            </li>
                          ))}
                        </ul>
                        <h3>相关视频与发现来源</h3>
                        {query.data!.source.videos.length ? (
                          <ul>
                            {query.data!.source.videos.map((video) => (
                              <li key={video.url}>
                                <a href={video.url} target="_blank" rel="noopener noreferrer">
                                  {video.platform} · {video.title} <ExternalLink size={12} />
                                </a>
                                {video.repository && (
                                  <p className="creative-video-source">
                                    {video.relation === 'inspiration'
                                      ? '视频对应仓库（视觉参考）'
                                      : '视频对应仓库'}
                                    ：
                                    <a href={video.repository} target="_blank" rel="noopener noreferrer">
                                      {video.repository.split('/').slice(-2).join('/')}{' '}
                                      <ExternalLink size={12} />
                                    </a>
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>通过 GitHub 项目发现；未录入可核实对应仓库的视频链接。</p>
                        )}
                        <h3>{query.data!.source.license} 许可与归属</h3>
                        <pre className="creative-license">{query.data!.source.licenseText}</pre>
                      </div>
                    ),
                  },
                ]}
              />
            </Card>
            <aside className="creative-learning">
              <div>
                <Sparkles size={20} />
                <h2>从这件作品学什么</h2>
              </div>
              <ol>
                {query.data.learningGoals.map((goal) => (
                  <li key={goal}>{goal}</li>
                ))}
              </ol>
              <div className="creative-learning-steps">
                <strong>动手路线</strong>
                <p>1. 体验交互，观察状态变化。</p>
                <p>2. 打开 UI 源码，找到绘制和事件。</p>
                <p>3. 创建项目，调整布局或增加交互。</p>
                <p>4. 保存版本，预览并核对效果。</p>
              </div>
              <Alert
                type="info"
                showIcon
                message="保留来源说明"
                description="下载与项目源码包含 NOTICE.txt 归属和许可，继续修改时请保留。"
              />
            </aside>
          </div>
          <Modal
            title="从创意创建编程项目"
            open={creating}
            onCancel={() => {
              if (!busy) setCreating(false);
            }}
            onOk={() => create(query.data!)}
            okText="创建项目"
            cancelText="继续探索"
            confirmLoading={busy === 'create'}
            okButtonProps={{ disabled: !title.trim() || !!busy }}
            closable={!busy}
            maskClosable={!busy}
          >
            <label className="creative-project-label" htmlFor="creative-project-title">
              项目名称
            </label>
            <Input
              id="creative-project-title"
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
            />
            <p className="creative-project-note">
              会创建包含当前 UI 源码与来源许可的新项目，之后可在编程工作室修改、使用 AI、保存版本和下载。
            </p>
          </Modal>
        </>
      )}
    </QueryState>
  );
}
