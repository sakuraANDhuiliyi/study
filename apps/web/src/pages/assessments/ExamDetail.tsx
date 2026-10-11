import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
} from 'antd';
import { ArrowRight, FileCheck2, Play } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { date, isTeacher, label, queryString, useAction, useData } from '../../api';
import { useAuth } from '../../auth';
import { ExamItemAnalysis } from '../ExamItemAnalysis';
import { EmptyState, PageTitle, Panel, QueryState, Status } from '../../components/shared';
import { qid, plainText, QuestionView, AnswerDisplay, money, toISO } from './shared';
import { AssessmentEditor } from './AssessmentEditor';

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
