import { Component, Suspense, lazy, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { Routes, Route, NavLink, Navigate, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { Avatar, Badge, Button, Dropdown, Select, Spin, Tooltip, App, Result } from 'antd';
import {
  BookOpen,
  LayoutDashboard,
  ClipboardList,
  PenLine,
  FileCheck2,
  ChartNoAxesCombined,
  MessagesSquare,
  Bell,
  Settings,
  Users,
  Building2,
  ShieldCheck,
  LibraryBig,
  LogOut,
  Menu,
  X,
  ChevronDown,
  ChevronsRight,
  ClipboardCheck,
  CalendarDays,
  NotebookPen,
  BrainCircuit,
  Code2,
  GraduationCap,
  Sparkles,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './auth';
import { send, label, getCsrf, isAdmin, isTeacher, useData } from './api';
const Login = lazy(() => import('./pages/Login').then((module) => ({ default: module.Login })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const Planner = lazy(() => import('./pages/Planner').then((module) => ({ default: module.Planner })));
const Notes = lazy(() => import('./pages/Notes').then((module) => ({ default: module.Notes })));
const AiStudy = lazy(() => import('./pages/AiStudy').then((module) => ({ default: module.AiStudy })));
const Academics = lazy(() => import('./pages/Academics').then((module) => ({ default: module.Academics })));
const AcademicWorkbench = lazy(() =>
  import('./pages/AcademicWorkbench').then((module) => ({ default: module.AcademicWorkbench })),
);
const AcademicRecords = lazy(() =>
  import('./pages/AcademicRecords').then((module) => ({ default: module.AcademicRecords })),
);
const AcademicAdmin = lazy(() =>
  import('./pages/AcademicAdmin').then((module) => ({ default: module.AcademicAdmin })),
);
const OrganizationAccess = lazy(() =>
  import('./pages/OrganizationAccess').then((module) => ({ default: module.OrganizationAccess })),
);
const Algorithms = lazy(() =>
  import('./pages/Algorithms').then((module) => ({ default: module.Algorithms })),
);
const Programming = lazy(() =>
  import('./pages/Programming').then((module) => ({ default: module.Programming })),
);
const Creative = lazy(() => import('./pages/Creative').then((module) => ({ default: module.Creative })));
const AlgorithmForum = lazy(() => import('./pages/AlgorithmForum'));
const AlgorithmDetail = lazy(() =>
  import('./pages/Algorithms').then((module) => ({ default: module.AlgorithmDetail })),
);
const AiAuthoring = lazy(() =>
  import('./pages/AiAuthoring').then((module) => ({ default: module.AiAuthoring })),
);
const Courses = lazy(() => import('./pages/Courses').then((module) => ({ default: module.Courses })));
const CourseDetail = lazy(() =>
  import('./pages/Courses').then((module) => ({ default: module.CourseDetail })),
);
const Analytics = lazy(() => import('./pages/Analytics').then((module) => ({ default: module.Analytics })));
const Profile = lazy(() => import('./pages/Analytics').then((module) => ({ default: module.Profile })));
const Assignments = lazy(() =>
  import('./pages/Assessments').then((module) => ({ default: module.Assignments })),
);
const AssignmentDetail = lazy(() =>
  import('./pages/Assessments').then((module) => ({ default: module.AssignmentDetail })),
);
const Questions = lazy(() => import('./pages/Assessments').then((module) => ({ default: module.Questions })));
const Practice = lazy(() => import('./pages/Assessments').then((module) => ({ default: module.Practice })));
const PracticeSession = lazy(() =>
  import('./pages/Assessments').then((module) => ({ default: module.PracticeSession })),
);
const Exams = lazy(() => import('./pages/Assessments').then((module) => ({ default: module.Exams })));
const ExamDetail = lazy(() =>
  import('./pages/Assessments').then((module) => ({ default: module.ExamDetail })),
);
const ExamAttempt = lazy(() =>
  import('./pages/Assessments').then((module) => ({ default: module.ExamAttempt })),
);
const Grading = lazy(() => import('./pages/Assessments').then((module) => ({ default: module.Grading })));
const Appeals = lazy(() => import('./pages/Assessments').then((module) => ({ default: module.Appeals })));
const Communication = lazy(() =>
  import('./pages/Communication').then((module) => ({ default: module.Communication })),
);
const Notifications = lazy(() =>
  import('./pages/Communication').then((module) => ({ default: module.Notifications })),
);
const Moderation = lazy(() =>
  import('./pages/Communication').then((module) => ({ default: module.Moderation })),
);
const AdminUsers = lazy(() => import('./pages/Admin').then((module) => ({ default: module.AdminUsers })));
const Organization = lazy(() => import('./pages/Admin').then((module) => ({ default: module.Organization })));
const Audit = lazy(() => import('./pages/Admin').then((module) => ({ default: module.Audit })));
const SystemSettings = lazy(() =>
  import('./pages/Admin').then((module) => ({ default: module.SystemSettings })),
);
const RolePermissions = lazy(() =>
  import('./pages/Admin').then((module) => ({ default: module.RolePermissions })),
);
import { PageTitle } from './components/shared';
function Shell() {
  const { user, loading, refresh } = useAuth();
  const [mobile, setMobile] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = App.useApp();
  useEffect(() => {
    if (!mobile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobile(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobile]);
  useEffect(() => {
    if (!user) return;
    const socket = io('/notifications', {
      auth: { csrfToken: getCsrf() },
      transports: ['websocket'],
      withCredentials: true,
      reconnection: true,
    });
    const invalidate = () => {
      void queryClient.invalidateQueries({
        predicate: (query) =>
          String(query.queryKey[0]).includes('/communication/') ||
          String(query.queryKey[0]).includes('/notifications'),
      });
    };
    socket.on('invalidate', invalidate);
    socket.on('connect', invalidate);
    return () => {
      socket.disconnect();
    };
  }, [user?.id, user?.role, queryClient]);
  const platform = useData('/platform', true);
  const notifications = useData('/notifications?pageSize=1', !!user, 30000);
  if (loading)
    return (
      <div className="initial-loader">
        <Spin size="large" />
        <p>正在连接知学学习平台</p>
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  const nav = [
    {
      group: '学习空间',
      items: [
        { path: '/', title: '学习工作台', icon: LayoutDashboard },
        { path: '/planner', title: '学习日历', icon: CalendarDays },
        { path: '/notes', title: '我的笔记', icon: NotebookPen },
        ...(user.role === 'STUDENT'
          ? [{ path: '/academics', title: '专业学习中心', icon: GraduationCap }]
          : []),
        { path: '/courses', title: isTeacher(user) ? '课程管理' : '我的课程', icon: BookOpen },
        { path: '/assignments', title: isTeacher(user) ? '作业管理' : '我的作业', icon: ClipboardList },
        { path: '/practice', title: '练习中心', icon: PenLine },
        ...(user.role === 'STUDENT' ? [{ path: '/algorithms', title: '算法练习', icon: Code2 }] : []),
        ...(user.role === 'STUDENT' ? [{ path: '/programming', title: '编程工作室', icon: Code2 }] : []),
        ...(user.role === 'STUDENT'
          ? [{ path: '/programming/creative', title: '创意广场', icon: Sparkles }]
          : []),
        ...(user.role === 'STUDENT' ? [{ path: '/ai-study', title: 'AI 错题复盘', icon: BrainCircuit }] : []),
        ...(isTeacher(user) ? [{ path: '/questions', title: '题库管理', icon: LibraryBig }] : []),
        ...(user.role === 'TEACHER' ? [{ path: '/ai-authoring', title: 'AI 出题', icon: BrainCircuit }] : []),
        { path: '/exams', title: isTeacher(user) ? '考试管理' : '在线考试', icon: FileCheck2 },
        { path: '/analytics', title: isTeacher(user) ? '教学分析' : '学习分析', icon: ChartNoAxesCombined },
      ],
    },
    {
      group: '协作与交流',
      items: [
        { path: '/algorithms/forum', title: '算法论坛', icon: MessagesSquare },
        { path: '/communication', title: '交流中心', icon: MessagesSquare },
        { path: '/notifications', title: '消息通知', icon: Bell },
        { path: '/appeals', title: '成绩复核', icon: ClipboardCheck },
      ],
    },
    ...(isAdmin(user)
      ? [
          {
            group: '机构管理',
            items: [
              { path: '/admin/users', title: '用户管理', icon: Users },
              { path: '/admin/organization', title: '组织与教学', icon: Building2 },
              { path: '/admin/academics', title: '专业与成员申请', icon: GraduationCap },
              { path: '/admin/roles', title: '角色与权限', icon: ShieldCheck },
              { path: '/admin/moderation', title: '内容治理', icon: MessagesSquare },
              { path: '/admin/settings', title: '系统设置', icon: Settings },
              { path: '/admin/audit', title: '审计日志', icon: ClipboardCheck },
            ],
          },
        ]
      : []),
  ];
  if (user.accountMode === 'PERSONAL') {
    const personalPaths = new Set([
      '/',
      '/planner',
      '/notes',
      '/academics',
      '/algorithms',
      '/programming',
      '/programming/creative',
      '/algorithms/forum',
      '/ai-study',
    ]);
    for (const group of nav) group.items = group.items.filter((item) => personalPaths.has(item.path));
  }
  nav[0].items.push({
    path: '/organization',
    title: user.accountMode === 'PERSONAL' ? '加入学习组织' : '我的组织',
    icon: Building2,
  });
  const navPermissions: Record<string, string[]> = {
    '/practice': ['learning.use'],
    '/algorithms': ['learning.use'],
    '/programming': ['learning.use'],
    '/programming/creative': ['learning.use'],
    '/academics': ['learning.use'],
    '/ai-study': ['learning.use'],
    '/ai-authoring': ['question.manage'],
    '/questions': ['question.manage'],
    '/assignments': ['learning.use', 'assessment.manage'],
    '/exams': ['learning.use', 'assessment.manage'],
    '/appeals': ['assessment.grade', 'learning.use'],
    '/admin/users': ['users.manage'],
    '/admin/organization': ['org.manage'],
    '/admin/academics': ['org.manage'],
    '/admin/roles': ['users.manage'],
    '/admin/moderation': ['communication.moderate'],
    '/admin/settings': ['settings.org'],
    '/admin/audit': ['audit.read'],
  };
  for (const group of nav)
    group.items = group.items.filter(
      (item) =>
        (item.path !== '/admin/academics' ||
          ['org.manage', 'users.manage'].every((permission) => user.permissions.includes(permission))) &&
        (!navPermissions[item.path] || navPermissions[item.path].some((p) => user.permissions.includes(p))),
    );
  const activePath = /^\/(exam-attempts|attempts|grading)\//.test(location.pathname)
    ? '/exams'
    : location.pathname;
  const active = nav
    .flatMap((g) => g.items)
    .filter(
      (item) => activePath === item.path || (item.path !== '/' && activePath.startsWith(`${item.path}/`)),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
  async function switchRole(role: string) {
    try {
      await send('/auth/role', { role });
      queryClient.clear();
      await refresh();
      navigate('/');
      message.success(`已切换为${label(role)}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  }
  async function logout() {
    try {
      await send('/auth/logout');
      queryClient.clear();
      await refresh();
      navigate('/login');
    } catch (e) {
      message.error((e as Error).message);
    }
  }
  return (
    <div className="app-shell">
      {mobile && <div className="mobile-mask" onClick={() => setMobile(false)} />}
      <a className="skip-link" href="#main-content">
        跳转到主要内容
      </a>
      <aside id="main-navigation" className={`sidebar ${mobile ? 'sidebar-open' : ''}`}>
        <button className="navigation-close" aria-label="关闭导航" onClick={() => setMobile(false)}>
          <X size={20} />
        </button>
        <Link to="/" className="brand">
          <div className="brand-icon">
            {platform.data?.logoUrl ? (
              <img
                src={platform.data.logoUrl}
                alt=""
                style={{ width: 28, height: 28, objectFit: 'contain' }}
              />
            ) : (
              <BookOpen size={24} />
            )}
          </div>
          <div>
            <strong>{platform.data?.name || '知学'}</strong>
            <span>LEARNING SPACE</span>
          </div>
        </Link>
        <div className="workspace-label">
          <span className="workspace-dot" />
          {user.accountMode === 'PERSONAL' ? '个人学习空间' : `${label(user.role)}工作空间`}
          <ChevronsRight size={14} />
        </div>
        <nav aria-label="主导航">
          {nav
            .filter((group) => group.items.length)
            .map((group) => (
              <div className="nav-group" key={group.group}>
                <div className="nav-group-name">{group.group}</div>
                {group.items.map((item) => (
                  <NavLink
                    end={
                      item.path === '/' ||
                      (['/algorithms', '/programming'].includes(item.path) && active?.path !== item.path)
                    }
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobile(false)}
                    className={`nav-item ${active?.path === item.path ? 'active' : ''}`}
                  >
                    <item.icon size={18} />
                    <span>{item.title}</span>
                    {item.path === '/notifications' && notifications.data?.unreadCount > 0 && (
                      <span className="nav-count">{notifications.data.unreadCount}</span>
                    )}
                  </NavLink>
                ))}
              </div>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="sidebar-account" onClick={() => navigate('/profile')}>
            <Avatar style={{ background: '#e9f1fb', color: '#206bc4' }}>{user.name.slice(0, 1)}</Avatar>
            <div>
              <strong>{user.name}</strong>
              <span>{label(user.role)}</span>
            </div>
            <Settings size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <Button
              className="menu-toggle"
              type="text"
              onClick={() => setMobile(!mobile)}
              icon={<Menu size={20} />}
              aria-label={mobile ? '关闭导航' : '打开导航'}
              aria-expanded={mobile}
              aria-controls="main-navigation"
            />
            <span>我的空间</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{active?.title || '个人中心'}</strong>
          </div>
          <div className="topbar-right">
            <span className="today-label">
              {new Intl.DateTimeFormat('zh-CN', {
                timeZone: 'Asia/Shanghai',
                month: 'long',
                day: 'numeric',
                weekday: 'long',
              }).format(new Date())}
            </span>
            {user.roles.length > 1 && (
              <Select
                value={user.role}
                onChange={switchRole}
                options={user.roles.map((r) => ({ value: r, label: label(r) }))}
                variant="borderless"
                style={{ minWidth: 105 }}
                aria-label="切换角色"
              />
            )}
            <Tooltip title="消息通知">
              <Badge count={notifications.data?.unreadCount} size="small" overflowCount={99}>
                <Button
                  type="text"
                  icon={<Bell size={20} />}
                  onClick={() => navigate('/notifications')}
                  aria-label="消息通知"
                />
              </Badge>
            </Tooltip>
            <div className="topbar-divider" />
            <Dropdown
              menu={{
                items: [
                  { key: 'profile', label: '个人资料与安全', onClick: () => navigate('/profile') },
                  { key: 'logout', label: '退出登录', icon: <LogOut size={15} />, onClick: logout },
                ],
              }}
            >
              <button className="topbar-account" aria-label={`${user.name}的账号菜单`}>
                <Avatar size={32} style={{ background: '#e9f1fb', color: '#206bc4' }}>
                  {user.name.slice(0, 1)}
                </Avatar>
                <span>{user.name}</span>
                <ChevronDown size={13} />
              </button>
            </Dropdown>
          </div>
        </header>
        <main className="main-content" id="main-content" tabIndex={-1}>
          {user.accountMode === 'PERSONAL' &&
          !/^\/(?:$|academics(?:\/|$)|planner$|notes$|algorithms(?:\/|$)|programming(?:\/|$)|ai-study$|profile$|organization$|notifications$)/.test(
            location.pathname,
          ) ? (
            <Result
              status="403"
              title="此功能属于组织教学空间"
              subTitle="你的个人学习模块仍可正常使用。加入组织并获得授权后，可使用对应的课程与教学功能。"
              extra={
                <Link to="/academics">
                  <Button type="primary">前往专业学习中心</Button>
                </Link>
              }
            />
          ) : (
            <Outlet />
          )}
        </main>
        <footer className="app-footer">
          <span>知学学习平台 · 让成长有迹可循</span>
          <span>Asia/Shanghai</span>
        </footer>
      </div>
    </div>
  );
}
export function Root() {
  return (
    <ScreenBoundary>
      <Suspense
        fallback={
          <div className="loading-state">
            <Spin size="large" />
          </div>
        }
      >
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Shell />}>
            <Route index element={<Dashboard />} />
            <Route path="planner" element={<Planner />} />
            <Route path="notes" element={<Notes />} />
            <Route path="organization" element={<OrganizationAccess />} />
            <Route
              path="academics"
              element={
                <RequirePermission anyOf={['learning.use']} roles={['STUDENT']}>
                  <Academics />
                </RequirePermission>
              }
            />
            <Route
              path="academics/modules/:id"
              element={
                <RequirePermission anyOf={['learning.use']} roles={['STUDENT']}>
                  <AcademicWorkbench />
                </RequirePermission>
              }
            />
            <Route
              path="academics/records"
              element={
                <RequirePermission anyOf={['learning.use']} roles={['STUDENT']}>
                  <AcademicRecords />
                </RequirePermission>
              }
            />
            <Route
              path="admin/academics"
              element={
                <RequirePermission
                  anyOf={['org.manage']}
                  allOf={['users.manage']}
                  roles={['ADMIN', 'SUPER_ADMIN']}
                >
                  <AcademicAdmin />
                </RequirePermission>
              }
            />
            <Route
              path="algorithms"
              element={
                <RequirePermission anyOf={['learning.use']} roles={['STUDENT']}>
                  <Algorithms />
                </RequirePermission>
              }
            />
            <Route
              path="algorithms/:id"
              element={
                <RequirePermission anyOf={['learning.use']} roles={['STUDENT']}>
                  <AlgorithmDetail />
                </RequirePermission>
              }
            />
            <Route
              path="programming"
              element={
                <RequirePermission anyOf={['learning.use']} roles={['STUDENT']}>
                  <Programming />
                </RequirePermission>
              }
            />
            <Route
              path="programming/creative"
              element={
                <RequirePermission anyOf={['learning.use']} roles={['STUDENT']}>
                  <Creative />
                </RequirePermission>
              }
            />
            <Route
              path="programming/creative/:ideaId"
              element={
                <RequirePermission anyOf={['learning.use']} roles={['STUDENT']}>
                  <Creative />
                </RequirePermission>
              }
            />
            <Route path="algorithms/forum" element={<AlgorithmForum />} />
            <Route path="algorithms/forum/:postId" element={<AlgorithmForum />} />
            <Route
              path="programming/:id"
              element={
                <RequirePermission anyOf={['learning.use']} roles={['STUDENT']}>
                  <Programming />
                </RequirePermission>
              }
            />
            <Route
              path="ai-authoring"
              element={
                <RequirePermission anyOf={['question.manage']} roles={['TEACHER']}>
                  <AiAuthoring />
                </RequirePermission>
              }
            />
            <Route
              path="ai-study"
              element={
                <RequirePermission anyOf={['learning.use']} roles={['STUDENT']}>
                  <AiStudy />
                </RequirePermission>
              }
            />
            <Route path="courses" element={<Courses />} />
            <Route path="courses/:id" element={<CourseDetail />} />
            <Route
              path="assignments"
              element={
                <RequirePermission anyOf={['learning.use', 'assessment.manage']}>
                  <Assignments />
                </RequirePermission>
              }
            />
            <Route
              path="assignments/:id"
              element={
                <RequirePermission anyOf={['learning.use', 'assessment.manage']}>
                  <AssignmentDetail />
                </RequirePermission>
              }
            />
            <Route
              path="questions"
              element={
                <RequirePermission anyOf={['question.manage']}>
                  <Questions />
                </RequirePermission>
              }
            />
            <Route
              path="practice"
              element={
                <RequirePermission anyOf={['learning.use']}>
                  <Practice />
                </RequirePermission>
              }
            />
            <Route
              path="practice/:id"
              element={
                <RequirePermission anyOf={['learning.use']}>
                  <PracticeSession />
                </RequirePermission>
              }
            />
            <Route
              path="exams"
              element={
                <RequirePermission anyOf={['learning.use', 'assessment.manage']}>
                  <Exams />
                </RequirePermission>
              }
            />
            <Route
              path="exams/:id"
              element={
                <RequirePermission anyOf={['learning.use', 'assessment.manage']}>
                  <ExamDetail />
                </RequirePermission>
              }
            />
            <Route
              path="attempts/:id"
              element={
                <RequirePermission anyOf={['learning.use']}>
                  <ExamAttempt />
                </RequirePermission>
              }
            />
            <Route
              path="exam-attempts/:id"
              element={
                <RequirePermission anyOf={['learning.use']}>
                  <ExamAttempt />
                </RequirePermission>
              }
            />
            <Route
              path="grading/:type/:id"
              element={
                <RequirePermission anyOf={['assessment.grade']}>
                  <Grading />
                </RequirePermission>
              }
            />
            <Route
              path="appeals"
              element={
                <RequirePermission anyOf={['assessment.grade', 'learning.use']}>
                  <Appeals />
                </RequirePermission>
              }
            />
            <Route path="analytics" element={<Analytics />} />
            <Route path="communication" element={<Communication />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="profile" element={<Profile />} />
            <Route path="admin/classes" element={<Navigate to="/admin/organization" replace />} />
            <Route path="admin/reports" element={<Navigate to="/admin/moderation" replace />} />
            <Route
              path="admin/users"
              element={
                <RequirePermission anyOf={['users.manage']}>
                  <AdminUsers />
                </RequirePermission>
              }
            />
            <Route
              path="admin/organization"
              element={
                <RequirePermission anyOf={['org.manage']}>
                  <Organization />
                </RequirePermission>
              }
            />
            <Route
              path="admin/roles"
              element={
                <RequirePermission anyOf={['users.manage']}>
                  <RolePermissions />
                </RequirePermission>
              }
            />
            <Route
              path="admin/moderation"
              element={
                <RequirePermission anyOf={['communication.moderate']}>
                  <Moderation />
                </RequirePermission>
              }
            />
            <Route
              path="admin/settings"
              element={
                <RequirePermission anyOf={['settings.org']}>
                  <SystemSettings />
                </RequirePermission>
              }
            />
            <Route
              path="admin/audit"
              element={
                <RequirePermission anyOf={['audit.read']}>
                  <Audit />
                </RequirePermission>
              }
            />
            <Route
              path="*"
              element={
                <>
                  <PageTitle title="页面不存在" description="这个地址可能已经变更，请从左侧导航继续。" />
                  <Link to="/">返回工作台</Link>
                </>
              }
            />
          </Route>
        </Routes>
      </Suspense>
    </ScreenBoundary>
  );
}

function RequirePermission({
  anyOf,
  allOf = [],
  roles,
  children,
}: {
  anyOf: string[];
  allOf?: string[];
  roles?: string[];
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  return (!roles || (!!user && roles.includes(user.role))) &&
    allOf.every((permission) => user?.permissions.includes(permission)) &&
    anyOf.some((p) => user?.permissions.includes(p)) ? (
    <>{children}</>
  ) : (
    <Result
      status="403"
      title="403"
      subTitle="当前工作身份没有此功能权限，请切换已获授权的身份。"
      extra={<Link to="/">返回工作台</Link>}
    />
  );
}

class ScreenBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Result
        status="error"
        title="页面暂时无法显示"
        subTitle="请重新载入页面。考试已同步的答案会从服务器恢复，未同步草稿保留在当前浏览器会话。"
        extra={<Button onClick={() => window.location.reload()}>重新载入</Button>}
      />
    ) : (
      this.props.children
    );
  }
}
