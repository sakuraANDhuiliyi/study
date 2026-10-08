import { useState, useRef } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Progress,
  Tabs,
  Collapse,
  Table,
  Alert,
  Upload,
  App,
  Popconfirm,
  Pagination,
  AutoComplete,
} from 'antd';
import {
  BookOpen,
  Plus,
  ArrowRight,
  Clock,
  CheckCircle2,
  PlayCircle,
  FileText,
  ExternalLink,
  Users,
  Upload as UploadIcon,
} from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, useData, useAction, isTeacher, isAdmin, date, label, queryString } from '../api';
import { EmptyState, PageTitle, Panel, QueryState, RichContent, Status } from '../components/shared';
import { RichTextEditor } from '../components/RichTextEditor';
import { RemoteSelect } from '../components/RemoteSelect';
import { LessonNote } from '../components/LessonNote';
export function Courses() {
  const { user } = useAuth();
  const catalog = useData('/catalog');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const query = useData(`/courses?${queryString({ search, status, page, pageSize: 12 })}`);
  const action = useAction('课程已创建');
  const teacher = isTeacher(user);
  return (
    <>
      <PageTitle
        eyebrow="COURSES"
        title={teacher ? '课程管理' : '我的课程'}
        description={
          teacher ? '组织课程内容，安排教学活动，跟进学习进展。' : '从一节课开始，构建属于你的知识体系。'
        }
        extra={
          teacher && (
            <Button type="primary" icon={<Plus size={16} />} onClick={() => setOpen(true)}>
              创建课程
            </Button>
          )
        }
      />
      <div className="filter-bar">
        <Input.Search
          placeholder="搜索课程名称"
          allowClear
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
          style={{ maxWidth: 320 }}
        />
        <Select
          placeholder="全部课程状态"
          allowClear
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          style={{ width: 150 }}
          options={['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'].map((value) => ({
            value,
            label: label(value),
          }))}
        />
        <span className="filter-count">共 {query.data?.total || 0} 门课程</span>
      </div>
      <QueryState query={query}>
        <div className="course-grid">
          {query.data?.items?.map((c: any, i: number) => (
            <Link key={c.id} to={`/courses/${c.id}`} className="mini-course full-course">
              <div
                className={`course-art art-${i % 4}`}
                style={
                  c.cover
                    ? {
                        backgroundImage: `linear-gradient(0deg, rgba(0,0,0,.3), rgba(0,0,0,.05)), url("${c.cover.replaceAll('"', '%22')}")`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }
                    : undefined
                }
              >
                {c.coverUrl ? (
                  <img src={c.coverUrl} alt="" />
                ) : (
                  <>
                    <BookOpen size={44} strokeWidth={1.5} />
                    <span>{c.category || '知识 · 实践'}</span>
                  </>
                )}
                <div className="course-status">
                  <Status value={c.status} />
                </div>
              </div>
              <div className="mini-course-body">
                <div className="course-meta">
                  {c.category || '通识课程'} · {c.teacherName || '课程学习'}
                </div>
                <h3>{c.title}</h3>
                <p className="course-description">{c.description || '进入课程，开始你的学习旅程。'}</p>
                <div className="course-progress-caption">
                  <span>{teacher ? '教学规模' : '学习进度'}</span>
                  <strong>
                    {teacher
                      ? `${c.studentCount || 0} 位学生`
                      : `${c.progressPercent ?? c.progress?.percent ?? 0}%`}
                  </strong>
                </div>
                {!teacher && (
                  <Progress
                    percent={c.progressPercent ?? c.progress?.percent ?? 0}
                    showInfo={false}
                    size="small"
                  />
                )}
                <div className="course-foot">
                  <span>{c.totalLessons ?? c._count?.lessons ?? 0} 个课时</span>
                  <span className="inline-link">
                    {teacher ? '管理课程' : '继续学习'}
                    <ArrowRight size={14} />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
        {!query.data?.items?.length && <EmptyState description="没有找到相关课程" />}
        {query.data?.total > 12 && (
          <div className="pagination-buttons">
            <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <span>第 {page} 页</span>
            <Button disabled={page * 12 >= query.data.total} onClick={() => setPage(page + 1)}>
              下一页
            </Button>
          </div>
        )}
      </QueryState>
      <Modal
        title="创建新课程"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={action.isPending}
        okText="创建课程"
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ status: 'DRAFT' }}
          onFinish={async (values) => {
            await action.mutateAsync({ path: '/courses', body: values });
            setOpen(false);
            form.resetFields();
          }}
        >
          <Form.Item name="title" label="课程名称" rules={[{ required: true, message: '请输入课程名称' }]}>
            <Input placeholder="例如：数学思维与应用" />
          </Form.Item>
          {isAdmin(user) && (
            <Form.Item
              name="teacherId"
              label="负责教师"
              rules={[{ required: true, message: '请选择负责教师' }]}
            >
              <RemoteSelect endpoint="/admin/people" params={{ role: 'TEACHER' }} />
            </Form.Item>
          )}
          <Form.Item name="description" label="课程简介">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="cover"
            label="课程封面地址"
            rules={[{ type: 'url', message: '请输入 HTTPS 图片地址' }]}
          >
            <Input placeholder="https://…" />
          </Form.Item>
          {isAdmin(user) && (
            <Form.Item name="termId" label="学期">
              <RemoteSelect endpoint="/admin/terms" allowClear />
            </Form.Item>
          )}
          <Form.Item name="category" label="课程分类">
            <AutoComplete
              options={(catalog.data?.courseCategories || []).map((value: string) => ({ value }))}
              placeholder="选择或输入课程分类"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
export function CourseDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const catalog = useData('/catalog');
  const query = useData(`/courses/${id}`);
  const action = useAction();
  const c = query.data;
  const teacher = isTeacher(user);
  const canEdit = teacher && c?.status !== 'ARCHIVED';
  const [memberPage, setMemberPage] = useState(1);
  const members = useData(`/courses/${id}/members?page=${memberPage}&pageSize=20`, teacher);
  const positions = useRef<Record<string, number>>({});
  const [lessonParams, setLessonParams] = useSearchParams();
  const [dialog, setDialog] = useState<string>();
  const [chapterId, setChapterId] = useState('');
  const [form] = Form.useForm();
  const [kind, setKind] = useState('student');
  const { message } = App.useApp();
  const chapters = c?.chapters || [];
  const availableLessons = chapters.flatMap((x: any) => x.lessons);
  const requestedLesson = lessonParams.get('lesson');
  const lesson = requestedLesson
    ? availableLessons.find((x: any) => x.id === requestedLesson)
    : availableLessons[0];
  async function save(values: any) {
    let path = `/courses/${id}`;
    let method = 'PATCH';
    if (dialog === 'chapter') {
      path += `/chapters`;
      method = 'POST';
    }
    if (dialog === 'lesson') {
      path = `/chapters/${chapterId}/lessons`;
      method = 'POST';
    }
    if (dialog === 'lesson-edit') {
      path = `/lessons/${lesson.id}`;
      method = 'PATCH';
    }
    if (dialog === 'chapter-edit') {
      path = `/chapters/${chapterId}`;
      method = 'PATCH';
    }
    if (dialog === 'member') {
      path += `/members`;
      method = 'POST';
      values.kind = kind;
    }
    if (values.opensAt) values.opensAt = new Date(values.opensAt + '+08:00').toISOString();
    else if (dialog?.startsWith('lesson')) values.opensAt = null;
    if (values.resourceUrl === '') values.resourceUrl = null;
    if (values.cover === '') values.cover = null;
    if (values.relatedTasks) values.relatedTasks = values.relatedTasks.filter((t: any) => t?.type && t?.id);
    if (values.sortOrder !== undefined) values.sortOrder = Number(values.sortOrder);
    await action.mutateAsync({ path, body: values, method });
    setDialog(undefined);
    form.resetFields();
  }
  function open(which: string, values?: any) {
    setDialog(which);
    form.resetFields();
    if (values)
      form.setFieldsValue({
        ...values,
        opensAt: values.opensAt
          ? new Date(new Date(values.opensAt).getTime() + 8 * 3600000).toISOString().slice(0, 16)
          : undefined,
      });
  }
  const resourceUrl = lesson?.attachmentId
    ? `/api/attachments/${lesson.attachmentId}/preview`
    : lesson?.resourceUrl;
  return (
    <QueryState query={query}>
      {c && (
        <>
          <Link className="back-link" to="/courses">
            ← 返回课程列表
          </Link>
          <PageTitle
            eyebrow={c.category || 'COURSE DETAIL'}
            title={c.title}
            description={c.description}
            extra={
              canEdit && (
                <Space>
                  <Status value={c.status} />
                  <Button onClick={() => open('edit', c)}>编辑课程</Button>
                  <Popconfirm
                    title={
                      c.status === 'PUBLISHED'
                        ? '下架后学生暂时无法访问课程，确认下架？'
                        : '向当前课程成员发布课程？'
                    }
                    onConfirm={() =>
                      action.mutateAsync({
                        path: `/courses/${id}`,
                        method: 'PATCH',
                        body: { status: c.status === 'PUBLISHED' ? 'UNPUBLISHED' : 'PUBLISHED' },
                      })
                    }
                  >
                    <Button type="primary">{c.status === 'PUBLISHED' ? '下架课程' : '发布课程'}</Button>
                  </Popconfirm>
                  <Popconfirm
                    title="归档后课程内容与配置不可再修改，历史访问保留。确认归档？"
                    onConfirm={() =>
                      action.mutateAsync({
                        path: `/courses/${id}`,
                        method: 'PATCH',
                        body: { status: 'ARCHIVED' },
                      })
                    }
                  >
                    <Button>归档课程</Button>
                  </Popconfirm>
                </Space>
              )
            }
          />
          <div className="course-detail-summary">
            <span>
              <BookOpen size={17} />
              {chapters.length} 个章节
            </span>
            <span>
              <Clock size={17} />
              {c.progress?.total ?? chapters.flatMap((x: any) => x.lessons).length} 个课时
            </span>
            <span>
              <Users size={17} />
              {c.memberCount || 0} 位成员
            </span>
            <div>
              <span>
                已完成 {c.progress?.completed || 0} / {c.progress?.total || 0}
              </span>
              <Progress percent={c.progress?.percent || 0} size="small" style={{ width: 150 }} />
            </div>
          </div>
          <Tabs
            items={[
              {
                key: 'content',
                label: '课程内容',
                children: (
                  <div className="learning-layout">
                    <Panel
                      title="课程目录"
                      extra={
                        canEdit && (
                          <Button
                            size="small"
                            type="text"
                            icon={<Plus size={16} />}
                            onClick={() => open('chapter')}
                          >
                            章节
                          </Button>
                        )
                      }
                      className="lesson-sidebar"
                    >
                      {chapters.length ? (
                        <Collapse
                          defaultActiveKey={chapters.map((x: any) => x.id)}
                          ghost
                          items={chapters.map((chapter: any, index: number) => ({
                            key: chapter.id,
                            label: (
                              <div className="list-title-line">
                                <strong>
                                  {String(index + 1).padStart(2, '0')}　{chapter.title}
                                </strong>
                                {canEdit && (
                                  <Button
                                    type="text"
                                    size="small"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setChapterId(chapter.id);
                                      open('chapter-edit', chapter);
                                    }}
                                  >
                                    编辑
                                  </Button>
                                )}
                              </div>
                            ),
                            children: (
                              <>
                                <div className="lesson-links">
                                  {chapter.lessons?.map((l: any) => (
                                    <button
                                      className={`lesson-link ${lesson?.id === l.id ? 'selected' : ''}`}
                                      key={l.id}
                                      onClick={() =>
                                        setLessonParams((previous) => {
                                          const next = new URLSearchParams(previous);
                                          next.set('lesson', l.id);
                                          return next;
                                        })
                                      }
                                    >
                                      {l.progress?.completed ? (
                                        <CheckCircle2 size={16} />
                                      ) : l.type === 'VIDEO' ? (
                                        <PlayCircle size={16} />
                                      ) : (
                                        <FileText size={16} />
                                      )}
                                      <span>{l.title}</span>
                                      {l.opensAt && new Date(l.opensAt) > new Date() && <Tag>未开放</Tag>}
                                    </button>
                                  ))}
                                </div>
                                {canEdit && (
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<Plus size={13} />}
                                    onClick={() => {
                                      setChapterId(chapter.id);
                                      open('lesson');
                                    }}
                                  >
                                    添加课时
                                  </Button>
                                )}
                              </>
                            ),
                          }))}
                        />
                      ) : (
                        <EmptyState description="课程内容正在筹备" />
                      )}
                    </Panel>
                    <Panel className="lesson-view">
                      {lesson ? (
                        <>
                          <div className="lesson-eyebrow">
                            <Tag bordered={false}>{label(lesson.type)}</Tag>
                            <span>按课时完成情况记录学习进度</span>
                          </div>
                          <div className="list-title-line">
                            <h2>{lesson.title}</h2>
                            {canEdit && (
                              <Button type="link" onClick={() => open('lesson-edit', lesson)}>
                                编辑课时
                              </Button>
                            )}
                          </div>
                          {lesson.opensAt && new Date(lesson.opensAt) > new Date() ? (
                            <Alert type="info" showIcon message={`此课时将于 ${date(lesson.opensAt)} 开放`} />
                          ) : (
                            <>
                              <div className="lesson-content">
                                <RichContent content={lesson.content || '请学习本课时提供的课程资源。'} />
                              </div>
                              {resourceUrl && lesson.type === 'VIDEO' ? (
                                <video
                                  key={lesson.id}
                                  controls
                                  onLoadedMetadata={(event) => {
                                    event.currentTarget.currentTime = lesson.progress?.positionSeconds || 0;
                                  }}
                                  className="lesson-video"
                                  src={resourceUrl}
                                  onTimeUpdate={(event) => {
                                    const video = event.currentTarget;
                                    positions.current[lesson.id] = Math.floor(video.currentTime);
                                    if (
                                      !teacher &&
                                      Math.floor(video.currentTime) % 30 === 0 &&
                                      Number(video.dataset.savedSecond) !== Math.floor(video.currentTime)
                                    ) {
                                      video.dataset.savedSecond = String(Math.floor(video.currentTime));
                                      api(`/lessons/${lesson.id}/progress`, {
                                        method: 'PUT',
                                        body: JSON.stringify({
                                          positionSeconds: Math.floor(video.currentTime),
                                          completed: !!lesson.progress?.completed,
                                        }),
                                      }).catch(() => {});
                                    }
                                  }}
                                />
                              ) : (
                                resourceUrl && (
                                  <a
                                    href={resourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="resource-link"
                                  >
                                    <ExternalLink size={18} />
                                    打开课时学习资源
                                  </a>
                                )
                              )}
                              {!!lesson.relatedTasks?.length && (
                                <div style={{ margin: '20px 0' }}>
                                  <h3>本课时学习任务</h3>
                                  <Space wrap>
                                    {lesson.relatedTasks.map((task: any, i: number) => (
                                      <Link
                                        key={task.type + task.id}
                                        to={
                                          task.type === 'practice'
                                            ? `/practice?courseId=${id}&chapterId=${task.id}`
                                            : `/${task.type === 'exam' ? 'exams' : 'assignments'}/${task.id}`
                                        }
                                      >
                                        <Button>
                                          {task.type === 'practice'
                                            ? '章节练习'
                                            : task.type === 'exam'
                                              ? '关联考试'
                                              : '关联作业'}{' '}
                                          {i + 1}
                                        </Button>
                                      </Link>
                                    ))}
                                  </Space>
                                </div>
                              )}
                              <LessonNote key={lesson.id} lessonId={lesson.id} />
                              <div className="lesson-bottom">
                                <span>
                                  <CheckCircle2 size={16} />
                                  {lesson.progress?.completed
                                    ? '你已完成此课时'
                                    : '学完后，标记完成以保存学习进度'}
                                </span>
                                <Button
                                  type="primary"
                                  loading={action.isPending}
                                  disabled={teacher}
                                  title={teacher ? '教师预览课时，不记录个人学习进度' : undefined}
                                  onClick={() =>
                                    action.mutate({
                                      path: `/lessons/${lesson.id}/progress`,
                                      method: 'PUT',
                                      body: {
                                        completed: !lesson.progress?.completed,
                                        positionSeconds:
                                          positions.current[lesson.id] ??
                                          lesson.progress?.positionSeconds ??
                                          0,
                                      },
                                    })
                                  }
                                >
                                  {lesson.progress?.completed ? '取消完成标记' : '我已完成学习'}
                                </Button>
                              </div>
                            </>
                          )}
                        </>
                      ) : (
                        <EmptyState description="请选择左侧课时开始学习" />
                      )}
                    </Panel>
                  </div>
                ),
              },
              {
                key: 'announcements',
                label: '课程公告',
                children: <CourseAnnouncements courseId={id!} teacher={teacher} />,
              },
              {
                key: 'members',
                label: '课程成员',
                children: (
                  <Panel
                    title="课程成员"
                    extra={
                      canEdit && (
                        <Button icon={<Plus size={16} />} onClick={() => open('member')}>
                          添加成员
                        </Button>
                      )
                    }
                  >
                    <Table
                      rowKey="id"
                      dataSource={members.data?.items || []}
                      pagination={{
                        current: memberPage,
                        pageSize: 20,
                        total: members.data?.total || 0,
                        onChange: setMemberPage,
                      }}
                      columns={[
                        { title: '姓名', render: (_, r: any) => r.user?.name || r.name },
                        { title: '账号', render: (_, r: any) => r.user?.username || r.username },
                        {
                          title: '成员身份',
                          render: (_, r: any) => (r.kind === 'teacher' ? '授课教师' : '学生'),
                        },
                        ...(teacher
                          ? [
                              {
                                title: '操作',
                                render: (_: any, r: any) => (
                                  <Popconfirm
                                    title="移除此课程成员？历史学习记录将保留。"
                                    onConfirm={() =>
                                      action.mutateAsync({
                                        path: `/courses/${id}/members/${r.userId}?kind=${r.kind}`,
                                        method: 'DELETE',
                                      })
                                    }
                                  >
                                    <Button type="link" danger>
                                      移除
                                    </Button>
                                  </Popconfirm>
                                ),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </Panel>
                ),
              },
              {
                key: 'activities',
                label: '学习任务',
                children: (
                  <div className="task-shortcuts">
                    <Link to={`/assignments?courseId=${id}`}>
                      <ClipboardIcon />
                      <strong>课程作业</strong>
                      <span>查看作业与批改反馈</span>
                      <ArrowRight size={18} />
                    </Link>
                    <Link to={`/exams?courseId=${id}`}>
                      <BookOpen size={24} />
                      <strong>课程考试</strong>
                      <span>查看考试安排与成绩</span>
                      <ArrowRight size={18} />
                    </Link>
                    <Link to={`/communication?courseId=${id}`}>
                      <Users size={24} />
                      <strong>课程讨论</strong>
                      <span>提问、交流与共同探索</span>
                      <ArrowRight size={18} />
                    </Link>
                  </div>
                ),
              },
            ]}
          />
          <Modal
            title={
              dialog === 'chapter'
                ? '添加章节'
                : dialog === 'chapter-edit'
                  ? '编辑章节'
                  : dialog === 'lesson-edit'
                    ? '编辑课时'
                    : dialog === 'lesson'
                      ? '添加课时'
                      : dialog === 'member'
                        ? '添加课程成员'
                        : '编辑课程'
            }
            open={!!dialog}
            onCancel={() => setDialog(undefined)}
            onOk={() => form.submit()}
            confirmLoading={action.isPending}
          >
            <Form
              form={form}
              layout="vertical"
              onFinish={save}
              initialValues={{ type: 'TEXT', sortOrder: 0 }}
            >
              {dialog === 'member' ? (
                <>
                  <Form.Item label="成员身份">
                    <Select
                      value={kind}
                      onChange={setKind}
                      options={[
                        { value: 'student', label: '学生' },
                        ...(isAdmin(user) ? [{ value: 'teacher', label: '授课教师' }] : []),
                      ]}
                    />
                  </Form.Item>
                  <Form.Item
                    name="userId"
                    label="选择成员"
                    rules={[{ required: true, message: '请选择成员' }]}
                  >
                    <RemoteSelect
                      endpoint="/admin/people"
                      params={{ role: kind === 'teacher' ? 'TEACHER' : 'STUDENT' }}
                      labelFor={(p) => `${p.name}（${p.username}）`}
                    />
                  </Form.Item>
                </>
              ) : (
                <>
                  <Form.Item name="title" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                    <Input />
                  </Form.Item>
                  {dialog === 'edit' && (
                    <>
                      <Form.Item name="description" label="简介">
                        <Input.TextArea rows={3} />
                      </Form.Item>
                      <Form.Item name="category" label="分类">
                        <AutoComplete
                          options={(catalog.data?.courseCategories || []).map((value: string) => ({ value }))}
                          placeholder="选择或输入课程分类"
                        />
                      </Form.Item>
                      <Form.Item name="cover" label="封面图片地址">
                        <Input placeholder="https://…" />
                      </Form.Item>
                      {isAdmin(user) && (
                        <Form.Item name="termId" label="学期">
                          <RemoteSelect endpoint="/admin/terms" allowClear />
                        </Form.Item>
                      )}
                      {isAdmin(user) && (
                        <Form.Item name="teacherId" label="负责教师（变更即交接）">
                          <RemoteSelect endpoint="/admin/people" params={{ role: 'TEACHER' }} />
                        </Form.Item>
                      )}
                    </>
                  )}
                  {dialog?.startsWith('lesson') && (
                    <>
                      <Form.Item name="type" label="课时类型">
                        <Select
                          options={['TEXT', 'VIDEO', 'PDF', 'DOCUMENT', 'LINK'].map((value) => ({
                            value,
                            label: label(value),
                          }))}
                        />
                      </Form.Item>
                      <Form.Item name="content" label="图文内容">
                        <RichTextEditor
                          courseId={id}
                          allowPrivateImages={user?.permissions.includes('file.upload')}
                        />
                      </Form.Item>
                      <Form.Item name="resourceUrl" label="资源链接">
                        <Input placeholder="https://… 或已上传资源的下载链接" />
                      </Form.Item>
                      <Form.Item name="attachmentId" hidden>
                        <Input />
                      </Form.Item>
                      <Upload
                        disabled={!user?.permissions.includes('file.upload')}
                        showUploadList={false}
                        customRequest={async (options) => {
                          try {
                            const data = new FormData();
                            data.append('file', options.file as Blob);
                            data.append('courseId', id!);
                            const file = await api('/attachments', { method: 'POST', body: data });
                            form.setFieldValue('attachmentId', file.id);
                            form.setFieldValue('resourceUrl', undefined);
                            options.onSuccess?.(file);
                            message.success('资源上传成功');
                          } catch (e) {
                            options.onError?.(e as Error);
                            message.error((e as Error).message);
                          }
                        }}
                      >
                        <Button icon={<UploadIcon size={16} />}>上传课程资源</Button>
                      </Upload>
                      <Form.Item name="opensAt" label="开放时间" style={{ marginTop: 16 }}>
                        <Input type="datetime-local" />
                      </Form.Item>
                      <Form.List name="relatedTasks">
                        {(fields, { add, remove }) => (
                          <>
                            <p>关联学习任务</p>
                            {fields.map((field) => (
                              <div key={field.key} style={{ marginBottom: 10 }}>
                                <Space align="start">
                                  <Form.Item name={[field.name, 'type']} rules={[{ required: true }]}>
                                    <Select
                                      style={{ width: 120 }}
                                      options={[
                                        { value: 'practice', label: '章节练习' },
                                        { value: 'assignment', label: '作业' },
                                        { value: 'exam', label: '考试' },
                                      ]}
                                      onChange={() =>
                                        form.setFieldValue(['relatedTasks', field.name, 'id'], undefined)
                                      }
                                    />
                                  </Form.Item>
                                  <Button danger onClick={() => remove(field.name)}>
                                    移除
                                  </Button>
                                </Space>
                                <Form.Item noStyle shouldUpdate>
                                  {() => {
                                    const type = form.getFieldValue(['relatedTasks', field.name, 'type']);
                                    return (
                                      <Form.Item
                                        name={[field.name, 'id']}
                                        rules={[{ required: true, message: '请选择关联任务' }]}
                                      >
                                        {type === 'practice' ? (
                                          <Select
                                            options={chapters.map((ch: any) => ({
                                              value: ch.id,
                                              label: ch.title,
                                            }))}
                                            placeholder="选择章节"
                                          />
                                        ) : (
                                          <RemoteSelect
                                            endpoint={type === 'exam' ? '/exams' : '/assignments'}
                                            params={{ courseId: id }}
                                            labelField="title"
                                          />
                                        )}
                                      </Form.Item>
                                    );
                                  }}
                                </Form.Item>
                              </div>
                            ))}
                            <Button
                              onClick={() => add({ type: 'practice', id: chapterId || lesson?.chapterId })}
                            >
                              添加关联任务
                            </Button>
                          </>
                        )}
                      </Form.List>
                    </>
                  )}
                  {dialog !== 'edit' && (
                    <Form.Item name="sortOrder" label="排序序号">
                      <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                  )}
                </>
              )}
            </Form>
          </Modal>
        </>
      )}
    </QueryState>
  );
}
function ClipboardIcon() {
  return <FileText size={24} />;
}

function CourseAnnouncements({ courseId, teacher }: { courseId: string; teacher: boolean }) {
  const [page, setPage] = useState(1);
  const query = useData(`/announcements?courseId=${courseId}&pageSize=20&page=${page}`);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const action = useAction('课程公告已发布');
  return (
    <Panel
      title="课程公告"
      extra={
        teacher && (
          <Button type="primary" icon={<Plus size={15} />} onClick={() => setOpen(true)}>
            发布公告
          </Button>
        )
      }
    >
      <QueryState query={query}>
        {query.data?.items?.length ? (
          query.data.items.map((a: any) => (
            <div key={a.id} className="announcement-item">
              <div className="announcement-meta">
                课程公告<span>{date(a.createdAt)}</span>
              </div>
              <h3>{a.title}</h3>
              <p style={{ display: 'block', whiteSpace: 'pre-wrap', fontSize: 12 }}>{a.content}</p>
            </div>
          ))
        ) : (
          <EmptyState description="暂无课程公告" />
        )}
      </QueryState>
      <Pagination
        current={page}
        pageSize={20}
        total={query.data?.total || 0}
        onChange={setPage}
        hideOnSinglePage
        showSizeChanger={false}
      />
      <Modal
        title="发布课程公告"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={action.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            await action.mutateAsync({ path: '/announcements', body: { ...values, courseId } });
            setOpen(false);
            form.resetFields();
          }}
        >
          <Form.Item name="title" label="公告标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="content" label="公告内容" rules={[{ required: true, message: '请输入内容' }]}>
            <Input.TextArea rows={6} />
          </Form.Item>
          <p className="form-hint">公告发布后会通知当前课程的学生。</p>
        </Form>
      </Modal>
    </Panel>
  );
}
