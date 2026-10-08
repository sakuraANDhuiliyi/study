import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Checkbox, Input, Pagination, Popconfirm, Spin, Tabs, Tag } from 'antd';
import {
  ArrowLeft,
  ArrowUpRight,
  BrainCircuit,
  Check,
  Download,
  FileText,
  History,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, date, getCsrf, label, queryString, send, useData } from '../api';
import {
  EmptyState,
  PageTitle,
  Panel,
  QueryState,
  RichContent,
  useUnsavedWarning,
} from '../components/shared';
import { RemoteSelect } from '../components/RemoteSelect';
import '../ai-study.css';

type Mistake = {
  id: string;
  available: boolean;
  courseId: string;
  wrongCount: number;
  mastered: boolean;
  question?: { stem: string; type: string; knowledgePoints?: string[] } | null;
};
type Snapshot = {
  mistakeId: string;
  questionId: string;
  questionVersionId: string;
  courseId: string;
  courseTitle: string;
  stem: string;
  type: string;
  options: unknown;
  studentAnswer: unknown;
  correctAnswer: unknown;
  explanation: string;
  knowledgePoints: string[];
  wrongCount: number;
  answeredAt: string;
  scoreCents: number | null;
  maxScoreCents: number;
};
type Analysis = {
  summary: string;
  patterns: { label: string; evidence: string; advice: string; mistakeIds: string[] }[];
  items: {
    mistakeId: string;
    diagnosis: string;
    reasoning: string;
    correction: string;
    knowledgePoints: string[];
    confidence: 'low' | 'medium' | 'high';
  }[];
  reviewPlan: string[];
  searchQueries: string[];
};
type Source = { id: string; title: string; url: string; snippet: string };
type SearchResult = {
  query: string;
  summary: string;
  sources: Source[];
  citations: { start: number; end: number; sourceId: string }[];
  searchedAt: string;
  provider: 'openai' | 'tavily';
};
type Report = {
  id: string;
  status: 'pending' | 'ready' | 'failed';
  createdAt: string;
  updatedAt: string;
  error: string | null;
  reflection: string;
  mistakes: Snapshot[];
  analysis: Analysis | null;
  search: SearchResult | null;
  searchError?: string;
};
type Summary = {
  id: string;
  status: Report['status'];
  createdAt: string;
  summary: string;
  error: string | null;
  mistakeCount: number;
};
type ServiceStatus = {
  analysis: { available: boolean; reason: string };
  search: { available: boolean; reason: string };
  model: string;
  searchProvider: string;
  limits: { maxMistakes: number; dailyRequests: number; maxDownloadMb: number };
};
const plain = (value = '') =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
const answerText = (value: unknown): string =>
  value === null || value === undefined
    ? '未作答'
    : typeof value === 'string'
      ? value
      : typeof value === 'boolean'
        ? value
          ? '正确'
          : '错误'
        : JSON.stringify(value, null, 2);
const safeUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};
const reportStatus = { pending: '分析中', ready: '已完成', failed: '生成失败' };
function CitedSummary({ result }: { result: SearchResult }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  const citations = [...result.citations].sort((a, b) => a.start - b.start || a.end - b.end);
  for (const citation of citations) {
    const index = result.sources.findIndex((source) => source.id === citation.sourceId);
    const source = result.sources[index];
    if (
      !source ||
      !Number.isInteger(citation.start) ||
      !Number.isInteger(citation.end) ||
      citation.start < cursor ||
      citation.end <= citation.start ||
      citation.end > result.summary.length
    )
      continue;
    parts.push(result.summary.slice(cursor, citation.start));
    const content = result.summary.slice(citation.start, citation.end);
    const url = safeUrl(source.url);
    parts.push(
      url ? (
        <a
          key={`${citation.start}-${source.id}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={source.title}
          className="ai-inline-citation"
        >
          {content}
          <sup>[{index + 1}]</sup>
        </a>
      ) : (
        content
      ),
    );
    cursor = citation.end;
  }
  parts.push(result.summary.slice(cursor));
  return <p className="ai-prose ai-search-summary">{parts}</p>;
}
async function downloadFile(path: string, fallbackName: string) {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    ...(path.endsWith('/download') ? { method: 'POST', headers: { 'x-csrf-token': getCsrf() } } : {}),
  });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('auth-expired'));
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.message || body.error?.message || '下载失败，请稍后重试');
  }
  const disposition = response.headers.get('content-disposition') || '';
  let name = fallbackName;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const ordinary = disposition.match(/filename="?([^";]+)"?/i);
  try {
    name = encoded ? decodeURIComponent(encoded[1]) : ordinary?.[1] || name;
  } catch {
    /* Use the readable fallback name. */
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = [...name]
    .map((char) => (char.charCodeAt(0) < 32 || char === '/' || char === '\\' ? '_' : char))
    .join('');
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AiStudy() {
  const [params, setParams] = useSearchParams();
  const reportId = params.get('report') || '';
  const [tab, setTab] = useState(reportId ? 'report' : 'new');
  const initialPage = Number(params.get('page') || 1);
  const [page, setPage] = useState(
    Number.isInteger(initialPage) && initialPage > 0 && initialPage <= 10000 ? initialPage : 1,
  );
  const [courseId, setCourseId] = useState<string | undefined>(params.get('courseId') || undefined);
  const [historyPage, setHistoryPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, Mistake>>({});
  const [reflection, setReflection] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [busy, setBusy] = useState<'analysis' | 'search' | 'delete' | null>(null);
  const lock = useRef(false);
  const [error, setError] = useState<string>();
  const [downloadError, setDownloadError] = useState<string>();
  const [downloading, setDownloading] = useState<string>();
  const [preselected, setPreselected] = useState(false);
  const { message } = App.useApp();
  const cache = useQueryClient();
  const status = useData<ServiceStatus>('/ai-study/status');
  const mistakes = useData<{ items: Mistake[]; total: number }>(
    `/mistakes?${queryString({ courseId, page, pageSize: 10 })}`,
    tab === 'new',
  );
  const history = useData<{ items: Summary[]; total: number }>(
    `/ai-study/reports?${queryString({ page: historyPage, pageSize: 10 })}`,
    tab === 'history',
  );
  const detail = useData<Report>(`/ai-study/reports/${encodeURIComponent(reportId)}`, !!reportId);
  const report = detail.data;
  const maxMistakes = Math.min(10, status.data?.limits.maxMistakes || 10);
  const chosen = Object.values(selected);
  useUnsavedWarning(!!busy);
  useEffect(() => {
    if (reportId) setTab('report');
  }, [reportId]);
  useEffect(() => {
    setSearchQuery(report?.search?.query || report?.analysis?.searchQueries[0] || '');
  }, [report?.id, !!report?.analysis]);
  useEffect(() => {
    if (report?.status !== 'pending') return;
    const timer = window.setInterval(() => void detail.refetch(), 4000);
    return () => window.clearInterval(timer);
  }, [report?.id, report?.status]);
  useEffect(() => {
    const id = params.get('mistake');
    if (preselected || !mistakes.data) return;
    const item = mistakes.data.items.find((item) => item.id === id);
    if (item?.available && item.question) setSelected((old) => ({ ...old, [item.id]: item }));
    if (id && !item) setError('指定错题不在当前列表中，请从可用错题重新选择。');
    if (item && !item.available) setError('这道错题已停止开放，不能用于 AI 复盘。');
    setPreselected(true);
  }, [mistakes.data, params, preselected]);
  async function invalidateHistory() {
    await cache.invalidateQueries({
      predicate: (q) => String(q.queryKey[0]).startsWith('/ai-study/reports'),
    });
  }
  function openReport(id: string) {
    setError(undefined);
    setDownloadError(undefined);
    setParams({ report: id });
    setTab('report');
  }
  function select(item: Mistake, checked: boolean) {
    setSelected((old) => {
      if (!checked) {
        const next = { ...old };
        delete next[item.id];
        return next;
      }
      if (!item.available || !item.question || Object.keys(old).length >= maxMistakes) return old;
      return { ...old, [item.id]: item };
    });
  }
  async function generate() {
    if (lock.current || !chosen.length || !status.data?.analysis.available) return;
    lock.current = true;
    setBusy('analysis');
    setError(undefined);
    try {
      const result = (await send('/ai-study/reports', {
        mistakeIds: chosen.map((item) => item.id),
        reflection: reflection.trim(),
      })) as Report;
      openReport(result.id);
      await invalidateHistory();
      if (result.status === 'ready') message.success('复盘报告已保存');
      else if (result.status === 'failed')
        message.error(result.error || '复盘未能完成，请查看报告中的失败原因');
    } catch (e) {
      setError((e as Error).message || '生成失败，请重试；所选错题和思路已保留。');
      message.error((e as Error).message || '生成失败，所选错题和思路已保留');
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }
  async function search() {
    if (lock.current || !report || !searchQuery.trim() || !status.data?.search.available) return;
    lock.current = true;
    setBusy('search');
    setError(undefined);
    try {
      const result = (await send(`/ai-study/reports/${encodeURIComponent(report.id)}/search`, {
        query: searchQuery.trim(),
      })) as Report;
      await detail.refetch();
      if (result.searchError) {
        setError(result.searchError);
        message.error(result.searchError);
      } else message.success('搜索结果和来源已保存');
    } catch (e) {
      setError((e as Error).message || '搜索失败，请重试；原有结果保留。');
      message.error((e as Error).message || '搜索失败，原有结果已保留');
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }
  async function remove() {
    if (lock.current || !report) return;
    lock.current = true;
    setBusy('delete');
    setError(undefined);
    try {
      await send(`/ai-study/reports/${encodeURIComponent(report.id)}`, {}, 'DELETE');
      setParams({});
      setTab('history');
      await invalidateHistory();
      message.success('报告已删除');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }
  async function download(path: string, name: string) {
    if (downloading) return;
    setDownloading(path);
    setDownloadError(undefined);
    try {
      await downloadFile(path, name);
    } catch (e) {
      setDownloadError((e as Error).message || '下载失败，请重试');
      message.error((e as Error).message || '下载失败，请重试');
    } finally {
      setDownloading(undefined);
    }
  }
  const snapshot = (id: string) => report?.mistakes.find((item) => item.mistakeId === id);
  return (
    <div className="ai-study-page">
      <PageTitle
        title="AI 错题复盘"
        description="从真实作答中梳理错因，形成订正与复习计划。"
        extra={
          <Link to="/practice?tab=mistakes">
            <Button icon={<ArrowLeft size={16} />}>返回错题本</Button>
          </Link>
        }
      />
      <Tabs
        activeKey={tab}
        onChange={(value) => {
          if (!busy) {
            setTab(value);
            setError(undefined);
          }
        }}
        items={[
          {
            key: 'new',
            label: (
              <span className="ai-tab">
                <Plus size={15} />
                新建复盘
              </span>
            ),
            disabled: !!busy,
          },
          {
            key: 'history',
            label: (
              <span className="ai-tab">
                <History size={15} />
                历史报告
              </span>
            ),
            disabled: !!busy,
          },
          ...(reportId
            ? [
                {
                  key: 'report',
                  label: (
                    <span className="ai-tab">
                      <FileText size={15} />
                      复盘报告
                    </span>
                  ),
                  disabled: !!busy,
                },
              ]
            : []),
        ]}
      />
      {error && (
        <Alert
          className="ai-alert"
          type="error"
          showIcon
          closable
          message={error}
          onClose={() => setError(undefined)}
        />
      )}
      {downloadError && (
        <Alert
          className="ai-alert"
          type="error"
          showIcon
          closable
          message={downloadError}
          onClose={() => setDownloadError(undefined)}
        />
      )}
      {tab === 'new' && (
        <div className="ai-compose-grid">
          <Panel
            title="1. 选择需要复盘的错题"
            description={`从当前可练习的错题中选择 1–${maxMistakes} 道，支持跨页选择。`}
          >
            <div className="ai-mistake-toolbar">
              <label className="ai-sr-only" htmlFor="ai-course-filter">
                复盘课程筛选
              </label>
              <RemoteSelect
                id="ai-course-filter"
                endpoint="/courses"
                labelField="title"
                placeholder="全部课程"
                value={courseId}
                allowClear
                onChange={(value) => {
                  setCourseId(value);
                  setPage(1);
                }}
                disabled={!!busy}
              />
              <span>共 {mistakes.data?.total || 0} 道错题</span>
            </div>
            <QueryState query={mistakes}>
              {mistakes.data?.items.length ? (
                <div className="ai-mistakes">
                  {mistakes.data.items.map((item) => (
                    <div
                      key={item.id}
                      className={`ai-mistake ${selected[item.id] ? 'ai-mistake-selected' : ''} ${!item.available ? 'ai-mistake-disabled' : ''}`}
                    >
                      <Checkbox
                        aria-label={`选择错题 ${plain(item.question?.stem) || item.id}`}
                        checked={!!selected[item.id]}
                        disabled={
                          !!busy ||
                          !item.available ||
                          !item.question ||
                          (!selected[item.id] && chosen.length >= maxMistakes)
                        }
                        onChange={(event) => select(item, event.target.checked)}
                      />
                      <div>
                        <div className="ai-mistake-meta">
                          <Tag>{item.question ? label(item.question.type) : '已停用'}</Tag>
                          <span>答错 {item.wrongCount} 次</span>
                          {item.mastered && <Tag color="green">已掌握</Tag>}
                        </div>
                        <div className="ai-mistake-stem">
                          {item.question ? (
                            <RichContent content={item.question.stem} />
                          ) : (
                            '此题已停止开放，不能用于复盘'
                          )}
                        </div>
                        {!!item.question?.knowledgePoints?.length && (
                          <p className="ai-muted">{item.question.knowledgePoints.join(' · ')}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  description={courseId ? '这门课程暂时没有错题' : '还没有错题，完成练习后可以在这里复盘'}
                >
                  <Link to="/practice">
                    <Button>开始练习</Button>
                  </Link>
                </EmptyState>
              )}
              <Pagination
                className="ai-pagination"
                current={page}
                total={mistakes.data?.total || 0}
                pageSize={10}
                showSizeChanger={false}
                hideOnSinglePage
                onChange={setPage}
                disabled={!!busy}
              />
            </QueryState>
          </Panel>
          <Panel
            title="2. 补充你的解题思路"
            description="可选。回忆当时如何理解题意、哪里拿不准。"
            className="ai-compose-aside"
          >
            <div className="ai-selection-heading">
              <strong>
                已选 {chosen.length} / {maxMistakes} 道
              </strong>
              {chosen.length > 0 && (
                <Button size="small" type="text" onClick={() => setSelected({})} disabled={!!busy}>
                  清空选择
                </Button>
              )}
            </div>
            <div className="ai-selected-list">
              {chosen.length ? (
                chosen.map((item, i) => (
                  <Tag
                    key={item.id}
                    closable={!busy}
                    onClose={() => select(item, false)}
                    title={plain(item.question?.stem)}
                  >
                    {i + 1}. {plain(item.question?.stem).slice(0, 38)}
                  </Tag>
                ))
              ) : (
                <p className="ai-muted">先在左侧选中错题。</p>
              )}
            </div>
            <label className="ai-field-label" htmlFor="ai-reflection">
              我的解题思路
            </label>
            <Input.TextArea
              id="ai-reflection"
              value={reflection}
              onChange={(event) => setReflection(event.target.value)}
              maxLength={2000}
              showCount
              rows={6}
              placeholder="例如：我混淆了两个概念，计算到第二步时不确定该用哪个公式。"
              disabled={!!busy}
            />
            <QueryState query={status}>
              {status.data && !status.data.analysis.available && (
                <Alert
                  className="ai-config-alert"
                  type="warning"
                  showIcon
                  message="AI 分析服务暂不可用"
                  description={
                    <>
                      {status.data.analysis.reason}
                      <br />
                      请联系管理员在服务器 config.yaml 中填写服务配置与密钥。
                    </>
                  }
                  action={
                    <Button size="small" onClick={() => void status.refetch()}>
                      重新检查
                    </Button>
                  }
                />
              )}
            </QueryState>
            <Button
              className="ai-generate-button"
              type="primary"
              icon={<BrainCircuit size={17} />}
              block
              loading={busy === 'analysis'}
              disabled={!!busy || !chosen.length || !status.data?.analysis.available}
              onClick={() => void generate()}
            >
              {busy === 'analysis' ? '正在分析，请稍候' : '生成错题复盘'}
            </Button>
            <p className="ai-disclosure">
              生成时会将所选题目、作答记录和补充思路发送给已配置的 AI 服务。AI
              分析供复习参考，请结合课程内容核对。
            </p>
            {busy === 'analysis' && (
              <p className="ai-working" role="status">
                <Spin size="small" /> 正在整理 {chosen.length} 道错题，完成后会保存到历史报告。
              </p>
            )}
          </Panel>
        </div>
      )}
      {tab === 'history' && (
        <Panel title="我的复盘报告" description="仅保存你自己的复盘与主动发起的搜索结果。">
          <QueryState query={history}>
            {history.data?.items.length ? (
              <div className="ai-history-list">
                {history.data.items.map((item) => (
                  <button key={item.id} className="ai-history-item" onClick={() => openReport(item.id)}>
                    <div className="ai-history-icon">
                      <FileText size={20} />
                    </div>
                    <div>
                      <div className="ai-history-meta">
                        <strong>{item.mistakeCount} 道错题复盘</strong>
                        <Tag
                          color={
                            item.status === 'ready' ? 'green' : item.status === 'failed' ? 'red' : 'blue'
                          }
                        >
                          {reportStatus[item.status]}
                        </Tag>
                        <span>{date(item.createdAt)}</span>
                      </div>
                      <p>{item.summary || item.error || '正在生成分析，稍后可重新查看。'}</p>
                    </div>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState description="还没有复盘报告">
                <Button type="primary" onClick={() => setTab('new')}>
                  新建一次复盘
                </Button>
              </EmptyState>
            )}
            <Pagination
              className="ai-pagination"
              current={historyPage}
              total={history.data?.total || 0}
              pageSize={10}
              onChange={setHistoryPage}
              showSizeChanger={false}
              hideOnSinglePage
            />
          </QueryState>
        </Panel>
      )}
      {tab === 'report' && (
        <QueryState query={detail}>
          {report && (
            <>
              <div className="ai-report-toolbar">
                <div>
                  <h2>{report.mistakes.length} 道错题的复盘报告</h2>
                  <p className="ai-muted">
                    {date(report.createdAt)} · <Tag>{reportStatus[report.status]}</Tag>
                  </p>
                </div>
                <div className="ai-report-actions">
                  <Button
                    icon={<Download size={15} />}
                    disabled={!!downloading || report.status === 'pending'}
                    loading={!!downloading?.endsWith('format=md')}
                    onClick={() =>
                      void download(
                        `/ai-study/reports/${encodeURIComponent(report.id)}/export?format=md`,
                        '错题复盘.md',
                      )
                    }
                  >
                    下载 Markdown
                  </Button>
                  <Button
                    disabled={!!downloading || report.status === 'pending'}
                    loading={!!downloading?.endsWith('format=json')}
                    onClick={() =>
                      void download(
                        `/ai-study/reports/${encodeURIComponent(report.id)}/export?format=json`,
                        '错题复盘.json',
                      )
                    }
                  >
                    下载 JSON
                  </Button>
                  <Popconfirm
                    title="删除这份复盘报告？"
                    description="仅删除报告，不会影响错题或作答记录。"
                    okText="删除报告"
                    cancelText="保留报告"
                    onConfirm={remove}
                  >
                    <Button
                      danger
                      icon={<Trash2 size={15} />}
                      disabled={!!busy || report.status === 'pending'}
                    >
                      删除报告
                    </Button>
                  </Popconfirm>
                </div>
              </div>
              {report.status === 'pending' && (
                <Panel>
                  <div className="ai-pending">
                    <Spin />
                    <h3>正在生成分析</h3>
                    <p>报告会自动更新，也可以稍后从历史报告继续查看。</p>
                    <Button onClick={() => void detail.refetch()}>刷新状态</Button>
                  </div>
                </Panel>
              )}
              {report.status === 'failed' && (
                <Alert
                  className="ai-alert"
                  type="error"
                  showIcon
                  message="本次复盘未能完成"
                  description={report.error || '请稍后重试'}
                  action={<Button onClick={() => setTab('new')}>返回选题重试</Button>}
                />
              )}
              {report.analysis && (
                <div className="ai-report-content">
                  <Panel title="复盘概览">
                    <p className="ai-prose ai-overview">{report.analysis.summary}</p>
                    {report.reflection && (
                      <details className="ai-reflection">
                        <summary>查看我提交的解题思路</summary>
                        <p className="ai-prose">{report.reflection}</p>
                      </details>
                    )}
                  </Panel>
                  <Panel title="共同错因与改进方向">
                    <div className="ai-patterns">
                      {report.analysis.patterns.map((pattern, i) => (
                        <article key={i} className="ai-pattern">
                          <span className="ai-number">{i + 1}</span>
                          <div>
                            <h3>{pattern.label}</h3>
                            <p className="ai-prose">{pattern.evidence}</p>
                            <p className="ai-advice">
                              <Check size={15} />
                              {pattern.advice}
                            </p>
                            <div className="ai-pattern-links">
                              {pattern.mistakeIds.map((id) => {
                                const n = report.mistakes.findIndex((item) => item.mistakeId === id);
                                return n >= 0 ? (
                                  <a href={`#ai-diagnosis-${id}`} key={id}>
                                    第 {n + 1} 题
                                  </a>
                                ) : null;
                              })}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </Panel>
                  <Panel title="逐题诊断与订正">
                    <div className="ai-diagnoses">
                      {report.analysis.items.map((item, i) => {
                        const original = snapshot(item.mistakeId);
                        return (
                          <article
                            id={`ai-diagnosis-${item.mistakeId}`}
                            className="ai-diagnosis"
                            key={item.mistakeId}
                          >
                            <div className="ai-diagnosis-heading">
                              <h3>第 {original ? report.mistakes.indexOf(original) + 1 : i + 1} 题</h3>
                              <span className="ai-muted">{original?.courseTitle}</span>
                              <Tag>
                                诊断把握：{{ low: '较低', medium: '中等', high: '较高' }[item.confidence]}
                              </Tag>
                            </div>
                            {original && (
                              <>
                                <div className="ai-question-full">
                                  <RichContent content={original.stem} />
                                </div>
                                {Array.isArray(original.options) && original.options.length > 0 && (
                                  <ul className="ai-options">
                                    {original.options.map((option: any, n) => (
                                      <li key={n}>
                                        {String(option.id || n + 1)}. {String(option.text || '')}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                <div className="ai-answer-grid">
                                  <div>
                                    <span>我的作答</span>
                                    <pre>{answerText(original.studentAnswer)}</pre>
                                  </div>
                                  <div>
                                    <span>参考答案</span>
                                    <pre>{answerText(original.correctAnswer)}</pre>
                                  </div>
                                </div>
                              </>
                            )}
                            <dl className="ai-diagnosis-details">
                              <div>
                                <dt>错因诊断</dt>
                                <dd>{item.diagnosis}</dd>
                              </div>
                              <div>
                                <dt>推理过程</dt>
                                <dd>{item.reasoning}</dd>
                              </div>
                              <div>
                                <dt>如何订正</dt>
                                <dd>{item.correction}</dd>
                              </div>
                            </dl>
                            <div className="ai-knowledge-tags">
                              {item.knowledgePoints.map((point) => (
                                <Tag key={point}>{point}</Tag>
                              ))}
                            </div>
                            {original?.explanation && (
                              <details className="ai-reflection">
                                <summary>查看题目原始解析</summary>
                                <RichContent content={original.explanation} />
                              </details>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </Panel>
                  <Panel title="接下来的复习计划">
                    <ol className="ai-review-plan">
                      {report.analysis.reviewPlan.map((step, i) => (
                        <li key={i}>
                          <span>{i + 1}</span>
                          <p>{step}</p>
                        </li>
                      ))}
                    </ol>
                  </Panel>
                  <Panel
                    title="按需联网查找资料"
                    description="确认或修改关键词后再发起搜索。搜索结果会连同来源保存在这份报告中。"
                  >
                    <QueryState query={status}>
                      {status.data && !status.data.search.available && (
                        <Alert
                          className="ai-config-alert"
                          type="warning"
                          showIcon
                          message="联网搜索服务暂不可用"
                          description={
                            <>
                              {status.data.search.reason}
                              <br />
                              请联系管理员检查服务器 config.yaml 中的搜索服务配置。
                            </>
                          }
                        />
                      )}
                    </QueryState>
                    <div className="ai-keywords" aria-label="建议搜索关键词">
                      {report.analysis.searchQueries.map((query) => (
                        <button key={query} onClick={() => setSearchQuery(query)} disabled={!!busy}>
                          {query}
                        </button>
                      ))}
                    </div>
                    <label className="ai-field-label" htmlFor="ai-search-query">
                      搜索关键词
                    </label>
                    <div className="ai-search-form">
                      <Input
                        id="ai-search-query"
                        value={searchQuery}
                        maxLength={300}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        onPressEnter={(event) => {
                          if (!event.nativeEvent.isComposing) void search();
                        }}
                        disabled={!!busy}
                        placeholder="编辑要查找的知识点或问题"
                      />
                      <Button
                        type="primary"
                        icon={<Search size={16} />}
                        loading={busy === 'search'}
                        disabled={!!busy || !searchQuery.trim() || !status.data?.search.available}
                        onClick={() => void search()}
                      >
                        联网搜索
                      </Button>
                    </div>
                    <p className="ai-disclosure">仅在点击搜索后，将上述关键词发送给配置的搜索服务。</p>
                    {report.searchError && !error && (
                      <Alert
                        className="ai-alert"
                        type="warning"
                        showIcon
                        message={report.searchError}
                        description="已有搜索结果仍保留，可修改关键词后重试。"
                      />
                    )}
                    {report.search && (
                      <div className="ai-search-results">
                        <div className="ai-search-result-heading">
                          <h3>检索摘要</h3>
                          <span>
                            {date(report.search.searchedAt)} ·{' '}
                            {report.search.provider === 'tavily' ? 'Tavily' : 'OpenAI'}
                          </span>
                        </div>
                        <p className="ai-muted">检索词：{report.search.query}</p>
                        <CitedSummary result={report.search} />
                        <h3 className="ai-sources-heading">参考来源 · {report.search.sources.length} 条</h3>
                        <div className="ai-sources">
                          {report.search.sources.map((source, i) => {
                            const url = safeUrl(source.url);
                            const path = `/ai-study/reports/${encodeURIComponent(report.id)}/sources/${encodeURIComponent(source.id)}/download`;
                            return (
                              <article className="ai-source" key={source.id}>
                                <span className="ai-source-number">{i + 1}</span>
                                <div>
                                  {url ? (
                                    <a
                                      className="ai-source-title"
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      {source.title}
                                      <ArrowUpRight size={14} />
                                    </a>
                                  ) : (
                                    <strong>{source.title}</strong>
                                  )}
                                  <p className="ai-source-url">
                                    {url ? new URL(url).hostname : '来源地址不可用'}
                                  </p>
                                  <p className="ai-prose">{source.snippet}</p>
                                  <Button
                                    size="small"
                                    icon={<Download size={14} />}
                                    disabled={!url || !!downloading}
                                    loading={downloading === path}
                                    onClick={() => void download(path, '学习资料.txt')}
                                  >
                                    下载资料
                                  </Button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                        <p className="ai-disclosure">
                          PDF
                          来源下载原文件；网页来源下载提取的纯文本。访问受限或无法提取时会显示失败原因。单份上限{' '}
                          {status.data?.limits.maxDownloadMb || '—'} MB。
                        </p>
                      </div>
                    )}
                  </Panel>
                </div>
              )}
            </>
          )}
        </QueryState>
      )}
    </div>
  );
}
