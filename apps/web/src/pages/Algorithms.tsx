import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Collapse, Input, Pagination, Popconfirm, Select, Spin, Tabs, Tag } from 'antd';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  BrainCircuit,
  Check,
  CheckCircle2,
  Circle,
  Code2,
  Columns2,
  History,
  MessageSquare,
  Play,
  RotateCcw,
  Save,
  Send,
  Terminal,
  Trophy,
} from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, date, queryString, send, useData } from '../api';
import { useAuth } from '../auth';
import { EmptyState, PageTitle, QueryState, useUnsavedWarning } from '../components/shared';
import { CodeEditor, type CodeEditorHandle } from '../components/algorithms/CodeEditor';
import { ResizableWorkspace } from '../components/algorithms/ResizableWorkspace';
import { Editorial } from '../components/algorithms/Editorial';
import { LearningBookmark, LearningNotes } from '../components/algorithms/LearningState';
import { LearningOverview } from '../components/algorithms/LearningOverview';
import { TrainingPlans, TrainingPlanNavigation } from '../components/algorithms/TrainingPlans';
import { OutputDiff } from '../components/algorithms/OutputDiff';
import { AlgorithmDiscussion } from '../components/algorithms/AlgorithmDiscussion';
import { CodeComparison, type CodeComparisonSnapshot } from '../components/algorithms/CodeComparison';
import '../algorithms.css';

type Language = 'cpp' | 'python' | 'javascript' | 'java';
type Difficulty = 'easy' | 'medium' | 'hard';
type Verdict =
  | 'accepted'
  | 'wrong_answer'
  | 'compile_error'
  | 'runtime_error'
  | 'time_limit'
  | 'memory_limit'
  | 'system_error'
  | 'running';
type AnalysisMode = 'hint' | 'explain' | 'debug';
type ServiceStatus = {
  judge: { available: boolean; reason: string; languages: { id: Language; label: string }[] };
  ai: { available: boolean; reason: string; model: string };
};
type ProblemSummary = {
  id: string;
  number: number;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  status: 'todo' | 'attempted' | 'solved';
  favorite?: boolean;
  reviewStatus?: 'none' | 'review' | 'mastered';
};
type Draft = { language: Language; code: string; revision: number; updatedAt?: string };
type DraftConflict = { server: Draft | null; loading?: boolean; error?: string };
type Problem = ProblemSummary & {
  description: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  sourceReferences?: { title: string; url: string; concept: string }[];
  examples: { input: string; output: string; explanation?: string }[];
  timeLimitMs: number;
  memoryLimitMb: number;
  starterCode: Record<Language, string>;
  draft: Draft | null;
  navigation?: { previousProblemId: string | null; nextProblemId: string | null };
};
type Submission = {
  id: string;
  problemId: string;
  language: Language;
  code: string;
  mode: 'run' | 'submit';
  customInput?: boolean;
  status: Verdict;
  passed: number;
  total: number;
  runtimeMs: number | null;
  memoryKb: number | null;
  compileOutput?: string | null;
  error?: string | null;
  createdAt: string;
  results: {
    index: number;
    status: Verdict;
    input?: string;
    expectedOutput?: string;
    stdout?: string;
    stderr?: string;
    runtimeMs?: number;
    memoryKb?: number;
    hidden: boolean;
  }[];
};
type Analysis = {
  id: string;
  mode: AnalysisMode;
  status?: 'pending' | 'ready' | 'failed';
  error?: string | null;
  createdAt: string;
  content: {
    summary: string;
    approach: string[];
    complexity: string;
    pitfalls: string[];
    suggestedCode?: string;
  } | null;
};
type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
type HistoryQuery = {
  page: number;
  kind?: 'submit' | 'examples' | 'custom';
  language?: Language;
  status?: Verdict;
};
type LocalDraft = {
  language: Language;
  codes: Partial<Record<Language, string>>;
  updatedAt: string;
  unsynced?: boolean;
  // The cloud revision from which this local edit was made, never a clock timestamp.
  baseRevision?: number;
  writerId?: string;
};
const languages: { value: Language; label: string; file: string }[] = [
  { value: 'cpp', label: 'C++ 17', file: 'main.cpp' },
  { value: 'python', label: 'Python 3', file: 'main.py' },
  { value: 'javascript', label: 'JavaScript', file: 'main.js' },
  { value: 'java', label: 'Java', file: 'Main.java' },
];
function readStoredDraft(read: () => string | null): LocalDraft | null {
  try {
    const parsed = JSON.parse(read() || 'null');
    if (
      parsed &&
      languages.some((item) => item.value === parsed.language) &&
      parsed.codes &&
      typeof parsed.codes[parsed.language] === 'string'
    )
      return parsed;
  } catch {
    /* A corrupt or unavailable browser cache must not prevent opening a problem. */
  }
  return null;
}
const difficulties = {
  easy: { label: '简单', color: 'green' },
  medium: { label: '中等', color: 'orange' },
  hard: { label: '困难', color: 'red' },
};
const verdicts: Record<Verdict, string> = {
  accepted: '通过',
  wrong_answer: '答案错误',
  compile_error: '编译错误',
  runtime_error: '运行错误',
  time_limit: '运行超时',
  memory_limit: '内存超限',
  system_error: '评测异常',
  running: '评测中',
};
const analysisModes: Record<AnalysisMode, string> = {
  hint: '思路提示',
  explain: '完整解析',
  debug: '代码诊断',
};
const languageLabel = (language: Language) =>
  languages.find((item) => item.value === language)?.label || language;
const fingerprint = (language: Language, code: string) => `${language}\n${code}`;
function DifficultyTag({ difficulty }: { difficulty: Difficulty }) {
  const d = difficulties[difficulty] || { label: difficulty, color: 'default' };
  return <Tag color={d.color}>{d.label}</Tag>;
}
function VerdictTag({ submission }: { submission: Pick<Submission, 'status' | 'mode' | 'customInput'> }) {
  return (
    <Tag
      color={submission.status === 'accepted' ? 'green' : submission.status === 'running' ? 'blue' : 'red'}
    >
      {submission.status === 'accepted' && submission.mode === 'run'
        ? submission.customInput
          ? '执行完成'
          : '样例通过'
        : verdicts[submission.status] || submission.status}
    </Tag>
  );
}
function ServiceNotice({ status }: { status: ReturnType<typeof useData<ServiceStatus>> }) {
  if (status.error)
    return (
      <Alert
        type="warning"
        showIcon
        message="暂时无法获取服务状态"
        description={status.error.message}
        action={
          <Button size="small" onClick={() => status.refetch()}>
            重试
          </Button>
        }
      />
    );
  if (!status.data)
    return (
      <div className="algo-service-loading">
        <Spin size="small" /> 正在检查编译与 AI 服务…
      </div>
    );
  const unavailable = [
    !status.data.judge.available && `编译评测：${status.data.judge.reason || '服务暂不可用'}`,
    !status.data.ai.available && `AI 解析：${status.data.ai.reason || '服务暂不可用'}`,
  ].filter(Boolean);
  return unavailable.length ? (
    <Alert
      type="info"
      showIcon
      message="部分服务尚未就绪"
      description={
        <>
          {unavailable.map((text) => (
            <div key={String(text)}>{text}</div>
          ))}
          <div>你仍然可以阅读题目、编写代码并保存草稿。</div>
        </>
      }
    />
  ) : null;
}

export function Algorithms() {
  const [params, setParams] = useSearchParams();
  const searchQuery = params.get('q') || '';
  const [search, setSearch] = useState(searchQuery);
  useEffect(() => {
    setSearch(searchQuery);
  }, [searchQuery]);
  const rawPage = Number(params.get('page') || 1);
  const page = Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 10000 ? rawPage : 1;
  const difficulty = params.get('difficulty') || undefined;
  const tag = params.get('tag') || undefined;
  const statusFilter = params.get('status') || undefined;
  const favorite = params.get('favorite') || undefined;
  const review = params.get('review') || undefined;
  const query = useData<
    Page<ProblemSummary> & { stats: { total: number; attempted: number; solved: number }; tags: string[] }
  >(
    `/algorithms/problems?${queryString({ q: params.get('q'), difficulty, tag, status: statusFilter, favorite, review, page, pageSize: 12 })}`,
  );
  const status = useData<ServiceStatus>('/algorithms/status');
  function filter(key: string, value?: string | number) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, String(value));
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }
  const stats = query.data?.stats;
  return (
    <div className="algo-page">
      <PageTitle
        eyebrow="ALGORITHM PRACTICE"
        title="算法练习"
        description="把思路写成代码。从第一行程序，到每一个通过的测试。"
        extra={
          <div className="algo-neighbor-links">
            <Link className="algo-back" to="/algorithms/forum">
              算法论坛 <MessageSquare size={16} />
            </Link>
            <Link className="algo-back" to="/practice">
              练习中心 <ArrowUpRight size={16} />
            </Link>
          </div>
        }
      />
      <div className="algo-overview">
        <div className="algo-overview-intro">
          <div className="algo-hero-icon">
            <Code2 size={25} />
          </div>
          <div>
            <h2>在实践中掌握算法</h2>
            <p>选择一道题，在线编写、编译运行，再用 AI 梳理思路。</p>
            <div className="algo-capabilities">
              <span>4 种编程语言</span>
              <span>逐用例反馈</span>
              <span>草稿自动保存</span>
            </div>
          </div>
        </div>
        <div className="algo-stats" aria-label="算法练习统计">
          {[
            { label: '全部题目', value: stats?.total, icon: BookOpen },
            { label: '已尝试', value: stats?.attempted, icon: Code2 },
            { label: '已解决', value: stats?.solved, icon: Trophy },
          ].map((item) => (
            <div key={item.label}>
              <item.icon size={17} />
              <strong>{item.value ?? '—'}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
      <ServiceNotice status={status} />
      <TrainingPlans />
      <LearningOverview />
      <section className="algo-panel algo-library">
        <div className="algo-panel-heading">
          <div>
            <h2>题目列表</h2>
            <p>按难度和知识点，找到适合你的下一道题。</p>
          </div>
          {query.data && <span className="algo-muted">共 {query.data.total} 道</span>}
        </div>
        <div className="algo-filters">
          <Input.Search
            aria-label="搜索算法题"
            placeholder="搜索题号、题目或关键词"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value) filter('q');
            }}
            onSearch={(value) => filter('q', value.trim())}
            allowClear
          />
          <Select
            aria-label="题目难度"
            placeholder="全部难度"
            allowClear
            value={difficulty}
            onChange={(value) => filter('difficulty', value)}
            options={Object.entries(difficulties).map(([value, item]) => ({ value, label: item.label }))}
          />
          <Select
            aria-label="知识点标签"
            placeholder="全部知识点"
            allowClear
            showSearch
            value={tag}
            onChange={(value) => filter('tag', value)}
            options={(query.data?.tags || []).map((value) => ({ value, label: value }))}
          />
          <Select
            aria-label="完成状态"
            placeholder="全部状态"
            allowClear
            value={statusFilter}
            onChange={(value) => filter('status', value)}
            options={[
              { value: 'todo', label: '未开始' },
              { value: 'attempted', label: '已尝试' },
              { value: 'solved', label: '已解决' },
            ]}
          />
          <Select
            aria-label="收藏筛选"
            placeholder="全部收藏状态"
            allowClear
            value={favorite}
            onChange={(value) => filter('favorite', value)}
            options={[
              { value: 'true', label: '我的收藏' },
              { value: 'false', label: '尚未收藏' },
            ]}
          />
          <Select
            aria-label="复习筛选"
            placeholder="全部复习状态"
            allowClear
            value={review}
            onChange={(value) => filter('review', value)}
            options={[
              { value: 'review', label: '需要复习' },
              { value: 'mastered', label: '已经掌握' },
            ]}
          />
          {(params.get('q') || difficulty || tag || statusFilter || favorite || review) && (
            <Button type="text" onClick={() => setParams({})}>
              重置筛选
            </Button>
          )}
        </div>
        <QueryState query={query}>
          {query.data?.items.length ? (
            <div className="algo-problem-list">
              <div className="algo-list-head">
                <span>题目</span>
                <span>难度</span>
                <span>知识点</span>
                <span>进度</span>
              </div>
              {query.data.items.map((problem) => (
                <Link className="algo-problem-row" to={`/algorithms/${problem.id}`} key={problem.id}>
                  <div className="algo-problem-title">
                    <span className={`algo-solved-marker ${problem.status === 'solved' ? 'is-solved' : ''}`}>
                      {problem.status === 'solved' ? <CheckCircle2 size={19} /> : <Circle size={19} />}
                    </span>
                    <span>
                      <small>{String(problem.number).padStart(3, '0')}</small>
                      <strong>{problem.title}</strong>
                    </span>
                  </div>
                  <div>
                    <DifficultyTag difficulty={problem.difficulty} />
                  </div>
                  <div className="algo-tags">
                    {problem.tags.map((item) => (
                      <Tag key={item}>{item}</Tag>
                    ))}
                  </div>
                  <span className={`algo-progress ${problem.status}`}>
                    {{ todo: '未开始', attempted: '已尝试', solved: '已解决' }[problem.status]}
                    <ArrowUpRight size={15} />
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState description="没有找到符合条件的算法题">
              <Button onClick={() => setParams({})}>查看全部题目</Button>
            </EmptyState>
          )}
          {!!query.data?.total && (
            <div className="algo-pagination">
              <Pagination
                current={page}
                pageSize={12}
                total={query.data.total}
                showSizeChanger={false}
                onChange={(value) => filter('page', value)}
              />
            </div>
          )}
        </QueryState>
      </section>
    </div>
  );
}

export function AlgorithmDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  return <AlgorithmWorkspace key={`${user?.organizationId}:${user?.id}:${user?.role}:${id}`} id={id} />;
}

function AlgorithmWorkspace({ id }: { id: string }) {
  const { user } = useAuth();
  const [workspaceParams] = useSearchParams();
  const { message } = App.useApp();
  const client = useQueryClient();
  const problemQuery = useData<Problem>(`/algorithms/problems/${id}`);
  const service = useData<ServiceStatus>('/algorithms/status');
  const problem = problemQuery.data;
  const scope = [user?.organizationId, user?.id, user?.role].join(':');
  const workspaceIdentity = `${scope}:${id}`;
  const activeWorkspace = useRef(workspaceIdentity);
  activeWorkspace.current = workspaceIdentity;
  const [language, setLanguage] = useState<Language>('cpp');
  const [code, setCode] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [draftStatus, setDraftStatus] = useState('正在载入草稿…');
  const [draftConflict, setDraftConflict] = useState<DraftConflict | null>(null);
  const [dirty, setDirty] = useState(false);
  const [localFailed, setLocalFailed] = useState(false);
  const [referenceBackup, setReferenceBackup] = useState<{ language: Language; code: string } | null>(null);
  const [busy, setBusy] = useState<'run' | 'submit' | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('problem');
  const [consoleTab, setConsoleTab] = useState('input');
  const [inputMode, setInputMode] = useState('examples');
  const [stdin, setStdin] = useState('');
  const [expectedOutput, setExpectedOutput] = useState('');
  const [selfTest, setSelfTest] = useState<{ submissionId: string; expected: string } | null>(null);
  const [result, setResult] = useState<Submission | null>(null);
  const [comparison, setComparison] = useState<CodeComparisonSnapshot | null>(null);
  const [inspection, setInspection] = useState<{ item: Submission; loading: boolean; error?: string } | null>(
    null,
  );
  const inspectSequence = useRef(0);
  const executionSequence = useRef<number | null>(null);
  const inspectController = useRef<AbortController | null>(null);
  const [historyQuery, setHistoryQuery] = useState<HistoryQuery>({ page: 1 });
  const [analysisBusy, setAnalysisBusy] = useState<AnalysisMode | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [activeAnalysis, setActiveAnalysis] = useState<Analysis | null>(null);
  const histories = useData<Page<Submission>>(
    `/algorithms/problems/${id}/submissions?${queryString({
      page: historyQuery.page,
      pageSize: 8,
      kind: historyQuery.kind,
      language: historyQuery.language,
      status: historyQuery.status,
    })}`,
    initialized,
  );
  const historyFiltered = !!(historyQuery.kind || historyQuery.language || historyQuery.status);
  const historyLastPage = Math.max(1, Math.ceil((histories.data?.total || 0) / 8));
  const historyPageOutOfRange =
    !!histories.data &&
    !histories.error &&
    !histories.isFetching &&
    histories.data.page === historyQuery.page &&
    historyQuery.page > historyLastPage;
  function changeHistoryFilter(update: Partial<Omit<HistoryQuery, 'page'>>) {
    setHistoryQuery((current) => ({ ...current, ...update, page: 1 }));
  }
  useEffect(() => {
    if (!historyPageOutOfRange) return;
    // Correct only the successful request's own snapshot. A late response must
    // never move a newer filter or page selection.
    const snapshot = historyQuery;
    const corrected = { ...snapshot, page: historyLastPage };
    // The destination may still be considered fresh even though this response
    // proves its cached count obsolete. Mark only that scoped page stale before
    // mounting its observer, so one refresh also retrieves the corrected page.
    void client.invalidateQueries({
      queryKey: [
        `/algorithms/problems/${id}/submissions?${queryString({
          page: corrected.page,
          pageSize: 8,
          kind: corrected.kind,
          language: corrected.language,
          status: corrected.status,
        })}`,
        scope,
      ],
      exact: true,
      refetchType: 'none',
    });
    setHistoryQuery((current) => (current === snapshot ? corrected : current));
  }, [historyPageOutOfRange, historyLastPage, historyQuery, client, id, scope]);
  const analyses = useData<{ items: Analysis[] }>(
    `/algorithms/problems/${id}/analyses`,
    initialized && tab === 'ai',
  );
  const running = useData<Submission>(
    `/algorithms/submissions/${result?.id || ''}`,
    result?.status === 'running',
    1500,
  );
  const codeRef = useRef<CodeEditorHandle>(null);
  const codeMap = useRef<Partial<Record<Language, string>>>({});
  const lastSaved = useRef('');
  const draftRevision = useRef<number | null>(0);
  const conflictBlocked = useRef(false);
  const latestDraft = useRef({ language, code });
  const pendingSave = useRef<{ language: Language; code: string } | null>(null);
  const saveInFlight = useRef(false);
  const mounted = useRef(true);
  const operationLock = useRef(false);
  const analysisLock = useRef(false);
  const storageKey = `algorithm-draft:${user?.organizationId}:${user?.id}:${id}`;
  const windowDraftKey = `${storageKey}:unsynced`;
  const draftWriter = useRef('');
  if (!draftWriter.current) draftWriter.current = crypto.randomUUID();
  const backupKey = `${storageKey}:before-reference`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(backupKey) || 'null');
      if (saved && languages.some((item) => item.value === saved.language) && typeof saved.code === 'string')
        setReferenceBackup(saved);
    } catch {
      /* A missing backup never blocks editing. */
    }
  }, [backupKey]);
  useEffect(() => {
    mounted.current = true;
    const expire = () => {
      inspectSequence.current++;
      inspectController.current?.abort();
      inspectController.current = null;
      setComparison(null);
    };
    window.addEventListener('auth-expired', expire);
    return () => {
      mounted.current = false;
      inspectSequence.current++;
      inspectController.current?.abort();
      inspectController.current = null;
      window.removeEventListener('auth-expired', expire);
    };
  }, []);
  useUnsavedWarning(dirty && localFailed);
  function persistDraft(unsynced: boolean, updatedAt = new Date().toISOString(), fromSave = false) {
    const encoded = JSON.stringify({
      language: latestDraft.current.language,
      codes: codeMap.current,
      updatedAt,
      unsynced,
      baseRevision: draftRevision.current ?? undefined,
      writerId: draftWriter.current,
    });
    let stored = !unsynced;
    try {
      // sessionStorage belongs to this window, so another tab cannot erase an
      // unsynced edit before a reload. Keep shared storage for reopening a tab.
      if (unsynced) {
        sessionStorage.setItem(windowDraftKey, encoded);
        stored = true;
      } else sessionStorage.removeItem(windowDraftKey);
    } catch {
      /* Shared storage may still retain the draft. */
    }
    try {
      const previous = fromSave ? JSON.parse(localStorage.getItem(storageKey) || 'null') : null;
      // A delayed response may acknowledge only this window's shared backup.
      if (!fromSave || !previous || previous.writerId === draftWriter.current) {
        localStorage.setItem(storageKey, encoded);
        stored = true;
      }
    } catch {
      /* Leave the window backup in place when shared storage is unavailable. */
    }
    setLocalFailed(!stored);
  }
  useEffect(() => {
    if (!problem || initialized) return;
    const windowCopy = readStoredDraft(() => sessionStorage.getItem(windowDraftKey));
    const local =
      windowCopy?.unsynced === true ? windowCopy : readStoredDraft(() => localStorage.getItem(storageKey));
    const server = problem.draft;
    const cloudRevision = server?.revision ?? 0;
    const localHasRevision = Number.isInteger(local?.baseRevision) && (local?.baseRevision ?? -1) >= 0;
    const localMatchesCloud =
      !!local &&
      !!server &&
      fingerprint(local.language, local.codes[local.language]!) === fingerprint(server.language, server.code);
    // A synchronized, versioned old cache can use the cloud. An unsynced or
    // unversioned copy stays visible, but must never silently overwrite a newer draft.
    const useCloud =
      !!local && local.unsynced !== true && localHasRevision && local.baseRevision! < cloudRevision;
    const useLocal = !!local && !useCloud && !localMatchesCloud;
    const initialLanguage = useLocal ? local!.language : server?.language || local?.language || 'cpp';
    const initialCode = useLocal
      ? local!.codes[initialLanguage]!
      : (server?.code ?? local?.codes[initialLanguage] ?? problem.starterCode[initialLanguage] ?? '');
    codeMap.current = { ...(local?.codes || {}), [initialLanguage]: initialCode };
    latestDraft.current = { language: initialLanguage, code: initialCode };
    lastSaved.current = server
      ? fingerprint(server.language, server.code)
      : fingerprint(initialLanguage, initialCode);
    const unsynced = useLocal && (!server || fingerprint(initialLanguage, initialCode) !== lastSaved.current);
    const conflicting = unsynced && !!server && (!localHasRevision || local!.baseRevision !== cloudRevision);
    draftRevision.current = conflicting ? (local!.baseRevision ?? null) : cloudRevision;
    conflictBlocked.current = conflicting;
    if (conflicting) setDraftConflict({ server });
    if (unsynced) lastSaved.current = '';
    setLanguage(initialLanguage);
    setCode(initialCode);
    setInitialized(true);
    setDirty(unsynced);
    setDraftStatus(
      conflicting
        ? '草稿存在版本冲突，自动同步已暂停'
        : unsynced
          ? '已恢复本机草稿，等待同步'
          : server
            ? '已恢复保存的草稿'
            : '使用初始代码模板',
    );
    // Upgrade old matching caches too, retaining inactive language drafts.
    persistDraft(unsynced, local?.updatedAt || server?.updatedAt);
  }, [problem, initialized, storageKey, windowDraftKey]);
  async function readConflict() {
    conflictBlocked.current = true;
    pendingSave.current = null;
    setDraftConflict({ server: null, loading: true });
    setDraftStatus('草稿存在版本冲突，自动同步已暂停');
    persistDraft(true, undefined, true);
    try {
      const current = await api<Problem>(`/algorithms/problems/${id}`);
      if (mounted.current) setDraftConflict({ server: current.draft });
    } catch (err) {
      if (mounted.current) setDraftConflict({ server: null, error: (err as Error).message });
    }
  }
  function resolveDraftConflict(useLocal: boolean) {
    if (!draftConflict || draftConflict.loading || draftConflict.error || !problem) return;
    const server = draftConflict.server;
    draftRevision.current = server?.revision ?? 0;
    const cloudLanguage = server?.language || latestDraft.current.language;
    const cloudCode = server?.code ?? problem.starterCode[cloudLanguage] ?? '';
    lastSaved.current = fingerprint(cloudLanguage, cloudCode);
    if (!useLocal) {
      codeMap.current[cloudLanguage] = cloudCode;
      latestDraft.current = { language: cloudLanguage, code: cloudCode };
      setLanguage(cloudLanguage);
      setCode(cloudCode);
    }
    conflictBlocked.current = false;
    setDraftConflict(null);
    const unsynced =
      fingerprint(latestDraft.current.language, latestDraft.current.code) !== lastSaved.current;
    setDirty(unsynced);
    persistDraft(unsynced);
    setDraftStatus(unsynced ? '已选择本机草稿，等待同步' : '草稿已同步');
    if (unsynced) void saveDraft();
  }
  async function saveDraft() {
    if (!initialized || conflictBlocked.current || draftRevision.current === null) return;
    pendingSave.current = { ...latestDraft.current };
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    while (pendingSave.current && mounted.current && !conflictBlocked.current) {
      const current = pendingSave.current;
      pendingSave.current = null;
      if (fingerprint(current.language, current.code) === lastSaved.current) continue;
      setDraftStatus('正在同步草稿…');
      try {
        const saved: Draft = await send(
          `/algorithms/problems/${id}/draft`,
          { ...current, revision: draftRevision.current },
          'PUT',
        );
        draftRevision.current = saved.revision;
        lastSaved.current = fingerprint(current.language, current.code);
        // Reopening this problem must not initialize from a stale cached revision.
        client.setQueryData<Problem>([`/algorithms/problems/${id}`, scope], (previous) =>
          previous && (previous.draft?.revision ?? 0) <= saved.revision
            ? { ...previous, draft: saved }
            : previous,
        );
        if (mounted.current) {
          const unsynced =
            fingerprint(latestDraft.current.language, latestDraft.current.code) !== lastSaved.current;
          setDirty(unsynced);
          setDraftStatus(unsynced ? '已保留在本机，等待同步' : '草稿已同步');
          // Advance the base revision even if the student edited while saving.
          persistDraft(unsynced, saved.updatedAt, true);
        }
      } catch (err) {
        if (mounted.current) {
          if (err instanceof ApiError && err.status === 409) await readConflict();
          else setDraftStatus(`同步失败：${(err as Error).message}`);
        }
        pendingSave.current = null;
        break;
      }
    }
    saveInFlight.current = false;
  }
  useEffect(() => {
    if (!initialized || !dirty || draftConflict) return;
    const timer = window.setTimeout(() => {
      void saveDraft();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [language, code, initialized, dirty, draftConflict]);
  function edit(nextCode: string, nextLanguage = language) {
    codeMap.current[nextLanguage] = nextCode;
    latestDraft.current = { language: nextLanguage, code: nextCode };
    setLanguage(nextLanguage);
    setCode(nextCode);
    const changed = saveInFlight.current || fingerprint(nextLanguage, nextCode) !== lastSaved.current;
    if (saveInFlight.current && !conflictBlocked.current)
      pendingSave.current = { language: nextLanguage, code: nextCode };
    setDirty(changed);
    setDraftStatus(
      conflictBlocked.current
        ? '草稿存在版本冲突，自动同步已暂停'
        : changed
          ? '已保留在本机，等待同步'
          : '草稿已同步',
    );
    persistDraft(changed || conflictBlocked.current);
  }
  useEffect(() => {
    if (running.data && running.data.id === result?.id) {
      setResult(running.data);
      if (running.data.status !== 'running') void refreshRecords();
    }
  }, [running.data]);
  async function refreshRecords() {
    await client.invalidateQueries({
      predicate: (query) => String(query.queryKey[0]).startsWith('/algorithms/'),
    });
  }
  async function execute(mode: 'run' | 'submit') {
    if (operationLock.current || result?.status === 'running' || !canJudge || !initialized || !code.trim())
      return;
    const sequence = ++inspectSequence.current;
    executionSequence.current = sequence;
    const expectedWorkspace = workspaceIdentity;
    const isSelected = () =>
      mounted.current &&
      activeWorkspace.current === expectedWorkspace &&
      inspectSequence.current === sequence;
    inspectController.current?.abort();
    inspectController.current = null;
    setInspection(null);
    operationLock.current = true;
    setBusy(mode);
    setError('');
    setConsoleTab('result');
    try {
      void saveDraft();
      const submitted = (await send(`/algorithms/problems/${id}/submissions`, {
        language,
        code,
        mode,
        ...(mode === 'run' && inputMode === 'custom' ? { stdin } : {}),
      })) as Submission;
      if (!mounted.current) return;
      if (isSelected()) {
        setResult(submitted);
        setSelfTest(
          mode === 'run' && inputMode === 'custom' && expectedOutput !== ''
            ? { submissionId: submitted.id, expected: expectedOutput }
            : null,
        );
        setHistoryQuery((current) => ({ ...current, page: 1 }));
      }
      await refreshRecords();
    } catch (err) {
      if (isSelected()) setError((err as Error).message);
    } finally {
      operationLock.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  async function analyze(mode: AnalysisMode) {
    if (analysisLock.current) return;
    analysisLock.current = true;
    setAnalysisBusy(mode);
    setAnalysisError('');
    try {
      const report = (await send(`/algorithms/problems/${id}/analysis`, {
        language,
        code,
        mode,
        ...(mode === 'debug' && result && result.language === language && result.code === code
          ? { submissionId: result.id }
          : {}),
      })) as Analysis;
      if (mounted.current) {
        setActiveAnalysis(report);
        await analyses.refetch();
      }
    } catch (err) {
      if (mounted.current) {
        setAnalysisError((err as Error).message);
        void analyses.refetch();
      }
    } finally {
      analysisLock.current = false;
      if (mounted.current) setAnalysisBusy(null);
    }
  }
  async function inspectSubmission(item: Submission) {
    const sequence = ++inspectSequence.current;
    inspectController.current?.abort();
    const controller = new AbortController();
    inspectController.current = controller;
    const expectedWorkspace = workspaceIdentity;
    const current = () =>
      mounted.current &&
      activeWorkspace.current === expectedWorkspace &&
      inspectSequence.current === sequence &&
      !controller.signal.aborted;
    setResult(null);
    setSelfTest(null);
    setError('');
    setComparison(null);
    setInspection({ item, loading: true });
    setConsoleTab('result');
    try {
      if (item.problemId !== id) throw new Error('这条提交不属于当前题目，无法查看。');
      const full = await api<Submission>(`/algorithms/submissions/${encodeURIComponent(item.id)}`, {
        signal: controller.signal,
      });
      if (!current()) return;
      if (
        full.id !== item.id ||
        full.problemId !== id ||
        !languages.some((entry) => entry.value === full.language) ||
        typeof full.code !== 'string'
      )
        throw new Error('提交记录与当前题目不匹配，请刷新提交记录后重试。');
      if (current()) {
        setResult(full);
        setInspection({ item: full, loading: false });
      }
    } catch (err) {
      if (current())
        setInspection({
          item,
          loading: false,
          error: (err as Error).message || '提交记录暂时无法读取，请重试。',
        });
    } finally {
      if (current()) inspectController.current = null;
    }
  }
  function compareSubmission() {
    if (!initialized || !result || result.problemId !== id || !mounted.current) return;
    const current = { ...latestDraft.current };
    const withinLimit = (value: string) =>
      value.length <= 16000 && new TextEncoder().encode(value).length <= 48000;
    if (!withinLimit(current.code) || !withinLimit(result.code)) {
      message.error('代码对比支持每份最多16000字符、48000字节，请先缩短当前代码。');
      return;
    }
    const capturedAt = new Date().toISOString();
    setComparison({
      id: crypto.randomUUID(),
      scope,
      problemId: id,
      history: {
        id: result.id,
        language: result.language,
        code: result.code,
        createdAt: result.createdAt,
        source: result.mode === 'submit' ? '正式提交' : result.customInput ? '自定义运行' : '样例运行',
        verdict:
          result.status === 'accepted' && result.mode === 'run'
            ? result.customInput
              ? '运行完成'
              : '样例通过'
            : verdicts[result.status],
      },
      current: {
        ...current,
        capturedAt,
        unsynced:
          dirty || saveInFlight.current || fingerprint(current.language, current.code) !== lastSaved.current,
      },
      ...(codeRef.current?.preferences() || { theme: 'vs', fontSize: 14 }),
    });
  }
  function restoreComparison() {
    if (!comparison || !mounted.current || comparison.scope !== scope || comparison.problemId !== id) return;
    edit(comparison.history.code, comparison.history.language);
    setComparison(null);
    message.success('已将历史代码恢复到编辑器');
    codeRef.current?.focus();
  }
  function restoreSubmission() {
    if (!result) return;
    edit(result.code, result.language);
    message.success('已将这次提交的代码恢复到编辑器');
    codeRef.current?.focus();
  }
  function loadReference(nextCode: string, nextLanguage: Language) {
    const backup = { ...latestDraft.current };
    setReferenceBackup(backup);
    try {
      localStorage.setItem(backupKey, JSON.stringify(backup));
    } catch {
      message.warning('载入前的代码已临时备份；本机存储不可用，离开页面前请保留需要的代码。');
    }
    edit(nextCode, nextLanguage);
  }
  const canJudge =
    !!service.data?.judge.available && service.data.judge.languages.some((item) => item.id === language);
  const isExecuting = !!busy || result?.status === 'running';
  const showExecutionProgress = !!busy && executionSequence.current === inspectSequence.current;
  return (
    <div className="algo-page algo-detail">
      <Link className="algo-back" to="/algorithms">
        <ArrowLeft size={16} /> 返回算法题库
      </Link>
      <QueryState query={problemQuery}>
        {problem && (
          <>
            <div className="algo-detail-heading">
              <div>
                <div className="algo-eyebrow">ALGORITHM / {String(problem.number).padStart(3, '0')}</div>
                <h1>{problem.title}</h1>
                <div className="algo-tags">
                  <DifficultyTag difficulty={problem.difficulty} />
                  {problem.tags.map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </div>
              </div>
              <div className="algo-detail-tools">
                <LearningBookmark problemId={id} />
                <div className="algo-neighbor-links">
                  {!workspaceParams.get('plan') && problem.navigation?.previousProblemId && (
                    <Link to={`/algorithms/${problem.navigation.previousProblemId}`}>上一题</Link>
                  )}
                  {!workspaceParams.get('plan') && problem.navigation?.nextProblemId && (
                    <Link to={`/algorithms/${problem.navigation.nextProblemId}`}>下一题</Link>
                  )}
                </div>
                <div className="algo-limits">
                  <span>
                    时间限制 <strong>{problem.timeLimitMs} ms</strong>
                  </span>
                  <span>
                    内存限制 <strong>{problem.memoryLimitMb} MB</strong>
                  </span>
                </div>
              </div>
            </div>
            <TrainingPlanNavigation problemId={id} />
            <ServiceNotice status={service} />
            <ResizableWorkspace>
              <section className="algo-panel algo-reading">
                <Tabs
                  activeKey={tab}
                  onChange={setTab}
                  items={[
                    {
                      key: 'problem',
                      label: (
                        <span className="algo-tab">
                          <BookOpen size={15} />
                          题目描述
                        </span>
                      ),
                      children: (
                        <div className="algo-statement">
                          <p className="algo-prose">{problem.description}</p>
                          <h3>输入格式</h3>
                          <p className="algo-prose">{problem.inputFormat}</p>
                          <h3>输出格式</h3>
                          <p className="algo-prose">{problem.outputFormat}</p>
                          {problem.examples.map((example, index) => (
                            <section className="algo-example" key={index}>
                              <div className="algo-example-title">
                                <h3>样例 {index + 1}</h3>
                                <Button
                                  size="small"
                                  type="text"
                                  onClick={() => {
                                    setInputMode('custom');
                                    setStdin(example.input);
                                    setConsoleTab('input');
                                  }}
                                >
                                  载入输入
                                </Button>
                              </div>
                              <CodeBlock label="输入" value={example.input} />
                              <CodeBlock label="输出" value={example.output} />
                              {example.explanation && (
                                <p className="algo-prose algo-muted">说明：{example.explanation}</p>
                              )}
                            </section>
                          ))}
                          <h3>数据范围与约束</h3>
                          <p className="algo-prose">{problem.constraints}</p>
                          {!!problem.sourceReferences?.length && (
                            <>
                              <h3>资料来源与延伸学习</h3>
                              <ul>
                                {problem.sourceReferences.map((source) => (
                                  <li key={source.url}>
                                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                                      {source.title}
                                    </a>
                                    <span className="algo-muted"> · {source.concept}</span>
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                          <div className="algo-io-tip">
                            <Terminal size={16} />
                            <span>
                              编写完整程序，从标准输入读取数据，将答案输出到标准输出。Java 请使用 Main 类。
                            </span>
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: 'editorial',
                      label: (
                        <span className="algo-tab">
                          <BookOpen size={15} />
                          题解
                        </span>
                      ),
                      children: <Editorial problemId={id} language={language} onLoadCode={loadReference} />,
                    },
                    {
                      key: 'notes',
                      label: (
                        <span className="algo-tab">
                          <Save size={15} />
                          笔记
                        </span>
                      ),
                      children: <LearningNotes problemId={id} />,
                    },
                    {
                      key: 'discussion',
                      label: (
                        <span className="algo-tab">
                          <MessageSquare size={15} />
                          讨论
                        </span>
                      ),
                      children: <AlgorithmDiscussion problemId={id} />,
                    },
                    {
                      key: 'history',
                      label: (
                        <span className="algo-tab">
                          <History size={15} />
                          提交记录
                        </span>
                      ),
                      children: (
                        <div className="algo-tab-content">
                          <p className="algo-muted">
                            运行和正式提交都会保留。仅正式提交通过全部用例后计为已解决。
                            自定义运行的“执行完成”仅表示程序正常退出。
                          </p>
                          <div className="algo-history-filters" role="group" aria-label="提交记录筛选">
                            <label>
                              <span>记录类型</span>
                              <Select<NonNullable<HistoryQuery['kind']> | ''>
                                aria-label="提交记录类型"
                                value={historyQuery.kind || ''}
                                onChange={(value) => changeHistoryFilter({ kind: value || undefined })}
                                options={[
                                  { value: '', label: '全部类型' },
                                  { value: 'submit', label: '正式提交' },
                                  { value: 'examples', label: '样例运行' },
                                  { value: 'custom', label: '自定义运行' },
                                ]}
                              />
                            </label>
                            <label>
                              <span>代码语言</span>
                              <Select<Language | ''>
                                aria-label="提交记录语言"
                                value={historyQuery.language || ''}
                                onChange={(value) => changeHistoryFilter({ language: value || undefined })}
                                options={[{ value: '', label: '全部语言' }, ...languages]}
                              />
                            </label>
                            <label>
                              <span>执行结果</span>
                              <Select<Verdict | ''>
                                aria-label="提交记录结果"
                                value={historyQuery.status || ''}
                                onChange={(value) => changeHistoryFilter({ status: value || undefined })}
                                options={[
                                  { value: '', label: '全部结果' },
                                  ...Object.entries(verdicts).map(([value, label]) => ({
                                    value,
                                    label:
                                      value === 'accepted'
                                        ? historyQuery.kind === 'submit'
                                          ? '正式通过'
                                          : historyQuery.kind === 'examples'
                                            ? '样例通过'
                                            : historyQuery.kind === 'custom'
                                              ? '执行完成'
                                              : '通过／执行完成'
                                        : label,
                                  })),
                                ]}
                              />
                            </label>
                          </div>
                          <div className="algo-history-filter-meta">
                            <span className="algo-muted" role="status" aria-label="提交记录匹配数量">
                              {histories.data
                                ? `${histories.error ? '上次加载' : ''}匹配 ${histories.data.total} 条`
                                : histories.error
                                  ? '匹配数量暂不可用'
                                  : '正在加载匹配记录…'}
                            </span>
                            <Button
                              size="small"
                              disabled={!historyFiltered && historyQuery.page === 1}
                              onClick={() => setHistoryQuery({ page: 1 })}
                            >
                              重置筛选
                            </Button>
                          </div>
                          <div className="algo-history-heading">
                            <h3>最近提交</h3>
                            <Button
                              size="small"
                              type="text"
                              loading={histories.isFetching}
                              onClick={() => histories.refetch()}
                            >
                              刷新提交记录
                            </Button>
                          </div>
                          <QueryState query={histories}>
                            {historyPageOutOfRange ? (
                              <div className="algo-working">
                                <Spin size="small" />
                                <span>正在调整记录页码…</span>
                              </div>
                            ) : histories.data?.items.length ? (
                              <div className="algo-history">
                                {histories.data.items.map((item) => (
                                  <button
                                    type="button"
                                    className={`algo-history-item ${result?.id === item.id ? 'is-active' : ''}`}
                                    key={item.id}
                                    data-testid={`algorithm-submission-${item.id}`}
                                    onClick={() => void inspectSubmission(item)}
                                  >
                                    <div>
                                      <VerdictTag submission={item} />
                                      <span>
                                        {item.mode === 'submit'
                                          ? '正式提交'
                                          : item.customInput
                                            ? '自定义运行'
                                            : '样例运行'}
                                      </span>
                                      <ArrowUpRight size={15} />
                                    </div>
                                    <div>
                                      <span>
                                        {languageLabel(item.language)} · {item.passed}/{item.total} 用例
                                      </span>
                                      <time>{date(item.createdAt)}</time>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : (histories.data?.total || 0) > 0 ? (
                              <Alert
                                type="info"
                                showIcon
                                message="记录正在更新"
                                description="当前页暂时没有可展示的记录，请刷新后查看。"
                                action={<Button onClick={() => histories.refetch()}>刷新记录</Button>}
                              />
                            ) : historyFiltered ? (
                              <EmptyState description="没有符合当前条件的记录">
                                <Button onClick={() => setHistoryQuery({ page: 1 })}>清除筛选</Button>
                              </EmptyState>
                            ) : (
                              <EmptyState description="还没有提交记录，先运行一次样例吧" />
                            )}
                            {!!histories.data?.total && (
                              <Pagination
                                size="small"
                                current={historyQuery.page}
                                pageSize={8}
                                total={histories.data.total}
                                showSizeChanger={false}
                                onChange={(page) => setHistoryQuery((current) => ({ ...current, page }))}
                              />
                            )}
                          </QueryState>
                        </div>
                      ),
                    },
                    {
                      key: 'ai',
                      label: (
                        <span className="algo-tab">
                          <BrainCircuit size={15} />
                          AI 解析
                        </span>
                      ),
                      children: (
                        <div className="algo-tab-content">
                          <div className="algo-ai-intro">
                            <BrainCircuit size={25} />
                            <div>
                              <h3>从卡住的地方，继续前进</h3>
                              <p>先获取一点提示，再逐步理解解题方法。</p>
                            </div>
                          </div>
                          <div className="algo-ai-actions">
                            {(Object.keys(analysisModes) as AnalysisMode[]).map((mode) => (
                              <Button
                                key={mode}
                                onClick={() => void analyze(mode)}
                                disabled={!service.data?.ai.available || !!analysisBusy || !initialized}
                                loading={analysisBusy === mode}
                              >
                                {analysisModes[mode]}
                              </Button>
                            ))}
                          </div>
                          <p className="algo-muted">
                            AI 将结合本题和编辑器内的当前代码生成解析。内容供学习参考，请用测试验证。
                            {service.data?.ai.model && ` 模型：${service.data.ai.model}`}
                          </p>
                          {analysisBusy && (
                            <div className="algo-working">
                              <Spin size="small" />
                              <span>正在生成{analysisModes[analysisBusy]}，请稍候…</span>
                            </div>
                          )}
                          {analysisError && (
                            <Alert showIcon type="error" message="解析生成失败" description={analysisError} />
                          )}
                          {activeAnalysis && <AnalysisReport report={activeAnalysis} />}
                          <div className="algo-history-heading">
                            <h3>解析历史</h3>
                            <Button size="small" type="text" onClick={() => analyses.refetch()}>
                              刷新
                            </Button>
                          </div>
                          <QueryState query={analyses}>
                            {analyses.data?.items.length ? (
                              <div className="algo-history">
                                {analyses.data.items.map((report) => (
                                  <button
                                    type="button"
                                    className={`algo-history-item ${activeAnalysis?.id === report.id ? 'is-active' : ''}`}
                                    key={report.id}
                                    onClick={() => setActiveAnalysis(report)}
                                  >
                                    <div>
                                      <strong>{analysisModes[report.mode]}</strong>
                                      <span>
                                        {report.status === 'failed'
                                          ? '生成失败'
                                          : report.status === 'pending'
                                            ? '生成中'
                                            : '查看解析'}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="algo-history-summary">
                                        {report.content?.summary || report.error || '等待生成结果'}
                                      </span>
                                      <time>{date(report.createdAt)}</time>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <EmptyState description="暂无解析，选择上方模式开始" />
                            )}
                          </QueryState>
                        </div>
                      ),
                    },
                  ]}
                />
              </section>
              <div className="algo-coding">
                <section className="algo-panel algo-editor-panel">
                  <div className="algo-editor-toolbar">
                    <span>
                      <Code2 size={17} />
                      <strong>代码编辑器</strong>
                    </span>
                    <Select
                      aria-label="编程语言"
                      value={language}
                      disabled={!initialized}
                      options={languages}
                      onChange={(next) =>
                        edit(codeMap.current[next] ?? problem.starterCode[next] ?? '', next)
                      }
                    />
                  </div>
                  <div className="algo-editor-file">
                    <span>{languages.find((item) => item.value === language)?.file}</span>
                    <Popconfirm
                      title="恢复当前语言的初始模板？"
                      description="当前语言的代码将被替换，请先保存需要的内容。"
                      onConfirm={() => edit(problem.starterCode[language] || '')}
                      okText="恢复模板"
                      cancelText="取消"
                    >
                      <Button size="small" type="text" icon={<RotateCcw size={13} />} disabled={!initialized}>
                        重置模板
                      </Button>
                    </Popconfirm>
                  </div>
                  <CodeEditor
                    ref={codeRef}
                    problemId={id}
                    language={language}
                    value={code}
                    disabled={!initialized}
                    onChange={edit}
                    onSave={() => void saveDraft()}
                    onRun={() => void execute('run')}
                    onSubmit={() => void execute('submit')}
                    canExecute={canJudge && initialized && !!code.trim() && !isExecuting}
                  />
                  {draftConflict && (
                    <Alert
                      type="warning"
                      showIcon
                      message="草稿存在版本冲突"
                      description={
                        <div>
                          <p>本机代码已保留，自动同步已暂停。比较两份草稿后选择要保留的版本。</p>
                          <p>本机草稿（{languages.find((item) => item.value === language)?.label}）</p>
                          <Input.TextArea aria-label="冲突中的本机草稿" value={code} readOnly rows={4} />
                          {draftConflict.loading ? (
                            <p>正在读取最新云端草稿…</p>
                          ) : draftConflict.error ? (
                            <p role="alert">读取云端草稿失败：{draftConflict.error}</p>
                          ) : draftConflict.server ? (
                            <>
                              <p>
                                云端草稿（
                                {
                                  languages.find((item) => item.value === draftConflict.server?.language)
                                    ?.label
                                }
                                ，版本 {draftConflict.server.revision}）
                              </p>
                              <Input.TextArea
                                aria-label="冲突中的云端草稿"
                                value={draftConflict.server.code}
                                readOnly
                                rows={4}
                              />
                            </>
                          ) : (
                            <p>云端尚无草稿，采用云端会恢复初始代码模板。</p>
                          )}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                            <Button
                              onClick={() => resolveDraftConflict(false)}
                              disabled={draftConflict.loading || !!draftConflict.error}
                            >
                              采用云端草稿
                            </Button>
                            <Button
                              onClick={() => resolveDraftConflict(true)}
                              disabled={draftConflict.loading || !!draftConflict.error}
                            >
                              保留本机并同步
                            </Button>
                            <Button onClick={() => void readConflict()} loading={draftConflict.loading}>
                              重新读取云端
                            </Button>
                          </div>
                        </div>
                      }
                    />
                  )}
                  {referenceBackup && (
                    <Alert
                      className="algo-reference-backup"
                      type="info"
                      showIcon
                      message="载入参考代码前的草稿已备份"
                      action={
                        <Popconfirm
                          title="恢复载入参考代码前的草稿？"
                          description="当前编辑器内容将被替换。"
                          okText="恢复原草稿"
                          cancelText="取消"
                          onConfirm={() => {
                            edit(referenceBackup.code, referenceBackup.language);
                            setReferenceBackup(null);
                            try {
                              localStorage.removeItem(backupKey);
                            } catch {
                              /* Restored code is saved through the normal draft flow. */
                            }
                          }}
                        >
                          <Button size="small">恢复原草稿</Button>
                        </Popconfirm>
                      }
                    />
                  )}
                  <div className="algo-editor-footer">
                    <span
                      className={draftStatus.startsWith('同步失败') || localFailed ? 'algo-error-text' : ''}
                      role="status"
                    >
                      {!dirty && initialized && <Check size={13} />}
                      {draftStatus}
                    </span>
                    <Button
                      size="small"
                      type="text"
                      icon={<Save size={13} />}
                      onClick={() => void saveDraft()}
                      disabled={!initialized || !dirty || !!draftConflict}
                    >
                      保存草稿
                    </Button>
                  </div>
                  <div className="algo-execute-bar">
                    <span className="algo-muted">标准输入 / 标准输出</span>
                    <div>
                      <Button
                        icon={<Play size={14} />}
                        loading={busy === 'run'}
                        disabled={!canJudge || !initialized || !code.trim() || isExecuting}
                        onClick={() => void execute('run')}
                      >
                        运行代码
                      </Button>
                      <Button
                        type="primary"
                        icon={<Send size={14} />}
                        loading={busy === 'submit'}
                        disabled={!canJudge || !initialized || !code.trim() || isExecuting}
                        onClick={() => void execute('submit')}
                      >
                        提交评测
                      </Button>
                    </div>
                  </div>
                  {service.data?.judge.available && !canJudge && (
                    <Alert showIcon type="warning" message="当前评测服务不支持所选语言，请切换语言后运行。" />
                  )}
                </section>
                <section className="algo-panel algo-console">
                  <Tabs
                    activeKey={consoleTab}
                    onChange={setConsoleTab}
                    items={[
                      {
                        key: 'input',
                        label: (
                          <span className="algo-tab">
                            <Terminal size={15} />
                            测试输入
                          </span>
                        ),
                        children: (
                          <div className="algo-console-content">
                            <Select
                              aria-label="运行输入方式"
                              value={inputMode}
                              onChange={setInputMode}
                              options={[
                                { value: 'examples', label: `运行全部样例（${problem.examples.length} 组）` },
                                { value: 'custom', label: '自定义输入' },
                              ]}
                            />
                            {inputMode === 'custom' ? (
                              <>
                                <label className="algo-field-label" htmlFor="algorithm-stdin">
                                  标准输入
                                </label>
                                <Input.TextArea
                                  id="algorithm-stdin"
                                  value={stdin}
                                  onChange={(event) => setStdin(event.target.value)}
                                  rows={5}
                                  placeholder="输入测试数据；空输入也可运行"
                                  className="algo-stdin"
                                />
                                <label className="algo-field-label" htmlFor="algorithm-expected">
                                  预期输出（可选，用于本机自测）
                                </label>
                                <Input.TextArea
                                  id="algorithm-expected"
                                  value={expectedOutput}
                                  onChange={(event) => setExpectedOutput(event.target.value)}
                                  rows={3}
                                  placeholder="填入你预计的答案，运行后在浏览器中比较输出"
                                  className="algo-stdin"
                                />
                                <p className="algo-muted">
                                  自定义输入仅检查程序能否执行。预期输出仅用于浏览器自测，不会上传为评测答案。
                                </p>
                              </>
                            ) : (
                              <>
                                <p className="algo-muted">
                                  点击“运行代码”检查公开样例；“提交评测”会检验包括隐藏用例在内的完整测试集。
                                </p>
                                {problem.examples.map((example, index) => (
                                  <CodeBlock
                                    key={index}
                                    label={`样例 ${index + 1} 输入`}
                                    value={example.input}
                                  />
                                ))}
                              </>
                            )}
                          </div>
                        ),
                      },
                      {
                        key: 'result',
                        label: (
                          <span className="algo-tab">
                            <CheckCircle2 size={15} />
                            执行结果{isExecuting && <Spin size="small" />}
                          </span>
                        ),
                        children: (
                          <div className="algo-console-content" aria-live="polite">
                            {error && (
                              <Alert type="error" showIcon message="请求未完成" description={error} />
                            )}
                            {inspection?.error && (
                              <Alert
                                type="error"
                                showIcon
                                message="提交记录读取失败"
                                description={inspection.error}
                                action={
                                  <Button onClick={() => void inspectSubmission(inspection.item)}>
                                    重试读取提交
                                  </Button>
                                }
                              />
                            )}
                            {showExecutionProgress ? (
                              <div className="algo-running">
                                <Spin />
                                <strong>{busy === 'run' ? '正在编译并运行…' : '正在编译并评测…'}</strong>
                                <p>执行时间受语言和用例数量影响，请稍候。</p>
                              </div>
                            ) : inspection?.loading ? (
                              <div className="algo-running">
                                <Spin />
                                <strong>正在读取提交记录…</strong>
                              </div>
                            ) : result ? (
                              <>
                                <SubmissionResult submission={result} />
                                {selfTest?.submissionId === result.id && result.status === 'accepted' && (
                                  <OutputDiff
                                    expected={selfTest.expected}
                                    actual={result.results[0]?.stdout || ''}
                                    selfTest
                                  />
                                )}
                                {running.error && result.status === 'running' && (
                                  <Alert
                                    type="warning"
                                    message="评测状态暂时无法刷新"
                                    description={running.error.message}
                                    action={
                                      <Button size="small" onClick={() => running.refetch()}>
                                        重试
                                      </Button>
                                    }
                                  />
                                )}
                                <Collapse
                                  className="algo-submitted-code"
                                  items={[
                                    {
                                      key: 'code',
                                      label: `查看此次${result.mode === 'submit' ? '提交' : '运行'}的代码 · ${languageLabel(result.language)}`,
                                      children: (
                                        <>
                                          <pre className="algo-code-block">{result.code}</pre>
                                          <div className="algo-submitted-code-actions">
                                            <Button
                                              icon={<Columns2 size={14} />}
                                              onClick={compareSubmission}
                                              disabled={!initialized}
                                            >
                                              与当前代码对比
                                            </Button>
                                            <Popconfirm
                                              title="将此代码恢复到编辑器？"
                                              description="当前编辑器内容会被替换。"
                                              onConfirm={restoreSubmission}
                                              okText="恢复代码"
                                              cancelText="取消"
                                            >
                                              <Button icon={<RotateCcw size={14} />}>恢复这份代码</Button>
                                            </Popconfirm>
                                          </div>
                                        </>
                                      ),
                                    },
                                  ]}
                                />
                              </>
                            ) : (
                              !error &&
                              !inspection?.error && (
                                <EmptyState description="运行代码或提交后，在这里查看结果" />
                              )
                            )}
                          </div>
                        ),
                      },
                    ]}
                  />
                </section>
              </div>
            </ResizableWorkspace>
          </>
        )}
      </QueryState>
      {comparison && (
        <CodeComparison
          key={comparison.id}
          snapshot={comparison}
          onClose={() => setComparison(null)}
          onRestore={restoreComparison}
        />
      )}
    </div>
  );
}

function CodeBlock({ label, value }: { label: string; value?: string }) {
  return (
    <div className="algo-output-block">
      <div>{label}</div>
      <pre>{value === undefined ? '未提供' : value === '' ? '（空）' : value}</pre>
    </div>
  );
}
function SubmissionResult({ submission }: { submission: Submission }) {
  const success = submission.status === 'accepted';
  return (
    <div className="algo-result">
      <div className={`algo-result-heading ${success ? 'is-success' : ''}`}>
        <div>
          <VerdictTag submission={submission} />
          <span>
            {submission.mode === 'submit' ? '正式提交' : submission.customInput ? '自定义输入' : '样例运行'}
          </span>
        </div>
        <time>{date(submission.createdAt)}</time>
      </div>
      {submission.status === 'running' && (
        <div className="algo-working">
          <Spin size="small" />
          评测进行中，结果将自动刷新。
        </div>
      )}
      <div className="algo-result-metrics">
        <div>
          <span>{submission.customInput ? '执行成功' : '通过用例'}</span>
          <strong>
            {submission.passed} / {submission.total}
          </strong>
        </div>
        <div>
          <span>最长用时</span>
          <strong>{submission.runtimeMs == null ? '—' : `${submission.runtimeMs} ms`}</strong>
        </div>
        <div>
          <span>峰值内存</span>
          <strong>
            {submission.memoryKb == null ? '—' : `${(submission.memoryKb / 1024).toFixed(1)} MB`}
          </strong>
        </div>
      </div>
      {submission.customInput && <p className="algo-muted">自定义运行不校验答案，不会将本题标记为已解决。</p>}
      {submission.error && <Alert showIcon type="error" message={submission.error} />}
      {submission.compileOutput && <CodeBlock label="编译日志" value={submission.compileOutput} />}
      {submission.status === 'compile_error' && !submission.compileOutput && (
        <Alert
          type="info"
          showIcon
          message="运行样例查看编译日志"
          description="正式提交包含隐藏用例时，编译日志不会公开。切换到样例输入后运行，可定位编译错误。"
        />
      )}
      <Collapse
        className="algo-cases"
        items={submission.results.map((item, index) => ({
          key: `${item.index}-${index}`,
          label: (
            <span className="algo-case-label">
              <span>
                用例 {index + 1}
                {item.hidden && ' · 隐藏'}
              </span>
              <VerdictTag
                submission={{
                  status: item.status,
                  mode: submission.mode,
                  customInput: submission.customInput,
                }}
              />
            </span>
          ),
          children: item.hidden ? (
            <p className="algo-muted">此用例的输入、预期输出和程序输出不公开，请结合数据范围检查边界条件。</p>
          ) : (
            <>
              <CodeBlock label="输入" value={item.input} />
              {item.expectedOutput !== undefined && (
                <CodeBlock label="预期输出" value={item.expectedOutput} />
              )}
              <CodeBlock label="实际输出" value={item.stdout} />
              {item.status === 'wrong_answer' && item.expectedOutput !== undefined && (
                <OutputDiff expected={item.expectedOutput} actual={item.stdout || ''} />
              )}
              {item.stderr && <CodeBlock label="运行日志" value={item.stderr} />}
              <span className="algo-muted">{item.runtimeMs == null ? '' : `耗时 ${item.runtimeMs} ms`}</span>
            </>
          ),
        }))}
      />
    </div>
  );
}
function AnalysisReport({ report }: { report: Analysis }) {
  if (report.status === 'failed')
    return (
      <Alert
        type="error"
        showIcon
        message="这次解析未能完成"
        description={report.error || '请重新生成解析。'}
      />
    );
  if (!report.content)
    return <Alert type="info" showIcon message="解析仍在生成中" description="稍后刷新解析历史查看结果。" />;
  const content = report.content;
  return (
    <article className="algo-analysis-report">
      <div className="algo-analysis-title">
        <Tag color="blue">{analysisModes[report.mode]}</Tag>
        <time>{date(report.createdAt)}</time>
      </div>
      <p className="algo-prose">{content.summary}</p>
      {!!content.approach?.length && (
        <>
          <h3>解题思路</h3>
          <ol>
            {content.approach.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </>
      )}
      {content.complexity && (
        <>
          <h3>复杂度分析</h3>
          <p className="algo-prose">{content.complexity}</p>
        </>
      )}
      {!!content.pitfalls?.length && (
        <>
          <h3>易错点与边界</h3>
          <ul>
            {content.pitfalls.map((pitfall, index) => (
              <li key={index}>{pitfall}</li>
            ))}
          </ul>
        </>
      )}
      {content.suggestedCode && (
        <Collapse
          items={[
            {
              key: 'code',
              label: '查看参考代码',
              children: <pre className="algo-code-block">{content.suggestedCode}</pre>,
            },
          ]}
        />
      )}
    </article>
  );
}
