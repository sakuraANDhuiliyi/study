import { useState } from 'react';
import { Button, Input, Table, Tag } from 'antd';
import { ArrowRight, Plus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { date, isTeacher, queryString, useData } from '../../api';
import { useAuth } from '../../auth';
import { PageTitle, Panel, QueryState, Status } from '../../components/shared';
import { CourseSelect, money } from './shared';
import { AssessmentCreator } from './AssessmentCreator';

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
