import { useState } from 'react';
import { Button, Input, Pagination, Select, Tag } from 'antd';
import { ArrowUpRight, NotebookPen, Pin } from 'lucide-react';
import { Link } from 'react-router-dom';
import { date, queryString, useData } from '../api';
import { EmptyState, PageTitle, Panel, QueryState } from '../components/shared';
import { LessonNote } from '../components/LessonNote';
import { RemoteSelect } from '../components/RemoteSelect';
import { useAuth } from '../auth';
import { AcademicRecords } from './AcademicRecords';

type Summary = {
  id: string;
  lessonId: string;
  courseId: string;
  courseTitle: string;
  lessonTitle: string;
  preview: string;
  pinned: boolean;
  updatedAt: string;
};
export function Notes() {
  const { user } = useAuth();
  return user?.accountMode === 'PERSONAL' ? <AcademicRecords notes /> : <CourseNotes />;
}
function CourseNotes() {
  const [search, setSearch] = useState('');
  const [courseId, setCourseId] = useState<string>();
  const [pinned, setPinned] = useState<string>();
  const [page, setPage] = useState(1);
  const query = useData<{ items: Summary[]; total: number }>(
    `/notes?${queryString({ search, courseId, pinned, page, pageSize: 12 })}`,
  );
  return (
    <>
      <PageTitle
        eyebrow="PERSONAL NOTES"
        title="我的学习笔记"
        description="整理课时重点与自己的理解，所有笔记仅你可见。"
        extra={
          <Link to="/courses">
            <Button icon={<NotebookPen size={16} />}>前往课程记笔记</Button>
          </Link>
        }
      />
      <div className="filter-bar">
        <Input.Search
          placeholder="搜索笔记、课时或课程"
          aria-label="搜索私人笔记"
          maxLength={120}
          allowClear
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
          style={{ width: 300 }}
        />
        <label className="note-visually-hidden" htmlFor="notes-course-filter">
          笔记课程
        </label>
        <RemoteSelect
          id="notes-course-filter"
          endpoint="/courses"
          labelField="title"
          placeholder="全部课程"
          value={courseId}
          allowClear
          onChange={(value) => {
            setCourseId(value);
            setPage(1);
          }}
          style={{ width: 220 }}
        />
        <Select
          aria-label="笔记置顶筛选"
          placeholder="全部笔记"
          value={pinned}
          allowClear
          onChange={(value) => {
            setPinned(value);
            setPage(1);
          }}
          options={[
            { value: 'true', label: '只看置顶' },
            { value: 'false', label: '未置顶' },
          ]}
          style={{ width: 150 }}
        />
        <span className="filter-count">共 {query.data?.total || 0} 条笔记</span>
      </div>
      <QueryState query={query}>
        {query.data?.items.length ? (
          <>
            <div className="notes-grid">
              {query.data.items.map((note) => (
                <Panel key={note.id} className="note-card">
                  <div className="note-card-heading">
                    <div>
                      <p className="note-source">{note.courseTitle}</p>
                      <h2>{note.lessonTitle}</h2>
                    </div>
                    {note.pinned && (
                      <Tag color="blue" icon={<Pin size={12} />}>
                        置顶
                      </Tag>
                    )}
                  </div>
                  <p className="note-preview">{note.preview}</p>
                  <div className="note-card-actions">
                    <span>更新于 {date(note.updatedAt)}</span>
                    <div>
                      <LessonNote lessonId={note.lessonId} compact />
                      <Link
                        className="inline-link"
                        to={`/courses/${note.courseId}?lesson=${encodeURIComponent(note.lessonId)}`}
                      >
                        返回课时 <ArrowUpRight size={14} />
                      </Link>
                    </div>
                  </div>
                </Panel>
              ))}
            </div>
            <Pagination
              className="notes-pagination"
              current={page}
              total={query.data.total}
              pageSize={12}
              showSizeChanger={false}
              onChange={setPage}
            />
          </>
        ) : (
          <Panel>
            <EmptyState
              description={
                page > 1
                  ? '当前页已无笔记，请返回第一页查看。'
                  : search || courseId || pinned
                    ? '没有符合条件的私人笔记'
                    : '还没有学习笔记，进入课时后记录第一条吧。'
              }
            >
              {page > 1 ? (
                <Button onClick={() => setPage(1)}>返回第一页</Button>
              ) : (
                <Link to="/courses">
                  <Button type="primary">查看我的课程</Button>
                </Link>
              )}
            </EmptyState>
          </Panel>
        )}
      </QueryState>
    </>
  );
}
