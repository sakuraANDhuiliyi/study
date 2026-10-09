import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  List,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
} from 'antd';
import {
  ArrowLeft,
  Bot,
  Code2,
  Copy,
  Download,
  FileCode2,
  FilePlus2,
  FolderCode,
  History,
  Play,
  Plus,
  RefreshCw,
  Save,
  Terminal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api, date, send, useData, type User } from '../api';
import { useAuth } from '../auth';
import { PageTitle, QueryState, useUnsavedWarning } from '../components/shared';
import { ProgrammingEditor } from './ProgrammingEditor';
import './programming.css';

type ProjectFile = { path: string; content: string };
type Project = {
  id: string;
  title: string;
  templateId: string;
  revision: number;
  files: ProjectFile[];
  createdAt: string;
  updatedAt: string;
};
type ProjectSummary = Omit<Project, 'files'> & { fileCount: number };
type ProjectBackup = {
  format: 'zhixue-programming';
  version: 1;
  title: string;
  templateId: string;
  files: ProjectFile[];
};
type Template = { id: string; title: string; description: string; files: ProjectFile[] };
type ProgrammingStatus = {
  ai: { available: boolean; reason: string; model: string };
  preview: { available: boolean; reason: string; origin: string };
  limits: {
    maxProjects: number;
    maxFiles: number;
    maxFileBytes: number;
    maxProjectBytes: number;
    maxVersions: number;
    maxAiDrafts: number;
    dailyRequests: number;
  };
  deployment: { available: false; reason: string };
};
type Version = { id: string; number: number; note: string; createdAt: string; files?: ProjectFile[] };
type AiDraft = {
  id: string;
  projectId: string;
  baseRevision: number;
  status: 'pending' | 'ready' | 'failed' | 'applied';
  prompt: string;
  summary: string;
  plan: string[];
  teaching: string[];
  files: ProjectFile[];
  model: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  appliedVersionId?: string | null;
};
type AiDraftSummary = Omit<AiDraft, 'files' | 'plan' | 'teaching'>;
type Preview = { url: string; expiresAt: string; nonce: string };
type PreviewLog = { id: number; level: string; text: string };
const draftLabels = { pending: '生成中', ready: '待审阅', failed: '生成失败', applied: '已应用' };
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
const filePathValid = (value: string) =>
  value.length <= 160 &&
  /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:html|css|js|json|md|txt|svg)$/.test(
    value,
  );
const filesKey = (files: ProjectFile[]) => JSON.stringify(files);
const errorText = (error: unknown) => (error instanceof Error ? error.message : '操作失败，请稍后重试。');
const maxBackupBytes = 380000;
function readProjectBackup(value: unknown, limits: ProgrammingStatus['limits']): ProjectBackup {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('备份必须是项目 JSON 对象。');
  const backup = value as Record<string, unknown>;
  if (Object.keys(backup).some((key) => !['format', 'version', 'title', 'templateId', 'files'].includes(key)))
    throw new Error('备份包含不支持的字段，请选择编程工作区下载的 JSON 备份。');
  if (backup.format !== 'zhixue-programming' || backup.version !== 1)
    throw new Error('不支持此备份格式或版本，请选择编程工作区下载的 JSON 备份。');
  if (
    typeof backup.title !== 'string' ||
    !backup.title.trim() ||
    backup.title.trim().length > 160 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(backup.title)
  )
    throw new Error('备份的项目名称无效。');
  if (
    typeof backup.templateId !== 'string' ||
    !/^(?:starter|counter|todo|imported|creative:[a-z0-9-]+)$/.test(backup.templateId)
  )
    throw new Error('备份的来源模板无效。');
  if (!Array.isArray(backup.files) || !backup.files.length || backup.files.length > limits.maxFiles)
    throw new Error(`备份必须包含 1～${limits.maxFiles} 个文件。`);
  const paths = new Set<string>();
  for (const file of backup.files) {
    if (
      !file ||
      typeof file !== 'object' ||
      Array.isArray(file) ||
      Object.keys(file).some((key) => !['path', 'content'].includes(key)) ||
      typeof file.path !== 'string' ||
      !filePathValid(file.path) ||
      typeof file.content !== 'string'
    )
      throw new Error('备份中有无效的文件路径或源码字段。');
    if (paths.has(file.path.toLowerCase())) throw new Error('备份中存在重复文件路径（不区分大小写）。');
    paths.add(file.path.toLowerCase());
    if (file.content.includes('\0')) throw new Error('备份源码不能包含空字符。');
    if (byteLength(file.content) > limits.maxFileBytes) throw new Error(`文件 ${file.path} 超过 64 KiB。`);
  }
  if (!backup.files.some((file) => file.path === 'index.html'))
    throw new Error('备份必须包含 index.html 入口。');
  if (backup.files.reduce((sum, file) => sum + byteLength(file.content), 0) > limits.maxProjectBytes)
    throw new Error('备份源码总计超过 256 KiB。');
  if (byteLength(JSON.stringify(backup.files)) > 360000)
    throw new Error('备份的 JSON 内容过大，请减少源码或转义字符。');
  return {
    format: 'zhixue-programming',
    version: 1,
    title: backup.title.trim(),
    templateId: backup.templateId,
    files: backup.files,
  };
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.replace(/[\\/:*?"<>|]/g, '_');
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useProgrammingOwner() {
  const { user } = useAuth();
  const client = useQueryClient();
  const identity = [user?.organizationId, user?.id, user?.role].join(':');
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const mounted = useRef(false);
  const expired = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const expire = () => {
      expired.current = true;
      ++generation.current;
    };
    window.addEventListener('auth-expired', expire);
    return () => {
      mounted.current = false;
      ++generation.current;
      window.removeEventListener('auth-expired', expire);
    };
  }, [identity]);
  function captureOwner() {
    const captured = generation.current;
    return () => {
      const current = client.getQueryData<{ user: User }>(['auth'])?.user;
      return (
        mounted.current &&
        !expired.current &&
        currentIdentity.current === identity &&
        generation.current === captured &&
        !!current &&
        [current.organizationId, current.id, current.role].join(':') === identity
      );
    };
  }
  return { identity, captureOwner };
}

export function Programming() {
  const { id } = useParams();
  const { identity } = useProgrammingOwner();
  const status = useData<ProgrammingStatus>('/programming/status');
  return (
    <div className="programming-page">
      <QueryState query={status}>
        {status.data &&
          (id ? (
            <ProgrammingWorkspace key={`${identity}:${id}`} id={id} status={status.data} />
          ) : (
            <ProgrammingProjects key={identity} status={status.data} />
          ))}
      </QueryState>
    </div>
  );
}

function ProgrammingProjects({ status }: { status: ProgrammingStatus }) {
  const { captureOwner } = useProgrammingOwner();
  const [page, setPage] = useState(1);
  const projects = useData<{ items: ProjectSummary[]; total: number; page: number; pageSize: number }>(
    `/programming/projects?page=${page}&pageSize=9`,
  );
  const templates = useData<{ items: Template[] }>('/programming/templates');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState('starter');
  const [importOpen, setImportOpen] = useState(false);
  const [importBackup, setImportBackup] = useState<ProjectBackup | null>(null);
  const [importTitle, setImportTitle] = useState('');
  const [importError, setImportError] = useState('');
  const [readingBackup, setReadingBackup] = useState(false);
  const importRead = useRef(0);
  const projectLimit = (projects.data?.total || 0) >= status.limits.maxProjects;
  const { message } = App.useApp();
  const navigate = useNavigate();
  async function create() {
    const isOwner = captureOwner();
    if (!isOwner() || !title.trim() || saving) return;
    setSaving(true);
    try {
      const project: Project = await send('/programming/projects', { title: title.trim(), templateId });
      if (!isOwner()) return;
      message.success('项目已创建');
      navigate(`/programming/${encodeURIComponent(project.id)}`);
    } catch (error) {
      if (isOwner()) message.error(errorText(error));
    } finally {
      if (isOwner()) setSaving(false);
    }
  }
  async function selectBackup(file?: File) {
    const isOwner = captureOwner();
    if (!isOwner()) return;
    const request = ++importRead.current;
    setImportBackup(null);
    setImportError('');
    setImportTitle('');
    setReadingBackup(false);
    if (!file) return;
    setReadingBackup(true);
    try {
      if (file.size > maxBackupBytes)
        throw new Error('JSON 备份文件最多 380,000 字节，请选择工作区下载的备份。');
      const source = await file.text();
      if (!isOwner() || request !== importRead.current) return;
      let value: unknown;
      try {
        value = JSON.parse(source);
      } catch {
        throw new Error('无法读取 JSON，请检查文件内容是否完整。');
      }
      const backup = readProjectBackup(value, status.limits);
      if (!isOwner() || request !== importRead.current) return;
      setImportBackup(backup);
      setImportTitle(backup.title);
    } catch (error) {
      if (isOwner() && request === importRead.current) setImportError(errorText(error));
    } finally {
      if (isOwner() && request === importRead.current) setReadingBackup(false);
    }
  }
  async function importProject() {
    const isOwner = captureOwner();
    if (!isOwner() || !importBackup || !importTitle.trim() || saving || readingBackup || projectLimit) return;
    setSaving(true);
    setImportError('');
    try {
      const project: Project = await send('/programming/projects/import', {
        ...importBackup,
        title: importTitle.trim(),
      });
      if (!isOwner()) return;
      message.success('备份已导入为新项目');
      navigate(`/programming/${encodeURIComponent(project.id)}`);
    } catch (error) {
      if (isOwner()) {
        setImportError(errorText(error));
        void projects.refetch();
      }
    } finally {
      if (isOwner()) setSaving(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="BUILD & LEARN"
        title="编程工作室"
        description="从网页模板开始，把想法写成可运行的 HTML、CSS 和 JavaScript 项目。"
        extra={
          <Space wrap>
            <Link to="/programming/creative">
              <Button icon={<Sparkles size={16} />}>探索创意广场</Button>
            </Link>
            <Button
              icon={<Upload size={16} />}
              disabled={projectLimit}
              onClick={() => {
                setImportOpen(true);
                setImportBackup(null);
                setImportTitle('');
                setImportError('');
              }}
            >
              导入 JSON 备份
            </Button>
            <Button
              type="primary"
              icon={<Plus size={16} />}
              disabled={projectLimit}
              onClick={() => setCreating(true)}
            >
              新建项目
            </Button>
          </Space>
        }
      />
      <div className="programming-intro">
        <div className="programming-intro-icon">
          <FolderCode size={28} />
        </div>
        <div>
          <strong>写代码、看效果、逐步改进</strong>
          <p>多文件编辑 · 隔离预览 · AI 辅助编写 · 版本恢复 · 项目复制与备份</p>
        </div>
        <Tag color="blue">本地工作区</Tag>
      </div>
      <Alert
        className="programming-local-notice"
        type="info"
        showIcon
        message="项目仅在你的学习空间保存；预览尚未公开到互联网。"
        description={status.deployment.reason || '当前提供本地预览，后续可在配置域名和部署环境后扩展发布。'}
      />
      <QueryState query={projects}>
        {projects.data?.items.length ? (
          <div className="programming-project-grid">
            {projects.data.items.map((project) => (
              <Link className="programming-project-link" key={project.id} to={`/programming/${project.id}`}>
                <Card className="programming-project-card" hoverable>
                  <div className="programming-card-top">
                    <Code2 size={25} />
                    <Tag>修订 {project.revision}</Tag>
                  </div>
                  <h2>{project.title}</h2>
                  <p>
                    {project.fileCount} 个文件 · {date(project.updatedAt)} 更新
                  </p>
                  <span>打开工作区 →</span>
                </Card>
              </Link>
            ))}
          </div>
        ) : projects.data ? (
          <Card>
            <Empty description="还没有编程项目，从一个模板开始吧。">
              <Button type="primary" onClick={() => setCreating(true)}>
                创建第一个项目
              </Button>
            </Empty>
          </Card>
        ) : null}
        {!!projects.data?.total && (
          <Pagination
            className="programming-pagination"
            current={page}
            total={projects.data.total}
            pageSize={9}
            showSizeChanger={false}
            onChange={setPage}
          />
        )}
      </QueryState>
      <Modal
        title="导入编程项目备份"
        open={importOpen}
        okText="确认导入"
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ disabled: !importBackup || !importTitle.trim() || readingBackup || projectLimit }}
        onOk={() => void importProject()}
        onCancel={() => {
          if (!saving) {
            ++importRead.current;
            setReadingBackup(false);
            setImportOpen(false);
          }
        }}
      >
        <p>选择工作区下载的 JSON 备份，检查内容后创建独立项目。</p>
        <label className="programming-field-label" htmlFor="programming-import-file">
          选择 JSON 备份
        </label>
        <input
          className="programming-import-file"
          id="programming-import-file"
          type="file"
          accept=".json,application/json"
          disabled={saving || readingBackup}
          onChange={(event) => {
            void selectBackup(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        {readingBackup && <p role="status">正在读取备份…</p>}
        {importError && <Alert className="programming-notice" type="error" showIcon message={importError} />}
        {importBackup && (
          <div className="programming-import-summary">
            <label className="programming-field-label" htmlFor="programming-import-title">
              导入后的项目名称
            </label>
            <Input
              id="programming-import-title"
              value={importTitle}
              maxLength={160}
              disabled={saving}
              onChange={(event) => setImportTitle(event.target.value)}
            />
            <p>
              {importBackup.files.length} 个文件 ·{' '}
              {(importBackup.files.reduce((sum, file) => sum + byteLength(file.content), 0) / 1024).toFixed(
                1,
              )}{' '}
              KiB 源码
            </p>
            <p>来源模板：{importBackup.templateId}</p>
            <ul aria-label="备份文件列表">
              {importBackup.files.map((file) => (
                <li key={file.path}>{file.path}</li>
              ))}
            </ul>
            <p>创意项目的完整 NOTICE.txt 会随导入保留；新项目从初始版本开始。</p>
          </div>
        )}
        {projectLimit && (
          <Alert
            type="warning"
            showIcon
            message={`最多保存 ${status.limits.maxProjects} 个项目，请先下载并删除旧项目。`}
          />
        )}
      </Modal>
      <Modal
        title="新建编程项目"
        open={creating}
        okText="创建项目"
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ disabled: !title.trim() || !templates.data?.items.some((t) => t.id === templateId) }}
        onOk={create}
        onCancel={() => {
          if (!saving) setCreating(false);
        }}
        maskClosable={!saving}
        closable={!saving}
      >
        <label className="programming-field-label" htmlFor="programming-project-title">
          项目名称
        </label>
        <Input
          id="programming-project-title"
          value={title}
          maxLength={160}
          placeholder="例如：我的交互式学习卡片"
          disabled={saving}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className="programming-field-label">选择起始模板</div>
        <QueryState query={templates}>
          <div className="programming-template-list">
            {templates.data?.items.map((template) => (
              <button
                className={`programming-template ${templateId === template.id ? 'selected' : ''}`}
                key={template.id}
                type="button"
                disabled={saving}
                aria-pressed={templateId === template.id}
                onClick={() => setTemplateId(template.id)}
              >
                <FileCode2 size={21} />
                <span>
                  <strong>{template.title}</strong>
                  <small>{template.description}</small>
                </span>
              </button>
            ))}
          </div>
        </QueryState>
      </Modal>
    </>
  );
}

function ProgrammingWorkspace({ id, status }: { id: string; status: ProgrammingStatus }) {
  const { captureOwner } = useProgrammingOwner();
  const projectPath = `/programming/projects/${encodeURIComponent(id)}`;
  const query = useData<Project>(projectPath);
  const versions = useData<{ items: Version[] }>(`${projectPath}/versions`);
  const projectCount = useData<{ total: number }>('/programming/projects?page=1&pageSize=1');
  const [draftPollMs, setDraftPollMs] = useState<number | undefined>();
  const drafts = useData<{ items: AiDraftSummary[] }>(`${projectPath}/ai-drafts`, true, draftPollMs);
  const [saved, setSaved] = useState<Project | null>(null);
  const [title, setTitle] = useState('');
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activePath, setActivePath] = useState('index.html');
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateTitle, setDuplicateTitle] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewFiles, setPreviewFiles] = useState('');
  const [now, setNow] = useState(Date.now());
  const [logs, setLogs] = useState<PreviewLog[]>([]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const logId = useRef(0);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [note, setNote] = useState('');
  const [viewVersion, setViewVersion] = useState<Version | null>(null);
  const [versionPath, setVersionPath] = useState('index.html');
  const [prompt, setPrompt] = useState('');
  const [selectedDraft, setSelectedDraft] = useState<AiDraft | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState('');
  const draftRequest = useRef(0);
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const client = useQueryClient();
  const dirty = !!saved && (title !== saved.title || filesKey(files) !== filesKey(saved.files));
  const pending = !!drafts.data?.items.some((draft) => draft.status === 'pending');
  const draftLimit = (drafts.data?.items.length || 0) >= (status.limits.maxAiDrafts || 20);
  const versionLimit = (versions.data?.items.length || 0) >= status.limits.maxVersions;
  const bytes = files.reduce((total, file) => total + byteLength(file.content), 0);
  const oversized = files.some((file) => byteLength(file.content) > status.limits.maxFileBytes);
  const fileError = oversized
    ? '单个文件超过 64 KB，请精简内容后保存。'
    : bytes > status.limits.maxProjectBytes
      ? '项目文件合计超过 256 KB，请精简内容后保存。'
      : '';
  const activeFile = files.find((file) => file.path === activePath) || files[0];
  const attributionFile = !!saved?.templateId.startsWith('creative:') && activeFile?.path === 'NOTICE.txt';
  const previewExpired = !!preview && Date.parse(preview.expiresAt) <= now;
  const previewStale = !!preview && previewFiles !== filesKey(files);
  const remoteChanged = !!saved && !!query.data && query.data.revision !== saved.revision;
  const projectLimit = (projectCount.data?.total || 0) >= status.limits.maxProjects;
  useUnsavedWarning(dirty);
  useEffect(() => {
    if (!query.data || saved) return;
    setSaved(query.data);
    setTitle(query.data.title);
    setFiles(query.data.files);
    setActivePath(query.data.files[0]?.path || 'index.html');
  }, [query.data, saved]);
  useEffect(() => {
    if (!preview) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [preview]);
  useEffect(() => {
    if (!preview || previewExpired) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      if (data.type !== 'programming-preview-log' || data.nonce !== preview.nonce) return;
      if (!['log', 'info', 'warn', 'error', 'debug'].includes(data.level)) return;
      if (typeof data.text !== 'string' || data.text.length > 2000) return;
      setLogs((previous) =>
        [...previous, { id: ++logId.current, level: data.level, text: data.text }].slice(-200),
      );
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [preview, previewExpired]);
  useEffect(() => {
    setDraftPollMs(pending ? 5000 : undefined);
  }, [pending]);
  useEffect(() => {
    if (!selectedDraft || !drafts.data || draftLoading) return;
    const updated = drafts.data.items.find((draft) => draft.id === selectedDraft.id);
    if (
      updated &&
      (Date.parse(updated.updatedAt) > Date.parse(selectedDraft.updatedAt) ||
        (selectedDraft.status === 'pending' && updated.status !== 'pending'))
    )
      void selectDraft(updated);
  }, [drafts.data, selectedDraft, draftLoading]);

  function install(project: Project) {
    setSaved(project);
    setTitle(project.title);
    setFiles(project.files);
    setActivePath((old) =>
      project.files.some((file) => file.path === old) ? old : project.files[0]?.path || 'index.html',
    );
    client.setQueriesData({ queryKey: [projectPath] }, project);
    void client.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith(`${projectPath}/`) });
  }
  async function perform(action: string, operation: (isOwner: () => boolean) => Promise<void>) {
    const isOwner = captureOwner();
    if (!isOwner() || busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    try {
      await operation(isOwner);
    } catch (error) {
      if (!isOwner()) return;
      message.error(errorText(error));
      if (error && typeof error === 'object' && 'status' in error && error.status === 409)
        void query.refetch();
    } finally {
      if (isOwner()) {
        busyRef.current = false;
        setBusy('');
      }
    }
  }
  function save() {
    if (!saved || !dirty || fileError || !title.trim()) return;
    void perform('save', async (isOwner) => {
      const project: Project = await send(
        projectPath,
        { revision: saved.revision, title: title.trim(), files },
        'PATCH',
      );
      if (!isOwner()) return;
      install(project);
      message.success('草稿已保存');
    });
  }
  async function saveForReuse(isOwner: () => boolean) {
    if (!saved) throw new Error('项目尚未载入，请稍后重试。');
    if (remoteChanged) throw new Error('服务器上的项目已变化，请保留本地源码并重新载入后再操作。');
    if (fileError || !title.trim()) throw new Error(fileError || '请填写项目名称后再操作。');
    if (!dirty) return saved;
    if (pending) throw new Error('AI 请求正在处理，请等待完成后保存修改。');
    const project: Project = await send(
      projectPath,
      { revision: saved.revision, title: title.trim(), files },
      'PATCH',
    );
    if (!isOwner()) return null;
    install(project);
    return project;
  }
  function duplicateProject() {
    if (!duplicateTitle.trim() || projectLimit) return;
    void perform('duplicate', async (isOwner) => {
      const source = await saveForReuse(isOwner);
      if (!isOwner() || !source) return;
      const project: Project = await send(`${projectPath}/duplicate`, {
        revision: source.revision,
        title: duplicateTitle.trim(),
      });
      if (!isOwner()) return;
      void client.invalidateQueries({
        predicate: (entry) => String(entry.queryKey[0]).startsWith('/programming/projects'),
      });
      message.success('项目已复制为独立副本');
      setDuplicateOpen(false);
      navigate(`/programming/${encodeURIComponent(project.id)}`);
    });
  }
  function backupProject() {
    void perform('backup', async (isOwner) => {
      const source = await saveForReuse(isOwner);
      if (!isOwner() || !source) return;
      const backup = await api<ProjectBackup>(`${projectPath}/backup`);
      if (!isOwner()) return;
      downloadBlob(
        new Blob([JSON.stringify(backup)], { type: 'application/json;charset=utf-8' }),
        `${source.title || 'project'}.json`,
      );
      message.success('已下载 JSON 项目备份，可从项目列表重新导入');
    });
  }
  function run() {
    if (!saved || fileError || !status.preview.available) return;
    void perform('preview', async (isOwner) => {
      const result: Preview = await send(`${projectPath}/preview`, { revision: saved.revision, files });
      if (!isOwner()) return;
      const url = new URL(result.url);
      const expected = new URL(status.preview.origin);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.origin !== expected.origin ||
        url.username ||
        url.password ||
        !Number.isFinite(Date.parse(result.expiresAt)) ||
        typeof result.nonce !== 'string' ||
        !result.nonce
      ) {
        throw new Error('预览地址无效，请检查预览服务配置。');
      }
      setPreview(result);
      setPreviewFiles(filesKey(files));
      setLogs([]);
      setNow(Date.now());
    });
  }
  function createVersion() {
    if (!saved || dirty || !note.trim() || pending || versionLimit) return;
    void perform('version', async (isOwner) => {
      const result: { project: Project; version: Version } = await send(`${projectPath}/versions`, {
        revision: saved.revision,
        note: note.trim(),
      });
      if (!isOwner()) return;
      install(result.project);
      setNote('');
      message.success(`版本 ${result.version.number} 已保存`);
    });
  }
  function restore(version: Version) {
    if (!saved || dirty || pending) return;
    modal.confirm({
      title: `恢复版本 ${version.number}？`,
      content: '当前已保存内容会先保留为版本记录，再切换到所选版本。',
      okText: '确认恢复',
      cancelText: '取消',
      onOk: () =>
        perform('restore', async (isOwner) => {
          const project: Project = await send(`${projectPath}/restore`, {
            revision: saved.revision,
            versionId: version.id,
          });
          if (!isOwner()) return;
          install(project);
          setPreview(null);
          setViewVersion(null);
          message.success('已恢复所选版本');
        }),
    });
  }
  function generate() {
    if (!saved || dirty || pending || draftLimit || !prompt.trim() || !status.ai.available) return;
    void perform('generate', async (isOwner) => {
      const draft: AiDraft = await send(`${projectPath}/ai-drafts`, {
        revision: saved.revision,
        prompt: prompt.trim(),
      });
      if (!isOwner()) return;
      ++draftRequest.current;
      setSelectedDraftId(draft.id);
      setSelectedDraft(draft);
      setDraftLoading(false);
      setDraftError('');
      await drafts.refetch();
      if (!isOwner()) return;
      if (draft.status === 'failed') message.error(draft.error || 'AI 生成失败，项目源码已保留。');
      else if (draft.status === 'ready') message.success('候选代码已生成，请审阅差异后应用。');
    });
  }
  function applyDraft() {
    if (
      !saved ||
      !selectedDraft ||
      dirty ||
      selectedDraft.status !== 'ready' ||
      saved.revision !== selectedDraft.baseRevision ||
      pending
    )
      return;
    modal.confirm({
      title: '应用这份 AI 候选代码？',
      content: '候选文件将替换当前已保存项目。被删除的文件也会生效，当前源码将保留版本记录。',
      okText: '确认应用',
      cancelText: '继续审阅',
      onOk: () =>
        perform('apply', async (isOwner) => {
          const result: { project: Project; draft: AiDraft } = await send(
            `${projectPath}/ai-drafts/${encodeURIComponent(selectedDraft.id)}/apply`,
            { revision: saved.revision },
          );
          if (!isOwner()) return;
          install(result.project);
          setSelectedDraft(result.draft);
          setPreview(null);
          message.success('候选代码已应用；点击运行预览查看效果。');
        }),
    });
  }
  function exportProject() {
    if (!saved || dirty) return;
    void perform('export', async (isOwner) => {
      const response = await fetch(`/api${projectPath}/export`, { credentials: 'include' });
      if (!isOwner()) return;
      if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new Event('auth-expired'));
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || result.error?.message || '下载失败，请稍后重试。');
      }
      const blob = await response.blob();
      if (!isOwner()) return;
      downloadBlob(blob, `${saved.title || 'project'}.zip`);
      message.success('已下载项目源码');
    });
  }
  function addFile() {
    const path = newPath.trim();
    if (
      !filePathValid(path) ||
      files.some((file) => file.path.toLowerCase() === path.toLowerCase()) ||
      files.length >= status.limits.maxFiles
    )
      return;
    setFiles((old) => [...old, { path, content: '' }]);
    setActivePath(path);
    setNewFileOpen(false);
    setNewPath('');
  }
  async function selectDraft(draft: Pick<AiDraftSummary, 'id'>) {
    const isOwner = captureOwner();
    if (!isOwner()) return;
    const request = ++draftRequest.current;
    setSelectedDraftId(draft.id);
    setSelectedDraft(null);
    setDraftLoading(true);
    setDraftError('');
    try {
      const detail = await api<AiDraft>(`${projectPath}/ai-drafts/${encodeURIComponent(draft.id)}`);
      if (isOwner() && request === draftRequest.current) setSelectedDraft(detail);
    } catch (error) {
      if (isOwner() && request === draftRequest.current) setDraftError(errorText(error));
    } finally {
      if (isOwner() && request === draftRequest.current) setDraftLoading(false);
    }
  }
  async function loadVersion(version: Version) {
    void perform('inspect-version', async (isOwner) => {
      const detail = await api<Version>(`${projectPath}/versions/${encodeURIComponent(version.id)}`);
      if (!isOwner()) return;
      setViewVersion(detail);
      setVersionPath(detail.files?.[0]?.path || 'index.html');
    });
  }
  function refreshProject() {
    modal.confirm({
      title: dirty ? '放弃未保存修改并重新载入？' : '重新载入项目？',
      content: dirty
        ? '本地未保存的内容将丢失。你可以取消并复制或保存后再重新载入。'
        : '将载入服务器上最新的源码与修订。',
      okText: '重新载入',
      cancelText: '取消',
      onOk: () =>
        perform('reload', async (isOwner) => {
          const project = await api<Project>(projectPath);
          if (!isOwner()) return;
          install(project);
          setPreview(null);
        }),
    });
  }
  return (
    <QueryState query={query}>
      {saved && (
        <>
          <PageTitle
            eyebrow="PROGRAMMING WORKSPACE"
            title="编程工作区"
            description="编辑源码并即时预览，AI 生成的修改需要你审阅后应用。"
            extra={
              <Link to="/programming">
                <Button icon={<ArrowLeft size={15} />}>项目列表</Button>
              </Link>
            }
          />
          <div className="programming-workspace-toolbar">
            <div className="programming-workspace-name">
              <Input
                aria-label="项目名称"
                value={title}
                maxLength={160}
                disabled={!!busy}
                onChange={(event) => setTitle(event.target.value)}
              />
              <Tag color={dirty ? 'orange' : 'green'}>
                {dirty ? '未保存修改' : `已保存 · 修订 ${saved.revision}`}
              </Tag>
            </div>
            <Space wrap>
              <Button
                icon={<Save size={15} />}
                type="primary"
                loading={busy === 'save'}
                disabled={!dirty || !!busy || !!fileError || !title.trim() || pending}
                onClick={save}
              >
                保存草稿
              </Button>
              <Button
                icon={<Play size={15} />}
                loading={busy === 'preview'}
                disabled={!!busy || !!fileError || !status.preview.available}
                onClick={run}
              >
                运行预览
              </Button>
              <Button icon={<History size={15} />} disabled={!!busy} onClick={() => setVersionsOpen(true)}>
                版本记录
              </Button>
              <Tooltip title={dirty ? '请先保存草稿，再下载源码。' : '下载已保存项目的 ZIP 源码'}>
                <Button
                  aria-label="下载源码"
                  icon={<Download size={15} />}
                  loading={busy === 'export'}
                  disabled={dirty || !!busy}
                  onClick={exportProject}
                >
                  源码 ZIP
                </Button>
              </Tooltip>
              <Tooltip title="先保存当前修改，再下载可重新导入的 JSON 项目备份">
                <Button
                  icon={<Download size={15} />}
                  loading={busy === 'backup'}
                  disabled={!!busy || !!fileError || !title.trim() || pending || remoteChanged}
                  onClick={backupProject}
                >
                  JSON 备份
                </Button>
              </Tooltip>
              <Tooltip
                title={
                  projectLimit
                    ? `最多保存 ${status.limits.maxProjects} 个项目`
                    : '先保存当前修改，再创建独立副本'
                }
              >
                <Button
                  icon={<Copy size={15} />}
                  disabled={
                    !!busy || !!fileError || !title.trim() || pending || remoteChanged || projectLimit
                  }
                  onClick={() => {
                    setDuplicateTitle(`${title.trim()} 副本`.slice(0, 160));
                    setDuplicateOpen(true);
                  }}
                >
                  复制项目
                </Button>
              </Tooltip>
              <Button
                aria-label="重新载入项目"
                icon={<RefreshCw size={15} />}
                disabled={!!busy}
                onClick={refreshProject}
              />
              <Popconfirm
                title="删除整个编程项目？"
                description="所有源码、版本及 AI 草稿将一并删除。"
                okText="删除项目"
                cancelText="取消"
                onConfirm={() =>
                  perform('delete', async (isOwner) => {
                    await send(projectPath, {}, 'DELETE');
                    if (!isOwner()) return;
                    message.success('项目已删除');
                    navigate('/programming');
                  })
                }
              >
                <Button
                  aria-label="删除项目"
                  danger
                  icon={<Trash2 size={15} />}
                  disabled={!!busy || pending}
                />
              </Popconfirm>
            </Space>
          </div>
          {dirty && (
            <Alert
              className="programming-notice"
              type="warning"
              showIcon
              message="有未保存修改。复制项目和 JSON 备份会先保存当前修改；AI、版本操作与源码 ZIP 下载前请先保存草稿。"
            />
          )}
          {fileError && <Alert className="programming-notice" type="error" showIcon message={fileError} />}
          {remoteChanged && (
            <Alert
              className="programming-notice"
              type="warning"
              showIcon
              message="服务器上的项目已变化，本地内容已保留。请复制需要保留的源码后重新载入。"
              action={
                <Button size="small" onClick={refreshProject}>
                  重新载入
                </Button>
              }
            />
          )}
          {!status.preview.available && (
            <Alert
              className="programming-notice"
              type="warning"
              message={status.preview.reason || '本地预览服务不可用'}
              showIcon
            />
          )}
          <div className="programming-workspace-layout">
            <div className="programming-code-area">
              <section className="programming-code-panel">
                <aside className="programming-file-tree" aria-label="项目文件">
                  <div className="programming-section-title">
                    <strong>项目文件</strong>
                    <Button
                      size="small"
                      type="text"
                      aria-label="新建文件"
                      icon={<FilePlus2 size={15} />}
                      disabled={!!busy || pending || files.length >= status.limits.maxFiles}
                      onClick={() => setNewFileOpen(true)}
                    />
                  </div>
                  <div className="programming-files">
                    {files.map((file) => (
                      <div
                        key={file.path}
                        className={`programming-file-row ${activeFile?.path === file.path ? 'active' : ''}`}
                      >
                        <button
                          type="button"
                          className="programming-file-select"
                          onClick={() => setActivePath(file.path)}
                          title={file.path}
                        >
                          <FileCode2 size={15} />
                          <span>{file.path}</span>
                        </button>
                        {file.path !== 'index.html' &&
                          !(saved.templateId.startsWith('creative:') && file.path === 'NOTICE.txt') && (
                            <Popconfirm
                              title={`删除 ${file.path}？`}
                              description="保存草稿后删除才会同步到项目。"
                              okText="删除"
                              cancelText="取消"
                              onConfirm={() => {
                                setFiles((old) => old.filter((item) => item.path !== file.path));
                                if (activePath === file.path) setActivePath('index.html');
                              }}
                            >
                              <Button
                                type="text"
                                size="small"
                                aria-label={`删除文件 ${file.path}`}
                                icon={<X size={12} />}
                                disabled={!!busy || pending}
                              />
                            </Popconfirm>
                          )}
                      </div>
                    ))}
                  </div>
                  <div className="programming-file-limits">
                    {files.length}/{status.limits.maxFiles} 个文件
                    <br />
                    {(bytes / 1024).toFixed(1)} / {(status.limits.maxProjectBytes / 1024).toFixed(0)} KB
                  </div>
                </aside>
                {activeFile && (
                  <ProgrammingEditor
                    projectId={id}
                    path={activeFile.path}
                    value={activeFile.content}
                    disabled={!!busy || pending || attributionFile}
                    onChange={(content) =>
                      setFiles((old) =>
                        old.map((file) => (file.path === activeFile.path ? { ...file, content } : file)),
                      )
                    }
                    onSave={save}
                    onRun={run}
                  />
                )}
              </section>
              <section className="programming-preview-panel">
                <div className="programming-section-title">
                  <strong>
                    <Play size={16} /> 本地预览
                  </strong>
                  <Space wrap>
                    {preview && (
                      <Button
                        size="small"
                        icon={<RefreshCw size={13} />}
                        disabled={!!busy || !!fileError || !status.preview.available}
                        onClick={run}
                      >
                        刷新预览
                      </Button>
                    )}
                    {preview && (
                      <Button
                        size="small"
                        type="text"
                        aria-label="关闭预览"
                        icon={<X size={15} />}
                        onClick={() => {
                          setPreview(null);
                          setLogs([]);
                        }}
                      />
                    )}
                  </Space>
                </div>
                {preview ? (
                  <>
                    <div className="programming-preview-caption">
                      {previewExpired
                        ? '预览已过期，请刷新预览。'
                        : `仅本地可见 · ${date(preview.expiresAt)} 到期`}
                      {previewStale && ' · 源码已修改，刷新后查看最新效果'}
                    </div>
                    {previewExpired ? (
                      <div className="programming-preview-empty">
                        <Button onClick={run} disabled={!!busy || !status.preview.available}>
                          重新生成预览
                        </Button>
                      </div>
                    ) : (
                      <iframe
                        key={preview.url}
                        ref={iframeRef}
                        title="项目运行预览"
                        src={preview.url}
                        sandbox="allow-scripts"
                        referrerPolicy="no-referrer"
                      />
                    )}
                  </>
                ) : (
                  <div className="programming-preview-empty">
                    <Play size={30} />
                    <strong>代码准备好了吗？</strong>
                    <span>点击“运行预览”查看效果，预览不会公开发布。</span>
                  </div>
                )}
                <div className="programming-console-heading">
                  <span>
                    <Terminal size={14} /> 控制台 · {logs.length} 条
                  </span>
                  <Button size="small" type="text" onClick={() => setLogs([])} disabled={!logs.length}>
                    清空日志
                  </Button>
                </div>
                <div className="programming-console" aria-label="预览控制台" role="log" aria-live="off">
                  {logs.length ? (
                    logs.map((log) => (
                      <div className={`programming-log-${log.level}`} key={log.id}>
                        <span>{log.level}</span>
                        <pre>{log.text}</pre>
                      </div>
                    ))
                  ) : (
                    <span className="programming-console-empty">
                      运行时的 console 输出与错误会显示在这里。
                    </span>
                  )}
                </div>
              </section>
            </div>
            <aside className="programming-ai-panel" aria-label="AI 编程助手">
              <div className="programming-section-title">
                <strong>
                  <Bot size={18} /> AI 编程助手
                </strong>
                <Tag color="blue">先审阅后应用</Tag>
              </div>
              <p className="programming-ai-intro">
                描述想实现的页面或交互。AI 会基于已保存源码提供完整候选文件、实现计划与学习建议。
              </p>
              {!status.ai.available && (
                <Alert type="warning" showIcon message="AI 暂不可用" description={status.ai.reason} />
              )}
              <label className="programming-field-label" htmlFor="programming-ai-prompt">
                你想做什么？
              </label>
              <Input.TextArea
                id="programming-ai-prompt"
                value={prompt}
                maxLength={3000}
                showCount
                rows={5}
                disabled={!!busy || pending}
                placeholder="例如：把计数器改成番茄钟，支持暂停和重置，并解释定时器的原理。"
                onChange={(event) => setPrompt(event.target.value)}
              />
              <Button
                className="programming-generate-button"
                type="primary"
                icon={<Bot size={16} />}
                loading={busy === 'generate' || pending}
                disabled={!!busy || pending || draftLimit || dirty || !prompt.trim() || !status.ai.available}
                onClick={generate}
              >
                生成候选代码
              </Button>
              <div className="programming-ai-caption">
                {status.ai.model || '配置模型后可使用'} · 每日额度 {status.limits.dailyRequests} 次（与其他 AI
                功能共用）
              </div>
              {draftLimit && (
                <Alert
                  type="warning"
                  showIcon
                  message="当前项目已达到 AI 候选记录上限。请下载源码并创建新项目继续。"
                />
              )}
              {busy === 'generate' && <Alert type="info" message="正在生成候选代码，请保持当前页面。" />}
              <div className="programming-history-heading">
                <h2>任务历史</h2>
                <Button
                  type="text"
                  size="small"
                  aria-label="刷新 AI 历史"
                  icon={<RefreshCw size={13} />}
                  onClick={() => void drafts.refetch()}
                />
              </div>
              <QueryState query={drafts}>
                {drafts.data?.items.length ? (
                  <div className="programming-task-history">
                    {drafts.data.items.map((draft) => (
                      <button
                        type="button"
                        key={draft.id}
                        className={`programming-task ${selectedDraftId === draft.id ? 'active' : ''}`}
                        onClick={() => void selectDraft(draft)}
                      >
                        <span>{draft.prompt}</span>
                        <small>
                          <Tag
                            color={
                              draft.status === 'ready'
                                ? 'blue'
                                : draft.status === 'failed'
                                  ? 'red'
                                  : draft.status === 'applied'
                                    ? 'green'
                                    : 'orange'
                            }
                          >
                            {draftLabels[draft.status]}
                          </Tag>
                          {date(draft.createdAt)}
                        </small>
                      </button>
                    ))}
                  </div>
                ) : drafts.data ? (
                  <div className="programming-history-empty">你的 AI 编程任务会保留在这里。</div>
                ) : null}
              </QueryState>
              {draftLoading && (
                <div className="programming-draft-loading" role="status">
                  <Spin size="small" /> 正在载入候选详情与源码…
                </div>
              )}
              {draftError && selectedDraftId && (
                <Alert
                  type="error"
                  showIcon
                  message="候选详情加载失败"
                  description={draftError}
                  action={
                    <Button size="small" onClick={() => void selectDraft({ id: selectedDraftId })}>
                      重试
                    </Button>
                  }
                />
              )}
              {selectedDraft && (
                <ProgrammingCandidate
                  draft={selectedDraft}
                  original={saved.files}
                  revision={saved.revision}
                  dirty={dirty}
                  disabled={!!busy || pending}
                  onApply={applyDraft}
                />
              )}
            </aside>
          </div>
          <Modal
            title="复制编程项目"
            open={duplicateOpen}
            okText="创建副本"
            cancelText="取消"
            confirmLoading={busy === 'duplicate'}
            okButtonProps={{
              disabled:
                !duplicateTitle.trim() || projectLimit || (!!busy && busy !== 'duplicate') || remoteChanged,
            }}
            onOk={duplicateProject}
            onCancel={() => {
              if (!busy) setDuplicateOpen(false);
            }}
          >
            <p>当前修改会先保存，副本保留源码与来源模板，并从初始版本开始。</p>
            <label className="programming-field-label" htmlFor="programming-duplicate-title">
              副本名称
            </label>
            <Input
              id="programming-duplicate-title"
              value={duplicateTitle}
              maxLength={160}
              disabled={!!busy}
              onChange={(event) => setDuplicateTitle(event.target.value)}
            />
            {projectLimit && (
              <Alert
                type="warning"
                showIcon
                message={`最多保存 ${status.limits.maxProjects} 个项目，请先下载并删除旧项目。`}
              />
            )}
          </Modal>
          <Modal
            title="新建文件"
            open={newFileOpen}
            okText="创建文件"
            cancelText="取消"
            onCancel={() => setNewFileOpen(false)}
            onOk={addFile}
            okButtonProps={{
              disabled:
                !filePathValid(newPath.trim()) ||
                files.some((file) => file.path.toLowerCase() === newPath.trim().toLowerCase()) ||
                files.length >= status.limits.maxFiles,
            }}
          >
            <label className="programming-field-label" htmlFor="programming-new-path">
              文件路径
            </label>
            <Input
              id="programming-new-path"
              value={newPath}
              maxLength={160}
              placeholder="例如：scripts/app.js"
              onChange={(event) => setNewPath(event.target.value)}
            />
            <p className="programming-ai-caption">
              支持 html、css、js、json、md、txt 和 svg。使用字母、数字、下划线或连字符命名，可用 / 创建目录。
            </p>
            {newPath && !filePathValid(newPath.trim()) && (
              <Alert type="warning" message="请输入有效的相对文件路径，不允许隐藏文件或 .. 路径。" />
            )}
            {files.some((file) => file.path.toLowerCase() === newPath.trim().toLowerCase()) && (
              <Alert type="warning" message="项目中已有同名文件。" />
            )}
          </Modal>
          <Modal
            className="programming-versions-modal"
            title="版本记录"
            width={760}
            open={versionsOpen}
            footer={<Button onClick={() => setVersionsOpen(false)}>关闭</Button>}
            onCancel={() => setVersionsOpen(false)}
          >
            <p>版本保存源码快照，恢复后仍可在记录中找到此前内容。</p>
            {(dirty || pending) && (
              <Alert
                className="programming-notice"
                type="warning"
                message={
                  dirty ? '请先保存草稿，再保存或恢复版本。' : 'AI 任务正在进行，请等待完成后操作版本。'
                }
              />
            )}
            <Space.Compact className="programming-version-create">
              <Input
                aria-label="版本说明"
                maxLength={200}
                value={note}
                disabled={!!busy || dirty || pending}
                onChange={(event) => setNote(event.target.value)}
                placeholder="例如：完成页面布局"
              />
              <Button
                icon={<Save size={14} />}
                type="primary"
                disabled={!!busy || dirty || pending || versionLimit || !note.trim()}
                loading={busy === 'version'}
                onClick={createVersion}
              >
                保存版本
              </Button>
            </Space.Compact>
            <QueryState query={versions}>
              <List
                rowKey={(version) => version.id}
                dataSource={versions.data?.items || []}
                locale={{ emptyText: '还没有版本记录。' }}
                renderItem={(version) => (
                  <List.Item
                    actions={[
                      <Button
                        key="view"
                        size="small"
                        disabled={!!busy}
                        onClick={() => void loadVersion(version)}
                      >
                        查看源码
                      </Button>,
                      <Button
                        key="restore"
                        size="small"
                        disabled={!!busy || dirty || pending}
                        onClick={() => restore(version)}
                      >
                        恢复版本
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={`版本 ${version.number} · ${version.note}`}
                      description={date(version.createdAt)}
                    />
                  </List.Item>
                )}
              />
            </QueryState>
            <div className="programming-ai-caption">
              最多保存 {status.limits.maxVersions} 个版本；达到上限后请下载源码并创建新项目继续。恢复或应用 AI
              也需要版本空间。
            </div>
          </Modal>
          <Modal
            className="programming-source-modal"
            title={`版本 ${viewVersion?.number || ''} 的源码`}
            width={850}
            open={!!viewVersion}
            footer={<Button onClick={() => setViewVersion(null)}>关闭</Button>}
            onCancel={() => setViewVersion(null)}
          >
            <Select
              aria-label="版本文件"
              value={versionPath}
              className="programming-full-select"
              onChange={setVersionPath}
              options={viewVersion?.files?.map((file) => ({ value: file.path, label: file.path })) || []}
            />
            <pre className="programming-source-view">
              {viewVersion?.files?.find((file) => file.path === versionPath)?.content || '（空文件）'}
            </pre>
          </Modal>
        </>
      )}
    </QueryState>
  );
}

function ProgrammingCandidate({
  draft,
  original,
  revision,
  dirty,
  disabled,
  onApply,
}: {
  draft: AiDraft;
  original: ProjectFile[];
  revision: number;
  dirty: boolean;
  disabled: boolean;
  onApply: () => void;
}) {
  const [path, setPath] = useState('index.html');
  const [sourceOpen, setSourceOpen] = useState(false);
  const changes = useMemo(() => {
    const paths = [
      ...new Set([...original.map((file) => file.path), ...draft.files.map((file) => file.path)]),
    ];
    return paths.flatMap((path) => {
      const before = original.find((file) => file.path === path);
      const after = draft.files.find((file) => file.path === path);
      if (before?.content === after?.content) return [];
      return [{ path, kind: !before ? '新增' : !after ? '删除' : '修改', before, after }];
    });
  }, [original, draft.files]);
  const selected = changes.find((change) => change.path === path) || changes[0];
  const conflict = draft.baseRevision !== revision;
  return (
    <div className="programming-candidate">
      <h2>候选代码审阅</h2>
      <Tag color={draft.status === 'ready' ? 'blue' : draft.status === 'failed' ? 'red' : 'default'}>
        {draftLabels[draft.status]}
      </Tag>
      <span className="programming-ai-caption">基于修订 {draft.baseRevision}</span>
      {draft.status === 'pending' && (
        <Alert type="info" showIcon message="任务正在生成，完成后可查看候选代码。" />
      )}
      {draft.status === 'failed' && (
        <Alert type="error" showIcon message={draft.error || '生成失败，请稍后重新描述需求。'} />
      )}
      {['ready', 'applied'].includes(draft.status) && (
        <>
          <p className="programming-candidate-summary">{draft.summary}</p>
          {!!draft.plan.length && (
            <div className="programming-candidate-guidance">
              <strong>实现计划</strong>
              <ol>
                {draft.plan.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            </div>
          )}
          {!!draft.teaching.length && (
            <div className="programming-candidate-guidance">
              <strong>学习提示</strong>
              <ul>
                {draft.teaching.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ul>
            </div>
          )}
          {draft.status === 'ready' && conflict && (
            <Alert
              type="warning"
              showIcon
              message="项目修订已变化，不能直接应用这份候选代码。请以当前源码重新生成。"
            />
          )}
          {draft.status === 'ready' && dirty && (
            <Alert type="warning" showIcon message="本地有未保存修改，请先保存草稿。" />
          )}
          <div className="programming-change-list">
            <strong>文件差异 · {changes.length} 项</strong>
            {changes.length ? (
              changes.map((change) => (
                <button
                  type="button"
                  key={change.path}
                  onClick={() => {
                    setPath(change.path);
                    setSourceOpen(true);
                  }}
                >
                  <Tag color={change.kind === '新增' ? 'green' : change.kind === '删除' ? 'red' : 'blue'}>
                    {change.kind}
                  </Tag>
                  <span>{change.path}</span>
                  <span>查看</span>
                </button>
              ))
            ) : (
              <p>候选文件与当前已保存源码一致。</p>
            )}
          </div>
          {draft.status === 'ready' && (
            <Button
              className="programming-apply-button"
              type="primary"
              disabled={dirty || conflict || disabled}
              onClick={onApply}
            >
              审核完成，应用候选代码
            </Button>
          )}
          {draft.status === 'applied' && (
            <Alert type="success" showIcon message="候选代码已应用到项目。原源码已保留在版本记录中。" />
          )}
          <Modal
            title="审阅文件差异"
            className="programming-diff-modal"
            width={1100}
            open={sourceOpen}
            onCancel={() => setSourceOpen(false)}
            footer={<Button onClick={() => setSourceOpen(false)}>继续审阅</Button>}
          >
            {selected && (
              <>
                <Select
                  aria-label="差异文件"
                  className="programming-full-select"
                  value={selected.path}
                  onChange={setPath}
                  options={changes.map((change) => ({
                    value: change.path,
                    label: `${change.kind} · ${change.path}`,
                  }))}
                />
                <div className="programming-diff-sources">
                  <section>
                    <h3>当前已保存源码</h3>
                    <pre>
                      {selected.before
                        ? selected.before.content || '（空文件）'
                        : '（新增文件，原项目中不存在）'}
                    </pre>
                  </section>
                  <section>
                    <h3>AI 候选源码</h3>
                    <pre>
                      {selected.after ? selected.after.content || '（空文件）' : '（候选方案将删除此文件）'}
                    </pre>
                  </section>
                </div>
              </>
            )}
          </Modal>
        </>
      )}
    </div>
  );
}
