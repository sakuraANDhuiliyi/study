import { useState } from 'react';
import { Button, Form, Input, InputNumber, Pagination, Select, Space, Table, Tabs, Tag } from 'antd';
import { ArrowRight, BrainCircuit, PenLine, Play } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { date, queryString, useAction, useData } from '../../api';
import { useAuth } from '../../auth';
import { EmptyState, PageTitle, Panel, QueryState } from '../../components/shared';
import { CourseSelect, ChapterSelect, typeOptions, plainText } from './shared';

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
        extra={
          user?.role === 'STUDENT' && user.permissions.includes('learning.use') ? (
            <Button onClick={() => navigate('/algorithms')}>算法编程练习</Button>
          ) : undefined
        }
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
