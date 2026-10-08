import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, App, Avatar, Button, Form, Input, Progress, Space, Table, Tag, Tabs } from 'antd';
import { Download, ShieldCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { RemoteSelect } from '../components/RemoteSelect';
import { isTeacher, isAdmin, label, queryString, send, useAction, useData } from '../api';
import { Chart, chartTheme, EmptyState, Metrics, PageTitle, Panel, QueryState } from '../components/shared';
export function Analytics() {
  const { user } = useAuth();
  const [courseId, setCourseId] = useState<string>();
  const [classId, setClassId] = useState<string>();
  const [termId, setTermId] = useState<string>();
  const query = useData(`/analytics?${queryString({ courseId, classId, termId })}`);
  const d = query.data;
  const teacher = isTeacher(user);
  return (
    <>
      <PageTitle
        eyebrow="LEARNING INSIGHTS"
        title={teacher ? '教学分析' : '我的学习分析'}
        description="让数据回归学习本身，找到进步的方向。"
        extra={
          <Space wrap>
            {user?.permissions.includes('data.export') && (
              <Button
                href={`/api/analytics/export?${queryString({ courseId, classId, termId })}`}
                icon={<Download size={15} />}
              >
                导出报表
              </Button>
            )}
            <RemoteSelect
              endpoint="/courses"
              labelField="title"
              value={courseId}
              onChange={setCourseId}
              placeholder="全部课程"
              style={{ width: 220 }}
            />
          </Space>
        }
      />
      <div className="filter-bar">
        {isAdmin(user) && (
          <RemoteSelect
            endpoint="/admin/classes"
            value={classId}
            onChange={setClassId}
            placeholder="全部授权班级"
            style={{ width: 220 }}
          />
        )}
        {isAdmin(user) && (
          <RemoteSelect
            endpoint="/admin/terms"
            value={termId}
            onChange={setTermId}
            placeholder="全部学期"
            style={{ width: 220 }}
          />
        )}
        <span className="filter-count">当前授权范围 · 全部历史</span>
      </div>
      <QueryState query={query}>
        {d && (
          <>
            <Metrics items={d.metrics || []} />
            {teacher && d.taskSummary && (
              <>
                <Metrics
                  items={[
                    {
                      label: '应提交作业',
                      value: d.taskSummary.expectedSubmissions,
                      detail: '当前有效教学任务与学生关系',
                    },
                    {
                      label: '已提交作业',
                      value: d.taskSummary.submitted,
                      detail: `尚未提交 ${d.taskSummary.missing} 份`,
                    },
                    {
                      label: '作业提交率',
                      value: `${d.taskSummary.submissionRate}%`,
                      detail: '有效已提交 / 应提交',
                    },
                    {
                      label: '作业迟交率',
                      value: `${d.taskSummary.lateRate}%`,
                      detail: `迟交 ${d.taskSummary.late} 份 / 有效已提交`,
                    },
                  ]}
                />
                <Alert style={{ marginBottom: 23 }} type="info" showIcon message={d.taskSummary.rule} />
              </>
            )}
            <div className="chart-grid">
              <Panel
                title="已发布成绩趋势"
                description="不同总分的成绩统一换算为百分制，仅包含已发布有效成绩"
              >
                {d.scoreTrend?.length ? (
                  <Chart
                    option={{
                      ...chartTheme,
                      xAxis: {
                        ...chartTheme.xAxis,
                        type: 'category',
                        data: d.scoreTrend.map((x: any) => x.name),
                        axisLabel: { rotate: 15, fontSize: 12, color: '#626976' },
                      },
                      yAxis: { ...chartTheme.yAxis, type: 'value', min: 0, max: 100, name: '分' },
                      series: [
                        {
                          name: '百分制成绩',
                          type: 'line',
                          data: d.scoreTrend.map((x: any) => x.score),
                          smooth: true,
                          symbolSize: 7,
                          lineStyle: { width: 3 },
                          areaStyle: { color: '#206bc414' },
                        },
                      ],
                    }}
                  />
                ) : (
                  <EmptyState description="成绩发布后，这里将展示你的成长曲线" />
                )}
              </Panel>
              <Panel title="知识点表现" description="正确作答次数 ÷ 已作答次数，保留样本量供参考">
                {d.knowledgePoints?.length ? (
                  <Chart
                    option={{
                      ...chartTheme,
                      grid: { left: 90, right: 25, top: 15, bottom: 28 },
                      xAxis: { ...chartTheme.yAxis, type: 'value', max: 100, name: '%' },
                      yAxis: {
                        ...chartTheme.xAxis,
                        type: 'category',
                        data: d.knowledgePoints.slice(0, 8).map((x: any) => x.name),
                        axisLabel: { fontSize: 12, color: '#626976' },
                      },
                      series: [
                        {
                          name: '正确率',
                          type: 'bar',
                          barWidth: 12,
                          data: d.knowledgePoints.slice(0, 8).map((x: any) => ({
                            value: x.accuracy,
                            itemStyle: { borderRadius: [0, 4, 4, 0] },
                          })),
                        },
                      ],
                    }}
                  />
                ) : (
                  <EmptyState description="数据不足，完成练习后生成知识点统计" />
                )}
              </Panel>
            </div>
            <div className="chart-grid">
              <Panel title="课程完成情况" description="已完成开放课时 ÷ 当前有效成员应完成的开放课时">
                {d.courseProgress?.length ? (
                  <div className="stack">
                    {d.courseProgress.map((c: any) => (
                      <div key={c.name}>
                        <div className="list-title-line" style={{ fontSize: 14, color: '#626976' }}>
                          <span>{c.name}</span>
                          <span>
                            {c.completed} / {c.total} 课时
                          </span>
                        </div>
                        <Progress percent={c.percent} size="small" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState description="暂无课程进度记录" />
                )}
              </Panel>
              <Panel title="复习建议" description="依据真实作答样本生成，数据不足时不推断掌握程度">
                {d.knowledgePoints?.filter((k: any) => k.total >= 3 && k.accuracy < 70).length ? (
                  <div className="stack">
                    {d.knowledgePoints
                      .filter((k: any) => k.total >= 3 && k.accuracy < 70)
                      .slice(0, 5)
                      .map((k: any) => (
                        <div key={k.name}>
                          <Tag color="gold">建议巩固</Tag>
                          <strong style={{ fontSize: 14, color: '#182433' }}>{k.name}</strong>
                          <p className="form-hint" style={{ marginTop: 8, marginBottom: 0 }}>
                            共作答 {k.total} 次，正确 {k.correct}{' '}
                            次。建议回顾相关课时，再通过错题练习检验理解。
                          </p>
                        </div>
                      ))}
                  </div>
                ) : (
                  <EmptyState description="暂无薄弱知识点建议；保持学习，积累更多样本" />
                )}
              </Panel>
            </div>
            {teacher && (
              <Panel title="学生学习明细" description="表格与图表使用相同的授权范围和统计口径">
                <Table
                  rowKey="id"
                  dataSource={d.students || []}
                  columns={[
                    { title: '学生姓名', dataIndex: 'name' },
                    { title: '已完成课时', dataIndex: 'completed' },
                    { title: '有效课时', dataIndex: 'total' },
                    {
                      title: '课程完成率',
                      dataIndex: 'percent',
                      render: (v: number) => <Progress percent={v} size="small" style={{ width: 170 }} />,
                    },
                  ]}
                  pagination={{ pageSize: 10 }}
                />
              </Panel>
            )}
            {teacher && (
              <>
                <div className="chart-grid">
                  <Panel
                    title="成绩分布"
                    description="已发布有效成绩换算为百分制，每人每项任务取最后有效成绩"
                  >
                    {d.distribution?.some((x: any) => x.count > 0) ? (
                      <Chart
                        option={{
                          ...chartTheme,
                          xAxis: {
                            ...chartTheme.xAxis,
                            type: 'category',
                            data: d.distribution.map((x: any) => x.name),
                          },
                          yAxis: { ...chartTheme.yAxis, type: 'value', name: '份', minInterval: 1 },
                          series: [
                            {
                              name: '有效成绩数',
                              type: 'bar',
                              barMaxWidth: 42,
                              data: d.distribution.map((x: any) => x.count),
                              itemStyle: { borderRadius: [5, 5, 0, 0] },
                            },
                          ],
                        }}
                      />
                    ) : (
                      <EmptyState description="暂无已发布成绩" />
                    )}
                  </Panel>
                  <Panel title="需要关注的学生" description="依据持续未完成任务等明确规则识别，帮助及时跟进">
                    {d.suggestions?.length ? (
                      d.suggestions.map((s: any) => (
                        <div key={s.userId + s.reason} className="reply-item">
                          <strong style={{ fontSize: 14, color: '#182433' }}>{s.name}</strong>
                          <p style={{ marginTop: 8 }}>{s.reason}</p>
                        </div>
                      ))
                    ) : (
                      <EmptyState description="当前没有规则命中的关注事项" />
                    )}
                  </Panel>
                </div>
                <Panel
                  title="班级对比"
                  description="课程完成率按应完成课时统计；平均成绩仅使用已发布百分制成绩"
                  className="rules-panel"
                >
                  <Table
                    rowKey="id"
                    dataSource={d.classComparison || []}
                    columns={[
                      { title: '班级', dataIndex: 'name' },
                      { title: '有效学生', dataIndex: 'studentCount' },
                      { title: '课时进度', render: (_, r: any) => `${r.completed} / ${r.total}` },
                      { title: '完成率', dataIndex: 'percent', render: (v: number) => `${v}%` },
                      {
                        title: '平均成绩',
                        dataIndex: 'averageScore',
                        render: (v: number | null) => (v === null ? '数据不足' : `${v} 分`),
                      },
                      { title: '成绩样本', dataIndex: 'scoreCount' },
                    ]}
                    pagination={{ pageSize: 8 }}
                  />
                </Panel>
                <Panel
                  title="题目作答分析"
                  description="正确次数 / 已作答客观题次数，主观题不计自动正确率"
                  className="rules-panel"
                >
                  <Table
                    rowKey="id"
                    dataSource={d.questionStats || []}
                    columns={[
                      { title: '题目', dataIndex: 'stem', ellipsis: true },
                      { title: '正确次数', dataIndex: 'correct' },
                      { title: '客观作答次数', dataIndex: 'total' },
                      { title: '正确率', dataIndex: 'accuracy', render: (v: number) => `${v}%` },
                    ]}
                    pagination={{ pageSize: 8 }}
                  />
                </Panel>
              </>
            )}
            <Panel
              title="知识点统计明细"
              description="样本量少于 3 次时标为数据不足，不生成掌握度建议"
              className="rules-panel"
            >
              <Table
                rowKey="name"
                dataSource={d.knowledgePoints || []}
                columns={[
                  { title: '知识点', dataIndex: 'name' },
                  { title: '完全答对', dataIndex: 'correct' },
                  { title: '已作答客观题', dataIndex: 'total' },
                  { title: '正确率', dataIndex: 'accuracy', render: (v: number) => `${v}%` },
                  {
                    title: '建议',
                    render: (_, r: any) => (r.total < 3 ? '数据不足' : r.recommendation || '保持间隔复习'),
                  },
                ]}
                pagination={{ pageSize: 8 }}
              />
            </Panel>
            <Panel title="统计口径" className="rules-panel">
              <ul className="rule-list">
                {(d.rules || []).map((rule: string) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </Panel>
          </>
        )}
      </QueryState>
    </>
  );
}
export function Profile() {
  const { user, refresh } = useAuth();
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [recoveryForm] = Form.useForm();
  const recovery = useData<{ configured: boolean }>('/auth/recovery');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const action = useAction('个人资料已更新');
  const client = useQueryClient();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  async function password(values: any) {
    setBusy(true);
    try {
      await send('/auth/password', { oldPassword: values.oldPassword, newPassword: values.newPassword });
      message.success('密码已修改，请重新登录');
      client.clear();
      await refresh();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generateRecovery(values: { oldPassword: string }) {
    setRecoveryBusy(true);
    setRecoveryCode('');
    try {
      const result = await send('/auth/recovery-code', values);
      setRecoveryCode(result.code);
      recoveryForm.resetFields();
      await recovery.refetch();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setRecoveryBusy(false);
    }
  }
  return (
    <>
      <PageTitle eyebrow="MY ACCOUNT" title="个人中心" description="管理你的基本资料、工作身份与账号安全。" />
      <div className="profile-layout">
        <Panel className="profile-card">
          <Avatar size={80} style={{ background: '#e9f2fc', color: '#206bc4', fontSize: 30 }}>
            {user?.name.slice(0, 1)}
          </Avatar>
          <h2>{user?.name}</h2>
          <p>{user?.username}</p>
          <Space wrap>
            {user?.roles.map((r) => (
              <Tag key={r} color="blue">
                {label(r)}
              </Tag>
            ))}
          </Space>
        </Panel>
        <Panel>
          <Tabs
            items={[
              {
                key: 'basic',
                label: '基本资料',
                children: (
                  <Form
                    form={form}
                    layout="vertical"
                    initialValues={{ name: user?.name }}
                    style={{ maxWidth: 430 }}
                    onFinish={async (values) => {
                      await action.mutateAsync({ path: '/auth/profile', method: 'PATCH', body: values });
                      await refresh();
                    }}
                  >
                    <Form.Item label="账号">
                      <Input disabled value={user?.username} />
                    </Form.Item>
                    <Form.Item
                      name="name"
                      label="显示姓名"
                      rules={[
                        { required: true, message: '请输入姓名' },
                        { max: 60, message: '姓名最长 60 个字符' },
                      ]}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item label="当前角色">
                      <Input disabled value={label(user?.role || '')} />
                    </Form.Item>
                    <Form.Item label="学习空间">
                      <Input
                        disabled
                        value={user?.accountMode === 'PERSONAL' ? '个人自主学习' : '组织教学空间'}
                      />
                    </Form.Item>
                    {user?.role === 'STUDENT' && (
                      <Form.Item
                        label="我的专业"
                        extra={
                          user.accountMode === 'PERSONAL' ? (
                            <Link to="/academics">前往专业学习中心调整专业与模块</Link>
                          ) : (
                            '组织学生的专业由管理员指定。'
                          )
                        }
                      >
                        <Input disabled value={user.major?.name || '未选择专业'} />
                      </Form.Item>
                    )}
                    <Button type="primary" htmlType="submit" loading={action.isPending}>
                      保存资料
                    </Button>
                  </Form>
                ),
              },
              {
                key: 'security',
                label: '账号安全',
                children: (
                  <>
                    <Alert
                      type="info"
                      showIcon
                      message="修改密码后，所有设备的旧会话及原恢复码将失效，请重新登录并生成新的恢复码。"
                      style={{ marginBottom: 23 }}
                    />
                    <Form
                      name="profile-password"
                      form={passwordForm}
                      layout="vertical"
                      onFinish={password}
                      style={{ maxWidth: 430 }}
                    >
                      <Form.Item
                        name="oldPassword"
                        label="当前密码"
                        rules={[{ required: true, message: '请输入当前密码' }]}
                      >
                        <Input.Password autoComplete="current-password" />
                      </Form.Item>
                      <Form.Item
                        name="newPassword"
                        label="新密码"
                        rules={[
                          { required: true, message: '请输入新密码' },
                          { min: 12, message: '密码至少 12 个字符' },
                        ]}
                      >
                        <Input.Password autoComplete="new-password" />
                      </Form.Item>
                      <Form.Item
                        name="confirm"
                        label="确认新密码"
                        dependencies={['newPassword']}
                        rules={[
                          { required: true, message: '请再次输入新密码' },
                          ({ getFieldValue }) => ({
                            validator(_, value) {
                              return !value || getFieldValue('newPassword') === value
                                ? Promise.resolve()
                                : Promise.reject(new Error('两次输入的密码不一致'));
                            },
                          }),
                        ]}
                      >
                        <Input.Password autoComplete="new-password" />
                      </Form.Item>
                      <Button htmlType="submit" type="primary" loading={busy}>
                        更新密码并重新登录
                      </Button>
                    </Form>
                    <div style={{ marginTop: 28, maxWidth: 430 }}>
                      <h3>账号恢复码</h3>
                      <p>
                        {recovery.data?.configured
                          ? '已预留恢复码。重新生成会使原码失效。'
                          : '预先生成并离线保存恢复码，以便忘记密码时恢复账号。'}
                      </p>
                      <p className="form-hint">
                        恢复码仅向你展示一次，管理员无法查看。
                        {user?.accountMode === 'PERSONAL'
                          ? '个人账号可直接在登录页使用预留恢复码。'
                          : '组织账号需要管理员开启 15 分钟许可，再由你在登录页输入恢复码。'}
                        使用后会撤销全部会话和敏感授权。
                      </p>
                      <Form
                        name="profile-recovery"
                        form={recoveryForm}
                        layout="vertical"
                        onFinish={generateRecovery}
                      >
                        <Form.Item
                          name="oldPassword"
                          label="验证当前密码"
                          rules={[{ required: true, message: '请输入当前密码' }]}
                        >
                          <Input.Password autoComplete="current-password" />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" loading={recoveryBusy}>
                          {recovery.data?.configured ? '生成新的恢复码' : '生成恢复码'}
                        </Button>
                      </Form>
                      {recoveryCode && (
                        <Alert
                          style={{ marginTop: 16 }}
                          type="warning"
                          showIcon
                          message="请离线安全保存；关闭后无法再次查看"
                          description={
                            <>
                              <Input.Password
                                value={recoveryCode}
                                readOnly
                                autoComplete="off"
                                aria-label="一次性账号恢复码"
                              />
                              <Button style={{ marginTop: 12 }} onClick={() => setRecoveryCode('')}>
                                我已安全保存
                              </Button>
                            </>
                          }
                        />
                      )}
                    </div>
                  </>
                ),
              },
              {
                key: 'permissions',
                label: '我的权限',
                children: (
                  <>
                    <p className="form-hint">
                      以下为当前角色获授的功能权限。具体课程、班级与个人数据由服务端进一步校验。
                    </p>
                    <div className="permission-grid">
                      {user?.permissions.map((p) => (
                        <div className="permission-item" key={p}>
                          <ShieldCheck size={14} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                          {p}
                        </div>
                      ))}
                    </div>
                  </>
                ),
              },
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
