import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Upload,
  Result,
} from 'antd';
import { Clock3, Download, Save, Send, Upload as UploadIcon } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, date, isTeacher, label, useAction, useData } from '../../api';
import { useAuth } from '../../auth';
import { EmptyState, PageTitle, Panel, QueryState, Status, useUnsavedWarning } from '../../components/shared';
import {
  answerMap,
  answerArray,
  answered,
  money,
  QuestionView,
  plainText,
  AnswerDisplay,
  toISO,
} from './shared';
import { AssessmentEditor } from './AssessmentEditor';

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
