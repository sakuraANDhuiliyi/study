import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Form, Input, Modal, Popconfirm, Segmented, Select, Spin, Tag } from 'antd';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  List,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError, api, queryString, send, useData } from '../api';
import { EmptyState, PageTitle, QueryState, useUnsavedWarning } from '../components/shared';
import {
  plannerDay,
  plannerEventOnDay,
  plannerISO,
  plannerLocalTime,
  plannerMonthDays,
  plannerMonthShift,
  plannerRange,
} from '../planner-time';
import '../planner.css';

type EventType = 'assignment' | 'exam' | 'personal';
type PlannerEvent = {
  id: string;
  type: EventType;
  title: string;
  startAt: string;
  endAt?: string;
  originalDueAt?: string;
  entryClosesAt?: string;
  courseId?: string;
  courseTitle?: string;
  path?: string;
  status: string;
  description?: string;
  revision?: number;
  completedAt?: string | null;
};
type PlannerData = { items: PlannerEvent[]; truncated: boolean; timezone: string; serverTime: string };
type PersonalTask = {
  id: string;
  title: string;
  description: string;
  dueAt: string;
  revision: number;
  completedAt?: string | null;
};
type FormValues = { title: string; description?: string; dueAt: string };
const typeLabels: Record<EventType, string> = { assignment: '作业', exam: '考试', personal: '个人待办' };
const statusLabels: Record<string, string> = {
  pending: '待完成',
  not_submitted: '待提交',
  completed: '已完成',
  overdue: '已逾期',
  submitted: '已提交',
  returned: '待重交',
  exempt: '已豁免',
  upcoming: '尚未开始',
  in_progress: '进行中',
  closed: '已结束',
  cancelled: '已取消',
  ineligible: '无参考资格',
  draft: '草稿',
  published: '已发布',
  scheduled: '已安排',
  available: '可参与',
  open: '可参与',
  timed_out: '超时交卷',
};
const fullDate = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
const eventTime = (value: string) => plannerLocalTime(value).slice(11);
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(`${day}T12:00:00+08:00`));
const eventPath = (event: PlannerEvent) =>
  event.path && /^\/(?:assignments|exams|attempts|exam-attempts|courses)\/[a-zA-Z0-9_-]+$/.test(event.path)
    ? event.path
    : undefined;

export function Planner() {
  const today = plannerDay();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDay, setSelectedDay] = useState(today);
  const [view, setView] = useState<'month' | 'agenda'>(() =>
    window.matchMedia('(max-width: 700px)').matches ? 'agenda' : 'month',
  );
  const [type, setType] = useState<'all' | EventType>('all');
  const [editing, setEditing] = useState<PersonalTask | 'new' | null>(null);
  const [detail, setDetail] = useState<PlannerEvent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState<string>();
  const [error, setError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const { message, modal } = App.useApp();
  const cache = useQueryClient();
  const days = plannerMonthDays(month);
  const range = plannerRange(month);
  const query = useData<PlannerData>(`/planner?${queryString({ ...range, type })}`, true, 60000);
  const items = [...(query.data?.items || [])].sort(
    (a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id),
  );
  const forDay = (day: string) => items.filter((item) => plannerEventOnDay(item, day));
  const monthStart = `${month}-01`;
  const nextMonthStart = `${plannerMonthShift(month, 1)}-01`;
  const monthStartAt = plannerISO(`${monthStart}T00:00`);
  const monthEndAt = plannerISO(`${nextMonthStart}T00:00`);
  const monthItems = items.filter((item) =>
    item.type === 'exam' && item.endAt
      ? item.startAt < monthEndAt && item.endAt > monthStartAt
      : plannerDay(item.startAt).startsWith(month),
  );
  const agendaDay = (item: PlannerEvent) =>
    plannerDay(item.startAt) < monthStart ? monthStart : plannerDay(item.startAt);
  const agendaDays = [...new Set(monthItems.map(agendaDay))].sort();
  useUnsavedWarning(!!editing && dirty);
  async function refresh() {
    await cache.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('/planner'),
    });
  }
  function changeMonth(value: string) {
    setMonth(value);
    setSelectedDay(value === today.slice(0, 7) ? today : `${value}-01`);
  }
  function createTask() {
    setEditing('new');
    setDirty(false);
    setConflict(false);
    setFormError(undefined);
    form.resetFields();
    form.setFieldsValue({ title: '', description: '', dueAt: `${selectedDay}T18:00` });
  }
  function editTask(item: PlannerEvent) {
    setEditing({
      id: item.id,
      title: item.title,
      description: item.description || '',
      dueAt: item.startAt,
      revision: item.revision!,
      completedAt: item.completedAt,
    });
    setDirty(false);
    setConflict(false);
    setFormError(undefined);
    form.resetFields();
    form.setFieldsValue({
      title: item.title,
      description: item.description || '',
      dueAt: plannerLocalTime(item.startAt),
    });
  }
  function closeEditor() {
    if (busy) return;
    if (dirty) {
      modal.confirm({
        title: '放弃未保存的修改？',
        content: '本次修改尚未保存。',
        okText: '放弃修改',
        cancelText: '继续编辑',
        onOk: () => {
          setEditing(null);
          setDirty(false);
        },
      });
    } else setEditing(null);
  }
  async function save(values: FormValues) {
    if (!editing) return;
    setBusy(true);
    setFormError(undefined);
    try {
      const dueAt = plannerISO(values.dueAt);
      const task: PersonalTask = await send(
        editing === 'new' ? '/planner/tasks' : `/planner/tasks/${editing.id}`,
        {
          title: values.title.trim(),
          description: values.description?.trim() || '',
          dueAt,
          ...(editing === 'new' ? {} : { revision: editing.revision }),
        },
        editing === 'new' ? 'POST' : 'PATCH',
      );
      setEditing(null);
      setDirty(false);
      setConflict(false);
      setSelectedDay(plannerDay(task.dueAt));
      setMonth(plannerDay(task.dueAt).slice(0, 7));
      if (type !== 'all' && type !== 'personal') setType('personal');
      await refresh();
      message.success('个人待办已保存');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存失败，请重试');
      setConflict(e instanceof ApiError && e.status === 409);
    } finally {
      setBusy(false);
    }
  }
  async function reloadVersion() {
    if (!editing || editing === 'new') return;
    setBusy(true);
    try {
      const task = await api<PersonalTask>(`/planner/tasks/${editing.id}`);
      setEditing(task);
      setConflict(false);
      setFormError(undefined);
      message.info('已获取最新版本，保留了你的输入。请核对后再次保存。');
      await refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '刷新失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  }
  async function toggle(item: PlannerEvent) {
    if (pendingId) return;
    setPendingId(item.id);
    setError(undefined);
    try {
      await send(
        `/planner/tasks/${item.id}`,
        { revision: item.revision, completed: !item.completedAt },
        'PATCH',
      );
      await refresh();
      message.success(item.completedAt ? '已重新打开待办' : '待办已完成');
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，请重试');
      if (e instanceof ApiError && e.status === 409) await refresh();
    } finally {
      setPendingId(undefined);
    }
  }
  async function removeTask() {
    if (!editing || editing === 'new') return;
    setBusy(true);
    try {
      await send(`/planner/tasks/${editing.id}`, { revision: editing.revision }, 'DELETE');
      setEditing(null);
      setDirty(false);
      await refresh();
      message.success('个人待办已删除');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '删除失败，请重试');
      setConflict(e instanceof ApiError && e.status === 409);
    } finally {
      setBusy(false);
    }
  }
  function eventCard(item: PlannerEvent) {
    const done = !!item.completedAt || ['completed', 'submitted', 'exempt'].includes(item.status);
    return (
      <div
        className={`planner-event planner-event-${item.type} ${done ? 'planner-event-done' : ''}`}
        key={item.id}
        data-testid={`planner-event-${item.id}`}
      >
        <div className="planner-event-summary">
          <div className="planner-event-meta">
            <span className={`planner-type planner-type-${item.type}`}>{typeLabels[item.type]}</span>
            <time>
              <Clock3 size={13} />
              {item.type === 'exam' ? fullDate(item.startAt) : eventTime(item.startAt)}
            </time>
            <Tag>{statusLabels[item.status] || '已安排'}</Tag>
          </div>
          <button
            className="planner-event-title"
            onClick={() => (item.type === 'personal' ? editTask(item) : setDetail(item))}
          >
            {item.title}
          </button>
          {item.courseTitle && <p className="planner-course-name">{item.courseTitle}</p>}
          {item.description && <p className="planner-event-description">{item.description}</p>}
          {item.originalDueAt && item.originalDueAt !== item.startAt && (
            <p className="planner-event-note">原截止：{fullDate(item.originalDueAt)} · 当前显示个人安排</p>
          )}
          {item.endAt && <p className="planner-event-note">结束：{fullDate(item.endAt)}</p>}
        </div>
        {item.type === 'personal' ? (
          <Button
            size="small"
            icon={item.completedAt ? <RotateCcw size={14} /> : <Check size={14} />}
            aria-label={`${item.completedAt ? '重开' : '完成'} ${item.title}`}
            loading={pendingId === item.id}
            disabled={!!pendingId && pendingId !== item.id}
            onClick={() => void toggle(item)}
          >
            {item.completedAt ? '重开' : '完成'}
          </Button>
        ) : (
          eventPath(item) && (
            <Link className="planner-open" to={eventPath(item)!}>
              查看
              <ChevronRight size={14} />
            </Link>
          )
        )}
      </div>
    );
  }
  return (
    <div className="planner-page">
      <PageTitle
        title="学习计划与日历"
        description="统一查看作业、考试与个人待办。所有时间均为北京时间。"
        extra={
          <Button type="primary" icon={<Plus size={16} />} onClick={createTask}>
            新建个人待办
          </Button>
        }
      />
      <div className="planner-toolbar">
        <div className="planner-month-controls">
          <Button
            aria-label="上个月"
            icon={<ChevronLeft size={16} />}
            onClick={() => changeMonth(plannerMonthShift(month, -1))}
          />
          <h2>
            {month.split('-')[0]} 年 {Number(month.split('-')[1])} 月
          </h2>
          <Button
            aria-label="下个月"
            icon={<ChevronRight size={16} />}
            onClick={() => changeMonth(plannerMonthShift(month, 1))}
          />
          <Button
            onClick={() => {
              setMonth(today.slice(0, 7));
              setSelectedDay(today);
            }}
          >
            今天
          </Button>
        </div>
        <div className="planner-view-controls">
          <Select
            aria-label="日程类型"
            value={type}
            onChange={setType}
            options={[
              { value: 'all', label: '全部类型' },
              ...Object.entries(typeLabels).map(([value, label]) => ({ value, label })),
            ]}
          />
          <Segmented
            aria-label="日历视图"
            value={view}
            onChange={(v) => setView(v as 'month' | 'agenda')}
            options={[
              { label: '月历', value: 'month', icon: <CalendarDays size={15} /> },
              { label: '日程', value: 'agenda', icon: <List size={15} /> },
            ]}
          />
          <Button
            aria-label="刷新日历"
            icon={<RotateCcw size={15} />}
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          />
        </div>
      </div>
      {error && (
        <Alert
          type="error"
          showIcon
          closable
          message={error}
          onClose={() => setError(undefined)}
          action={
            <Button size="small" onClick={() => void refresh()}>
              刷新日历
            </Button>
          }
        />
      )}
      <QueryState query={query}>
        {query.data?.truncated && (
          <Alert
            type="warning"
            showIcon
            message="当前时间范围内的日程较多，仅显示部分记录。请按类型筛选，或前往作业、考试页面查看完整列表。"
          />
        )}
        {query.data &&
          (view === 'month' ? (
            <div className="planner-layout">
              <section className="planner-month" aria-label="月历">
                <div className="planner-weekdays" aria-hidden="true">
                  {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                <div className="planner-day-grid">
                  {days.map((day) => {
                    const events = forDay(day);
                    return (
                      <div
                        key={day}
                        className={`planner-day-cell ${!day.startsWith(month) ? 'planner-other-month' : ''} ${day === selectedDay ? 'planner-day-selected' : ''} ${day === today ? 'planner-day-today' : ''}`}
                      >
                        <button
                          className="planner-day-select"
                          aria-label={`${day}，${events.length} 项日程`}
                          aria-pressed={selectedDay === day}
                          onClick={() => setSelectedDay(day)}
                        >
                          <span>{Number(day.slice(-2))}</span>
                        </button>
                        <div className="planner-day-events">
                          {events.slice(0, 2).map((item) => (
                            <button
                              key={item.id}
                              className={`planner-calendar-event planner-calendar-${item.type} ${item.completedAt ? 'planner-calendar-done' : ''}`}
                              title={`${fullDate(item.startAt)} ${item.title}${item.endAt ? `，结束 ${fullDate(item.endAt)}` : ''}`}
                              onClick={() => {
                                setSelectedDay(day);
                                if (item.type === 'personal') editTask(item);
                                else setDetail(item);
                              }}
                            >
                              <span>
                                {plannerDay(item.startAt) === day ? eventTime(item.startAt) : '跨日'}
                              </span>{' '}
                              {item.title}
                            </button>
                          ))}
                          {events.length > 2 && (
                            <button className="planner-more-events" onClick={() => setSelectedDay(day)}>
                              还有 {events.length - 2} 项
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="planner-legend">
                  {Object.entries(typeLabels).map(([key, name]) => (
                    <span key={key} className={`planner-type planner-type-${key}`}>
                      {name}
                    </span>
                  ))}
                  <span>Asia/Shanghai</span>
                </div>
              </section>
              <section className="planner-day-agenda" aria-label="所选日期日程">
                <div className="planner-section-heading">
                  <div>
                    <h2>{dayLabel(selectedDay)}</h2>
                    <p>{forDay(selectedDay).length} 项日程</p>
                  </div>
                  <Button
                    size="small"
                    aria-label="在所选日期添加待办"
                    icon={<Plus size={16} />}
                    onClick={createTask}
                  />
                </div>
                {forDay(selectedDay).length ? (
                  forDay(selectedDay).map(eventCard)
                ) : (
                  <EmptyState description="当天没有日程">
                    <Button onClick={createTask}>添加个人待办</Button>
                  </EmptyState>
                )}
              </section>
            </div>
          ) : (
            <section className="planner-agenda-view" aria-label="本月日程列表">
              <div className="planner-section-heading">
                <h2>本月日程</h2>
                <span>{monthItems.length} 项</span>
              </div>
              {agendaDays.length ? (
                agendaDays.map((day) => (
                  <div className="planner-agenda-day" key={day}>
                    <h3>
                      {dayLabel(day)}
                      {day === today && <Tag color="blue">今天</Tag>}
                    </h3>
                    <div>{monthItems.filter((item) => agendaDay(item) === day).map(eventCard)}</div>
                  </div>
                ))
              ) : (
                <EmptyState description="本月暂无符合筛选条件的日程">
                  <Button onClick={createTask}>新建个人待办</Button>
                </EmptyState>
              )}
            </section>
          ))}
      </QueryState>
      <Modal
        title={editing === 'new' ? '新建个人待办' : '编辑个人待办'}
        open={!!editing}
        onCancel={closeEditor}
        destroyOnClose
        footer={
          <div className="planner-modal-footer">
            {editing && editing !== 'new' && (
              <Popconfirm
                title="删除这项个人待办？"
                description="删除不会影响任何作业、考试或学习记录。"
                okText="删除"
                cancelText="保留"
                onConfirm={removeTask}
              >
                <Button danger icon={<Trash2 size={14} />} disabled={busy}>
                  删除待办
                </Button>
              </Popconfirm>
            )}
            <div>
              <Button onClick={closeEditor} disabled={busy}>
                取消
              </Button>
              <Button type="primary" loading={busy} onClick={() => form.submit()}>
                {editing === 'new' ? '创建待办' : '保存修改'}
              </Button>
            </div>
          </div>
        }
      >
        {formError && (
          <Alert
            type={conflict ? 'warning' : 'error'}
            showIcon
            message={formError}
            description={conflict ? '你的输入仍然保留。请刷新版本并核对后重试。' : undefined}
            action={
              conflict && (
                <Button size="small" loading={busy} onClick={() => void reloadVersion()}>
                  保留输入并刷新版本
                </Button>
              )
            }
          />
        )}
        <Form
          form={form}
          layout="vertical"
          onFinish={save}
          onValuesChange={() => setDirty(true)}
          className="planner-task-form"
        >
          <Form.Item
            name="title"
            label="待办标题"
            rules={[
              { required: true, whitespace: true, message: '请填写待办标题' },
              { max: 160, message: '标题最多 160 字' },
            ]}
          >
            <Input maxLength={160} placeholder="例如：复习第三章并整理错题" disabled={busy} />
          </Form.Item>
          <Form.Item
            name="dueAt"
            label="计划时间（北京时间）"
            rules={[
              { required: true, message: '请选择计划时间' },
              {
                validator: async (_, value) => {
                  if (value) plannerISO(value);
                },
              },
            ]}
          >
            <Input type="datetime-local" min="2000-01-01T00:00" max="2100-12-31T23:59" disabled={busy} />
          </Form.Item>
          <Form.Item name="description" label="备注" rules={[{ max: 10000, message: '备注最多 10000 字' }]}>
            <Input.TextArea
              rows={4}
              maxLength={10000}
              showCount
              placeholder="记录你的学习目标或准备事项，仅自己可见"
              disabled={busy}
            />
          </Form.Item>
          <p className="planner-private-note">个人待办仅自己可见。完成待办不会提交作业或改变考试成绩。</p>
        </Form>
      </Modal>
      <Modal
        title={detail?.title}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={
          <>
            <Button onClick={() => setDetail(null)}>关闭</Button>
            {detail && eventPath(detail) && (
              <Link to={eventPath(detail)!}>
                <Button type="primary">{detail.type === 'assignment' ? '查看作业' : '查看考试'}</Button>
              </Link>
            )}
          </>
        }
      >
        {detail && (
          <div className="planner-event-detail">
            <Tag color={detail.type === 'exam' ? 'orange' : 'blue'}>{typeLabels[detail.type]}</Tag>
            <Tag>{statusLabels[detail.status] || '已安排'}</Tag>
            {detail.courseTitle && (
              <p>
                <strong>所属课程</strong>
                {detail.courseTitle}
              </p>
            )}
            <p>
              <strong>{detail.type === 'exam' ? '考试开始' : '计划截止'}</strong>
              {fullDate(detail.startAt)}
            </p>
            {detail.originalDueAt && detail.originalDueAt !== detail.startAt && (
              <p>
                <strong>原截止时间</strong>
                {fullDate(detail.originalDueAt)}
              </p>
            )}
            {detail.entryClosesAt && (
              <p>
                <strong>最晚进入</strong>
                {fullDate(detail.entryClosesAt)}
              </p>
            )}
            {detail.endAt && (
              <p>
                <strong>结束时间</strong>
                {fullDate(detail.endAt)}
              </p>
            )}
            {detail.description && <div className="planner-detail-description">{detail.description}</div>}
            <p className="planner-private-note">
              具体参与资格和时间限制以作业或考试页面为准。时间均为北京时间。
            </p>
          </div>
        )}
      </Modal>
      {query.isFetching && query.data && (
        <span className="planner-refreshing" aria-live="polite">
          <Spin size="small" /> 正在同步日程
        </span>
      )}
    </div>
  );
}
