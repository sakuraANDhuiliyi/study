import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Collapse, Form, Input, Pagination, Popconfirm, Space, Tabs, Tag } from 'antd';
import { ArrowLeft, BookOpen, Play, RotateCcw, Save } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { api, date, send, useData } from '../api';
import { EmptyState, PageTitle, Panel, QueryState, useUnsavedWarning } from '../components/shared';
import { ModuleFields, formValues } from '../components/academics/ModuleForm';
import { ResultView } from '../components/academics/ResultView';
import { RecordEditor } from '../components/academics/RecordEditor';
import { kindLabels } from '../components/academics/types';
import type { LearningModule, LearningRecord, LearningResult } from '../components/academics/types';
import '../academics.css';

export function AcademicWorkbench() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  return <Workbench key={`${user?.organizationId}:${user?.id}:${id}`} id={id} />;
}
function Workbench({ id }: { id: string }) {
  const { user } = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const query = useData<LearningModule>(`/academics/modules/${id}`);
  const [page, setPage] = useState(1);
  const history = useData<{ items: LearningRecord[]; total: number }>(
    `/academics/records?moduleId=${encodeURIComponent(id)}&page=${page}&pageSize=6`,
  );
  const [form] = Form.useForm();
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [record, setRecord] = useState<LearningRecord | null>(null);
  const [tab, setTab] = useState('practice');
  const [draftStatus, setDraftStatus] = useState('');
  const [storageFailed, setStorageFailed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const live = useRef(false);
  const editVersion = useRef(0);
  const scope = [user?.organizationId, user?.id, user?.role].join(':');
  const storageKey = `academic-draft:${user?.organizationId}:${user?.id}:${id}`;
  useUnsavedWarning(dirty && storageFailed);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!query.data || initialized) return;
    let values = query.data.defaultValues;
    try {
      const local = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (local && typeof local === 'object') {
        values = local;
        setDraftStatus('已恢复本机草稿');
        setDirty(true);
      }
    } catch {
      setStorageFailed(true);
    }
    form.setFieldsValue(formValues(query.data, values));
    setInitialized(true);
  }, [query.data, initialized, form, storageKey]);
  function remember() {
    editVersion.current++;
    setDirty(true);
    try {
      localStorage.setItem(storageKey, JSON.stringify(form.getFieldsValue(true)));
      setStorageFailed(false);
      setDraftStatus('输入已保存在本机');
    } catch {
      setStorageFailed(true);
      setDraftStatus('本机存储不可用，请及时提交保存');
    }
  }
  function load(values: Record<string, unknown>) {
    form.resetFields();
    form.setFieldsValue(formValues(query.data!, values));
    remember();
    setTab('practice');
  }
  async function evaluate(values: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    const version = editVersion.current;
    const { recordTitle, ...fields } = values;
    const title = recordTitle || (typeof fields.title === 'string' ? fields.title : undefined);
    try {
      const result = (await send(`/academics/modules/${id}/evaluate`, {
        values: fields,
        ...(title ? { title } : {}),
      })) as { record: LearningRecord; result: LearningResult };
      if (!live.current) return;
      setRecord(result.record);
      setTab('result');
      if (version === editVersion.current) {
        setDirty(false);
        setDraftStatus('结果已保存至学习记录');
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* Server record persists. */
        }
      }
      void client.invalidateQueries({
        predicate: (item) => item.queryKey[1] === scope && String(item.queryKey[0]).startsWith('/academics/'),
      });
      message.success('练习结果已保存');
    } catch (err) {
      if (live.current) setError((err as Error).message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function freshRecord() {
    if (!record) return undefined;
    const data = await api<{ items: LearningRecord[] }>(
      `/academics/records?moduleId=${encodeURIComponent(id)}&page=${page}&pageSize=6`,
    );
    return data.items.find((item) => item.id === record.id);
  }
  const module = query.data;
  return (
    <div className="academic-page academic-workbench">
      <Link className="academic-back" to="/academics">
        <ArrowLeft size={16} />
        返回专业学习中心
      </Link>
      <QueryState query={query}>
        {module && (
          <>
            <PageTitle
              eyebrow={kindLabels[module.kind]}
              title={module.title}
              description={module.description}
              extra={<Tag color="blue">约 {module.estimatedMinutes} 分钟</Tag>}
            />
            <div className="academic-workspace-grid">
              <aside className="academic-guidance">
                <Panel title="学习目标">
                  <ul>
                    {module.learningObjectives.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </Panel>
                <Panel title="先理解，再动手">
                  <Collapse
                    defaultActiveKey={['0']}
                    items={module.concepts.map((item, index) => ({
                      key: String(index),
                      label: item.title,
                      children: <p className="academic-preserve">{item.content}</p>,
                    }))}
                  />
                  <h3>练习步骤</h3>
                  <ol>
                    {module.instructions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                </Panel>
                {!!module.resources.length && (
                  <Panel title="延伸阅读">
                    {module.resources
                      .filter((item) => /^https?:\/\//.test(item.url))
                      .map((item) => (
                        <a
                          className="academic-resource"
                          href={item.url}
                          key={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <BookOpen size={15} />
                          {item.title}
                        </a>
                      ))}
                  </Panel>
                )}
              </aside>
              <section className="academic-main-panel">
                <Panel>
                  <Tabs
                    activeKey={tab}
                    onChange={setTab}
                    items={[
                      {
                        key: 'practice',
                        label: '动手练习',
                        children:
                          module.kind === 'algorithm' ? (
                            <EmptyState description="在算法工作台中使用四种语言编程、运行样例并查看详细题解。">
                              <Link to="/algorithms">
                                <Button type="primary">进入算法练习</Button>
                              </Link>
                            </EmptyState>
                          ) : (
                            <>
                              {!!module.examples.length && (
                                <div className="academic-examples">
                                  <span>从例子开始</span>
                                  {module.examples.map((example, index) => (
                                    <Popconfirm
                                      key={index}
                                      title="载入示例会替换当前输入，是否继续？"
                                      description={example.explanation}
                                      okText="载入示例"
                                      cancelText="取消"
                                      onConfirm={() => load(example.values)}
                                    >
                                      <Button size="small">{example.title}</Button>
                                    </Popconfirm>
                                  ))}
                                </div>
                              )}
                              <Form
                                form={form}
                                layout="vertical"
                                disabled={!initialized || busy}
                                onFinish={evaluate}
                                onValuesChange={remember}
                              >
                                <Form.Item name="recordTitle" label="本次记录标题（可选）">
                                  <Input maxLength={160} placeholder={`${module.title} · 我的实验`} />
                                </Form.Item>
                                <ModuleFields module={module} />
                                {error && (
                                  <Alert type="error" showIcon message="本次练习未完成" description={error} />
                                )}
                                <div className="academic-submit-bar">
                                  <span role="status">
                                    {draftStatus || '修改参数，观察结果并记录你的思考'}
                                  </span>
                                  <Space wrap>
                                    <Popconfirm
                                      title="恢复默认输入？"
                                      okText="恢复默认"
                                      cancelText="取消"
                                      onConfirm={() => load(module.defaultValues)}
                                    >
                                      <Button icon={<RotateCcw size={15} />}>重置</Button>
                                    </Popconfirm>
                                    <Button
                                      type="primary"
                                      htmlType="submit"
                                      loading={busy}
                                      icon={
                                        module.kind === 'workspace' ? <Save size={16} /> : <Play size={16} />
                                      }
                                    >
                                      {module.kind === 'workspace'
                                        ? '保存学习记录'
                                        : module.kind === 'quiz'
                                          ? '提交练习并查看解析'
                                          : '运行并保存结果'}
                                    </Button>
                                  </Space>
                                </div>
                              </Form>
                            </>
                          ),
                      },
                      {
                        key: 'result',
                        label: '结果与笔记',
                        children: record ? (
                          <>
                            <ResultView result={record.result} />
                            <div className="academic-record-meta">
                              {date(record.createdAt)} · 已保存 · {record.id.slice(-8)}
                            </div>
                            <h3>整理这次学习</h3>
                            <RecordEditor
                              key={record.id}
                              record={record}
                              onRefresh={freshRecord}
                              onSaved={(saved) => {
                                setRecord(saved);
                                void history.refetch();
                              }}
                            />
                          </>
                        ) : (
                          <EmptyState description="完成一次练习后，这里会展示实际结果和逐步解释。" />
                        ),
                      },
                      {
                        key: 'history',
                        label: `学习记录${history.data ? ` · ${history.data.total}` : ''}`,
                        children: (
                          <QueryState query={history}>
                            <div className="academic-history">
                              <div className="academic-history-heading">
                                <span>所有记录仅自己可见</span>
                                <Button onClick={() => history.refetch()}>刷新记录</Button>
                              </div>
                              {history.data?.items.length ? (
                                history.data.items.map((item) => (
                                  <article key={item.id}>
                                    <div>
                                      <Tag color={item.status === 'COMPLETED' ? 'green' : 'default'}>
                                        {item.status === 'COMPLETED' ? '已完成' : '继续研究'}
                                      </Tag>
                                      <h3>{item.title}</h3>
                                      <p>{date(item.updatedAt)}</p>
                                    </div>
                                    <Space wrap>
                                      <Button
                                        onClick={() => {
                                          setRecord(item);
                                          setTab('result');
                                        }}
                                      >
                                        查看结果与笔记
                                      </Button>
                                      <Popconfirm
                                        title="恢复这次输入并替换当前草稿？"
                                        okText="恢复输入"
                                        cancelText="取消"
                                        onConfirm={() => load(item.values)}
                                      >
                                        <Button>恢复输入</Button>
                                      </Popconfirm>
                                    </Space>
                                  </article>
                                ))
                              ) : (
                                <EmptyState description="还没有学习记录，完成一次练习即可开始积累。" />
                              )}
                              <Pagination
                                current={page}
                                pageSize={6}
                                total={history.data?.total || 0}
                                onChange={setPage}
                                showSizeChanger={false}
                              />
                            </div>
                          </QueryState>
                        ),
                      },
                    ]}
                  />
                </Panel>
              </section>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}
