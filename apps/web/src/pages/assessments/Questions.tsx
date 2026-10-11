import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Upload,
} from 'antd';
import { BrainCircuit, Download, Plus, Upload as UploadIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, date, label, queryString, send, useAction, useData } from '../../api';
import { useAuth } from '../../auth';
import { RichTextEditor } from '../../components/RichTextEditor';
import { PageTitle, Panel, QueryState } from '../../components/shared';
import { CourseSelect, typeOptions, ChapterSelect, plainText, money, QuestionView } from './shared';

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
