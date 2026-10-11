import { useState } from 'react';
import { Button, Input, Table } from 'antd';
import { ArrowRight, Plus } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { date, isTeacher, queryString, useData } from '../../api';
import { useAuth } from '../../auth';
import { PageTitle, Panel, QueryState, Status } from '../../components/shared';
import { CourseSelect, money } from './shared';
import { AssessmentCreator } from './AssessmentCreator';

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
