import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Pagination,
  Popconfirm,
  Radio,
  Select,
  Spin,
  Tag,
} from 'antd';
import { BrainCircuit, CheckCircle2, FileText, History, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, date, label, queryString, send, useData } from '../api';
import { useAuth } from '../auth';
import { EmptyState, PageTitle, Panel, QueryState, useUnsavedWarning } from '../components/shared';
import { RemoteSelect } from '../components/RemoteSelect';
import '../ai-authoring.css';

type QuestionType = 'single' | 'multiple' | 'boolean' | 'blank' | 'short';
type Mode = 'questions' | 'paper';
type Blueprint = { type: QuestionType; count: number; scoreCents: number; difficulty: number };
type GenerationInput = {
  mode: Mode;
  courseId: string;
  chapterId?: string | null;
  title: string;
  knowledgePoints: string[];
  requirements: string;
  material: string;
  blueprint: Blueprint[];
};
type Question = {
  _editorKey?: string;
  type: QuestionType;
  stem: string;
  options: { id: string; text: string }[];
  answer: string[];
  explanation: string;
  knowledgePoints: string[];
  scoreCents: number;
  difficulty: number;
};
type Draft = {
  id: string;
  mode: Mode;
  courseId: string;
  chapterId: string | null;
  status: 'pending' | 'ready' | 'failed' | 'saved';
  title: string;
  input: GenerationInput;
  questions: Question[];
  revision: number;
  error: string | null;
  model: string;
  createdAt: string;
  updatedAt: string;
  savedQuestionIds: string[];
  savedPaperId: string | null;
};
type DraftSummary = Pick<
  Draft,
  'id' | 'mode' | 'courseId' | 'title' | 'status' | 'error' | 'createdAt' | 'updatedAt'
> & { questionCount: number };
type ServiceStatus = {
  available: boolean;
  reason: string;
  model: string;
  limits: { maxQuestions: number; dailyRequests: number };
};
const questionTypes: QuestionType[] = ['single', 'multiple', 'boolean', 'blank', 'short'];
const statusLabels = { pending: '生成中', ready: '待审阅', failed: '生成失败', saved: '已保存' };
const difficulties = [1, 2, 3, 4, 5].map((value) => ({
  value,
  label: `${value} · ${['入门', '较易', '中等', '较难', '挑战'][value - 1]}`,
}));
const freshInput = (mode: Mode = 'questions', courseId = ''): GenerationInput => ({
  mode,
  courseId,
  title: '',
  knowledgePoints: [],
  requirements: '',
  material: '',
  blueprint: [{ type: 'single', count: 3, scoreCents: 200, difficulty: 3 }],
});
const serializeQuestion = (q: Question): Question => ({
  type: q.type,
  stem: q.stem.trim(),
  options: ['single', 'multiple'].includes(q.type)
    ? q.options.map((o) => ({ id: o.id, text: o.text.trim() }))
    : [],
  answer: q.answer.map((a) => a.trim()),
  explanation: q.explanation.trim(),
  knowledgePoints: q.knowledgePoints.map((k) => k.trim()).filter(Boolean),
  scoreCents: q.scoreCents,
  difficulty: q.difficulty,
});
const copyQuestions = (items: Question[]) =>
  items.map((q) => ({
    ...q,
    _editorKey: crypto.randomUUID(),
    options: q.options.map((o) => ({ ...o })),
    answer: [...q.answer],
    knowledgePoints: [...q.knowledgePoints],
  }));
function validateQuestion(q: Question, index: number): string | undefined {
  const prefix = `第 ${index + 1} 题：`;
  if (!q.stem.trim()) return `${prefix}请填写题干`;
  if (!q.explanation.trim()) return `${prefix}请填写答案解析`;
  const texts = [q.stem, q.explanation, ...q.answer, ...q.knowledgePoints, ...q.options.map((o) => o.text)];
  if (texts.some((text) => /<(?:\/?[a-z]|!|\?)/i.test(text)))
    return `${prefix}请使用纯文本，不能包含 HTML 标签；比较符号后请留空格`;
  if (q.knowledgePoints.some((k) => k.trim().length > 100)) return `${prefix}每个知识点最多 100 个字符`;
  if (q.answer.length > 10 || q.answer.some((a) => a.trim().length > 2000))
    return `${prefix}答案最多 10 项，每项最多 2000 个字符`;
  if (q.type === 'blank' && (q.stem.match(/_{3,}/g) || []).length !== q.answer.length)
    return `${prefix}题干中的 ___ 空位数量必须与答案行数一致`;
  if (!q.knowledgePoints.length || q.knowledgePoints.length > 20 || q.knowledgePoints.some((k) => !k.trim()))
    return `${prefix}请填写 1–20 个知识点`;
  if (!Number.isInteger(q.scoreCents) || q.scoreCents < 1 || q.scoreCents > 1000000)
    return `${prefix}分值应为 0.01–10000 分`;
  if (!Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 5) return `${prefix}请选择难度`;
  if (['single', 'multiple'].includes(q.type)) {
    if (q.options.length < 2 || q.options.length > 8 || q.options.some((o) => !o.text.trim()))
      return `${prefix}请填写 2–8 个选项`;
    if (new Set(q.options.map((o) => o.text.trim())).size !== q.options.length)
      return `${prefix}选项内容不能重复`;
    if (!q.answer.length || q.answer.some((a) => !q.options.some((o) => o.id === a)))
      return `${prefix}请选择有效答案`;
    if (q.type === 'single' && q.answer.length !== 1) return `${prefix}单选题应有一个正确答案`;
    if (q.type === 'multiple' && q.answer.length < 2) return `${prefix}多选题至少选择两个正确答案`;
  } else if (!q.answer.length || q.answer.some((a) => !a.trim())) return `${prefix}请填写完整答案`;
  if (q.type === 'boolean' && (q.answer.length !== 1 || !['true', 'false'].includes(q.answer[0])))
    return `${prefix}请选择判断答案`;
  if (q.type === 'short' && q.answer.length !== 1) return `${prefix}请填写参考答案`;
  return undefined;
}
function QuestionEditor({
  question: q,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  question: Question;
  index: number;
  disabled: boolean;
  onChange: (q: Question) => void;
  onRemove: () => void;
}) {
  const prefix = `author-question-${index}`;
  const change = (patch: Partial<Question>) => onChange({ ...q, ...patch });
  const choice = q.type === 'single' || q.type === 'multiple';
  return (
    <article className="author-question" aria-label={`第 ${index + 1} 题编辑`}>
      <div className="author-question-heading">
        <div>
          <strong>第 {index + 1} 题</strong>
          <Tag>{label(q.type)}</Tag>
        </div>
        <Popconfirm title="从草稿中删除这道题？" onConfirm={onRemove} disabled={disabled}>
          <Button
            type="text"
            danger
            icon={<Trash2 size={15} />}
            disabled={disabled}
            aria-label={`删除第 ${index + 1} 题`}
          >
            删除题目
          </Button>
        </Popconfirm>
      </div>
      <div className="author-field">
        <label htmlFor={`${prefix}-stem`}>题干</label>
        <Input.TextArea
          id={`${prefix}-stem`}
          maxLength={8000}
          value={q.stem}
          onChange={(e) => change({ stem: e.target.value })}
          autoSize={{ minRows: 3, maxRows: 10 }}
          disabled={disabled}
        />
      </div>
      {q.type === 'blank' && (
        <p className="author-help">在题干中使用 ___ 标记每一空；答案每行一项，按空位顺序填写。</p>
      )}
      {choice && (
        <fieldset className="author-options">
          <legend>选项与正确答案</legend>
          <p className="author-help">
            {q.type === 'single' ? '选择一个正确答案。' : '至少选择两个正确答案。'}选项内容使用纯文本。
          </p>
          {q.options.map((option, i) => (
            <div className="author-option" key={option.id}>
              {q.type === 'single' ? (
                <Radio
                  aria-label={`第 ${index + 1} 题正确答案 ${option.id}`}
                  checked={q.answer.includes(option.id)}
                  disabled={disabled}
                  onChange={() => change({ answer: [option.id] })}
                >
                  {option.id}
                </Radio>
              ) : (
                <Checkbox
                  aria-label={`第 ${index + 1} 题正确答案 ${option.id}`}
                  checked={q.answer.includes(option.id)}
                  disabled={disabled}
                  onChange={(e) =>
                    change({
                      answer:
                        q.type === 'single'
                          ? [option.id]
                          : e.target.checked
                            ? [...q.answer, option.id]
                            : q.answer.filter((a) => a !== option.id),
                    })
                  }
                >
                  {option.id}
                </Checkbox>
              )}
              <Input
                aria-label={`第 ${index + 1} 题选项 ${option.id}`}
                maxLength={1000}
                value={option.text}
                disabled={disabled}
                onChange={(e) =>
                  change({ options: q.options.map((o, j) => (j === i ? { ...o, text: e.target.value } : o)) })
                }
              />
              <Button
                type="text"
                disabled={disabled || q.options.length <= 2}
                aria-label={`删除第 ${index + 1} 题选项 ${option.id}`}
                icon={<Trash2 size={15} />}
                onClick={() =>
                  change({
                    options: q.options.filter((_, j) => j !== i),
                    answer: q.answer.filter((a) => a !== option.id),
                  })
                }
              />
            </div>
          ))}
          <Button
            size="small"
            icon={<Plus size={14} />}
            disabled={disabled || q.options.length >= 8}
            onClick={() => {
              const id = 'ABCDEFGH'.split('').find((id) => !q.options.some((o) => o.id === id))!;
              change({ options: [...q.options, { id, text: '' }] });
            }}
          >
            增加选项
          </Button>
        </fieldset>
      )}
      {q.type === 'boolean' && (
        <fieldset className="author-options">
          <legend>正确答案</legend>
          <Radio.Group
            aria-label={`第 ${index + 1} 题判断答案`}
            value={q.answer[0]}
            disabled={disabled}
            onChange={(e) => change({ answer: [e.target.value] })}
          >
            <Radio value="true">正确</Radio>
            <Radio value="false">错误</Radio>
          </Radio.Group>
        </fieldset>
      )}
      {(q.type === 'blank' || q.type === 'short') && (
        <div className="author-field">
          <label htmlFor={`${prefix}-answer`}>
            {q.type === 'blank' ? '填空答案（每行对应一空）' : '参考答案'}
          </label>
          <Input.TextArea
            id={`${prefix}-answer`}
            value={q.type === 'blank' ? q.answer.join('\n') : q.answer[0] || ''}
            onChange={(e) =>
              change({ answer: q.type === 'blank' ? e.target.value.split('\n') : [e.target.value] })
            }
            autoSize={{ minRows: 2, maxRows: 10 }}
            disabled={disabled}
          />
        </div>
      )}
      <div className="author-field">
        <label htmlFor={`${prefix}-explanation`}>答案解析</label>
        <Input.TextArea
          id={`${prefix}-explanation`}
          maxLength={8000}
          value={q.explanation}
          onChange={(e) => change({ explanation: e.target.value })}
          autoSize={{ minRows: 2, maxRows: 8 }}
          disabled={disabled}
        />
      </div>
      <div className="author-question-meta">
        <div className="author-field">
          <label htmlFor={`${prefix}-knowledge`}>知识点</label>
          <Select
            id={`${prefix}-knowledge`}
            mode="tags"
            value={q.knowledgePoints}
            onChange={(value) => change({ knowledgePoints: value })}
            disabled={disabled}
            tokenSeparators={[',', '，']}
            maxCount={20}
          />
        </div>
        <div className="author-field">
          <label htmlFor={`${prefix}-score`}>分值</label>
          <InputNumber
            id={`${prefix}-score`}
            value={q.scoreCents / 100}
            min={0.01}
            max={10000}
            precision={2}
            disabled={disabled}
            onChange={(v) => change({ scoreCents: Math.round((v ?? 0) * 100) })}
          />
        </div>
        <div className="author-field">
          <label htmlFor={`${prefix}-difficulty`}>难度</label>
          <Select
            id={`${prefix}-difficulty`}
            value={q.difficulty}
            options={difficulties}
            disabled={disabled}
            onChange={(difficulty) => change({ difficulty })}
          />
        </div>
      </div>
    </article>
  );
}
export function AiAuthoring() {
  const { user } = useAuth();
  const { message, modal } = App.useApp();
  const canPaper = !!user?.permissions.includes('assessment.manage');
  const canWrite = !!user?.permissions.includes('course.manage');
  const [params, setParams] = useSearchParams();
  const draftId = params.get('draft');
  const requestedMode: Mode = params.get('mode') === 'paper' && canPaper ? 'paper' : 'questions';
  const [input, setInput] = useState<GenerationInput>(() =>
    freshInput(requestedMode, params.get('courseId') || ''),
  );
  const [draft, setDraft] = useState<Draft>();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [title, setTitle] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const sequence = useRef(0);
  const busyRef = useRef('');
  const draftRef = useRef<Draft>();
  const dirtyRef = useRef(false);
  const retryInput = useRef<GenerationInput>();
  const status = useData<ServiceStatus>('/ai-authoring/status');
  const history = useData<{ items: DraftSummary[]; total: number; page: number; pageSize: number }>(
    `/ai-authoring/drafts?${queryString({ page: historyPage, pageSize: 8 })}`,
  );
  const course = useData<{ title: string; chapters: { id: string; title: string }[] }>(
    `/courses/${input.courseId}`,
    !!input.courseId && !draftId,
  );
  useUnsavedWarning(dirty);
  const markDirty = () => {
    setDirty(true);
    dirtyRef.current = true;
  };
  const setOperation = (operation: string) => {
    busyRef.current = operation;
    setBusy(operation);
  };
  const hydrate = (value: Draft, keepEdits = false) => {
    if (value.mode === 'paper' && !canPaper) throw new Error('当前身份没有组卷权限，无法打开此草稿。');
    draftRef.current = value;
    setDraft(value);
    if (!keepEdits || value.status !== 'ready') {
      setQuestions(copyQuestions(value.questions));
      setTitle(value.title);
      setDirty(false);
      dirtyRef.current = false;
    }
  };
  useEffect(() => {
    const version = ++sequence.current;
    setError('');
    setConflict(false);
    setOperation('');
    if (!draftId) {
      draftRef.current = undefined;
      setDraft(undefined);
      setQuestions([]);
      setDirty(false);
      dirtyRef.current = false;
      setInput(retryInput.current || freshInput(requestedMode, params.get('courseId') || ''));
      retryInput.current = undefined;
      return;
    }
    if (draftRef.current?.id === draftId) return;
    draftRef.current = undefined;
    setDraft(undefined);
    setDirty(false);
    dirtyRef.current = false;
    setOperation('load');
    void api<Draft>(`/ai-authoring/drafts/${encodeURIComponent(draftId)}`)
      .then((value) => {
        if (version === sequence.current) hydrate(value);
      })
      .catch((e) => {
        if (version === sequence.current) setError(e.message);
      })
      .finally(() => {
        if (version === sequence.current) setOperation('');
      });
    return () => {
      sequence.current++;
    };
    // A route change owns a new async scope; responses from the previous draft are ignored.
  }, [draftId, requestedMode, params.get('courseId')]);
  useEffect(() => {
    if (draft?.status !== 'pending' || busy) return;
    const version = sequence.current;
    const timer = window.setTimeout(() => {
      void api<Draft>(`/ai-authoring/drafts/${encodeURIComponent(draft.id)}`)
        .then((value) => {
          if (version === sequence.current) {
            hydrate(value);
            setError('');
            if (value.status !== 'pending') void history.refetch();
          }
        })
        .catch((e) => {
          if (version === sequence.current) setError(e.message);
        });
    }, 5000);
    return () => clearTimeout(timer);
  }, [draft, busy]);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  const changeView = (next: Record<string, string>) => {
    const change = () => {
      sequence.current++;
      setParams(next);
    };
    if (dirtyRef.current)
      modal.confirm({
        title: '离开未保存的草稿？',
        content: '本次题目修改尚未保存，离开后将丢失这些修改。',
        okText: '放弃修改并继续',
        cancelText: '继续编辑',
        onOk: change,
      });
    else change();
  };
  const refreshDraft = async (keepEdits = false) => {
    if (!draftId || busyRef.current) return;
    const version = sequence.current;
    setOperation('refresh');
    try {
      const value = await api<Draft>(`/ai-authoring/drafts/${encodeURIComponent(draftId)}`);
      if (version !== sequence.current) return;
      hydrate(value, keepEdits);
      setError('');
      setConflict(false);
      if (keepEdits && value.status === 'ready')
        message.info('已更新草稿版本，本地题目修改仍保留，请检查后重新保存。');
    } catch (e) {
      if (version === sequence.current) setError((e as Error).message);
    } finally {
      if (version === sequence.current) setOperation('');
    }
  };
  const generate = async () => {
    if (busyRef.current || !status.data?.available || !canWrite) return;
    const knowledgePoints = input.knowledgePoints.map((k) => k.trim()).filter(Boolean);
    if (!input.courseId || !input.title.trim() || !knowledgePoints.length || knowledgePoints.length > 20) {
      setError('请选择课程，填写题名和 1–20 个知识点。');
      return;
    }
    if (input.mode === 'paper' && !canPaper) {
      setError('当前身份没有组卷权限。');
      return;
    }
    const total = input.blueprint.reduce((sum, b) => sum + b.count, 0);
    if (
      total < 1 ||
      total > 10 ||
      input.blueprint.some(
        (b) =>
          !Number.isInteger(b.count) ||
          b.count < 1 ||
          b.count > 10 ||
          !Number.isInteger(b.scoreCents) ||
          b.scoreCents < 1 ||
          b.scoreCents > 1000000,
      )
    ) {
      setError('请设置 1–10 道题，每题分值为 0.01–10000 分。');
      return;
    }
    const version = sequence.current;
    setOperation('generate');
    setError('');
    try {
      const value = (await send('/ai-authoring/drafts', {
        ...input,
        title: input.title.trim(),
        knowledgePoints,
      })) as Draft;
      if (version !== sequence.current) return;
      hydrate(value);
      setParams({ draft: value.id });
      void history.refetch();
      if (value.status === 'failed') message.error(value.error || '生成失败，可调整要求后重试');
      else if (value.status === 'ready') message.success('草稿已生成，请逐题审阅后保存');
    } catch (e) {
      if (version === sequence.current) setError((e as Error).message);
    } finally {
      if (version === sequence.current) setOperation('');
    }
  };
  const commit = async () => {
    if (
      busyRef.current ||
      !draft ||
      draft.status !== 'ready' ||
      !canWrite ||
      (draft.mode === 'paper' && !canPaper)
    )
      return;
    const validation = questions.map(validateQuestion).find(Boolean);
    if (!title.trim() || !questions.length || questions.length > 10 || validation) {
      setError(validation || '请填写题名，并保留 1–10 道题目。');
      return;
    }
    const version = sequence.current;
    setOperation('save');
    setError('');
    setConflict(false);
    try {
      const value = (await send(`/ai-authoring/drafts/${encodeURIComponent(draft.id)}/commit`, {
        revision: draft.revision,
        title: title.trim(),
        questions: questions.map(serializeQuestion),
      })) as Draft;
      if (version !== sequence.current) return;
      hydrate(value);
      void history.refetch();
      if (value.status === 'saved')
        message.success(draft.mode === 'paper' ? '试卷和题目已保存' : '题目已保存到题库');
      else setError(value.error || '服务未确认保存，请刷新草稿状态后重试。');
    } catch (e) {
      if (version === sequence.current) {
        setError((e as Error).message);
        setConflict(e instanceof ApiError && e.status === 409);
      }
    } finally {
      if (version === sequence.current) setOperation('');
    }
  };
  const deleteDraft = async () => {
    if (busyRef.current || !draft) return;
    const version = sequence.current;
    setOperation('delete');
    try {
      await send(`/ai-authoring/drafts/${encodeURIComponent(draft.id)}`, {}, 'DELETE');
      if (version !== sequence.current) return;
      dirtyRef.current = false;
      setDirty(false);
      setParams({ mode: draft.mode, courseId: draft.courseId });
      void history.refetch();
      message.success('草稿记录已删除');
    } catch (e) {
      if (version === sequence.current) setError((e as Error).message);
    } finally {
      if (version === sequence.current) setOperation('');
    }
  };
  const totalCount = input.blueprint.reduce((sum, b) => sum + b.count, 0);
  const totalScore = input.blueprint.reduce((sum, b) => sum + b.count * b.scoreCents, 0) / 100;
  const readonly = !!busy || draft?.status !== 'ready' || !canWrite;
  return (
    <div className="ai-authoring-page">
      <PageTitle
        eyebrow="AI AUTHORING"
        title="AI 出题"
        description="从教学目标生成可编辑草稿，由教师审阅后保存。"
        extra={
          <Button
            icon={<Plus size={16} />}
            disabled={!!busy}
            onClick={() =>
              changeView({ mode: requestedMode, ...(draft?.courseId ? { courseId: draft.courseId } : {}) })
            }
          >
            新建出题任务
          </Button>
        }
      />
      {!canWrite && (
        <Alert
          showIcon
          type="warning"
          message="当前身份没有课程管理权限"
          description="可以查看获授权的草稿；生成和保存题目需要课程管理授权。"
        />
      )}
      <QueryState query={status}>
        {status.data && (
          <div className={`author-service ${status.data.available ? '' : 'author-service-unavailable'}`}>
            <BrainCircuit size={19} />
            <div>
              <strong>{status.data.available ? `模型：${status.data.model}` : 'AI 服务尚不可用'}</strong>
              <p>
                {status.data.available
                  ? `每次最多 ${status.data.limits.maxQuestions} 题 · 每日 AI 调用上限 ${status.data.limits.dailyRequests} 次（与错题复盘、搜索和资料下载共用）`
                  : `${status.data.reason || '尚未配置服务'}。请联系管理员填写服务器 config.yaml 中的 AI 密钥。`}
              </p>
            </div>
            <Button
              size="small"
              icon={<RefreshCw size={14} />}
              loading={status.isFetching}
              onClick={() => void status.refetch()}
            >
              刷新状态
            </Button>
          </div>
        )}
      </QueryState>
      <div className="author-layout">
        <div className="author-workspace">
          {error && (
            <Alert
              showIcon
              type="error"
              message="操作未完成"
              description={error}
              action={
                conflict ? (
                  <Button disabled={!!busy} onClick={() => void refreshDraft(true)}>
                    保留修改并刷新版本
                  </Button>
                ) : draftId && !draft ? (
                  <Button disabled={!!busy} onClick={() => void refreshDraft()}>
                    重新载入
                  </Button>
                ) : undefined
              }
            />
          )}
          {busy === 'load' && (
            <div className="author-loading">
              <Spin />
              <span>正在载入草稿…</span>
            </div>
          )}
          {!draftId && (
            <Panel title="设置出题要求" description="先确定课程和知识点，再安排题型、数量与分值。">
              <fieldset className="author-mode">
                <legend>生成内容</legend>
                <Radio.Group
                  value={input.mode}
                  disabled={!!busy}
                  onChange={(e) => setInput({ ...input, mode: e.target.value })}
                >
                  <Radio.Button value="questions">题目草稿</Radio.Button>
                  {canPaper && <Radio.Button value="paper">完整试卷</Radio.Button>}
                </Radio.Group>
              </fieldset>
              <div className="author-form-grid">
                <div className="author-field">
                  <label htmlFor="author-course">
                    课程 <span>*</span>
                  </label>
                  <RemoteSelect
                    id="author-course"
                    endpoint="/courses"
                    labelField="title"
                    value={input.courseId || undefined}
                    allowClear={false}
                    disabled={!!busy}
                    placeholder="选择任教课程"
                    onChange={(courseId) => {
                      sequence.current++;
                      setInput({ ...input, courseId, chapterId: null });
                      setError('');
                    }}
                  />
                </div>
                <div className="author-field">
                  <label htmlFor="author-chapter">章节（选填）</label>
                  <Select
                    id="author-chapter"
                    allowClear
                    disabled={!input.courseId || !!busy || course.isLoading}
                    value={input.chapterId || undefined}
                    placeholder="不限定章节"
                    options={(course.data?.chapters || []).map((c) => ({ value: c.id, label: c.title }))}
                    onChange={(chapterId) => setInput({ ...input, chapterId: chapterId || null })}
                  />
                </div>
              </div>
              {course.error && (
                <Alert
                  type="warning"
                  message="章节加载失败"
                  action={
                    <Button size="small" onClick={() => void course.refetch()}>
                      重试
                    </Button>
                  }
                />
              )}
              <div className="author-field">
                <label htmlFor="author-title">
                  题名 / 试卷名称 <span>*</span>
                </label>
                <Input
                  id="author-title"
                  value={input.title}
                  maxLength={200}
                  showCount
                  disabled={!!busy}
                  placeholder="例如：二次函数基础巩固"
                  onChange={(e) => setInput({ ...input, title: e.target.value })}
                />
              </div>
              <div className="author-field">
                <label htmlFor="author-knowledge">
                  知识点 <span>*</span>
                </label>
                <Select
                  id="author-knowledge"
                  mode="tags"
                  maxCount={20}
                  tokenSeparators={[',', '，']}
                  value={input.knowledgePoints}
                  disabled={!!busy}
                  placeholder="输入知识点后按回车，最多 20 个"
                  onChange={(knowledgePoints) => setInput({ ...input, knowledgePoints })}
                />
                <p className="author-help">例如：顶点坐标、函数图像、实际问题建模。</p>
              </div>
              <fieldset className="author-blueprint">
                <legend>
                  题型安排{' '}
                  <span>
                    共 {totalCount} 题 · {totalScore.toFixed(2).replace(/\.00$/, '')} 分
                  </span>
                </legend>
                {questionTypes.map((type) => {
                  const row = input.blueprint.find((b) => b.type === type);
                  const update = (patch: Partial<Blueprint>) =>
                    setInput({
                      ...input,
                      blueprint: input.blueprint.map((b) => (b.type === type ? { ...b, ...patch } : b)),
                    });
                  return (
                    <div className="author-blueprint-row" key={type}>
                      <Checkbox
                        checked={!!row}
                        disabled={!!busy}
                        onChange={(e) =>
                          setInput({
                            ...input,
                            blueprint: e.target.checked
                              ? [...input.blueprint, { type, count: 1, scoreCents: 200, difficulty: 3 }]
                              : input.blueprint.filter((b) => b.type !== type),
                          })
                        }
                      >
                        {label(type)}
                      </Checkbox>
                      <div>
                        <label htmlFor={`blueprint-${type}-count`}>题数</label>
                        <InputNumber
                          id={`blueprint-${type}-count`}
                          min={1}
                          max={10}
                          precision={0}
                          disabled={!row || !!busy}
                          value={row?.count}
                          onChange={(count) => update({ count: count ?? 0 })}
                        />
                      </div>
                      <div>
                        <label htmlFor={`blueprint-${type}-score`}>每题分值</label>
                        <InputNumber
                          id={`blueprint-${type}-score`}
                          min={0.01}
                          max={10000}
                          precision={2}
                          disabled={!row || !!busy}
                          value={row ? row.scoreCents / 100 : undefined}
                          onChange={(score) => update({ scoreCents: Math.round((score ?? 0) * 100) })}
                        />
                      </div>
                      <div>
                        <label htmlFor={`blueprint-${type}-difficulty`}>难度</label>
                        <Select
                          id={`blueprint-${type}-difficulty`}
                          options={difficulties}
                          disabled={!row || !!busy}
                          value={row?.difficulty}
                          onChange={(difficulty) => update({ difficulty })}
                        />
                      </div>
                    </div>
                  );
                })}
                {(totalCount < 1 || totalCount > 10) && (
                  <p className="author-validation" role="alert">
                    总题数必须在 1–10 题之间。
                  </p>
                )}
              </fieldset>
              <div className="author-field">
                <label htmlFor="author-requirements">额外要求（选填）</label>
                <Input.TextArea
                  id="author-requirements"
                  value={input.requirements}
                  maxLength={2000}
                  showCount
                  disabled={!!busy}
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  placeholder="例如：适合高一学生，包含生活情境，解析说明常见误区。"
                  onChange={(e) => setInput({ ...input, requirements: e.target.value })}
                />
              </div>
              <div className="author-field">
                <label htmlFor="author-material">参考材料（选填）</label>
                <Input.TextArea
                  id="author-material"
                  value={input.material}
                  maxLength={10000}
                  showCount
                  disabled={!!busy}
                  autoSize={{ minRows: 3, maxRows: 8 }}
                  placeholder="可粘贴本课讲义或背景资料，无需上传文件。"
                  onChange={(e) => setInput({ ...input, material: e.target.value })}
                />
              </div>
              <div className="author-generate-footer">
                <p className="author-help">
                  点击生成会将题名、知识点、出题要求、题型安排和选填材料发送给管理员配置的 AI
                  服务。草稿需经审阅，不会自动发布考试。
                </p>
                <Button
                  type="primary"
                  icon={<BrainCircuit size={16} />}
                  loading={busy === 'generate'}
                  disabled={
                    !!busy || !status.data?.available || !canWrite || totalCount < 1 || totalCount > 10
                  }
                  onClick={() => void generate()}
                >
                  生成出题草稿
                </Button>
                {busy === 'generate' && (
                  <p className="author-help" role="status">
                    模型正在生成，请勿重复提交；完成后会自动打开草稿。
                  </p>
                )}
              </div>
            </Panel>
          )}
          {draft && (
            <>
              <Panel
                title={draft.status === 'saved' ? '已保存的出题任务' : '审阅出题草稿'}
                extra={
                  <Tag
                    color={draft.status === 'saved' ? 'green' : draft.status === 'failed' ? 'red' : 'blue'}
                  >
                    {statusLabels[draft.status]}
                  </Tag>
                }
              >
                <div className="author-draft-meta">
                  <span>{draft.mode === 'paper' ? '完整试卷' : '题目草稿'}</span>
                  <span>{draft.model}</span>
                  <span>{date(draft.createdAt)}</span>
                  <span>版本 {draft.revision}</span>
                </div>
                {draft.status === 'pending' && (
                  <Alert
                    showIcon
                    type="info"
                    message="题目正在生成"
                    description="状态会自动更新。稍后也可从右侧历史记录继续查看。"
                  />
                )}
                {draft.status === 'failed' && (
                  <Alert
                    showIcon
                    type="error"
                    message="本次生成失败"
                    description={draft.error || '模型未能生成有效题目，请调整出题要求后重试。'}
                  />
                )}
                {draft.status === 'saved' && (
                  <div className="author-saved">
                    <CheckCircle2 size={25} />
                    <div>
                      <strong>
                        {draft.savedPaperId
                          ? '试卷和题目已保存，可在考试中心选择已有试卷。'
                          : '题目已保存到题库。'}
                      </strong>
                      <p>
                        保存为个人私有题，练习未开放。
                        {draft.savedPaperId ? '试卷不会自动创建或发布考试。' : '可在题库继续维护或组卷。'}
                      </p>
                      <div className="author-links">
                        <Link
                          to={`/questions?${queryString({ courseId: draft.courseId, tab: draft.savedPaperId ? 'papers' : 'questions' })}`}
                        >
                          {draft.savedPaperId ? '查看固定版本试卷' : '查看题库'}
                        </Link>
                        {draft.savedPaperId && <Link to="/exams">前往考试中心</Link>}
                      </div>
                    </div>
                  </div>
                )}
                <div className="author-field">
                  <label htmlFor="author-draft-title">题名 / 试卷名称</label>
                  <Input
                    id="author-draft-title"
                    maxLength={200}
                    showCount
                    value={title}
                    disabled={readonly}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      markDirty();
                    }}
                  />
                </div>
                <div className="author-draft-actions">
                  <span>
                    {questions.length} 题 · {questions.reduce((sum, q) => sum + q.scoreCents, 0) / 100} 分
                    {dirty ? ' · 有未保存修改' : ''}
                  </span>
                  <div>
                    <Button
                      icon={<RefreshCw size={14} />}
                      disabled={!!busy}
                      onClick={() => {
                        if (dirty)
                          modal.confirm({
                            title: '重新载入服务端草稿？',
                            content: '这将丢弃当前未保存的修改。',
                            okText: '重新载入',
                            cancelText: '继续编辑',
                            onOk: () => refreshDraft(),
                          });
                        else void refreshDraft();
                      }}
                    >
                      刷新草稿
                    </Button>
                    {draft.status === 'failed' && (
                      <Button
                        disabled={!!busy || !canWrite}
                        onClick={() => {
                          const original = draft.input;
                          retryInput.current = {
                            ...original,
                            blueprint: original.blueprint.map((b) => ({ ...b })),
                            knowledgePoints: [...original.knowledgePoints],
                          };
                          sequence.current++;
                          setParams({ mode: original.mode, courseId: original.courseId });
                        }}
                      >
                        调整要求后重试
                      </Button>
                    )}
                  </div>
                </div>
              </Panel>
              {(draft.status === 'ready' || draft.status === 'saved') && (
                <>
                  {!questions.length && (
                    <EmptyState description="草稿中暂无题目。至少保留一道题才能保存，可刷新以恢复原始草稿。" />
                  )}
                  {questions.map((q, index) => (
                    <QuestionEditor
                      key={q._editorKey || `${draft.id}-${index}`}
                      question={q}
                      index={index}
                      disabled={readonly}
                      onChange={(value) => {
                        setQuestions((current) => current.map((item, i) => (i === index ? value : item)));
                        markDirty();
                      }}
                      onRemove={() => {
                        setQuestions((current) => current.filter((_, i) => i !== index));
                        markDirty();
                      }}
                    />
                  ))}
                  {draft.status === 'ready' && (
                    <div className="author-savebar">
                      <div>
                        <strong>确认答案与解析后保存</strong>
                        <p>所有题目默认为个人私有，练习保持关闭。</p>
                      </div>
                      <Button
                        type="primary"
                        icon={<Save size={16} />}
                        loading={busy === 'save'}
                        disabled={!!busy || !canWrite || !questions.length}
                        onClick={() => void commit()}
                      >
                        {draft.mode === 'paper' ? '保存整卷与题目' : '保存到题库'}
                      </Button>
                    </div>
                  )}
                </>
              )}
              <div className="author-delete">
                <Popconfirm
                  title="删除这条出题任务记录？"
                  description={
                    draft.status === 'saved'
                      ? '只删除任务记录，已保存的题目与试卷仍保留。'
                      : '删除后无法恢复草稿内容。'
                  }
                  onConfirm={deleteDraft}
                  disabled={!!busy || draft.status === 'pending'}
                >
                  <Button
                    danger
                    type="text"
                    icon={<Trash2 size={15} />}
                    disabled={!!busy || draft.status === 'pending'}
                  >
                    删除任务记录
                  </Button>
                </Popconfirm>
              </div>
            </>
          )}
        </div>
        <aside className="author-history">
          <Panel
            title="出题历史"
            description="生成结果会保留为草稿，便于继续审阅。"
            extra={<History size={18} />}
          >
            <QueryState query={history}>
              {!history.data?.items.length && (
                <EmptyState description="暂无出题记录，生成第一份草稿后会显示在这里。" />
              )}
              <div className="author-history-list">
                {history.data?.items
                  .filter((item) => item.mode !== 'paper' || canPaper)
                  .map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`author-history-item ${item.id === draftId ? 'is-active' : ''}`}
                      disabled={!!busy}
                      aria-current={item.id === draftId ? 'page' : undefined}
                      onClick={() => changeView({ draft: item.id })}
                    >
                      <span className="author-history-title">
                        <FileText size={16} />
                        <strong>{item.title}</strong>
                      </span>
                      <span>
                        <Tag
                          color={
                            item.status === 'failed' ? 'red' : item.status === 'saved' ? 'green' : undefined
                          }
                        >
                          {statusLabels[item.status]}
                        </Tag>
                        <span>
                          {item.mode === 'paper' ? '试卷' : '题目'} · {item.questionCount} 题
                        </span>
                      </span>
                      <time>{date(item.createdAt)}</time>
                    </button>
                  ))}
              </div>
              {!!history.data?.total && (
                <Pagination
                  size="small"
                  current={historyPage}
                  pageSize={8}
                  total={history.data.total}
                  showSizeChanger={false}
                  disabled={!!busy}
                  onChange={setHistoryPage}
                />
              )}
            </QueryState>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
