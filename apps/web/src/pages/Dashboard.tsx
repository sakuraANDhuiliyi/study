import type { ReactNode } from 'react';
import { Button, Progress } from 'antd';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileCheck2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useData, date, isTeacher, isAdmin, getCsrf } from '../api';
import { Chart, chartTheme, EmptyState, QueryState, RichContent } from '../components/shared';
import '../dashboard.css';
import { Academics } from './Academics';
import { ActionPanel } from '../components/learning/ActionPanel';
import {
  overviewAuthorization,
  overviewOwner,
  StudentOverviewState,
  useStudentOverview,
  type StudentOverviewIdentity,
} from '../components/learning/StudentOverview';
import '../components/learning/student-overview.css';

function DashboardPanel({
  title,
  description,
  extra,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`lms-dash-panel ${className}`}>
      <div className="lms-dash-panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}
function DashboardLink({ to, children = '查看全部' }: { to: string; children?: ReactNode }) {
  return (
    <Link to={to} className="lms-dash-link">
      {children}
      <ChevronRight size={15} aria-hidden="true" />
    </Link>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  return user?.accountMode === 'PERSONAL' ? <Academics home /> : <OrganizationDashboard />;
}
function OrganizationDashboard() {
  const { user } = useAuth();
  if (user?.role === 'STUDENT') {
    const identity = {
      owner: overviewOwner(user),
      authorization: overviewAuthorization(user),
      csrf: getCsrf(),
    };
    return (
      <StudentOrganizationDashboard key={`${identity.authorization}:${identity.csrf}`} identity={identity} />
    );
  }
  return <StaffOrganizationDashboard />;
}
function StudentOrganizationDashboard({ identity }: { identity: StudentOverviewIdentity }) {
  const { user } = useAuth();
  const canReadDashboard =
    !!user?.permissions.includes('course.read') && !!user.permissions.includes('learning.use');
  const query = useStudentOverview(identity, canReadDashboard);
  return <OrganizationDashboardContent query={query} canReadDashboard={canReadDashboard} student />;
}
function StaffOrganizationDashboard() {
  const query = useData('/dashboard');
  return <OrganizationDashboardContent query={query} canReadDashboard />;
}
function OrganizationDashboardContent({
  query,
  canReadDashboard,
  student = false,
}: {
  query: any;
  canReadDashboard: boolean;
  student?: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const OverviewGate = student ? StudentOverviewState : QueryState;
  const d = query.data;
  const teacher = isTeacher(user);
  const admin = isAdmin(user);
  const platform = !!user?.permissions.includes('org.platform');
  const can = (permission: string) => !!user?.permissions.includes(permission);
  const today = new Date();
  const hour = Number(
    today.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Shanghai' }),
  );
  const greeting = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';
  const mainAction = admin
    ? { path: '/admin/users', label: '管理机构成员', permission: 'users.manage' }
    : teacher
      ? { path: '/assignments', label: '查看教学任务', permission: 'assessment.manage' }
      : { path: '/practice', label: '开始今日练习', permission: 'learning.use' };
  const metricIcons = platform
    ? [Building2, Users, AlertCircle, Activity]
    : admin
      ? [Users, Building2, BookOpen, ShieldCheck]
      : teacher
        ? [BookOpen, ClipboardList, FileCheck2, Bell]
        : [BookOpen, ClipboardList, CalendarDays, CheckCheck];
  const managementLinks = [
    {
      path: '/admin/users',
      title: '用户与角色',
      description: '账号状态与权限分配',
      permission: 'users.manage',
      icon: Users,
    },
    {
      path: '/admin/organization',
      title: '组织与教学',
      description: '班级、学期与授课安排',
      permission: 'org.manage',
      icon: Building2,
    },
    {
      path: '/admin/moderation',
      title: '内容治理',
      description: '举报处理与禁言记录',
      permission: 'communication.moderate',
      icon: ShieldCheck,
    },
    {
      path: '/admin/audit',
      title: '安全审计',
      description: '关键操作与运行记录',
      permission: 'audit.read',
      icon: Activity,
    },
  ].filter((item) => can(item.permission));
  return (
    <div className={`lms-dashboard${student && canReadDashboard ? ' lms-dash-student-dashboard' : ''}`}>
      <header className="lms-dash-heading dashboard-heading">
        <div>
          <div className="lms-dash-date">
            {today.toLocaleDateString('zh-CN', {
              timeZone: 'Asia/Shanghai',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            })}
          </div>
          <h1>{platform ? '平台工作台' : admin ? '机构工作台' : teacher ? '教学工作台' : '学习工作台'}</h1>
          <p>
            {greeting}，{user?.name}。
            {admin
              ? '查看机构运行情况，处理教学与管理事项。'
              : teacher
                ? '查看授课进展，及时跟进待办任务。'
                : '查看学习进度，继续课程与待办任务。'}
          </p>
        </div>
        <div className="lms-dash-actions">
          {(admin ? can('org.manage') : can('learning.use') || can('assessment.manage')) && (
            <Button
              icon={<CalendarDays size={16} />}
              onClick={() => navigate(admin ? '/admin/organization' : '/planner')}
            >
              {admin ? '组织与教学安排' : '查看学习日历'}
            </Button>
          )}
          {can(mainAction.permission) && (
            <Button type="primary" onClick={() => navigate(mainAction.path)}>
              {mainAction.label}
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          )}
        </div>
      </header>
      {canReadDashboard ? (
        <OverviewGate query={query}>
          {d && (
            <>
              <div className="lms-dash-metrics">
                {(d.metrics || []).map((metric: any, index: number) => {
                  const Icon = metricIcons[index % metricIcons.length];
                  const path = metric.path === '/admin/organizations' ? '/admin/organization' : metric.path;
                  const content = (
                    <>
                      <div className="lms-dash-metric-top">
                        <span>{metric.label}</span>
                        <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
                      </div>
                      <strong className="lms-dash-metric-value">{metric.value ?? '—'}</strong>
                      <div className="lms-dash-metric-bottom">
                        <span>{metric.detail || '根据当前授权范围统计'}</span>
                        {path && <ArrowUpRight size={16} aria-hidden="true" />}
                      </div>
                    </>
                  );
                  return path ? (
                    <Link
                      key={metric.label}
                      to={path}
                      className="lms-dash-metric"
                      aria-label={`查看${metric.label}`}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div key={metric.label} className="lms-dash-metric">
                      {content}
                    </div>
                  );
                })}
              </div>
              <div className="lms-dash-grid">
                <div className="lms-dash-primary">
                  <DashboardPanel
                    title={admin ? '机构课程' : teacher ? '我的授课' : '继续学习'}
                    description={
                      admin
                        ? '机构内课程与教学安排'
                        : teacher
                          ? '当前授课课程与学生规模'
                          : '已加入课程的学习进度'
                    }
                    extra={<DashboardLink to="/courses" />}
                  >
                    <div className="lms-dash-courses">
                      {d.courses?.slice(0, 3).map((course: any) => (
                        <Link to={`/courses/${course.id}`} key={course.id} className="lms-dash-course">
                          <div className="lms-dash-course-cover" aria-hidden="true">
                            {course.cover ? (
                              <img src={course.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
                            ) : (
                              <BookOpen size={24} strokeWidth={1.6} />
                            )}
                          </div>
                          <div className="lms-dash-course-info">
                            <h3>{course.title}</h3>
                            <p>
                              {course.category || '课程学习'}
                              {course.teacherName && <> · {course.teacherName}</>}
                            </p>
                          </div>
                          <div className="lms-dash-course-progress">
                            {teacher ? (
                              <>
                                <strong>{course.studentCount || 0} 位学生</strong>
                                <span>{course.totalLessons || 0} 个课时</span>
                              </>
                            ) : (
                              <>
                                <div>
                                  <span>
                                    {course.completedLessons || 0} / {course.totalLessons || 0} 课时
                                  </span>
                                  <strong>{course.progressPercent || 0}%</strong>
                                </div>
                                <Progress
                                  percent={course.progressPercent || 0}
                                  showInfo={false}
                                  size="small"
                                  strokeColor="#206bc4"
                                  trailColor="#e8edf3"
                                />
                              </>
                            )}
                          </div>
                          <ChevronRight className="lms-dash-row-arrow" size={17} aria-hidden="true" />
                        </Link>
                      ))}
                    </div>
                    {!d.courses?.length && <EmptyState description="暂时没有已分配的课程" />}
                  </DashboardPanel>
                  <DashboardPanel
                    title={admin ? '平台活动' : '学习活动'}
                    description="最近七天的学习记录与平台操作次数"
                    extra={<span className="lms-dash-period">最近 7 天</span>}
                  >
                    <div className="lms-dash-chart">
                      {d.weeklyActivity?.length ? (
                        <Chart
                          height={225}
                          label="最近七天学习活动次数"
                          option={{
                            ...chartTheme,
                            textStyle: { ...chartTheme.textStyle, color: '#626976', fontSize: 12 },
                            grid: { left: 34, right: 15, top: 24, bottom: 28 },
                            xAxis: {
                              ...chartTheme.xAxis,
                              type: 'category',
                              boundaryGap: false,
                              data: d.weeklyActivity.map((x: any) => date(x.date, true)),
                            },
                            yAxis: {
                              ...chartTheme.yAxis,
                              type: 'value',
                              minInterval: 1,
                              splitLine: { lineStyle: { color: '#e8edf3', type: 'dashed' } },
                            },
                            series: [
                              {
                                name: '活动次数',
                                type: 'line',
                                smooth: false,
                                data: d.weeklyActivity.map((x: any) => x.count),
                                symbol: 'circle',
                                symbolSize: 6,
                                lineStyle: { width: 2 },
                                itemStyle: { color: '#206bc4' },
                                areaStyle: { color: 'rgba(32,107,196,.08)' },
                              },
                            ],
                          }}
                        />
                      ) : (
                        <EmptyState description="开始学习后，在这里回顾你的活动" />
                      )}
                    </div>
                  </DashboardPanel>
                  <DashboardPanel title="最近动态">
                    {d.activity?.length ? (
                      <div className="lms-dash-activity-list">
                        {d.activity.slice(0, 4).map((item: any) => (
                          <div className="lms-dash-activity" key={item.id}>
                            <span className="lms-dash-activity-dot" aria-hidden="true" />
                            <div>
                              <strong>{item.title}</strong>
                              <p>{item.detail}</p>
                            </div>
                            <time>{date(item.createdAt)}</time>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState description="学习记录将在这里显示" />
                    )}
                  </DashboardPanel>
                </div>
                <div className="lms-dash-secondary">
                  {admin ? (
                    <DashboardPanel title="管理入口" description="机构管理与运行维护">
                      <div className="lms-dash-task-list">
                        {managementLinks.map((item) => (
                          <Link to={item.path} key={item.path} className="lms-dash-task">
                            <span className="lms-dash-task-icon">
                              <item.icon size={19} aria-hidden="true" />
                            </span>
                            <div className="lms-dash-task-body">
                              <h3>{item.title}</h3>
                              <p>{item.description}</p>
                            </div>
                            <ChevronRight className="lms-dash-row-arrow" size={16} aria-hidden="true" />
                          </Link>
                        ))}
                      </div>
                      {!managementLinks.length && <EmptyState description="暂无已授权的管理入口" />}
                    </DashboardPanel>
                  ) : user?.role === 'STUDENT' ? null : (
                    <DashboardPanel
                      title="待办任务"
                      extra={<span className="lms-dash-count">{d.tasks?.length || 0}</span>}
                    >
                      {d.tasks?.length ? (
                        <div className="lms-dash-task-list">
                          {d.tasks.slice(0, 5).map((task: any) => (
                            <Link
                              to={
                                task.path ||
                                (task.type === 'exam' ? `/exams/${task.id}` : `/assignments/${task.id}`)
                              }
                              key={`${task.type}-${task.id}`}
                              className="lms-dash-task"
                            >
                              <span
                                className={`lms-dash-task-icon ${task.type === 'exam' ? 'lms-dash-task-exam' : ''}`}
                              >
                                {task.type === 'exam' ? (
                                  <FileCheck2 size={19} />
                                ) : (
                                  <ClipboardList size={19} />
                                )}
                              </span>
                              <div className="lms-dash-task-body">
                                <span>{task.courseTitle || '学习任务'}</span>
                                <h3>{task.title}</h3>
                                <p>
                                  <Clock3 size={12} aria-hidden="true" />
                                  {date(task.dueAt)}
                                  {task.type === 'exam' ? ' 开始' : ' 截止'}
                                </p>
                              </div>
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <EmptyState description="当前没有待办任务" />
                      )}
                      <div className="lms-dash-panel-footer">
                        <DashboardLink to="/assignments">全部学习任务</DashboardLink>
                      </div>
                    </DashboardPanel>
                  )}
                  <DashboardPanel
                    title="通知与公告"
                    extra={<DashboardLink to="/notifications">更多</DashboardLink>}
                  >
                    {d.announcements?.length ? (
                      <div className="lms-dash-announcements">
                        {d.announcements.slice(0, 3).map((announcement: any) => (
                          <div className="lms-dash-announcement" key={announcement.id}>
                            <div className="lms-dash-announcement-meta">
                              <span>
                                <Bell size={13} aria-hidden="true" />
                                {announcement.courseId ? '课程公告' : '机构公告'}
                              </span>
                              <time>{date(announcement.createdAt, true)}</time>
                            </div>
                            <h3>{announcement.title}</h3>
                            <div className="lms-dash-announcement-content">
                              <RichContent content={announcement.content} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState description="暂无最新公告" />
                    )}
                  </DashboardPanel>
                </div>
              </div>
            </>
          )}
        </OverviewGate>
      ) : (
        <ActionPanel />
      )}
      {student && canReadDashboard && (
        <aside className="lms-dash-student-actions">
          <ActionPanel />
        </aside>
      )}
    </div>
  );
}
