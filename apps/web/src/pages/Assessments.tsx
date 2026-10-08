import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Upload,
  Result,
} from 'antd';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Flag,
  Download,
  PenLine,
  Play,
  Plus,
  RefreshCw,
  Save,
  Send,
  Upload as UploadIcon,
} from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api, date, isTeacher, label, queryString, send, useAction, useData } from '../api';
import { useAuth } from '../auth';
import { RemoteSelect } from '../components/RemoteSelect';
import { RichTextEditor } from '../components/RichTextEditor';
import { ExamItemAnalysis } from './ExamItemAnalysis';
import {
  EmptyState,
  Metrics,
  PageTitle,
  Panel,
  QueryState,
  RichContent,
  Status,
  useUnsavedWarning,
} from '../components/shared';
const types = ['single', 'multiple', 'boolean', 'blank', 'short', 'composite'];
const typeOptions = types.map((value) => ({ value, label: label(value) }));
const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? '—' : Number((cents / 100).toFixed(2));
const plainText = (value = '') =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
const qid = (q: any) => q.questionVersionId || q.id;
const answerArray = (answers: Record<string, any>) =>
  Object.entries(answers)
    .filter(([, value]) => value !== undefined)
    .map(([questionVersionId, value]) => ({ questionVersionId, value }));
const answerMap = (answers: any[] = []) =>
  Object.fromEntries(answers.map((a) => [a.questionVersionId, a.value]));
const answered = (value: any) =>
  value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
const toISO = (value: string) =>
  value ? new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : value + '+08:00').toISOString() : undefined;
function AnswerInput({
  question: q,
  value,
  onChange,
  disabled = false,
}: {
  question: any;
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
}) {
  if (q.type === 'single')
    return (
      <Radio.Group
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="question-options"
      >
        {q.options?.map((o: any) => (
          <Radio value={o.id} key={o.id}>
            {o.id}.　{o.text}
          </Radio>
        ))}
      </Radio.Group>
    );
  if (q.type === 'multiple')
    return (
      <Checkbox.Group
        disabled={disabled}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
        className="question-options"
      >
        {q.options?.map((o: any) => (
          <Checkbox value={o.id} key={o.id}>
            {o.id}.　{o.text}
          </Checkbox>
        ))}
      </Checkbox.Group>
    );
  if (q.type === 'boolean')
    return (
      <Radio.Group
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="question-options"
      >
        <Radio value={true}>正确</Radio>
        <Radio value={false}>错误</Radio>
      </Radio.Group>
    );
  if (q.type === 'composite')
    return (
      <div className="stack">
        {q.children?.map((child: any, index: number) => (
          <div key={child.id}>
            <div className="question-stem">
              <span>（{index + 1}）</span>
              <RichContent content={child.stem} />
              <Tag>{money(child.scoreCents)} 分</Tag>
            </div>
            <AnswerInput
              question={child}
              value={value?.[child.id]}
              onChange={(next) => onChange({ ...value, [child.id]: next })}
              disabled={disabled}
            />
          </div>
        ))}
      </div>
    );
  return (
    <Input.TextArea
      value={typeof value === 'string' ? value : Array.isArray(value) ? value.join('\n') : ''}
      onChange={(e) => onChange(q.type === 'blank' ? e.target.value.split('\n') : e.target.value)}
      rows={q.type === 'short' ? 5 : 2}
      placeholder={q.type === 'blank' ? '每个填空的答案独占一行' : '请输入你的答案，思路与过程同样重要'}
      disabled={disabled}
    />
  );
}
function AnswerDisplay({ value }: { value: any }) {
  return (
    <span style={{ whiteSpace: 'pre-wrap' }}>
      {value === undefined || value === null
        ? '未作答'
        : typeof value === 'boolean'
          ? value
            ? '正确'
            : '错误'
          : Array.isArray(value)
            ? value.join('、')
            : typeof value === 'object'
              ? Object.entries(value)
                  .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' / ') : String(v)}`)
                  .join('\n')
              : String(value)}
    </span>
  );
}
function QuestionView({
  question: q,
  index,
  value,
  onChange,
  disabled,
  explain,
}: {
  question: any;
  index: number;
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
  explain?: boolean;
}) {
  return (
    <div className="answer-question">
      <div className="question-meta">
        <Tag bordered={false}>{label(q.type)}</Tag>
        <span>第 {index + 1} 题</span>
        <span>{money(q.scoreCents)} 分</span>
        {q.knowledgePoints?.map((k: string) => (
          <Tag key={k}>{k}</Tag>
        ))}
      </div>
      <div className="question-stem">
        <RichContent content={q.stem} />
      </div>
      <AnswerInput question={q} value={value} onChange={onChange} disabled={disabled} />
      {explain && ('answer' in q || q.explanation) && (
        <div className="question-explanation">
          {'answer' in q && (
            <>
              <strong>参考答案</strong>
              <AnswerDisplay value={q.answer} />
            </>
          )}
          {q.explanation && (
            <>
              <strong style={{ marginTop: 12 }}>答案解析</strong>
              <span style={{ whiteSpace: 'pre-wrap' }}>{q.explanation}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
function CourseSelect({
  id,
  value,
  onChange,
  allowClear = true,
}: {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  allowClear?: boolean;
}) {
  return (
    <RemoteSelect
      id={id}
      endpoint="/courses"
      labelField="title"
      value={value}
      onChange={onChange}
      allowClear={allowClear}
      placeholder="选择课程"
      style={{ minWidth: 210 }}
    />
  );
}
function ChapterSelect({
  id,
  courseId,
  value,
  onChange,
}: {
  id?: string;
  courseId?: string;
  value?: string;
  onChange?: (id?: string) => void;
}) {
  const course = useData(`/courses/${courseId}`, !!courseId);
  return (
    <Select
      id={id}
      allowClear
      disabled={!courseId}
      value={value}
      onChange={onChange}
      placeholder="全部章节"
      options={(course.data?.chapters || []).map((c: any) => ({ value: c.id, label: c.title }))}
      style={{ minWidth: 180 }}
    />
  );
}

function QuestionEditor({ open, onClose, record }: { open: boolean; onClose: () => void; record?: any }) {
  const [form] = Form.useForm();
  const action = useAction('题目已保存，历史版本保持不变');
  const type = Form.useWatch('type', form) || 'single';
  const editorCourse = Form.useWatch('courseId', form);
  const [optionText, setOptionText] = useState('选项一\n选项二\n选项三\n选项四');
  const [children, setChildren] = useState<any[]>([]);
  const options = optionText
    .split('\n')
    .filter(Boolean)
    .map((text, i) => ({ id: String.fromCharCode(65 + i), text }));
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    const q = record?.versions?.[0];
    if (q) {
      form.setFieldsValue({
        ...record,
        ...q,
        score: Number(q.scoreCents) / 100,
        answer:
          q.type === 'blank'
            ? (q.answer || []).map((a: any) => (Array.isArray(a) ? a.join('|') : a)).join('\n')
            : q.answer,
      });
      setOptionText(q.options?.map((o: any) => o.text).join('\n') || '');
      setChildren(q.children || []);
    } else {
      setOptionText('选项一\n选项二\n选项三\n选项四');
      setChildren([]);
    }
  }, [open, record?.id]);
  async function save(v: any) {
    const body = {
      ...v,
      options: ['single', 'multiple'].includes(v.type) ? options : [],
      scoreCents: Math.round(v.score * 100),
      answer:
        v.type === 'blank'
          ? String(v.answer)
              .split('\n')
              .map((line: string) => line.split('|'))
          : v.answer,
      children,
      expectedVersion: record?.versions?.[0]?.version || record?.currentVersion,
      practiceEnabled: !!v.practiceEnabled,
      chapterId: v.chapterId || null,
    };
    delete body.score;
    await action.mutateAsync({
      path: record ? `/questions/${record.id}` : '/questions',
      method: record ? 'PATCH' : 'POST',
      body,
    });
    onClose();
  }
  return (
    <Modal
      title={record ? '编辑题目（创建新版本）' : '新增题目'}
      width={780}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={action.isPending}
      okText="保存题目"
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          type: 'single',
          score: 5,
          difficulty: 2,
          practiceEnabled: false,
          scope: 'private',
          rules: { partialCredit: false },
        }}
        onFinish={save}
      >
        <div className="info-list">
          <Form.Item name="courseId" label="所属课程" rules={[{ required: true, message: '请选择课程' }]}>
            <CourseSelect allowClear={false} onChange={() => form.setFieldValue('chapterId', undefined)} />
          </Form.Item>
          <Form.Item name="type" label="题目类型" rules={[{ required: true }]}>
            <Select options={typeOptions} />
          </Form.Item>
        </div>
        <Form.Item name="chapterId" label="所属章节（可选）">
          <ChapterSelect courseId={editorCourse} />
        </Form.Item>
        <Form.Item name="stem" label="题干" rules={[{ required: true, message: '请输入题干' }]}>
          <RichTextEditor />
        </Form.Item>
        {['single', 'multiple'].includes(type) && (
          <>
            <Form.Item label="选项（每行一个，自动编号 A、B、C…）">
              <Input.TextArea value={optionText} onChange={(e) => setOptionText(e.target.value)} rows={4} />
            </Form.Item>
            <Form.Item name="answer" label="正确答案" rules={[{ required: true, message: '请选择正确答案' }]}>
              <Select
                mode={type === 'multiple' ? 'multiple' : undefined}
                options={options.map((o) => ({ value: o.id, label: `${o.id}. ${o.text}` }))}
              />
            </Form.Item>
            {type === 'multiple' && (
              <Form.Item
                name={['rules', 'partialCredit']}
                label="漏选按比例给分，错选不得分"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            )}
          </>
        )}
        {type === 'boolean' ? (
          <Form.Item name="answer" label="正确答案" rules={[{ required: true, message: '请选择答案' }]}>
            <Radio.Group
              options={[
                { label: '正确', value: true },
                { label: '错误', value: false },
              ]}
            />
          </Form.Item>
        ) : (
          !['single', 'multiple', 'composite'].includes(type) && (
            <Form.Item
              name="answer"
              label={type === 'blank' ? '每行对应一个空，同义答案用 | 分隔' : '参考答案 / 评分标准'}
              rules={[{ required: true, message: '请输入标准答案或评分参考' }]}
            >
              <Input.TextArea rows={3} />
            </Form.Item>
          )
        )}
        {type === 'composite' && (
          <>
            <Form.Item
              name="answer"
              label="综合评分标准"
              rules={[{ required: true, message: '填写评分标准' }]}
            >
              <Input.TextArea rows={2} />
            </Form.Item>
            <div className="stack" style={{ marginBottom: 20 }}>
              {children.map((c, index) => (
                <div key={c.id} style={{ border: '1px solid #dce1e7', padding: 16, borderRadius: 6 }}>
                  <div className="list-title-line">
                    <strong style={{ fontSize: 14 }}>子题 {index + 1}（简答）</strong>
                    <Button
                      type="text"
                      danger
                      size="small"
                      onClick={() => setChildren(children.filter((_, i) => i !== index))}
                    >
                      移除
                    </Button>
                  </div>
                  <Input.TextArea
                    value={c.stem}
                    placeholder="子题题干"
                    onChange={(e) =>
                      setChildren(
                        children.map((item, i) => (i === index ? { ...item, stem: e.target.value } : item)),
                      )
                    }
                    style={{ margin: '10px 0' }}
                  />
                  <Input.TextArea
                    value={c.answer}
                    placeholder="子题评分参考"
                    onChange={(e) =>
                      setChildren(
                        children.map((item, i) => (i === index ? { ...item, answer: e.target.value } : item)),
                      )
                    }
                  />
                  <InputNumber
                    min={0.01}
                    value={c.scoreCents / 100}
                    addonAfter="分"
                    onChange={(v) =>
                      setChildren(
                        children.map((item, i) =>
                          i === index ? { ...item, scoreCents: Math.round(Number(v) * 100) } : item,
                        ),
                      )
                    }
                    style={{ marginTop: 10 }}
                  />
                </div>
              ))}
              <Button
                icon={<Plus size={14} />}
                onClick={() =>
                  setChildren([
                    ...children,
                    {
                      id: crypto.randomUUID(),
                      type: 'short',
                      stem: '',
                      answer: '',
                      scoreCents: 100,
                      options: [],
                      explanation: '',
                      rules: {},
                      difficulty: 2,
                      knowledgePoints: [],
                      tags: [],
                    },
                  ])
                }
              >
                添加子题
              </Button>
              <p className="form-hint">子题总分必须等于本题满分。</p>
            </div>
          </>
        )}
        <div className="info-list">
          <Form.Item name="score" label="题目满分" rules={[{ required: true }]}>
            <InputNumber min={0.01} max={10000} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="difficulty" label="难度">
            <Select
              options={[1, 2, 3, 4, 5].map((v) => ({
                value: v,
                label: ['基础', '较易', '适中', '较难', '挑战'][v - 1],
              }))}
            />
          </Form.Item>
        </div>
        <Form.Item name="explanation" label="答案解析">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="knowledgePoints" label="知识点">
          <Select mode="tags" placeholder="输入知识点后按回车" />
        </Form.Item>
        <Form.Item name="tags" label="标签">
          <Select mode="tags" />
        </Form.Item>
        <div className="info-list">
          <Form.Item name="scope" label="共享范围">
            <Select
              options={[
                { value: 'private', label: '个人私有' },
                { value: 'shared', label: '授权课程内共享' },
              ]}
            />
          </Form.Item>
          <Form.Item name="practiceEnabled" label="向学生开放练习" valuePropName="checked">
            <Switch />
          </Form.Item>
        </div>
        <Alert
          showIcon
          type="info"
          message="曾开放练习或用于公开作业的题目不能再用于保密考试，请建立独立考试题。"
        />
      </Form>
    </Modal>
  );
}
export function Questions() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [courseId, setCourseId] = useState<string | undefined>(params.get('courseId') || undefined);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<string>();
  const [chapterId, setChapterId] = useState<string>();
  const [page, setPage] = useState(1);
  const query = useData(
    `/questions?${queryString({ courseId, search, type, chapterId, page, pageSize: 15 })}`,
  );
  const [editor, setEditor] = useState(false);
  const [record, setRecord] = useState<any>();
  const [preview, setPreview] = useState<any>();
  const [tab, setTab] = useState(params.get('tab') === 'papers' ? 'papers' : 'questions');
  const [paperPage, setPaperPage] = useState(1);
  const papers = useData(`/papers?${queryString({ courseId, page: paperPage, pageSize: 15 })}`);
  const [paperOpen, setPaperOpen] = useState(false);
  const [paperForm] = Form.useForm();
  const [paperMode, setPaperMode] = useState('manual');
  const paperCourse = Form.useWatch('courseId', paperForm);
  const [paperQuestionPage, setPaperQuestionPage] = useState(1);
  const [paperSearch, setPaperSearch] = useState('');
  const paperQuestions = useData(
    `/questions?${queryString({ courseId: paperCourse, search: paperSearch, page: paperQuestionPage, pageSize: 10 })}`,
    !!paperCourse,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const action = useAction();
  return (
    <>
      <PageTitle
        eyebrow="QUESTION BANK"
        title="题库与试卷"
        description="积累高质量题目，使用固定版本组织作业与考试。"
        extra={
          <Space wrap>
            {user?.role === 'TEACHER' && user.permissions.includes('question.manage') && (
              <>
                <Link to={`/ai-authoring?${queryString({ mode: 'questions', courseId })}`}>
                  <Button icon={<BrainCircuit size={16} />}>AI 生成题目</Button>
                </Link>
                {user.permissions.includes('assessment.manage') && (
                  <Link to={`/ai-authoring?${queryString({ mode: 'paper', courseId })}`}>
                    <Button>AI 编写试卷</Button>
                  </Link>
                )}
              </>
            )}
            <QuestionTransfer courseId={courseId} />
            <Button
              onClick={() => {
                paperForm.setFieldValue('courseId', courseId);
                setPaperOpen(true);
              }}
            >
              创建试卷
            </Button>
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={() => {
                setRecord(undefined);
                setEditor(true);
              }}
            >
              新增题目
            </Button>
          </Space>
        }
      />
      <div className="filter-bar">
        <Input.Search
          allowClear
          placeholder="搜索题干关键词"
          style={{ maxWidth: 280 }}
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
        <CourseSelect
          value={courseId}
          onChange={(v) => {
            setCourseId(v);
            setChapterId(undefined);
            setPage(1);
            setPaperPage(1);
          }}
        />
        <ChapterSelect
          courseId={courseId}
          value={chapterId}
          onChange={(v) => {
            setChapterId(v);
            setPage(1);
          }}
        />
        <Select
          allowClear
          value={type}
          onChange={(v) => {
            setType(v);
            setPage(1);
          }}
          options={typeOptions}
          placeholder="全部题型"
          style={{ width: 130 }}
        />
      </div>
      <Panel>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'questions', label: '题目管理' },
            { key: 'papers', label: '固定版本试卷' },
          ]}
        />
        {tab === 'questions' ? (
          <QueryState query={query}>
            <Table
              rowKey="id"
              dataSource={query.data?.items || []}
              columns={[
                {
                  title: '题目',
                  render: (_, r: any) => (
                    <div>
                      <div className="table-title" onClick={() => setPreview(r.versions?.[0])}>
                        {plainText(r.versions?.[0]?.stem).slice(0, 85)}
                      </div>
                      <div className="table-secondary">
                        版本 {r.versions?.[0]?.version} · {r.scope === 'shared' ? '课程共享' : '个人私有'} ·{' '}
                        {r.practiceEnabled ? '已开放练习' : '保密题'}
                      </div>
                    </div>
                  ),
                },
                { title: '题型', render: (_, r: any) => <Tag>{label(r.versions?.[0]?.type)}</Tag> },
                { title: '分值', render: (_, r: any) => `${money(r.versions?.[0]?.scoreCents)} 分` },
                {
                  title: '知识点',
                  render: (_, r: any) => (
                    <Space size={2} wrap>
                      {r.versions?.[0]?.knowledgePoints?.map((k: string) => (
                        <Tag key={k}>{k}</Tag>
                      ))}
                    </Space>
                  ),
                },
                {
                  title: '操作',
                  render: (_, r: any) => (
                    <Space size={0}>
                      <Button
                        type="link"
                        onClick={() => {
                          setRecord(r);
                          setEditor(true);
                        }}
                      >
                        编辑
                      </Button>
                      <Button type="link" onClick={() => action.mutate({ path: `/questions/${r.id}/copy` })}>
                        复制
                      </Button>
                      <Popconfirm
                        title="停用后不影响已发布试卷的历史版本，确定停用？"
                        onConfirm={() =>
                          action.mutateAsync({
                            path: `/questions/${r.id}`,
                            method: 'PATCH',
                            body: { active: false, expectedVersion: r.versions?.[0]?.version },
                          })
                        }
                      >
                        <Button danger type="link">
                          停用
                        </Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
              pagination={{
                current: page,
                pageSize: 15,
                total: query.data?.total,
                onChange: setPage,
                showSizeChanger: false,
              }}
            />
          </QueryState>
        ) : (
          <QueryState query={papers}>
            <Table
              rowKey="id"
              dataSource={papers.data?.items || []}
              columns={[
                { title: '试卷名称', dataIndex: 'title' },
                { title: '总分', dataIndex: 'totalCents', render: (v) => `${money(v)} 分` },
                { title: '题目数量', render: (_, r: any) => r.items?.length ?? r._count?.items ?? '—' },
                { title: '创建时间', dataIndex: 'createdAt', render: (v) => date(v) },
              ]}
              pagination={{
                current: paperPage,
                pageSize: 15,
                total: papers.data?.total,
                onChange: setPaperPage,
                showSizeChanger: false,
              }}
            />
          </QueryState>
        )}
      </Panel>
      <QuestionEditor open={editor} record={record} onClose={() => setEditor(false)} />
      <Modal
        title="题目预览"
        open={!!preview}
        onCancel={() => setPreview(undefined)}
        footer={null}
        width={750}
      >
        {preview && (
          <QuestionView question={preview} index={0} value={undefined} onChange={() => {}} explain disabled />
        )}
      </Modal>
      <Modal
        title="创建固定版本试卷"
        open={paperOpen}
        onCancel={() => setPaperOpen(false)}
        onOk={() => paperForm.submit()}
        width={760}
        confirmLoading={action.isPending}
      >
        <Form
          form={paperForm}
          layout="vertical"
          onFinish={async (values) => {
            await action.mutateAsync({
              path: '/papers',
              body: {
                courseId: values.courseId,
                title: values.title,
                questionVersionIds: paperMode === 'manual' ? selected : [],
                ...(paperMode === 'rule' ? { rule: values.rule } : {}),
              },
            });
            setPaperOpen(false);
            setSelected([]);
          }}
        >
          <Form.Item name="courseId" label="所属课程" rules={[{ required: true, message: '请选择课程' }]}>
            <CourseSelect allowClear={false} />
          </Form.Item>
          <Form.Item name="title" label="试卷名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <p className="form-hint">下方题目来自当前题库筛选，选定后试卷固定题目版本。</p>
          <Form.Item label="组卷方式">
            <Radio.Group
              value={paperMode}
              onChange={(e) => setPaperMode(e.target.value)}
              options={[
                { value: 'manual', label: '手工选题' },
                { value: 'rule', label: '按规则抽题' },
              ]}
            />
          </Form.Item>
          {paperMode === 'rule' ? (
            <>
              <Form.Item name={['rule', 'count']} label="抽题数量" rules={[{ required: true }]}>
                <InputNumber min={1} max={100} />
              </Form.Item>
              <Form.Item name={['rule', 'type']} label="题型">
                <Select allowClear options={typeOptions} />
              </Form.Item>
              <Form.Item name={['rule', 'difficulty']} label="难度">
                <Select
                  allowClear
                  options={[1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) }))}
                />
              </Form.Item>
              <Form.Item name={['rule', 'knowledgePoint']} label="知识点">
                <Input />
              </Form.Item>
            </>
          ) : (
            <>
              <Input.Search
                placeholder="搜索组卷题目"
                onSearch={(v) => {
                  setPaperSearch(v);
                  setPaperQuestionPage(1);
                }}
                style={{ marginBottom: 12 }}
              />
              <Table
                size="small"
                rowKey={(r: any) => r.versions[0].id}
                dataSource={paperQuestions.data?.items || []}
                rowSelection={{
                  selectedRowKeys: selected,
                  preserveSelectedRowKeys: true,
                  onChange: (keys) => setSelected(keys as string[]),
                }}
                columns={[
                  { title: '题干', render: (_, r: any) => plainText(r.versions[0].stem) },
                  { title: '分值', render: (_, r: any) => money(r.versions[0].scoreCents) },
                ]}
                pagination={{
                  current: paperQuestionPage,
                  pageSize: 10,
                  total: paperQuestions.data?.total,
                  onChange: setPaperQuestionPage,
                  showSizeChanger: false,
                }}
              />
            </>
          )}
        </Form>
      </Modal>
    </>
  );
}
function AssessmentCreator({
  kind,
  open,
  onClose,
}: {
  kind: 'assignments' | 'exams';
  open: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const courseId = Form.useWatch('courseId', form);
  const [questionPage, setQuestionPage] = useState(1);
  const [questionSearch, setQuestionSearch] = useState('');
  const questions = useData(
    `/questions?${queryString({ courseId, search: questionSearch, page: questionPage, pageSize: 10 })}`,
    !!courseId,
  );
  const [questionSource, setQuestionSource] = useState('manual');
  const [paperId, setPaperId] = useState<string>();
  const [paperItems, setPaperItems] = useState<any[]>([]);
  const selectedScores = useRef<Record<string, number>>({});
  for (const q of questions.data?.items || [])
    selectedScores.current[q.versions[0].id] = q.versions[0].scoreCents;
  const [selected, setSelected] = useState<string[]>([]);
  const action = useAction('已创建草稿，请检查后发布');
  const exam = kind === 'exams';
  async function create(values: any) {
    const body = {
      ...values,
      questionVersionIds:
        questionSource === 'paper' ? paperItems.map((item) => item.questionVersionId) : selected,
      passCents: Math.round((values.passScore || 0) * 100),
    };
    for (const key of [
      'opensAt',
      'dueAt',
      'startsAt',
      'endsAt',
      'entryClosesAt',
      'scoreReleaseAt',
      'answerReleaseAt',
      'explanationReleaseAt',
      'commentReleaseAt',
      'appealDeadline',
    ])
      if (body[key]) body[key] = toISO(body[key]);
    await action.mutateAsync({ path: `/${kind}`, body });
    onClose();
    form.resetFields();
    setSelected([]);
  }
  return (
    <Modal
      title={exam ? '创建考试草稿' : '创建作业草稿'}
      width={840}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={action.isPending}
      okButtonProps={{ disabled: questionSource === 'paper' ? !paperItems.length : !selected.length }}
      okText="保存草稿"
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={create}
        initialValues={{
          maxAttempts: 1,
          durationMinutes: 60,
          passScore: 0,
          allowBacktrack: true,
          allowLate: false,
          shuffleQuestions: false,
          shuffleOptions: false,
        }}
      >
        <div className="info-list">
          <Form.Item name="courseId" label="所属课程" rules={[{ required: true, message: '请选择课程' }]}>
            <CourseSelect
              allowClear={false}
              onChange={() => {
                setSelected([]);
                setQuestionPage(1);
                setPaperId(undefined);
                setPaperItems([]);
                form.setFieldValue('audienceIds', []);
                form.setFieldValue('graderIds', []);
              }}
            />
          </Form.Item>
          <Form.Item
            name="title"
            label={exam ? '考试名称' : '作业名称'}
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input />
          </Form.Item>
        </div>
        <Form.Item name="description" label={exam ? '考试说明与须知' : '作业说明'}>
          <Input.TextArea rows={3} />
        </Form.Item>
        <div className="info-list">
          <Form.Item
            name={exam ? 'startsAt' : 'opensAt'}
            label={exam ? '考试开始时间' : '开放时间'}
            rules={[{ required: true, message: '请选择时间' }]}
          >
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item
            name={exam ? 'endsAt' : 'dueAt'}
            label={exam ? '考试窗口结束时间' : '截止时间'}
            rules={[{ required: true, message: '请选择时间' }]}
          >
            <Input type="datetime-local" />
          </Form.Item>
        </div>
        {exam && (
          <>
            <div className="info-list">
              <Form.Item
                name="entryClosesAt"
                label="最晚允许进入时间"
                rules={[{ required: true, message: '请选择时间' }]}
              >
                <Input type="datetime-local" />
              </Form.Item>
              <Form.Item name="durationMinutes" label="答题时长（分钟）" rules={[{ required: true }]}>
                <InputNumber min={1} max={1440} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="passScore" label="及格分">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="graderIds" label="主观题阅卷教师">
                <RemoteSelect
                  endpoint={`/courses/${courseId}/members`}
                  params={{ kind: 'teacher' }}
                  mode="multiple"
                  disabled={!courseId}
                />
              </Form.Item>
            </div>
            <Space size={25} wrap>
              <Form.Item name="shuffleQuestions" label="打乱题目" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="shuffleOptions" label="打乱选项" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="allowBacktrack" label="允许返回上一题" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Space>
            <div className="info-list">
              {[
                { name: 'scoreReleaseAt', label: '成绩公开时间' },
                { name: 'answerReleaseAt', label: '答案公开时间' },
                { name: 'explanationReleaseAt', label: '解析公开时间' },
                { name: 'commentReleaseAt', label: '教师评语公开时间' },
                { name: 'appealDeadline', label: '成绩复核截止时间' },
              ].map((f) => (
                <Form.Item name={f.name} label={`${f.label}（可选）`} key={f.name}>
                  <Input type="datetime-local" />
                </Form.Item>
              ))}
            </div>
          </>
        )}
        <div className="info-list">
          <Form.Item name="maxAttempts" label="允许提交次数">
            <InputNumber min={1} max={exam ? 10 : 20} style={{ width: '100%' }} />
          </Form.Item>
          {!exam && (
            <Form.Item name="allowLate" label="允许迟交" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </div>
        <Form.Item name="audienceIds" label="指定学生（留空为当前课程全部学生）">
          <RemoteSelect
            endpoint={`/courses/${courseId}/members`}
            params={{ kind: 'student' }}
            mode="multiple"
            disabled={!courseId}
          />
        </Form.Item>
        {exam && (
          <Form.Item label="试卷来源">
            <Radio.Group
              value={questionSource}
              onChange={(e) => setQuestionSource(e.target.value)}
              options={[
                { value: 'manual', label: '手动选题' },
                { value: 'paper', label: '套用已有试卷' },
              ]}
            />
          </Form.Item>
        )}
        {exam && questionSource === 'paper' ? (
          <Form.Item label="已有固定版本试卷" htmlFor="exam-paper-select">
            <RemoteSelect
              id="exam-paper-select"
              endpoint="/papers"
              params={{ courseId }}
              labelField="title"
              disabled={!courseId}
              value={paperId}
              onChange={(value, _option, item) => {
                setPaperId(value);
                setPaperItems(item?.items || []);
              }}
              placeholder="搜索并选择试卷"
            />
            <p className="form-hint">
              已载入 {paperItems.length} 题，总分{' '}
              {money(paperItems.reduce((sum, item) => sum + (item.questionVersion?.scoreCents || 0), 0))}{' '}
              分。考试保存后固定这些题目版本；发布时检查保密限制。
            </p>
          </Form.Item>
        ) : (
          <>
            <Input.Search
              placeholder="搜索待选题目"
              onSearch={(v) => {
                setQuestionSearch(v);
                setQuestionPage(1);
              }}
              style={{ marginBottom: 12 }}
            />
            <div className="list-title-line" style={{ marginBottom: 15 }}>
              <h3 style={{ fontSize: 14 }}>选择题目固定版本</h3>
              <span className="form-hint" style={{ margin: 0 }}>
                已选 {selected.length} 题 · 总分{' '}
                {money(selected.reduce((sum, id) => sum + (selectedScores.current[id] || 0), 0))} 分
              </span>
            </div>
            {exam && (
              <Alert
                type="info"
                showIcon
                message="考试仅可使用从未开放练习、未用于公开作业的保密题。"
                style={{ marginBottom: 15 }}
              />
            )}
            <Table
              rowKey={(r: any) => r.versions[0].id}
              size="small"
              loading={questions.isLoading}
              dataSource={(questions.data?.items || []).filter(
                (q: any) => !exam || (!q.practiceEnabled && !q.everPracticeEnabled),
              )}
              rowSelection={{
                selectedRowKeys: selected,
                onChange: (keys) => setSelected(keys as string[]),
                preserveSelectedRowKeys: true,
              }}
              columns={[
                { title: '题干', render: (_, r: any) => plainText(r.versions[0].stem).slice(0, 90) },
                { title: '题型', render: (_, r: any) => label(r.versions[0].type) },
                { title: '分值', render: (_, r: any) => money(r.versions[0].scoreCents) },
              ]}
              pagination={{
                current: questionPage,
                pageSize: 10,
                total: questions.data?.total,
                onChange: setQuestionPage,
                showSizeChanger: false,
              }}
            />
          </>
        )}
      </Form>
    </Modal>
  );
}
export function Assignments() {
  const { user } = useAuth();
  const teacher = isTeacher(user);
  const [params] = useSearchParams();
  const [courseId, setCourseId] = useState(params.get('courseId') || undefined);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const query = useData(`/assignments?${queryString({ courseId, search, page, pageSize: 12 })}`);
  const navigate = useNavigate();
  return (
    <>
      <PageTitle
        eyebrow="ASSIGNMENTS"
        title={teacher ? '作业管理' : '我的作业'}
        description={teacher ? '从发布到反馈，清晰管理每一份作业。' : '把知识付诸实践，认真完成每一份作业。'}
        extra={
          teacher && (
            <Button type="primary" icon={<Plus size={16} />} onClick={() => setOpen(true)}>
              创建作业
            </Button>
          )
        }
      />
      <div className="filter-bar">
        <Input.Search
          placeholder="搜索作业名称"
          allowClear
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
          style={{ maxWidth: 300 }}
        />
        <CourseSelect
          value={courseId}
          onChange={(value) => {
            setCourseId(value);
            setPage(1);
          }}
        />
        <span className="filter-count">共 {query.data?.total || 0} 份作业</span>
      </div>
      <Panel>
        <QueryState query={query}>
          <Table
            rowKey="id"
            dataSource={query.data?.items || []}
            columns={[
              {
                title: '作业名称',
                render: (_, r: any) => (
                  <div>
                    <Link to={`/assignments/${r.id}`} className="table-title">
                      {r.title}
                    </Link>
                    <div className="table-secondary">
                      满分 {money(r.totalCents)} 分 · 最多提交 {r.maxAttempts} 次
                    </div>
                  </div>
                ),
              },
              {
                title: '截止时间',
                dataIndex: 'dueAt',
                render: (v) => (
                  <span style={{ color: new Date(v) < new Date() ? '#9c5b00' : undefined }}>{date(v)}</span>
                ),
              },
              {
                title: '状态',
                render: (_, r: any) => <Status value={r.submissions?.[0]?.status || r.status} />,
              },
              {
                title: teacher ? '提交版本数 / 应交人数' : '最新成绩',
                render: (_, r: any) =>
                  teacher
                    ? `${r._count?.submissions || 0} / ${r._count?.audience || 0}`
                    : r.submissions?.[0]?.releasedAt
                      ? `${money(r.submissions[0].scoreCents)} 分`
                      : r.submissions?.length
                        ? '等待反馈'
                        : '尚未提交',
              },
              {
                title: '操作',
                render: (_, r: any) => (
                  <Button type="link" onClick={() => navigate(`/assignments/${r.id}`)}>
                    {teacher ? '查看 / 批改' : '查看作业'}
                    <ArrowRight size={13} />
                  </Button>
                ),
              },
            ]}
            pagination={{
              current: page,
              pageSize: 12,
              total: query.data?.total,
              onChange: setPage,
              showSizeChanger: false,
            }}
          />
        </QueryState>
      </Panel>
      <AssessmentCreator kind="assignments" open={open} onClose={() => setOpen(false)} />
    </>
  );
}
function AssessmentEditor({
  kind,
  data,
  open,
  onClose,
}: {
  kind: 'assignments' | 'exams';
  data: any;
  open: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const action = useAction('设置已保存');
  const editRevision = useRef(data.revision);
  const exam = kind === 'exams';
  const draft = data.status === 'draft';
  const dateKeys = exam
    ? [
        'startsAt',
        'endsAt',
        'entryClosesAt',
        'scoreReleaseAt',
        'answerReleaseAt',
        'explanationReleaseAt',
        'commentReleaseAt',
        'appealDeadline',
      ]
    : ['opensAt', 'dueAt'];
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    editRevision.current = data.revision;
    const values: any = { ...data, passScore: data.passCents / 100 };
    for (const key of dateKeys)
      values[key] = data[key]
        ? new Date(new Date(data[key]).getTime() + 8 * 3600000).toISOString().slice(0, 16)
        : '';
    form.setFieldsValue(values);
  }, [open, data.id]);
  async function save(values: any) {
    const body: any = { ...values, revision: editRevision.current };
    for (const key of dateKeys) if (key in body) body[key] = values[key] ? toISO(values[key]) : null;
    if (exam) {
      body.passCents = Math.round(values.passScore * 100);
      delete body.passScore;
    }
    await action.mutateAsync({ path: `/${kind}/${data.id}`, method: 'PATCH', body });
    onClose();
  }
  return (
    <Modal
      title={exam ? '编辑考试草稿' : '编辑作业'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={action.isPending}
      width={760}
      okText="保存修改"
    >
      <Form form={form} layout="vertical" onFinish={save}>
        {!draft && (
          <Alert
            type="info"
            showIcon
            message="已发布作业可修改名称、说明和延后截止时间。其他规则固定，个别学生补交请使用补交授权。"
            style={{ marginBottom: 16 }}
          />
        )}
        <Form.Item
          name="title"
          label={exam ? '考试名称' : '作业名称'}
          rules={[{ required: true, message: '请输入名称' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="description" label={exam ? '考试说明与须知' : '作业说明'}>
          <Input.TextArea rows={4} />
        </Form.Item>
        <div className="info-list">
          {(exam
            ? [
                { key: 'startsAt', label: '考试开始' },
                { key: 'endsAt', label: '考试结束' },
                { key: 'entryClosesAt', label: '最晚进入' },
              ]
            : [...(draft ? [{ key: 'opensAt', label: '开放时间' }] : []), { key: 'dueAt', label: '截止时间' }]
          ).map((field) => (
            <Form.Item
              key={field.key}
              name={field.key}
              label={`${field.label}（北京时间）`}
              rules={[{ required: true, message: '请选择时间' }]}
            >
              <Input type="datetime-local" />
            </Form.Item>
          ))}
          {draft && (
            <Form.Item name="maxAttempts" label="允许提交次数">
              <InputNumber min={1} max={exam ? 10 : 20} />
            </Form.Item>
          )}
          {draft && !exam && (
            <Form.Item name="allowLate" label="允许迟交" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
          {exam && (
            <>
              <Form.Item name="durationMinutes" label="答题时长（分钟）" rules={[{ required: true }]}>
                <InputNumber min={1} max={1440} />
              </Form.Item>
              <Form.Item name="passScore" label="及格分" rules={[{ required: true }]}>
                <InputNumber min={0} precision={2} max={data.totalCents / 100} />
              </Form.Item>
            </>
          )}
        </div>
        {exam && (
          <>
            <Form.Item name="graderIds" label="主观题阅卷教师">
              <RemoteSelect
                endpoint={`/courses/${data.courseId}/members`}
                params={{ kind: 'teacher' }}
                mode="multiple"
              />
            </Form.Item>
            <Space wrap>
              <Form.Item name="shuffleQuestions" label="打乱题目" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="shuffleOptions" label="打乱选项" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="allowBacktrack" label="允许返回上一题" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Space>
            <div className="info-list">
              {[
                { key: 'scoreReleaseAt', label: '成绩公开' },
                { key: 'answerReleaseAt', label: '答案公开' },
                { key: 'explanationReleaseAt', label: '解析公开' },
                { key: 'commentReleaseAt', label: '教师评语公开' },
                { key: 'appealDeadline', label: '复核截止' },
              ].map((field) => (
                <Form.Item key={field.key} name={field.key} label={`${field.label}（可选）`}>
                  <Input type="datetime-local" />
                </Form.Item>
              ))}
            </div>
          </>
        )}
        {!draft && (
          <Form.Item
            name="reason"
            label="修改原因"
            rules={[{ required: true, min: 3, message: '请填写至少 3 字原因' }]}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
        )}
        <p className="form-hint">保存使用版本校验，发生并发修改时请刷新后重新检查。</p>
      </Form>
    </Modal>
  );
}

export function AssignmentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const teacher = isTeacher(user);
  const query = useData(`/assignments/${id}`);
  const [submissionPage, setSubmissionPage] = useState(1);
  const submissions = useData(`/assignments/${id}/submissions?pageSize=15&page=${submissionPage}`, teacher);
  const [rosterPage, setRosterPage] = useState(1);
  const roster = useData(`/assignments/${id}/roster?pageSize=12&page=${rosterPage}`, teacher);
  const [editOpen, setEditOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [lastSaved, setLastSaved] = useState('');
  const submissionKey = useRef(crypto.randomUUID());
  const [grading, setGrading] = useState<any>();
  const [feedback, setFeedback] = useState('');
  const [scores, setScores] = useState<Record<string, any>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [exception, setException] = useState<any>();
  const [exceptionForm] = Form.useForm();
  const action = useAction();
  const { message, modal } = App.useApp();
  const d = query.data;
  const loaded = useRef('');
  useUnsavedWarning(dirty);
  useEffect(() => {
    if (d && loaded.current !== id) {
      setAnswers(answerMap(d.draft?.answers || []));
      setRevision(d.draft?.revision || 0);
      setAttachments((d.draft?.attachmentIds || []).map((id: string) => ({ id, name: '已保存附件' })));
      loaded.current = id || '';
    }
  }, [d, id]);
  const change = (questionId: string, value: any) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setDirty(true);
  };
  async function save() {
    const result = await action.mutateAsync({
      path: `/assignments/${id}/draft`,
      method: 'PUT',
      body: { revision, answers: answerArray(answers), attachmentIds: attachments.map((f) => f.id) },
    });
    setRevision(result.revision);
    setDirty(false);
    setLastSaved(new Date().toISOString());
  }
  async function submit() {
    await action.mutateAsync({
      path: `/assignments/${id}/submit`,
      body: {
        answers: answerArray(answers),
        attachmentIds: attachments.map((f) => f.id),
        idempotencyKey: submissionKey.current,
      },
    });
    setDirty(false);
    submissionKey.current = crypto.randomUUID();
    query.refetch();
  }
  function confirmSubmit() {
    const remaining = d.items.filter((i: any) => !answered(answers[i.questionVersionId])).length;
    modal.confirm({
      title: remaining ? `还有 ${remaining} 道题未作答，确认提交？` : '确认正式提交作业？',
      content: '草稿与正式提交不同。提交后将保存一个独立版本，后续重交保留历史记录。',
      okText: '正式提交',
      cancelText: '继续作答',
      onOk: submit,
    });
  }
  function openGrade(s: any) {
    setGrading(s);
    setFeedback(s.feedback || '');
    const old = s.grading?.[0]?.items || [];
    setScores(Object.fromEntries(old.map((x: any) => [x.questionVersionId, x.scoreCents / 100])));
    setComments(Object.fromEntries(old.map((x: any) => [x.questionVersionId, x.comment])));
  }
  return (
    <QueryState query={query}>
      {d && (
        <>
          <Link to="/assignments" className="back-link">
            ← 返回作业列表
          </Link>
          <PageTitle
            eyebrow="ASSIGNMENT DETAIL"
            title={d.title}
            description={d.description}
            extra={
              <Space>
                {teacher &&
                  user?.permissions.includes('data.export') &&
                  user?.permissions.includes('assessment.grade') && (
                    <SubmissionExportButton assignmentId={id!} />
                  )}
                <Status value={d.status} />
                {teacher && <Button onClick={() => setEditOpen(true)}>编辑作业</Button>}
                {teacher && d.status === 'draft' && (
                  <Popconfirm
                    title="确认发布给已指定的学生？"
                    onConfirm={() => action.mutateAsync({ path: `/assignments/${id}/publish` })}
                  >
                    <Button type="primary">发布作业</Button>
                  </Popconfirm>
                )}
                {teacher && d.status === 'published' && (
                  <Popconfirm
                    title="统一发布已批改的有效结果？"
                    onConfirm={() => action.mutateAsync({ path: `/assignments/${id}/release` })}
                  >
                    <Button type="primary">发布批改结果</Button>
                  </Popconfirm>
                )}
              </Space>
            }
          />
          <AssessmentEditor kind="assignments" data={d} open={editOpen} onClose={() => setEditOpen(false)} />
          <div className="course-detail-summary">
            <span>
              <Clock3 size={16} />
              开放 {date(d.opensAt)}
            </span>
            <span>截止 {date(d.dueAt)}</span>
            <span>满分 {money(d.totalCents)} 分</span>
            <span>
              {d.allowLate ? '允许迟交' : '按时提交'} · 最多 {d.maxAttempts} 次
            </span>
          </div>
          {teacher ? (
            <Tabs
              items={[
                {
                  key: 'submissions',
                  label: '提交与批改',
                  children: (
                    <Panel>
                      <QueryState query={submissions}>
                        <Table
                          rowKey="id"
                          dataSource={submissions.data?.items || []}
                          columns={[
                            { title: '学生', render: (_, r: any) => r.user?.name || r.userId },
                            { title: '提交版本', dataIndex: 'version', render: (v) => `第 ${v} 次` },
                            { title: '提交时间', dataIndex: 'submittedAt', render: (v) => date(v) },
                            {
                              title: '提交状态',
                              render: (_, r: any) => (
                                <Space>
                                  <Status value={r.status} />
                                  {r.late && <Tag color="gold">迟交</Tag>}
                                </Space>
                              ),
                            },
                            {
                              title: '批改状态',
                              dataIndex: 'gradingStatus',
                              render: (v) => <Status value={v} />,
                            },
                            { title: '得分', dataIndex: 'scoreCents', render: money },
                            {
                              title: '操作',
                              render: (_, r: any) => (
                                <Space>
                                  <Button type="link" onClick={() => openGrade(r)}>
                                    {r.releasedAt ? '查看反馈' : '查看 / 批改'}
                                  </Button>
                                  {!r.releasedAt && r.status !== 'returned' && (
                                    <Button
                                      type="link"
                                      onClick={() => {
                                        setException({ type: 'return', submission: r });
                                        exceptionForm.resetFields();
                                      }}
                                    >
                                      退回重做
                                    </Button>
                                  )}
                                </Space>
                              ),
                            },
                          ]}
                          pagination={{
                            current: submissionPage,
                            pageSize: 15,
                            total: submissions.data?.total,
                            onChange: setSubmissionPage,
                          }}
                        />
                      </QueryState>
                    </Panel>
                  ),
                },
                {
                  key: 'roster',
                  label: '应交名单',
                  children: (
                    <Panel>
                      <QueryState query={roster}>
                        <Table
                          rowKey={(r: any) => r.user.id}
                          dataSource={roster.data?.items || []}
                          columns={[
                            { title: '学生', render: (_, r: any) => r.user.name },
                            { title: '状态', dataIndex: 'status', render: label },
                            { title: '提交次数', render: (_, r: any) => r.submission?.version || 0 },
                            {
                              title: '操作',
                              render: (_, r: any) => (
                                <Button
                                  type="link"
                                  onClick={() => {
                                    setException({ type: 'exception', user: r.user });
                                    exceptionForm.resetFields();
                                  }}
                                >
                                  补交 / 豁免授权
                                </Button>
                              ),
                            },
                          ]}
                          pagination={{
                            current: rosterPage,
                            pageSize: 12,
                            total: roster.data?.total,
                            onChange: setRosterPage,
                            showSizeChanger: false,
                          }}
                        />
                      </QueryState>
                    </Panel>
                  ),
                },
                {
                  key: 'paper',
                  label: '作业题目',
                  children: (
                    <Panel>
                      {d.items.map((item: any, index: number) => (
                        <QuestionView
                          key={item.id}
                          question={item.question}
                          index={index}
                          value={undefined}
                          onChange={() => {}}
                          disabled
                          explain
                        />
                      ))}
                    </Panel>
                  ),
                },
              ]}
            />
          ) : (
            <div className="content-two-columns">
              <Panel title="在线作答" description="提交前可以暂存草稿；正式提交后保存独立版本">
                {d.items?.length ? (
                  d.items.map((item: any, index: number) => (
                    <QuestionView
                      key={item.id}
                      question={item.question}
                      index={index}
                      value={answers[item.questionVersionId]}
                      onChange={(value) => change(item.questionVersionId, value)}
                    />
                  ))
                ) : (
                  <EmptyState description="作业尚未开放" />
                )}
                {d.items?.length > 0 && (
                  <>
                    <div style={{ marginTop: 25 }}>
                      <Upload
                        fileList={attachments.map((f) => ({ uid: f.id, name: f.name, status: 'done' }))}
                        onRemove={(file) => {
                          setAttachments(attachments.filter((f) => f.id !== file.uid));
                          setDirty(true);
                        }}
                        customRequest={async (options) => {
                          try {
                            const form = new FormData();
                            form.append('file', options.file as Blob);
                            form.append('assignmentId', id!);
                            const file = await api('/attachments', { method: 'POST', body: form });
                            setAttachments((prev) => [...prev, file]);
                            setDirty(true);
                            options.onSuccess?.(file);
                          } catch (e) {
                            options.onError?.(e as Error);
                            message.error((e as Error).message);
                          }
                        }}
                      >
                        <Button icon={<UploadIcon size={15} />}>添加作业附件</Button>
                      </Upload>
                    </div>
                    <div className="answer-controls">
                      <span className="save-status">
                        {dirty
                          ? '有未保存的修改'
                          : lastSaved
                            ? `已保存于 ${date(lastSaved)}`
                            : '作业草稿已恢复'}
                      </span>
                      <Space>
                        <Button icon={<Save size={15} />} onClick={save} loading={action.isPending}>
                          暂存草稿
                        </Button>
                        <Button
                          type="primary"
                          icon={<Send size={15} />}
                          onClick={confirmSubmit}
                          loading={action.isPending}
                        >
                          正式提交
                        </Button>
                      </Space>
                    </div>
                  </>
                )}
              </Panel>
              <div className="stack">
                <Panel title="提交记录" description="每次提交与对应反馈独立保存">
                  {d.mySubmissions?.length ? (
                    d.mySubmissions.map((s: any) => (
                      <div key={s.id} className="reply-item">
                        <div className="list-title-line">
                          <strong style={{ fontSize: 14 }}>第 {s.version} 次提交</strong>
                          <Status value={s.status} />
                        </div>
                        <p className="form-hint" style={{ margin: '8px 0' }}>
                          提交于 {date(s.submittedAt)}
                          {s.late ? ' · 迟交' : ''}
                        </p>
                        {s.releasedAt ? (
                          <>
                            <Tag color="green">
                              {money(s.scoreCents)} / {money(d.totalCents)} 分
                            </Tag>
                            <p>{s.feedback || '已完成批改'}</p>
                            {s.grading?.map((g: any) => (
                              <div key={g.id} className="form-hint" style={{ marginTop: 10 }}>
                                {g.items?.map((item: any, index: number) => (
                                  <div key={index}>
                                    第{' '}
                                    {d.items.findIndex(
                                      (q: any) => q.questionVersionId === item.questionVersionId,
                                    ) + 1}{' '}
                                    题：{money(item.scoreCents)} 分 {item.comment && `· ${item.comment}`}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </>
                        ) : (
                          <Tag>等待批改结果公开</Tag>
                        )}
                        <Button
                          size="small"
                          type="link"
                          onClick={() =>
                            modal.info({
                              title: `第 ${s.version} 次提交内容`,
                              width: 720,
                              content: (
                                <div>
                                  {d.items.map((item: any, index: number) => (
                                    <div className="reply-item" key={item.id}>
                                      <strong>
                                        {index + 1}. {plainText(item.question.stem)}
                                      </strong>
                                      <p style={{ marginTop: 10 }}>
                                        <AnswerDisplay
                                          value={
                                            s.answers?.find(
                                              (a: any) => a.questionVersionId === item.questionVersionId,
                                            )?.value
                                          }
                                        />
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              ),
                            })
                          }
                        >
                          查看提交内容
                        </Button>
                      </div>
                    ))
                  ) : (
                    <EmptyState description="尚未正式提交" />
                  )}
                </Panel>
                <Alert
                  type="info"
                  showIcon
                  message="草稿不等于正式提交"
                  description="请在截止前点击正式提交。每次重交保留原提交内容与教师批注。"
                />
              </div>
            </div>
          )}
          <Modal
            open={!!grading}
            title={`批改作业 · ${grading?.user?.name || ''} · 第 ${grading?.version} 次提交`}
            width={850}
            onCancel={() => setGrading(undefined)}
            footer={
              <Space>
                <Button onClick={() => setGrading(undefined)}>关闭</Button>
                <Button
                  disabled={!!grading?.releasedAt || grading?.status === 'returned'}
                  loading={action.isPending}
                  onClick={async () => {
                    const items = Object.entries(scores)
                      .filter(([, v]) => v !== null && v !== undefined)
                      .map(([questionVersionId, score]) => ({
                        questionVersionId,
                        scoreCents: Math.round(Number(score) * 100),
                        comment: comments[questionVersionId] || '',
                      }));
                    const saved = await action.mutateAsync({
                      path: `/submissions/${grading.id}/grade`,
                      method: 'PUT',
                      body: { revision: grading.revision, items, comment: feedback, finalize: false },
                    });
                    setGrading({ ...grading, ...saved });
                  }}
                >
                  暂存批改
                </Button>
                <Button
                  type="primary"
                  disabled={!!grading?.releasedAt || grading?.status === 'returned'}
                  loading={action.isPending}
                  onClick={async () => {
                    const items = Object.entries(scores)
                      .filter(([, v]) => v !== null && v !== undefined)
                      .map(([questionVersionId, score]) => ({
                        questionVersionId,
                        scoreCents: Math.round(Number(score) * 100),
                        comment: comments[questionVersionId] || '',
                      }));
                    await action.mutateAsync({
                      path: `/submissions/${grading.id}/grade`,
                      method: 'PUT',
                      body: { revision: grading.revision, items, comment: feedback },
                    });
                    setGrading(undefined);
                  }}
                >
                  保存批改
                </Button>
              </Space>
            }
          >
            {grading && (
              <>
                {d.items.map((item: any, index: number) => (
                  <div className="reply-item" key={item.id}>
                    <QuestionView
                      question={item.question}
                      index={index}
                      value={
                        grading.answers?.find((a: any) => a.questionVersionId === item.questionVersionId)
                          ?.value
                      }
                      onChange={() => {}}
                      disabled
                      explain
                    />
                    <Space style={{ marginTop: 15 }}>
                      <span>本题得分</span>
                      <InputNumber
                        min={0}
                        max={item.question.scoreCents / 100}
                        precision={2}
                        value={scores[item.questionVersionId]}
                        onChange={(value) =>
                          setScores((prev) => ({ ...prev, [item.questionVersionId]: value }))
                        }
                        placeholder="客观题可自动"
                        disabled={!!grading.releasedAt}
                      />
                      <Input
                        value={comments[item.questionVersionId] || ''}
                        placeholder="本题批注"
                        onChange={(e) =>
                          setComments((prev) => ({ ...prev, [item.questionVersionId]: e.target.value }))
                        }
                        disabled={!!grading.releasedAt}
                      />
                    </Space>
                  </div>
                ))}
                <Input.TextArea
                  rows={3}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="给学生的总体反馈"
                  disabled={!!grading.releasedAt}
                />
                {grading.attachmentIds?.map((fileId: string) => (
                  <a className="resource-link" key={fileId} href={`/api/attachments/${fileId}/download`}>
                    下载作业附件
                  </a>
                ))}
              </>
            )}
          </Modal>
          <Modal
            title={exception?.type === 'return' ? '退回重做' : '个别补交与豁免授权'}
            open={!!exception}
            onCancel={() => setException(undefined)}
            onOk={() => exceptionForm.submit()}
          >
            <Form
              form={exceptionForm}
              layout="vertical"
              initialValues={{ extraAttempts: 1, exempt: false }}
              onFinish={async (values) => {
                if (exception.type === 'return')
                  await action.mutateAsync({
                    path: `/submissions/${exception.submission.id}/return`,
                    body: { reason: values.reason },
                  });
                else
                  await action.mutateAsync({
                    path: `/assignments/${id}/exceptions`,
                    body: { ...values, userId: exception.user.id, allowUntil: toISO(values.allowUntil) },
                  });
                setException(undefined);
              }}
            >
              {exception?.type !== 'return' && (
                <>
                  <p className="form-hint">学生：{exception?.user.name}</p>
                  <Form.Item name="allowUntil" label="允许补交至">
                    <Input type="datetime-local" />
                  </Form.Item>
                  <Form.Item name="extraAttempts" label="额外提交次数">
                    <InputNumber min={0} max={20} />
                  </Form.Item>
                  <Form.Item name="exempt" label="豁免本次作业" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </>
              )}
              <Form.Item
                name="reason"
                label="操作原因"
                rules={[{ required: true, min: 3, message: '请填写至少 3 字的原因' }]}
              >
                <Input.TextArea rows={3} />
              </Form.Item>
            </Form>
          </Modal>
        </>
      )}
    </QueryState>
  );
}
export function Practice() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [tab, setTab] = useState(params.get('tab') === 'mistakes' ? 'mistakes' : 'start');
  const [courseId, setCourseId] = useState<string>();
  const [form] = Form.useForm();
  const practiceCourse = Form.useWatch('courseId', form);
  const [recentPage, setRecentPage] = useState(1);
  const recent = useData(`/practice?pageSize=10&page=${recentPage}`);
  const [collectionPage, setCollectionPage] = useState(1);
  const collection = useData(
    `/${tab === 'favorites' ? 'favorites' : 'mistakes'}?${queryString({ courseId, page: collectionPage, pageSize: 10 })}`,
    tab !== 'start',
  );
  const action = useAction('');
  const navigate = useNavigate();
  async function start(values: any) {
    const session = await action.mutateAsync({ path: '/practice', body: values });
    navigate(`/practice/${session.id}`);
  }
  return (
    <>
      <PageTitle
        eyebrow="PRACTICE MAKES PROGRESS"
        title="练习中心"
        description="在练习中理解知识，在错题中找到进步的机会。"
        extra={user?.role === 'STUDENT' && user.permissions.includes('learning.use') ? <Button onClick={() => navigate('/algorithms')}>算法编程练习</Button> : undefined}
      />
      <Tabs
        activeKey={tab}
        onChange={(v) => {
          setTab(v);
          setCollectionPage(1);
        }}
        items={[
          { key: 'start', label: '开始练习' },
          { key: 'mistakes', label: '我的错题本' },
          { key: 'favorites', label: '收藏题目' },
        ]}
      />
      {tab === 'start' ? (
        <div className="content-two-columns">
          <Panel title="定制一次练习" description="根据课程、知识点和难度选择适合你的练习">
            <Form
              form={form}
              layout="vertical"
              initialValues={{
                mode: 'random',
                courseId: params.get('courseId') || undefined,
                chapterId: params.get('chapterId') || undefined,
              }}
              onFinish={start}
            >
              <Form.Item name="courseId" label="练习课程" rules={[{ required: true, message: '请选择课程' }]}>
                <CourseSelect
                  allowClear={false}
                  onChange={() => form.setFieldValue('chapterId', undefined)}
                />
              </Form.Item>
              <Form.Item name="chapterId" label="课程章节（可选）">
                <ChapterSelect courseId={practiceCourse} />
              </Form.Item>
              <div className="info-list">
                <Form.Item name="mode" label="练习方式">
                  <Select
                    options={[
                      { value: 'random', label: '随机练习' },
                      { value: 'mistakes', label: '错题复习' },
                      { value: 'favorites', label: '收藏题练习' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="count" label="题目数量">
                  <InputNumber
                    min={1}
                    max={100}
                    placeholder="留空按实际题库选择，最多 10 题"
                    style={{ width: '100%' }}
                  />
                </Form.Item>
                <Form.Item name="type" label="题型">
                  <Select allowClear placeholder="全部题型" options={typeOptions} />
                </Form.Item>
                <Form.Item name="difficulty" label="难度">
                  <Select
                    allowClear
                    placeholder="全部难度"
                    options={[1, 2, 3, 4, 5].map((value) => ({
                      value,
                      label: ['基础', '较易', '适中', '较难', '挑战'][value - 1],
                    }))}
                  />
                </Form.Item>
              </div>
              <Form.Item name="knowledgePoint" label="知识点（可选）">
                <Input placeholder="输入需要巩固的知识点" />
              </Form.Item>
              <Button type="primary" htmlType="submit" icon={<Play size={15} />} loading={action.isPending}>
                开始练习
              </Button>
            </Form>
          </Panel>
          <Panel title="最近练习" description="学习进度自动保存，随时继续">
            <QueryState query={recent}>
              {recent.data?.items?.length ? (
                recent.data.items.map((s: any) => (
                  <Link key={s.id} to={`/practice/${s.id}`} className="task-item">
                    <div className="task-icon">
                      <PenLine size={17} />
                    </div>
                    <div className="task-body">
                      <h3>{s.status === 'completed' ? '查看练习报告' : '继续上次练习'}</h3>
                      <div>
                        {date(s.createdAt)} · 已答 {s._count?.answers || 0} 题
                      </div>
                    </div>
                    <ArrowRight size={15} />
                  </Link>
                ))
              ) : (
                <EmptyState description="从一次练习开始积累" />
              )}
            </QueryState>
            <Pagination
              current={recentPage}
              pageSize={10}
              total={recent.data?.total}
              onChange={setRecentPage}
              showSizeChanger={false}
              hideOnSinglePage
            />
          </Panel>
        </div>
      ) : (
        <>
          <div className="filter-bar">
            <CourseSelect
              value={courseId}
              onChange={(v) => {
                setCourseId(v);
                setCollectionPage(1);
              }}
            />
            <Button
              type="primary"
              disabled={!courseId}
              loading={action.isPending}
              onClick={() => start({ courseId, mode: tab })}
            >
              {tab === 'mistakes' ? '开始错题复习' : '练习收藏题目'}
            </Button>
            {tab === 'mistakes' && user?.role === 'STUDENT' && user.permissions.includes('learning.use') && (
              <Link to={`/ai-study${courseId ? `?courseId=${encodeURIComponent(courseId)}` : ''}`}>
                <Button icon={<BrainCircuit size={16} />}>AI 分析错因</Button>
              </Link>
            )}
          </div>
          <Panel>
            <QueryState query={collection}>
              <Table
                rowKey="id"
                dataSource={collection.data?.items || []}
                columns={[
                  {
                    title: '题目',
                    render: (_, r: any) => (
                      <div>
                        <strong className="table-title">
                          {plainText(r.question?.stem) || '此题已停止开放练习'}
                        </strong>
                        <div className="table-secondary">{r.question?.knowledgePoints?.join(' · ')}</div>
                      </div>
                    ),
                  },
                  {
                    title: tab === 'mistakes' ? '答错次数' : '收藏时间',
                    render: (_, r: any) => (tab === 'mistakes' ? `${r.wrongCount} 次` : date(r.createdAt)),
                  },
                  {
                    title: '状态',
                    render: (_, r: any) => (
                      <Tag color={r.mastered ? 'green' : undefined}>
                        {!r.available ? '不可练习' : r.mastered ? '已掌握' : '待巩固'}
                      </Tag>
                    ),
                  },
                  {
                    title: '操作',
                    render: (_, r: any) => (
                      <Space>
                        {r.available && (
                          <Button
                            type="link"
                            onClick={() =>
                              start({
                                courseId: r.courseId,
                                mode: tab,
                                questionIds: [r.questionId],
                                count: 1,
                              })
                            }
                          >
                            重新练习
                          </Button>
                        )}
                        {tab === 'mistakes' &&
                          r.available &&
                          user?.role === 'STUDENT' &&
                          user.permissions.includes('learning.use') && (
                            <Link
                              to={`/ai-study?${queryString({ mistake: r.id, page: collectionPage, courseId })}`}
                            >
                              <Button type="link">AI 复盘</Button>
                            </Link>
                          )}
                        {tab === 'mistakes' ? (
                          <Button
                            type="link"
                            onClick={() =>
                              action.mutate({
                                path: `/mistakes/${r.id}`,
                                method: 'PATCH',
                                body: { mastered: !r.mastered },
                              })
                            }
                          >
                            {r.mastered ? '继续巩固' : '标为掌握'}
                          </Button>
                        ) : (
                          <Button
                            type="link"
                            onClick={() =>
                              action.mutate({
                                path: `/questions/${r.questionId}/favorite`,
                                method: 'PUT',
                                body: { favorite: false },
                              })
                            }
                          >
                            取消收藏
                          </Button>
                        )}
                      </Space>
                    ),
                  },
                ]}
                pagination={{
                  current: collectionPage,
                  pageSize: 10,
                  total: collection.data?.total,
                  onChange: setCollectionPage,
                  showSizeChanger: false,
                }}
              />
            </QueryState>
          </Panel>
        </>
      )}
    </>
  );
}
export function PracticeSession() {
  const { id } = useParams();
  const query = useData(`/practice/${id}`);
  const d = query.data;
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState<any>();
  const [flagged, setFlagged] = useState<string[]>([]);
  const revision = useRef(0);
  const [progressReady, setProgressReady] = useState(false);
  const loaded = useRef('');
  const desired = useRef({ currentPosition: 0, flags: [] as string[] });
  const savedProgress = useRef('');
  const savingProgress = useRef(false);
  const progressConflict = useRef(false);
  const [progressStatus, setProgressStatus] = useState('已保存练习位置');
  const restore = (data: any) => {
    revision.current = data.revision || 0;
    const current = { currentPosition: data.currentPosition || 0, flags: data.flags || [] };
    desired.current = current;
    savedProgress.current = JSON.stringify(current);
    progressConflict.current = false;
    setIndex(current.currentPosition);
    setFlagged(current.flags);
    setProgressStatus('已保存练习位置');
    setProgressReady(true);
  };
  useEffect(() => {
    if (d && loaded.current !== id) {
      loaded.current = id || '';
      restore(d);
    }
  }, [d, id]);
  async function persistProgress() {
    if (savingProgress.current || progressConflict.current || loaded.current !== id) return;
    const payload = { ...desired.current };
    const signature = JSON.stringify(payload);
    if (signature === savedProgress.current) return;
    savingProgress.current = true;
    setProgressStatus('正在保存练习位置…');
    let success = false;
    try {
      const result = await send(
        `/practice/${id}/progress`,
        { ...payload, revision: revision.current },
        'PUT',
      );
      revision.current = result.revision;
      savedProgress.current = signature;
      success = true;
      setProgressStatus(JSON.stringify(desired.current) === signature ? '已保存练习位置' : '练习位置未同步');
    } catch (error) {
      progressConflict.current = error instanceof ApiError && error.status === 409;
      setProgressStatus(
        progressConflict.current ? '其他页面已修改练习位置，请载入服务器版本' : '练习位置未同步，请重试',
      );
    } finally {
      savingProgress.current = false;
      if (success && JSON.stringify(desired.current) !== signature) void persistProgress();
    }
  }
  useEffect(() => {
    if (!progressReady || loaded.current !== id) return;
    desired.current = { currentPosition: index, flags: flagged };
    if (JSON.stringify(desired.current) === savedProgress.current) return;
    setProgressStatus('练习位置未同步');
    const timer = setTimeout(() => void persistProgress(), 350);
    return () => clearTimeout(timer);
  }, [index, flagged, progressReady]);
  useEffect(() => {
    const online = () => void persistProgress();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [id]);
  useUnsavedWarning(progressStatus.includes('未同步') || progressStatus.includes('正在保存'));
  const action = useAction('');
  const [report, setReport] = useState(false);
  const question = d?.items?.[index];
  const saved = d?.answers?.find((a: any) => a.questionVersionId === qid(question || {}));
  useEffect(() => {
    setValue(saved?.value);
  }, [index, saved?.questionVersionId]);
  async function answer() {
    await action.mutateAsync({
      path: `/practice/${id}/answer`,
      body: { questionVersionId: qid(question), value },
    });
    query.refetch();
  }
  const currentReport = d?.report;
  return (
    <QueryState query={query}>
      {d && (
        <>
          <Link to="/practice" className="back-link">
            ← 返回练习中心
          </Link>
          <PageTitle
            eyebrow="FOCUSED PRACTICE"
            title={report ? '本次练习报告' : '专注练习，稳步进阶'}
            description={currentReport?.note || '单题提交后显示答案与解析。主观题请对照参考答案复盘。'}
            extra={<Button onClick={() => setReport(!report)}>{report ? '返回答题' : '查看报告'}</Button>}
          />
          <div className="form-hint" style={{ marginBottom: 16 }}>
            {progressStatus}
            {progressStatus.includes('未同步') && (
              <Button size="small" type="link" onClick={() => void persistProgress()}>
                重试保存
              </Button>
            )}
            {progressConflict.current && (
              <Button
                size="small"
                type="link"
                onClick={async () => {
                  const fresh = await query.refetch();
                  if (fresh.data) restore(fresh.data);
                }}
              >
                载入服务器版本
              </Button>
            )}
          </div>
          {report ? (
            <>
              <Metrics
                items={[
                  {
                    label: '已完成题目',
                    value: `${currentReport?.answered || 0} / ${currentReport?.total || 0}`,
                    detail: '本次练习实际作答情况',
                  },
                  {
                    label: '客观题正确',
                    value: currentReport?.correct || 0,
                    detail: `可自动评分 ${currentReport?.objectivelyScored || 0} 题`,
                  },
                  {
                    label: '客观正确率',
                    value: currentReport?.objectivelyScored
                      ? `${Math.round((currentReport.correct / currentReport.objectivelyScored) * 100)}%`
                      : '数据不足',
                    detail: '正确数 / 已评分客观题数',
                  },
                  { label: '已得分', value: money(currentReport?.scoreCents), detail: '主观题不计自动得分' },
                ]}
              />
              <Panel title="作答回顾">
                {d.items.map((q: any, i: number) => (
                  <QuestionView
                    question={q}
                    index={i}
                    key={qid(q)}
                    value={d.answers.find((a: any) => a.questionVersionId === qid(q))?.value}
                    onChange={() => {}}
                    disabled
                    explain
                  />
                ))}
              </Panel>
            </>
          ) : (
            <div className="content-two-columns">
              <Panel>
                {question && (
                  <>
                    <div className="list-title-line">
                      <span className="form-hint">
                        题目 {index + 1} / {d.items.length}
                      </span>
                      <Button
                        type="text"
                        icon={<Bookmark size={16} />}
                        onClick={() =>
                          action.mutate({
                            path: `/questions/${question.questionId}/favorite`,
                            method: 'PUT',
                            body: { favorite: true },
                          })
                        }
                      >
                        收藏此题
                      </Button>
                    </div>
                    <QuestionView
                      question={question}
                      index={index}
                      value={saved?.value ?? value}
                      onChange={setValue}
                      disabled={!!saved}
                      explain={!!saved}
                    />
                    {saved && (
                      <Alert
                        style={{ marginTop: 20 }}
                        showIcon
                        type={
                          saved.correct === true ? 'success' : saved.correct === false ? 'warning' : 'info'
                        }
                        message={
                          saved.correct === true
                            ? '回答正确，继续保持'
                            : saved.correct === false
                              ? '这一题值得再想一想，错题记录已保存'
                              : '主观题已记录，请对照评分参考自我复盘'
                        }
                      />
                    )}
                    <div className="answer-controls">
                      <Button
                        disabled={index === 0}
                        icon={<ArrowLeft size={15} />}
                        onClick={() => setIndex(index - 1)}
                      >
                        上一题
                      </Button>
                      <Space>
                        <Button
                          icon={<Flag size={14} />}
                          onClick={() =>
                            setFlagged(
                              flagged.includes(qid(question))
                                ? flagged.filter((x) => x !== qid(question))
                                : [...flagged, qid(question)],
                            )
                          }
                        >
                          {flagged.includes(qid(question)) ? '取消标记' : '稍后复习'}
                        </Button>
                        {!saved ? (
                          <Button
                            type="primary"
                            onClick={answer}
                            disabled={!answered(value)}
                            loading={action.isPending}
                          >
                            提交本题
                          </Button>
                        ) : (
                          <Button
                            type="primary"
                            onClick={() =>
                              index === d.items.length - 1 ? setReport(true) : setIndex(index + 1)
                            }
                          >
                            {index === d.items.length - 1 ? '查看练习报告' : '下一题'}
                            <ArrowRight size={15} />
                          </Button>
                        )}
                      </Space>
                    </div>
                  </>
                )}
              </Panel>
              <Panel title="答题卡" description={`已作答 ${d.answers.length} / ${d.items.length} 题`}>
                <div className="answer-sheet">
                  {d.items.map((q: any, i: number) => (
                    <button
                      key={qid(q)}
                      aria-label={`第 ${i + 1} 题`}
                      onClick={() => setIndex(i)}
                      className={`${i === index ? 'current' : ''} ${d.answers.some((a: any) => a.questionVersionId === qid(q)) ? 'answered' : ''} ${flagged.includes(qid(q)) ? 'flagged' : ''}`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
                <div className="sheet-legend">
                  <span>
                    <i className="sheet-dot saved" />
                    已作答
                  </span>
                  <span>
                    <i className="sheet-dot" />
                    未作答
                  </span>
                  <span>
                    <i className="sheet-dot flag" />
                    已标记
                  </span>
                </div>
              </Panel>
            </div>
          )}
        </>
      )}
    </QueryState>
  );
}
export function Exams() {
  const { user } = useAuth();
  const teacher = isTeacher(user);
  const [params] = useSearchParams();
  const [courseId, setCourseId] = useState(params.get('courseId') || undefined);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const query = useData(`/exams?${queryString({ courseId, search, page, pageSize: 12 })}`);
  return (
    <>
      <PageTitle
        eyebrow="EXAMINATION CENTER"
        title={teacher ? '考试管理' : '在线考试'}
        description={
          teacher
            ? '安排考试、管理阅卷，在每一个环节保留清晰记录。'
            : '确认考试安排，做好准备，从容检验学习成果。'
        }
        extra={
          teacher && (
            <Button type="primary" icon={<Plus size={16} />} onClick={() => setOpen(true)}>
              创建考试
            </Button>
          )
        }
      />
      <div className="filter-bar">
        <Input.Search
          placeholder="搜索考试名称"
          allowClear
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
          style={{ maxWidth: 300 }}
        />
        <CourseSelect
          value={courseId}
          onChange={(value) => {
            setCourseId(value);
            setPage(1);
          }}
        />
        <span className="filter-count">共 {query.data?.total || 0} 场考试</span>
      </div>
      <Panel>
        <QueryState query={query}>
          <Table
            rowKey="id"
            dataSource={query.data?.items || []}
            columns={[
              {
                title: '考试名称',
                render: (_, r: any) => (
                  <div>
                    <Link to={`/exams/${r.id}`} className="table-title">
                      {r.title}
                    </Link>
                    <div className="table-secondary">
                      {r.durationMinutes} 分钟 · 满分 {money(r.totalCents)} 分
                    </div>
                  </div>
                ),
              },
              {
                title: '考试时间',
                render: (_, r: any) => (
                  <div>
                    {date(r.startsAt)}
                    <div className="table-secondary">至 {date(r.endsAt)}</div>
                  </div>
                ),
              },
              { title: '考试状态', render: (_, r: any) => <Status value={r.status} /> },
              {
                title: teacher ? '作答次数 / 应考人数' : '我的状态',
                render: (_, r: any) =>
                  teacher ? (
                    `${r._count?.attempts || 0} / ${r._count?.audience || 0}`
                  ) : r.attempts?.[0] ? (
                    <Status value={r.attempts[0].status} />
                  ) : (
                    <Tag>尚未参加</Tag>
                  ),
              },
              {
                title: '操作',
                render: (_, r: any) => (
                  <Link className="inline-link" to={`/exams/${r.id}`}>
                    {teacher ? '管理考试' : '查看考试'}
                    <ArrowRight size={13} />
                  </Link>
                ),
              },
            ]}
            pagination={{
              current: page,
              total: query.data?.total,
              pageSize: 12,
              onChange: setPage,
              showSizeChanger: false,
            }}
          />
        </QueryState>
      </Panel>
      <AssessmentCreator kind="exams" open={open} onClose={() => setOpen(false)} />
    </>
  );
}
function QuestionGrading({ exam }: { exam: any }) {
  const [questionId, setQuestionId] = useState<string>();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>();
  const selected = questionId || (exam.items?.[0] && qid(exam.items[0]));
  const query = useData(
    `/exams/${exam.id}/questions/${selected}/answers?${queryString({ page, pageSize: 10, status })}`,
    !!selected,
  );
  const [edits, setEdits] = useState<
    Record<string, { score?: number | null; comment?: string; revision?: number }>
  >({});
  const action = useAction('本题评分已保存，其他题目评分保留');
  const question = query.data?.question;
  function update(id: string, value: any, revision: number) {
    setEdits((previous) => ({ ...previous, [id]: { revision, ...previous[id], ...value } }));
  }
  return (
    <Panel
      title="按题集中阅卷"
      description="选择一道题，依次批阅当前考试中的已交答卷。修改时校验答卷评分版本。"
    >
      <div className="filter-bar">
        <Select
          style={{ minWidth: 280, maxWidth: '100%' }}
          value={selected}
          onChange={(value) => {
            setQuestionId(value);
            setPage(1);
            setEdits({});
          }}
          options={(exam.items || []).map((q: any, index: number) => ({
            value: qid(q),
            label: `第 ${index + 1} 题 · ${plainText(q.stem).slice(0, 45)}`,
          }))}
        />
        <Select
          allowClear
          style={{ width: 180 }}
          placeholder="全部阅卷状态"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={[
            { value: 'pending', label: '待完成阅卷' },
            { value: 'graded', label: '已完成阅卷' },
          ]}
        />
      </div>
      {question && (
        <QuestionView
          question={question}
          index={(exam.items || []).findIndex((item: any) => qid(item) === selected)}
          value={undefined}
          onChange={() => {}}
          disabled
          explain
        />
      )}
      <QueryState query={query}>
        <Table
          rowKey="id"
          dataSource={query.data?.items || []}
          scroll={{ x: 780 }}
          pagination={{
            current: page,
            pageSize: 10,
            total: query.data?.total,
            onChange: setPage,
            showSizeChanger: false,
          }}
          columns={[
            {
              title: '学生 / 次数',
              width: 140,
              render: (_, row: any) => (
                <div>
                  {row.user?.name || row.userId}
                  <div className="table-secondary">
                    第 {row.number} 次 · {label(row.gradingStatus)}
                  </div>
                </div>
              ),
            },
            { title: '本题作答', render: (_, row: any) => <AnswerDisplay value={row.answer?.value} /> },
            {
              title: '得分',
              width: 120,
              render: (_, row: any) => (
                <InputNumber
                  aria-label={`${row.user?.name || row.userId}的本题得分`}
                  min={0}
                  max={(question?.scoreCents || 0) / 100}
                  precision={2}
                  value={
                    edits[row.id]?.score !== undefined
                      ? edits[row.id].score
                      : row.answer?.scoreCents == null
                        ? null
                        : row.answer.scoreCents / 100
                  }
                  onChange={(value) => update(row.id, { score: value }, row.gradingRevision)}
                  disabled={row.releaseStatus === 'released'}
                />
              ),
            },
            {
              title: '本题评语',
              width: 220,
              render: (_, row: any) => (
                <Input.TextArea
                  rows={2}
                  value={edits[row.id]?.comment ?? row.answer?.comment ?? ''}
                  onChange={(event) => update(row.id, { comment: event.target.value }, row.gradingRevision)}
                  disabled={row.releaseStatus === 'released'}
                />
              ),
            },
            {
              title: '操作',
              width: 130,
              render: (_, row: any) => (
                <Button
                  type="link"
                  disabled={
                    row.releaseStatus === 'released' ||
                    edits[row.id]?.score === null ||
                    (edits[row.id]?.score ?? row.answer?.scoreCents) == null
                  }
                  loading={action.isPending}
                  onClick={async () => {
                    const edit = edits[row.id] || {};
                    const score =
                      edit.score === undefined
                        ? row.answer?.scoreCents
                        : Math.round(Number(edit.score) * 100);
                    await action.mutateAsync({
                      path: `/attempts/${row.id}/grade`,
                      method: 'PUT',
                      body: {
                        revision: edit.revision ?? row.gradingRevision,
                        items: [
                          {
                            questionVersionId: selected,
                            scoreCents: score,
                            comment: edit.comment ?? row.answer?.comment ?? '',
                          },
                        ],
                      },
                    });
                    setEdits((previous) => {
                      const next = { ...previous };
                      delete next[row.id];
                      return next;
                    });
                  }}
                >
                  {row.releaseStatus === 'released' ? '成绩已发布' : '保存本题评分'}
                </Button>
              ),
            },
          ]}
        />
      </QueryState>
    </Panel>
  );
}

export function ExamDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const teacher = isTeacher(user);
  const query = useData(`/exams/${id}`);
  const [page, setPage] = useState(1);
  const attempts = useData(`/exams/${id}/attempts?pageSize=15&page=${page}`, teacher);
  const [rosterPage, setRosterPage] = useState(1);
  const roster = useData(`/exams/${id}/roster?pageSize=12&page=${rosterPage}`, teacher);
  const [editOpen, setEditOpen] = useState(false);
  const action = useAction('');
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [exception, setException] = useState<any>();
  const [exceptionForm] = Form.useForm();
  const d = query.data;
  const now = d ? new Date(d.serverTime) : new Date();
  const canStart =
    d &&
    d.status === 'published' &&
    d.eligible &&
    new Date(d.startsAt) <= now &&
    new Date(d.entryClosesAt) >= now;
  return (
    <QueryState query={query}>
      {d && (
        <>
          <Link to="/exams" className="back-link">
            ← 返回考试列表
          </Link>
          <PageTitle
            eyebrow="EXAM DETAILS"
            title={d.title}
            description={d.description}
            extra={
              <Space>
                <Status value={d.status} />
                {teacher && d.status === 'draft' && (
                  <Button onClick={() => setEditOpen(true)}>编辑考试</Button>
                )}
                {teacher && d.status !== 'cancelled' && (
                  <Button danger onClick={() => setCancelOpen(true)}>
                    取消考试
                  </Button>
                )}
                {teacher && d.status === 'draft' && (
                  <Popconfirm
                    title="发布后试卷和关键规则将冻结，确认发布？"
                    onConfirm={() => action.mutateAsync({ path: `/exams/${id}/publish` })}
                  >
                    <Button type="primary">发布考试</Button>
                  </Popconfirm>
                )}
                {teacher && d.status === 'published' && (
                  <Popconfirm
                    title="发布已完成阅卷的成绩？成绩仍按照公开时间对学生可见。"
                    onConfirm={() => action.mutateAsync({ path: `/exams/${id}/release` })}
                  >
                    <Button type="primary">发布成绩</Button>
                  </Popconfirm>
                )}
              </Space>
            }
          />
          <AssessmentEditor kind="exams" data={d} open={editOpen} onClose={() => setEditOpen(false)} />
          <Modal
            title="取消考试"
            open={cancelOpen}
            onCancel={() => setCancelOpen(false)}
            okText="确认取消考试"
            okButtonProps={{ danger: true, disabled: cancelReason.trim().length < 3 }}
            confirmLoading={action.isPending}
            onOk={async () => {
              await action.mutateAsync({ path: `/exams/${id}/cancel`, body: { reason: cancelReason } });
              setCancelOpen(false);
              setCancelReason('');
            }}
          >
            <Alert
              type="warning"
              showIcon
              message="取消后学生无法进入，正在作答的答卷也将取消。历史记录保留并通知学生。"
              style={{ marginBottom: 16 }}
            />
            <Input.TextArea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="填写至少 3 字的取消原因"
            />
          </Modal>
          <Panel
            title="考试安排"
            description="考试截止由服务器决定；个人截止为作答时长与考试窗口结束时间中的较早时间"
          >
            <dl className="info-list">
              <div>
                <dt>考试开始</dt>
                <dd>{date(d.startsAt)}</dd>
              </div>
              <div>
                <dt>考试结束</dt>
                <dd>{date(d.endsAt)}</dd>
              </div>
              <div>
                <dt>最晚进入时间</dt>
                <dd>{date(d.entryClosesAt)}</dd>
              </div>
              <div>
                <dt>考试时长</dt>
                <dd>{d.durationMinutes} 分钟</dd>
              </div>
              <div>
                <dt>试卷分值</dt>
                <dd>
                  满分 {money(d.totalCents)} 分 / 及格 {money(d.passCents)} 分
                </dd>
              </div>
              <div>
                <dt>作答规则</dt>
                <dd>
                  {d.maxAttempts} 次机会 · {d.allowBacktrack ? '允许返回上一题' : '不能返回上一题'}
                </dd>
              </div>
              <div>
                <dt>成绩公开时间</dt>
                <dd>{d.scoreReleaseAt ? date(d.scoreReleaseAt) : '等待教师发布设置'}</dd>
              </div>
              <div>
                <dt>教师评语公开时间</dt>
                <dd>{d.commentReleaseAt ? date(d.commentReleaseAt) : '随实际成绩公开'}</dd>
              </div>
              <div>
                <dt>复核申请截止</dt>
                <dd>{date(d.appealDeadline)}</dd>
              </div>
            </dl>
          </Panel>
          {teacher ? (
            <Tabs
              style={{ marginTop: 23 }}
              items={[
                {
                  key: 'attempts',
                  label: '答卷与阅卷',
                  children: (
                    <Panel>
                      <QueryState query={attempts}>
                        <Table
                          rowKey="id"
                          dataSource={attempts.data?.items || []}
                          columns={[
                            { title: '学生', render: (_, r: any) => r.user?.name || r.userId },
                            { title: '作答次数', dataIndex: 'number' },
                            { title: '交卷状态', dataIndex: 'status', render: (v) => <Status value={v} /> },
                            {
                              title: '阅卷状态',
                              dataIndex: 'gradingStatus',
                              render: (v) => <Status value={v} />,
                            },
                            { title: '发布状态', dataIndex: 'releaseStatus', render: label },
                            { title: '总分', dataIndex: 'scoreCents', render: money },
                            {
                              title: '操作',
                              render: (_, r: any) => (
                                <Link to={`/grading/exam/${r.id}`} className="inline-link">
                                  查看 / 阅卷
                                  <ArrowRight size={13} />
                                </Link>
                              ),
                            },
                          ]}
                          pagination={{
                            current: page,
                            pageSize: 15,
                            total: attempts.data?.total,
                            onChange: setPage,
                          }}
                        />
                      </QueryState>
                    </Panel>
                  ),
                },
                { key: 'question-grading', label: '按题阅卷', children: <QuestionGrading exam={d} /> },
                { key: 'item-analysis', label: '题目分析', children: <ExamItemAnalysis exam={d} /> },
                {
                  key: 'roster',
                  label: '参考名单与异常处理',
                  children: (
                    <Panel>
                      <QueryState query={roster}>
                        <Table
                          rowKey={(r: any) => r.user?.id}
                          dataSource={roster.data?.items || []}
                          columns={[
                            { title: '姓名', render: (_, r: any) => r.user?.name },
                            { title: '状态', dataIndex: 'status', render: label },
                            {
                              title: '参考资格',
                              dataIndex: 'eligible',
                              render: (v) => (v ? '正常' : '已撤销'),
                            },
                            {
                              title: '操作',
                              render: (_, r: any) => (
                                <Space>
                                  <Button
                                    type="link"
                                    onClick={() => {
                                      setException({ type: 'extension', user: r.user });
                                      exceptionForm.resetFields();
                                    }}
                                  >
                                    延时 / 补考
                                  </Button>
                                  <Button
                                    type="link"
                                    danger={r.eligible}
                                    onClick={() => {
                                      setException({
                                        type: 'eligibility',
                                        user: r.user,
                                        eligible: !r.eligible,
                                      });
                                      exceptionForm.resetFields();
                                    }}
                                  >
                                    {r.eligible ? '撤销资格' : '恢复资格'}
                                  </Button>
                                </Space>
                              ),
                            },
                          ]}
                          pagination={{
                            current: rosterPage,
                            pageSize: 12,
                            total: roster.data?.total,
                            onChange: setRosterPage,
                            showSizeChanger: false,
                          }}
                        />
                      </QueryState>
                    </Panel>
                  ),
                },
                {
                  key: 'paper',
                  label: '试卷快照',
                  children: (
                    <Panel>
                      {d.items?.map((q: any, index: number) => (
                        <QuestionView
                          key={qid(q)}
                          question={q}
                          index={index}
                          value={undefined}
                          onChange={() => {}}
                          disabled
                          explain
                        />
                      ))}
                    </Panel>
                  ),
                },
              ]}
            />
          ) : (
            <div className="content-two-columns" style={{ marginTop: 23 }}>
              <Panel title="考试须知">
                <ol className="instructions">
                  <li>请确认网络连接稳定，使用一个设备与一个标签页作答。</li>
                  <li>答案会在修改后自动保存，请留意“已同步”状态和最后同步时间。</li>
                  <li>断网时答案只保留在当前浏览器，恢复网络并成功同步后才算保存。</li>
                  <li>到达个人截止时间，服务器自动收卷；未同步的本地答案可能无法接收。</li>
                  <li>提交前请检查答题卡。正式交卷后不能继续修改本次答卷。</li>
                  <li>成绩、标准答案与解析按照教师设置的时间分别公开。</li>
                </ol>
                <Checkbox
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  style={{ marginTop: 20, fontSize: 12 }}
                >
                  我已阅读并理解考试须知
                </Checkbox>
                <div className="action-row">
                  <Button
                    type="primary"
                    size="large"
                    icon={<Play size={17} />}
                    disabled={
                      !agreed || (!canStart && !d.attempts?.some((a: any) => a.status === 'in_progress'))
                    }
                    loading={action.isPending}
                    onClick={async () => {
                      const attempt = await action.mutateAsync({ path: `/exams/${id}/start` });
                      navigate(`/exam-attempts/${attempt.id}`);
                    }}
                  >
                    {d.attempts?.some((a: any) => a.status === 'in_progress') ? '继续考试' : '开始考试'}
                  </Button>
                </div>
                {!canStart && !d.attempts?.some((a: any) => a.status === 'in_progress') && (
                  <p className="form-hint" style={{ textAlign: 'right', margin: '12px 0 0' }}>
                    {!d.eligible
                      ? '当前没有有效参考资格'
                      : new Date(d.startsAt) > now
                        ? '尚未到考试开始时间'
                        : '已超过允许进入时间或考试尚未发布'}
                  </p>
                )}
              </Panel>
              <Panel title="我的作答记录">
                {d.attempts?.length ? (
                  d.attempts.map((a: any) => (
                    <Link to={`/exam-attempts/${a.id}`} key={a.id} className="task-item">
                      <div className="task-icon task-exam">
                        <FileCheck2 size={17} />
                      </div>
                      <div className="task-body">
                        <h3>第 {a.number} 次作答</h3>
                        <p style={{ marginBottom: 7 }}>
                          <Status value={a.status} />
                        </p>
                        <div>{date(a.startedAt)}</div>
                      </div>
                      <ArrowRight size={15} />
                    </Link>
                  ))
                ) : (
                  <EmptyState description="你还没有参加这场考试" />
                )}
              </Panel>
            </div>
          )}
          <Modal
            title={exception?.type === 'extension' ? '个别延时 / 补考授权' : '变更参考资格'}
            open={!!exception}
            onCancel={() => setException(undefined)}
            onOk={() => exceptionForm.submit()}
          >
            <Form
              form={exceptionForm}
              layout="vertical"
              initialValues={{ extraAttempts: 0 }}
              onFinish={async (values) => {
                await action.mutateAsync({
                  path: `/exams/${id}/${exception.type === 'extension' ? 'extensions' : 'eligibility'}`,
                  method: exception.type === 'extension' ? 'POST' : 'PUT',
                  body:
                    exception.type === 'extension'
                      ? { ...values, userId: exception.user.id, deadlineAt: toISO(values.deadlineAt) }
                      : { userId: exception.user.id, eligible: exception.eligible, reason: values.reason },
                });
                setException(undefined);
              }}
            >
              <p className="form-hint">学生：{exception?.user?.name}</p>
              {exception?.type === 'extension' && (
                <>
                  <Form.Item
                    name="deadlineAt"
                    label="个人截止时间"
                    rules={[{ required: true, message: '请选择时间' }]}
                  >
                    <Input type="datetime-local" />
                  </Form.Item>
                  <Form.Item name="extraAttempts" label="额外作答次数">
                    <InputNumber min={0} max={10} />
                  </Form.Item>
                </>
              )}
              <Form.Item
                name="reason"
                label="审批原因"
                rules={[{ required: true, min: 3, message: '请填写至少 3 字的原因' }]}
              >
                <Input.TextArea rows={3} />
              </Form.Item>
            </Form>
          </Modal>
        </>
      )}
    </QueryState>
  );
}
export function ExamAttempt() {
  const { id } = useParams();
  const { user } = useAuth();
  const query = useData(`/attempts/${id}`);
  const d = query.data;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [flags, setFlags] = useState<string[]>([]);
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving' | 'offline' | 'conflict'>('saved');
  const [lastSaved, setLastSaved] = useState<string>();
  const [remaining, setRemaining] = useState(0);
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealReason, setAppealReason] = useState('');
  const action = useAction('复核申请已提交');
  const { modal, message } = App.useApp();
  const loaded = useRef('');
  const revision = useRef(0);
  const latest = useRef<Record<string, any>>({});
  const pending = useRef<Record<string, any>>({});
  const flagsRef = useRef<string[]>([]);
  const position = useRef(0);
  const needsMeta = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const blocked = useRef(false);
  const offset = useRef(0);
  const submitKey = useRef(crypto.randomUUID());
  const autoSubmitted = useRef(false);
  const draftKey = `zhixue:exam:${user?.id}:${id}`;
  const [unsynced, setUnsynced] = useState(false);
  useUnsavedWarning(unsynced && d?.status === 'in_progress');
  function storeDraft() {
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          revision: revision.current,
          pending: pending.current,
          flags: flagsRef.current,
          currentPosition: position.current,
          needsMeta: needsMeta.current,
        }),
      );
    } catch {
      /* browser storage can be unavailable */
    }
  }
  function initialize(server: any, discard = false) {
    const synced = answerMap(server.answers);
    revision.current = server.revision;
    offset.current = new Date(server.serverTime).getTime() - Date.now();
    position.current = server.currentPosition || 0;
    flagsRef.current = server.flags || [];
    pending.current = {};
    needsMeta.current = false;
    blocked.current = false;
    if (!discard && server.status === 'in_progress') {
      try {
        const local = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
        if (local && (Object.keys(local.pending || {}).length || local.needsMeta)) {
          pending.current = local.pending;
          Object.assign(synced, local.pending);
          if (local.revision !== server.revision) {
            blocked.current = true;
            setStatus('conflict');
          } else {
            setStatus('dirty');
            flagsRef.current = local.flags || flagsRef.current;
            position.current = local.currentPosition ?? position.current;
            needsMeta.current = !!local.needsMeta;
          }
        }
      } catch {
        /* ignore invalid local draft */
      }
    }
    latest.current = synced;
    setAnswers(synced);
    setFlags(flagsRef.current);
    setIndex(position.current);
    setLastSaved(server.lastSavedAt);
    setUnsynced(Object.keys(pending.current).length > 0 || needsMeta.current);
    if (discard || (!Object.keys(pending.current).length && !needsMeta.current)) setStatus('saved');
    if (discard) sessionStorage.removeItem(draftKey);
  }
  useEffect(() => {
    if (d && loaded.current !== id) {
      initialize(d);
      loaded.current = id || '';
    }
  }, [d, id]);
  const finished = d && d.status !== 'in_progress';
  async function save(): Promise<boolean> {
    if (blocked.current) return false;
    if (inFlight.current) {
      const success = await inFlight.current;
      if (!success) return false;
      return save();
    }
    if (!Object.keys(pending.current).length && !needsMeta.current) return true;
    if (!navigator.onLine) {
      setStatus('offline');
      return false;
    }
    const snapshot = { ...pending.current };
    const savedMeta = JSON.stringify([flagsRef.current, position.current]);
    setStatus('saving');
    inFlight.current = (async () => {
      try {
        const result = await send(
          `/attempts/${id}/answers`,
          {
            revision: revision.current,
            answers: answerArray(snapshot),
            flags: flagsRef.current,
            currentPosition: position.current,
          },
          'PUT',
        );
        revision.current = result.revision;
        offset.current = new Date(result.serverTime).getTime() - Date.now();
        for (const key of Object.keys(snapshot))
          if (JSON.stringify(pending.current[key]) === JSON.stringify(snapshot[key]))
            delete pending.current[key];
        if (savedMeta === JSON.stringify([flagsRef.current, position.current])) needsMeta.current = false;
        setLastSaved(result.lastSavedAt);
        const dirty = Object.keys(pending.current).length > 0 || needsMeta.current;
        setUnsynced(dirty);
        setStatus(dirty ? 'dirty' : 'saved');
        if (dirty) storeDraft();
        else sessionStorage.removeItem(draftKey);
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          blocked.current = true;
          setStatus('conflict');
          query.refetch();
        } else setStatus('offline');
        setUnsynced(true);
        storeDraft();
        return false;
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }
  useEffect(() => {
    if (finished) return;
    if (status === 'dirty') {
      const timer = setTimeout(() => {
        void save();
      }, 850);
      return () => clearTimeout(timer);
    }
  }, [answers, flags, index, status, finished]);
  useEffect(() => {
    const offline = () => setStatus('offline');
    const online = () => {
      if (!blocked.current) {
        setStatus('dirty');
        void save();
      }
      query.refetch();
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [id]);
  useEffect(() => {
    if (!d?.deadlineAt || finished) return;
    const tick = () => {
      const seconds = Math.max(
        0,
        Math.ceil((new Date(d.deadlineAt).getTime() - Date.now() - offset.current) / 1000),
      );
      setRemaining(seconds);
      if (seconds === 0 && !autoSubmitted.current) {
        autoSubmitted.current = true;
        void send(`/attempts/${id}/submit`, { idempotencyKey: submitKey.current })
          .then(() => query.refetch())
          .catch(() => {
            setStatus('offline');
            autoSubmitted.current = false;
          });
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [d?.deadlineAt, finished, id]);
  useEffect(() => {
    if (finished) {
      setUnsynced(false);
      sessionStorage.removeItem(draftKey);
    }
  }, [finished, draftKey]);
  function change(questionId: string, value: any) {
    latest.current = { ...latest.current, [questionId]: value };
    pending.current[questionId] = value;
    setAnswers(latest.current);
    setUnsynced(true);
    if (!blocked.current) setStatus(navigator.onLine ? 'dirty' : 'offline');
    storeDraft();
  }
  async function navigateQuestion(next: number) {
    if (!d.exam.allowBacktrack) {
      if (next !== index + 1) return;
      if (!(await save())) {
        message.error('请先成功同步当前答案，再进入下一题');
        return;
      }
    }
    position.current = next;
    needsMeta.current = true;
    setIndex(next);
    setUnsynced(true);
    setStatus('dirty');
    storeDraft();
  }
  function flag() {
    const questionId = qid(d.items[index]);
    flagsRef.current = flagsRef.current.includes(questionId)
      ? flagsRef.current.filter((f) => f !== questionId)
      : [...flagsRef.current, questionId];
    needsMeta.current = true;
    setFlags([...flagsRef.current]);
    setUnsynced(true);
    setStatus('dirty');
    storeDraft();
  }
  async function submit() {
    if (!(await save())) throw new Error('答案尚未成功同步，请先重试保存');
    await send(`/attempts/${id}/submit`, { idempotencyKey: submitKey.current });
    setUnsynced(false);
    sessionStorage.removeItem(draftKey);
    await query.refetch();
  }
  function confirmSubmit() {
    const missing = d.items.filter((q: any) => !answered(latest.current[qid(q)])).length;
    modal.confirm({
      title: missing ? `还有 ${missing} 道题未作答，确认交卷？` : '确认提交本次考试？',
      content: '交卷后不能继续修改。系统会先同步当前答案，再完成正式提交。',
      okText: '确认交卷',
      cancelText: '继续答题',
      onOk: async () => {
        try {
          await submit();
        } catch (e) {
          message.error((e as Error).message);
          throw e;
        }
      },
    });
  }
  const question = d?.items?.[index];
  return (
    <QueryState query={query}>
      {d && (
        <>
          <PageTitle
            eyebrow={finished ? 'EXAM RESULT' : 'EXAM IN PROGRESS'}
            title={d.exam.title}
            description={
              finished
                ? '答卷已由服务器接收，成绩按照公开规则展示。'
                : '请保持专注。服务器时间决定截止，修改答案后请确认保存状态。'
            }
            extra={
              finished ? (
                <Link to={`/exams/${d.exam.id}`} className="inline-link">
                  返回考试详情
                  <ArrowRight size={14} />
                </Link>
              ) : (
                <Tag color="blue">第 {d.number} 次作答</Tag>
              )
            }
          />
          {finished ? (
            <>
              <div className="content-two-columns">
                <Panel>
                  <Result
                    status="success"
                    title={d.status === 'timed_out' ? '考试到时，服务器已收卷' : '交卷成功'}
                    subTitle={`提交时间：${date(d.submittedAt)} · ${label(d.gradingStatus)}`}
                  />
                  <div className="result-score">
                    {d.scoreCents !== null && d.scoreCents !== undefined ? (
                      <>
                        <strong>{money(d.scoreCents)}</strong>
                        <span> / {money(d.exam.totalCents)} 分</span>
                        <p>
                          {d.scoreCents >= d.exam.passCents ? '已达到及格分数' : '继续巩固，下一次更进一步'}
                        </p>
                      </>
                    ) : (
                      <>
                        <h2 style={{ fontSize: 23 }}>等待成绩公开</h2>
                        <p>
                          {d.gradingStatus === 'pending'
                            ? '主观题仍在批阅中，暂不显示临时总分。'
                            : `公开时间：${date(d.exam.scoreReleaseAt)}`}
                        </p>
                      </>
                    )}
                  </div>
                </Panel>
                <Panel title="成绩与复核">
                  <dl className="info-list" style={{ gridTemplateColumns: '1fr' }}>
                    <div>
                      <dt>成绩状态</dt>
                      <dd>{label(d.releaseStatus)}</dd>
                    </div>
                    <div>
                      <dt>答案公开时间</dt>
                      <dd>{date(d.exam.answerReleaseAt)}</dd>
                    </div>
                    <div>
                      <dt>解析公开时间</dt>
                      <dd>{date(d.exam.explanationReleaseAt)}</dd>
                    </div>
                    <div>
                      <dt>教师评语公开时间</dt>
                      <dd>{d.exam.commentReleaseAt ? date(d.exam.commentReleaseAt) : '随实际成绩公开'}</dd>
                    </div>
                    <div>
                      <dt>复核截止时间</dt>
                      <dd>{date(d.exam.appealDeadline)}</dd>
                    </div>
                  </dl>
                  <Button
                    block
                    style={{ marginTop: 20 }}
                    onClick={() => setAppealOpen(true)}
                    disabled={
                      d.releaseStatus !== 'released' ||
                      !d.exam.appealDeadline ||
                      new Date(d.exam.appealDeadline) < new Date()
                    }
                  >
                    申请成绩复核
                  </Button>
                </Panel>
              </div>
              {d.feedback && (
                <Panel title="教师总体评语">
                  <p style={{ whiteSpace: 'pre-wrap' }}>{d.feedback}</p>
                </Panel>
              )}
              <Panel
                title="我的答卷"
                description="参考答案和解析只在各自的公开时间后显示"
                className="result-answers"
              >
                {d.items.map((q: any, i: number) => (
                  <div key={qid(q)}>
                    <QuestionView
                      question={q}
                      index={i}
                      value={d.answers.find((a: any) => a.questionVersionId === qid(q))?.value}
                      onChange={() => {}}
                      disabled
                      explain
                    />
                    {d.answers.find((a: any) => a.questionVersionId === qid(q))?.scoreCents !== undefined && (
                      <Tag>
                        本题得分：
                        {money(d.answers.find((a: any) => a.questionVersionId === qid(q)).scoreCents)} 分
                      </Tag>
                    )}
                    {d.answers.find((a: any) => a.questionVersionId === qid(q))?.comment && (
                      <div className="question-explanation">
                        <strong>教师批注</strong>
                        <p style={{ whiteSpace: 'pre-wrap' }}>
                          {d.answers.find((a: any) => a.questionVersionId === qid(q)).comment}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </Panel>
            </>
          ) : (
            <>
              <div className="exam-integrity-status" aria-live="polite">
                {status === 'conflict' && (
                  <Alert
                    type="error"
                    showIcon
                    message="检测到其他页面已修改答案或考试状态已变化"
                    description="已暂停保存，防止旧答案覆盖新版本。确认后重新载入服务器答案；当前未同步草稿将被丢弃。"
                    action={
                      <Popconfirm
                        title="重新载入并丢弃本页面未同步的修改？"
                        onConfirm={async () => {
                          const fresh = await api(`/attempts/${id}`);
                          initialize(fresh, true);
                          query.refetch();
                        }}
                      >
                        <Button danger size="small">
                          重新载入
                        </Button>
                      </Popconfirm>
                    }
                  />
                )}{' '}
                {status === 'offline' && (
                  <Alert
                    type="warning"
                    showIcon
                    message="尚有未同步答案"
                    description="网络可能中断，当前草稿仅存于此浏览器。恢复连接后自动重试，成功同步前不算提交。"
                    action={
                      <Button
                        size="small"
                        onClick={() => {
                          blocked.current = false;
                          void save();
                        }}
                      >
                        重试同步
                      </Button>
                    }
                  />
                )}
              </div>
              <div className="content-two-columns">
                <Panel>
                  {question && (
                    <>
                      <QuestionView
                        question={question}
                        index={index}
                        value={answers[qid(question)]}
                        onChange={(value) => change(qid(question), value)}
                        disabled={status === 'conflict' || remaining === 0}
                      />
                      <div className="answer-controls">
                        <Button
                          icon={<ArrowLeft size={15} />}
                          disabled={index === 0 || !d.exam.allowBacktrack}
                          title={!d.exam.allowBacktrack ? '本次考试不允许返回上一题' : undefined}
                          onClick={() => navigateQuestion(index - 1)}
                        >
                          上一题
                        </Button>
                        <Space>
                          <Button icon={<Flag size={14} />} onClick={flag} disabled={status === 'conflict'}>
                            {flags.includes(qid(question)) ? '取消标记' : '稍后检查'}
                          </Button>
                          {index < d.items.length - 1 ? (
                            <Button
                              type="primary"
                              icon={<ArrowRight size={15} />}
                              iconPosition="end"
                              disabled={status === 'conflict'}
                              onClick={() => navigateQuestion(index + 1)}
                            >
                              下一题
                            </Button>
                          ) : (
                            <Button type="primary" onClick={confirmSubmit} disabled={status === 'conflict'}>
                              检查并交卷
                            </Button>
                          )}
                        </Space>
                      </div>
                    </>
                  )}
                </Panel>
                <div className="stack">
                  <div className="exam-clock">
                    <span>剩余作答时间</span>
                    <strong>
                      {String(Math.floor(remaining / 3600)).padStart(2, '0')}:
                      {String(Math.floor((remaining % 3600) / 60)).padStart(2, '0')}:
                      {String(remaining % 60).padStart(2, '0')}
                    </strong>
                    <p>
                      个人截止时间 {date(d.deadlineAt)}
                      <br />
                      时间来自服务器，到时自动收卷。
                    </p>
                  </div>
                  <Panel
                    title="答题卡"
                    description={`已答 ${Object.values(answers).filter(answered).length} / ${d.items.length} 题`}
                  >
                    <div className="answer-sheet">
                      {d.items.map((q: any, i: number) => (
                        <button
                          key={qid(q)}
                          onClick={() => navigateQuestion(i)}
                          disabled={
                            (!d.exam.allowBacktrack && i !== index && i !== index + 1) ||
                            status === 'conflict'
                          }
                          className={`${i === index ? 'current' : ''} ${answered(answers[qid(q)]) ? 'answered' : ''} ${flags.includes(qid(q)) ? 'flagged' : ''}`}
                          aria-label={`第 ${i + 1} 题，${answered(answers[qid(q)]) ? '已答' : '未答'}`}
                        >
                          {i + 1}
                        </button>
                      ))}
                    </div>
                    <div className="sheet-legend">
                      <span>
                        <i className="sheet-dot saved" />
                        已作答
                      </span>
                      <span>
                        <i className="sheet-dot" />
                        未作答
                      </span>
                      <span>
                        <i className="sheet-dot flag" />
                        已标记
                      </span>
                    </div>
                    <div
                      className={`save-status ${status === 'offline' || status === 'conflict' ? 'error' : ''}`}
                      role="status"
                    >
                      {status === 'saved' ? <CheckCircle2 size={14} /> : <RefreshCw size={14} />}
                      {
                        {
                          saved: '全部答案已同步',
                          dirty: '存在未同步修改',
                          saving: '正在同步答案…',
                          offline: '未同步，请重试',
                          conflict: '版本冲突，保存已暂停',
                        }[status]
                      }
                    </div>
                    <p className="form-hint" style={{ fontSize: 12 }}>
                      最后成功同步：{date(lastSaved)}
                    </p>
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Button
                        block
                        onClick={() => save()}
                        disabled={status === 'conflict'}
                        loading={status === 'saving'}
                      >
                        立即保存
                      </Button>
                      <Button block type="primary" disabled={status === 'conflict'} onClick={confirmSubmit}>
                        提交答卷
                      </Button>
                    </Space>
                  </Panel>
                </div>
              </div>
            </>
          )}
          <Modal
            title="申请成绩复核"
            open={appealOpen}
            onCancel={() => setAppealOpen(false)}
            onOk={async () => {
              await action.mutateAsync({ path: `/attempts/${id}/appeals`, body: { reason: appealReason } });
              setAppealOpen(false);
            }}
            okButtonProps={{ disabled: appealReason.trim().length < 5 }}
          >
            <p className="form-hint">
              请说明需要复核的题目、评分疑问和依据。改分会保留原成绩与完整处理记录。
            </p>
            <Input.TextArea
              rows={5}
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
              placeholder="请输入至少 5 个字的复核理由"
            />
          </Modal>
        </>
      )}
    </QueryState>
  );
}
export function Grading() {
  const { id } = useParams();
  const query = useData(`/attempts/${id}`);
  const history = useData(`/attempts/${id}/revisions`);
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const d = query.data;
  const action = useAction('批阅已保存');
  const loaded = useRef('');
  const gradeRevision = useRef(0);
  useEffect(() => {
    if (d && loaded.current !== id) {
      gradeRevision.current = d.gradingRevision;
      setScores(
        Object.fromEntries(
          d.answers
            .filter((a: any) => a.scoreCents !== undefined && a.scoreCents !== null)
            .map((a: any) => [a.questionVersionId, a.scoreCents / 100]),
        ),
      );
      setComment(d.feedback || '');
      setComments(Object.fromEntries(d.answers.map((a: any) => [a.questionVersionId, a.comment || ''])));
      loaded.current = id || '';
    }
  }, [d, id]);
  const readonly = d?.releaseStatus === 'released' || !['submitted', 'timed_out'].includes(d?.status);
  return (
    <QueryState query={query}>
      {d && (
        <>
          <Link to={`/exams/${d.exam.id}`} className="back-link">
            ← 返回考试管理
          </Link>
          <PageTitle
            eyebrow="EXAM GRADING"
            title={`阅卷 · ${d.exam.title}`}
            description="按固定试卷版本批阅，分值不能超过题目满分。发布后的成绩通过复核流程修改。"
            extra={
              <Space>
                <Status value={d.status} />
                <Status value={d.gradingStatus} />
              </Space>
            }
          />
          <div className="content-two-columns">
            <Panel title="答卷与评分">
              {d.items.map((q: any, index: number) => (
                <div className="grading-question" key={qid(q)}>
                  <QuestionView
                    question={q}
                    index={index}
                    value={d.answers.find((a: any) => a.questionVersionId === qid(q))?.value}
                    onChange={() => {}}
                    disabled
                    explain
                  />
                  <div className="grading-controls">
                    <span>得分</span>
                    <InputNumber
                      value={scores[qid(q)]}
                      min={0}
                      max={q.scoreCents / 100}
                      precision={2}
                      disabled={readonly}
                      placeholder="客观题可自动"
                      onChange={(v) => setScores((prev) => ({ ...prev, [qid(q)]: v }))}
                    />
                    <span>/ {money(q.scoreCents)} 分</span>
                    <Input
                      value={comments[qid(q)] || ''}
                      onChange={(e) => setComments((prev) => ({ ...prev, [qid(q)]: e.target.value }))}
                      disabled={readonly}
                      placeholder="题目批注"
                    />
                  </div>
                </div>
              ))}
            </Panel>
            <div className="stack">
              <Panel title="批阅概况">
                <dl className="info-list" style={{ gridTemplateColumns: '1fr' }}>
                  <div>
                    <dt>提交时间</dt>
                    <dd>{date(d.submittedAt)}</dd>
                  </div>
                  <div>
                    <dt>总分</dt>
                    <dd>
                      {money(d.scoreCents)} / {money(d.exam.totalCents)} 分
                    </dd>
                  </div>
                  <div>
                    <dt>成绩状态</dt>
                    <dd>{label(d.releaseStatus)}</dd>
                  </div>
                </dl>
                <Input.TextArea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={4}
                  placeholder="总体批阅意见"
                  style={{ marginTop: 22 }}
                  disabled={readonly}
                />
                <Button
                  style={{ marginTop: 20 }}
                  block
                  type="primary"
                  disabled={readonly}
                  loading={action.isPending}
                  onClick={async () => {
                    const result = await action.mutateAsync({
                      path: `/attempts/${id}/grade`,
                      method: 'PUT',
                      body: {
                        revision: gradeRevision.current,
                        items: Object.entries(scores)
                          .filter(([, score]) => score !== null && score !== undefined)
                          .map(([questionVersionId, score]) => ({
                            questionVersionId,
                            scoreCents: Math.round(Number(score) * 100),
                            comment: comments[questionVersionId] || '',
                          })),
                        comment,
                      },
                    });
                    gradeRevision.current = result.gradingRevision;
                  }}
                >
                  保存阅卷
                </Button>
                <p className="form-hint" style={{ margin: '13px 0 0' }}>
                  多人阅卷使用版本检测，冲突时请重新载入并检查已有评分。
                </p>
              </Panel>
              <Popconfirm
                title="重新载入会放弃本页面尚未保存的评分，确认继续？"
                onConfirm={async () => {
                  const fresh = await api(`/attempts/${id}`);
                  gradeRevision.current = fresh.gradingRevision;
                  setScores(
                    Object.fromEntries(
                      fresh.answers
                        .filter((answer: any) => answer.scoreCents != null)
                        .map((answer: any) => [answer.questionVersionId, answer.scoreCents / 100]),
                    ),
                  );
                  setComments(
                    Object.fromEntries(
                      fresh.answers.map((answer: any) => [answer.questionVersionId, answer.comment || '']),
                    ),
                  );
                  setComment(fresh.feedback || '');
                  await query.refetch();
                }}
              >
                <Button>重新载入服务器评分</Button>
              </Popconfirm>
              <Panel title="成绩修改记录">
                <QueryState query={history}>
                  {history.data?.items?.length ? (
                    history.data.items.map((r: any) => (
                      <div className="reply-item" key={r.id}>
                        <div style={{ fontSize: 12 }}>
                          {money(r.oldScoreCents)} → {money(r.newScoreCents)} 分
                        </div>
                        <p>{r.reason}</p>
                        <div className="table-secondary">{date(r.createdAt)}</div>
                      </div>
                    ))
                  ) : (
                    <EmptyState description="暂无改分记录" />
                  )}
                </QueryState>
              </Panel>
            </div>
          </div>
        </>
      )}
    </QueryState>
  );
}
export function Appeals() {
  const { user } = useAuth();
  const teacher = user?.permissions.includes('assessment.grade');
  const [page, setPage] = useState(1);
  const query = useData(`/appeals?pageSize=12&page=${page}`);
  const action = useAction('复核处理已保存');
  const [record, setRecord] = useState<any>();
  const [form] = Form.useForm();
  return (
    <>
      <PageTitle
        eyebrow="GRADE REVIEW"
        title="成绩复核"
        description={
          teacher
            ? '回应评分疑问，按审批流程记录处理意见与成绩变更。'
            : '查看本人提交的复核申请、处理意见与当前有效成绩。'
        }
      />
      <Panel>
        <QueryState query={query}>
          <Table
            rowKey="id"
            dataSource={query.data?.items || []}
            columns={[
              { title: '申请时间', dataIndex: 'createdAt', render: (v) => date(v) },
              { title: '申请学生', render: (_, r: any) => r.user?.name || r.userId },
              {
                title: '考试',
                render: (_, r: any) => r.exam?.title || r.attempt?.exam?.title || r.attemptId,
              },
              { title: '复核理由', dataIndex: 'reason' },
              { title: '状态', dataIndex: 'status', render: (v) => <Status value={v} /> },
              { title: '处理意见', dataIndex: 'resolution', render: (v) => v || '—' },
              { title: '当前成绩', render: (_, r: any) => money(r.attempt?.scoreCents) },
              {
                title: '操作',
                render: (_, r: any) =>
                  teacher ? (
                    <Button
                      type="link"
                      disabled={r.status === 'resolved'}
                      onClick={() => {
                        setRecord(r);
                        form.resetFields();
                      }}
                    >
                      处理复核
                    </Button>
                  ) : (
                    <Link to={`/exam-attempts/${r.attemptId}`}>查看本人答卷</Link>
                  ),
              },
            ]}
            pagination={{
              current: page,
              pageSize: 12,
              total: query.data?.total,
              onChange: setPage,
              showSizeChanger: false,
            }}
          />
        </QueryState>
      </Panel>
      <Modal
        title="处理成绩复核"
        open={!!record}
        onCancel={() => setRecord(undefined)}
        onOk={() => form.submit()}
        confirmLoading={action.isPending}
      >
        <Alert type="info" showIcon message={record?.reason} style={{ marginBottom: 20 }} />
        <Link className="inline-link" to={`/grading/exam/${record?.attemptId}`} target="_blank">
          核对原始答卷
          <ArrowRight size={14} />
        </Link>
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 20 }}
          onFinish={async (values) => {
            await action.mutateAsync({
              path: `/appeals/${record.id}/resolve`,
              body: {
                resolution: values.resolution,
                ...(values.score !== undefined && values.score !== null
                  ? { scoreCents: Math.round(values.score * 100) }
                  : {}),
              },
            });
            setRecord(undefined);
          }}
        >
          <Form.Item
            name="resolution"
            label="处理意见及原因"
            rules={[{ required: true, min: 5, message: '至少填写 5 个字的处理意见' }]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="score" label="修订后总分（留空则保持原成绩）">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <p className="form-hint">
            修改成绩需要独立权限，保存原分、新分、原因和操作者。统计会使用修订后的有效成绩。
          </p>
        </Form>
      </Modal>
    </>
  );
}
function downloadJson(value: any, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function QuestionTransfer({ courseId }: { courseId?: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [preview, setPreview] = useState<any>();
  const [busy, setBusy] = useState(false);
  const { message } = App.useApp();
  const action = useAction('题库导入完成');
  async function validate(commit = false) {
    setBusy(true);
    try {
      const result = await (commit
        ? action.mutateAsync({ path: '/questions/import', body: { rows, commit } })
        : send('/questions/import', { rows, commit }));
      setPreview(result);
      if (commit && result.committed) {
        setOpen(false);
        setRows([]);
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportQuestions() {
    setBusy(true);
    try {
      const result = await api(`/questions/export?${queryString({ courseId, pageSize: 100, page: 1 })}`);
      const all = [...result.items];
      for (let page = 2; page <= Math.ceil(result.total / 100); page++) {
        const more = await api(`/questions/export?${queryString({ courseId, pageSize: 100, page })}`);
        all.push(...more.items);
      }
      downloadJson({ rows: all }, 'questions-export.json');
      message.success(`已导出 ${all.length} 道授权题目`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button onClick={() => setOpen(true)} icon={<UploadIcon size={14} />}>
        导入 / 导出
      </Button>
      <Modal
        title="题库批量导入与导出"
        width={780}
        open={open}
        onCancel={() => setOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button disabled={!rows.length} loading={busy} onClick={() => validate()}>
              校验预览
            </Button>
            <Button
              type="primary"
              disabled={!preview || preview.items?.some((i: any) => !i.success)}
              loading={busy}
              onClick={() => validate(true)}
            >
              确认导入
            </Button>
          </Space>
        }
      >
        <p className="form-hint">
          使用 JSON 模板保留题型、选项、多答案和子题结构。所有错误行修复后整批导入，不会留下部分数据。
        </p>
        <Space wrap style={{ marginBottom: 20 }}>
          <Button
            disabled={!courseId}
            onClick={async () => {
              const result = await api(`/questions/template?${queryString({ courseId })}`);
              downloadJson(result, 'question-import-template.json');
            }}
          >
            下载导入模板
          </Button>
          <Upload
            accept=".json"
            showUploadList={false}
            beforeUpload={async (file) => {
              try {
                if (file.size > 2 * 1024 * 1024) throw new Error('导入文件不能超过 2 MB');
                const parsed = JSON.parse(await file.text());
                const data = Array.isArray(parsed) ? parsed : parsed.rows || parsed.items;
                if (!Array.isArray(data)) throw new Error('文件需包含 rows 数组');
                setRows(data);
                setPreview(undefined);
                message.success(`已读取 ${data.length} 道题，请校验预览`);
              } catch (e) {
                message.error((e as Error).message);
              }
              return false;
            }}
          >
            <Button icon={<UploadIcon size={14} />}>选择 JSON 文件</Button>
          </Upload>
          <Button icon={<Download size={14} />} loading={busy} onClick={exportQuestions}>
            导出授权题目
          </Button>
        </Space>
        {!courseId && <Alert type="info" message="下载模板前，请先在题库筛选中选择课程。" />}
        {preview && (
          <Table
            rowKey="row"
            dataSource={preview.items || []}
            columns={[
              { title: '行号', dataIndex: 'row' },
              {
                title: '校验结果',
                dataIndex: 'success',
                render: (v) => <Tag color={v ? 'green' : 'red'}>{v ? '有效' : '错误'}</Tag>,
              },
              {
                title: '错误详情',
                dataIndex: 'errors',
                render: (v) =>
                  Array.isArray(v)
                    ? v.map((e: any) => (typeof e === 'string' ? e : e.message)).join('；')
                    : String(v || '—'),
              },
            ]}
            pagination={{ pageSize: 8 }}
          />
        )}
      </Modal>
    </>
  );
}
function SubmissionExportButton({ assignmentId }: { assignmentId: string }) {
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState<string>();
  const [poll, setPoll] = useState(3000);
  const clientId = useRef(crypto.randomUUID());
  const action = useAction('');
  const query = useData(`/attachments/exports/${jobId}`, !!jobId, poll);
  useEffect(() => {
    if (['SUCCEEDED', 'FAILED'].includes(query.data?.status)) setPoll(0);
  }, [query.data?.status]);
  async function start() {
    setOpen(true);
    const result = await action.mutateAsync({
      path: `/attachments/assignments/${assignmentId}/export`,
      body: { clientId: clientId.current },
    });
    setJobId(result.jobId);
  }
  return (
    <>
      <Button onClick={start} icon={<Download size={14} />} loading={action.isPending}>
        批量下载提交
      </Button>
      <Modal
        title="作业提交导出"
        open={open}
        onCancel={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>关闭</Button>}
      >
        <QueryState query={query}>
          {query.data?.status === 'SUCCEEDED' ? (
            <Result
              status="success"
              title="导出文件已准备好"
              subTitle="包含提交版本、答案、评分历史和附件。下载时再次检查当前授权。"
              extra={
                <Button type="primary" href={`/api/attachments/${query.data.attachmentId}/download`}>
                  下载 TAR.GZ 归档
                </Button>
              }
            />
          ) : query.data?.status === 'FAILED' ? (
            <Alert
              type="error"
              showIcon
              message="导出任务失败"
              description={query.data.error || '请检查任务记录后重试'}
            />
          ) : (
            <Result
              status="info"
              title="正在生成导出文件"
              subTitle="任务已持久化，后台会继续执行。稍候将自动更新状态。"
            />
          )}
        </QueryState>
      </Modal>
    </>
  );
}
