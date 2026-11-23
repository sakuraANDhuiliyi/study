import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Slot, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { MobileClient, serverOrigin, type MobileUser } from './src/client';
import { AuthAccess } from './src/AuthAccess';
import { bindRemoteStudyPush } from './src/remote-push.native';
import { AccountSecurity } from './src/AccountSecurity';
import { AcademicGoals } from './src/AcademicGoals';
import { AcademicRecordsExport } from './src/AcademicRecordsExport';
import { AiStudyHome, AiStudyReportScreen } from './src/AiStudy';
import { clearAiStudyTransfers } from './src/ai-study-files';
import { Programming, ProgrammingProject } from './src/Programming';
import { Creative } from './src/Creative';
import { clearProgrammingTransfers } from './src/programming-files';
import { PersonalNotes, StandaloneNoteEditor } from './src/PersonalNotes';
import { Focus } from './src/Focus';
import { AiAuthoringHome, AiAuthoringEditor } from './src/AiAuthoring';
import { LearningAnalytics } from './src/LearningAnalytics';
import { TeachingAnnouncement } from './src/TeachingAnnouncement';
import { ProfileSettings } from './src/ProfileSettings';
import { LocalStudyReminders } from './src/LocalStudyReminders';
import { OfflineReview } from './src/OfflineReview';
import { bindPersonalDeviceLearning } from './src/study-reminders.native';
import { TeachingOperations } from './src/TeachingOperations';
import { clearTeachingTransfers } from './src/teaching-files';
import { clearTeachingOperationTransfers } from './src/teaching-operation-files';
import { AndroidStudio, AndroidWorkspace, AndroidFileEditor } from './src/AndroidStudio';
import { NativeProgrammingPreview } from './src/NativeProgrammingPreview';
import { SchoolDirectoryOperations } from './src/SchoolDirectoryOperations';
import { clearSchoolDirectoryTransfers } from './src/school-directory-files';
import { clearCommunicationTransfers } from './src/communication-files.native';
import { AdminControls } from './src/AdminControls';
import { AlgorithmForum } from './src/AlgorithmForum';
import { AlgorithmTrainingPlans } from './src/AlgorithmTrainingPlans';
import { Messages, MessageConversation } from './src/Messages';
import { clearMessageTransfers } from './src/message-files';
import { clearAcademicTransfers } from './src/academic-files';
import { Organization } from './src/Organization';
import { GradingDesk } from './src/GradingDesk';
import { Teach } from './src/Teach';
import { AdminWorkspace } from './src/AdminWorkspace';
import { AcademicHome } from './src/Academics';
import { AcademicWorkbench } from './src/AcademicWorkbench';
import { AcademicRecords, AcademicRecordDetail } from './src/AcademicRecords';
import { useResource } from './src/resource';
import { StudyPlan } from './src/StudyPlan';
import { Assignments, Assignment, type LeaveGuard } from './src/Assignments';
import { Algorithms, Algorithm, AlgorithmSolution } from './src/Algorithms';
import { Collections } from './src/Collections';
import { Practices, Practice } from './src/Practice';
import { Notes, NoteEditor } from './src/Notes';
import { Announcements, Announcement } from './src/Announcements';
import { Discussions, Discussion, NewDiscussion } from './src/Discussions';
import { Inbox } from './src/Inbox';
import { Reviews, Review } from './src/Reviews';
import { Exams, Exam, ExamAnswer } from './src/Exams';
import { Lesson } from './src/Lesson';
import { clearLessonTransfers } from './src/lesson-files';
import { clearAssignmentTransfers } from './src/assignment-files';
import { LiveRoom, type Admission } from './src/LiveRoom';
import { permissionPrompts } from './src/permission-lifecycle';

const allowLocal = process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP === 'true';
const defaultOrigin = process.env.EXPO_PUBLIC_API_ORIGIN || 'https://study.huiliyi.cn';
const credentialKey = 'zhixue.mobile.session.v1',
  originKey = 'zhixue.mobile.origin.v1';
const store = {
  get: () => SecureStore.getItemAsync(credentialKey),
  set: (value: string) =>
    SecureStore.setItemAsync(credentialKey, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  remove: () => SecureStore.deleteItemAsync(credentialKey),
};
const roles: Record<string, string> = {
  STUDENT: '学生',
  TEACHER: '教师',
  ADMIN: '机构管理员',
  SUPER_ADMIN: '平台管理员',
};
const statuses: Record<string, string> = { SCHEDULED: '待开始', LIVE: '直播中', ENDED: '已结束' };
const date = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
type Course = {
  id: string;
  title: string;
  category: string;
  description: string;
  teacherName: string;
  progressPercent: number;
  totalLessons: number;
  completedLessons: number;
  chapters?: { id: string; title: string; lessons: CourseLesson[] }[];
  progress?: { completed: number; total: number; percent: number };
};
type CourseLesson = {
  id: string;
  title: string;
  content: string;
  type: string;
  progress: { completed: boolean; positionSeconds: number } | null;
};
type Live = {
  id: string;
  title: string;
  courseTitle: string;
  status: string;
  scheduledAt: string;
  revision: number;
  canManage: boolean;
  canChat: boolean;
  chatAvailable: boolean;
  provider?: { available: boolean; reason: string };
  own: Member | null;
  members: Member[];
  messages: { id: string; name: string; text: string }[];
};
type Member = {
  id: string;
  name: string;
  host: boolean;
  approved: boolean;
  handRaised: boolean;
  chatMuted: boolean;
  online: boolean;
  revision: number;
  state: string;
};
type Route =
  | {
      name:
        | 'home'
        | 'courses'
        | 'live'
        | 'profile-settings'
        | 'local-reminders'
        | 'offline-review'
        | 'analytics'
        | 'focus'
        | 'personal-notes'
        | 'programming'
        | 'creative'
        | 'algorithm-training'
        | 'admin-controls'
        | 'messages'
        | 'me'
        | 'account-security'
        | 'organization'
        | 'grading'
        | 'teaching-operations'
        | 'school-directory'
        | 'android-studio'
        | 'teach'
        | 'admin'
        | 'academics'
        | 'planner'
        | 'assignments'
        | 'exams'
        | 'appeals'
        | 'notifications'
        | 'notes'
        | 'practice'
        | 'collections'
        | 'algorithms'
        | 'announcements'
        | 'discussions'
        | 'discussionNew';
      courseId?: string;
    }
  | { name: 'standalone-note'; id?: string }
  | { name: 'personal-lesson' | 'programming-project'; id: string }
  | { name: 'ai-authoring'; courseId?: string; tab?: 'new' | 'history' }
  | { name: 'authoring-draft'; id: string }
  | { name: 'android-project' | 'website-preview'; id: string }
  | { name: 'android-source'; id: string; path: string }
  | { name: 'teaching-announcement'; courseId: string }
  | { name: 'ai-study'; tab?: 'new' | 'history'; courseId?: string }
  | { name: 'ai-report'; id: string }
  | { name: 'algorithm-forum'; problemId?: string }
  | { name: 'conversation'; id: string; title?: string }
  | { name: 'academic-module'; id: string; recordId?: string }
  | { name: 'academic-record'; id: string }
  | { name: 'academic-records' | 'academic-goals' | 'academic-export'; moduleId?: string; status?: string }
  | { name: 'course'; id: string }
  | { name: 'classroom'; id: string }
  | { name: 'assignment'; id: string }
  | { name: 'note'; id: string }
  | { name: 'announcement'; id: string }
  | { name: 'discussion'; id: string }
  | { name: 'algorithm' | 'algorithmSolution'; id: string }
  | { name: 'practiceSession'; id: string }
  | { name: 'exam' | 'examAttempt' | 'review'; id: string };

const AuthContext = createContext<{
  client: MobileClient;
  user: MobileUser;
  inboxAction: React.RefObject<(() => void) | null>;
} | null>(null);
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Application />
    </SafeAreaProvider>
  );
}
function Application() {
  const [client, setClient] = useState<MobileClient | null>(null);
  const active = useRef<MobileClient | null>(null);
  const [user, setUser] = useState<MobileUser | null>(null);
  const inboxAction = useRef<(() => void) | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    clearAssignmentTransfers();
    clearLessonTransfers();
    clearTeachingTransfers();
    clearTeachingOperationTransfers();
    clearSchoolDirectoryTransfers();
    clearCommunicationTransfers();
    clearAcademicTransfers();
    clearMessageTransfers();
    clearAiStudyTransfers();
    clearProgrammingTransfers();
  }, [user?.id, user?.role, user?.organizationId, client?.origin]);
  useEffect(() => {
    if (client && user) return bindPersonalDeviceLearning(client, user);
  }, [client, user?.id, user?.organizationId, user?.role, user?.accountMode]);
  useEffect(() => {
    if (client && user) return bindRemoteStudyPush(client, user, () => inboxAction.current?.());
  }, [client, user?.id, user?.organizationId, user?.role, user?.accountMode]);
  const [error, setError] = useState('');
  const [server, setServer] = useState(defaultOrigin),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false);
  const create = (origin: string) => {
    const next = new MobileClient(origin, store, (u) => {
      if (active.current === next) setUser(u);
    });
    next.onSessionInvalidated(clearProgrammingTransfers);
    next.onSessionInvalidated(clearAiStudyTransfers);
    next.onSessionInvalidated(clearMessageTransfers);
    next.onSessionInvalidated(clearTeachingOperationTransfers);
    next.onSessionInvalidated(clearTeachingTransfers);
    next.onSessionInvalidated(clearSchoolDirectoryTransfers);
    next.onSessionInvalidated(clearCommunicationTransfers);
    next.onSessionInvalidated(clearAcademicTransfers);
    active.current = next;
    setClient(next);
    return next;
  };
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const origin = serverOrigin((await SecureStore.getItemAsync(originKey)) || defaultOrigin, allowLocal);
        if (!mounted) return;
        setServer(origin);
        await create(origin).restore();
      } catch (e) {
        if (mounted) setError((e as Error).message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'recover'>('login');
  async function prepareClient() {
    const origin = serverOrigin(server, allowLocal);
    let next = client;
    if (!next || next.origin !== origin) {
      if (next) await next.clear();
      next = create(origin);
    }
    await SecureStore.setItemAsync(originKey, origin);
    return next;
  }
  async function login() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await prepareClient();
      await next.login(username, password);
      setPassword('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!loading && user && client) {
      setAuthMode('login');
      router.replace('/');
    }
  }, [loading, user?.id, user?.role, user?.organizationId, client?.origin]);
  if (loading)
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator color="#6d45dc" />
        <Text style={s.muted}>正在连接你的学习空间…</Text>
      </SafeAreaView>
    );
  if (user && client)
    return (
      <AuthContext.Provider
        key={JSON.stringify([client.origin, user.id, user.role, user.organizationId])}
        value={{ client, user, inboxAction }}
      >
        <Slot />
      </AuthContext.Provider>
    );
  return (
    <SafeAreaView style={s.root}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.loginPage}>
          <View style={s.brand}>
            <Text style={s.brandMark}>知</Text>
            <Text style={s.brandName}>知学</Text>
          </View>
          <Text style={s.tagline}>把每一次学习，连接起来。</Text>
          <View style={s.card}>
            {authMode === 'login' && (
              <>
                <Text style={s.title}>登录学习空间</Text>
                <Text style={s.muted}>使用与网站相同的账号，接续课程和直播。</Text>
              </>
            )}
            <Text style={s.label}>平台地址</Text>
            <TextInput
              accessibilityLabel="平台地址"
              style={s.input}
              value={server}
              onChangeText={setServer}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!busy}
            />
            {authMode !== 'login' ? (
              <AuthAccess
                key={authMode}
                mode={authMode}
                prepareClient={prepareClient}
                back={() => setAuthMode('login')}
              />
            ) : (
              <>
                <Text style={s.label}>账号</Text>
                <TextInput
                  accessibilityLabel="账号"
                  style={s.input}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  editable={!busy}
                />
                <Text style={s.label}>密码</Text>
                <TextInput
                  accessibilityLabel="密码"
                  style={s.input}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="current-password"
                  editable={!busy}
                  onSubmitEditing={() => void login()}
                />
                {!!error && (
                  <Text accessibilityRole="alert" style={s.error}>
                    {error}
                  </Text>
                )}
                <Button
                  title={busy ? '正在登录…' : '登录学习平台'}
                  disabled={busy || !username.trim() || !password}
                  onPress={() => void login()}
                />
                <Button
                  secondary
                  title="个人注册"
                  onPress={() => {
                    setPassword('');
                    setError('');
                    setAuthMode('register');
                  }}
                />
                <Button
                  secondary
                  title="使用恢复码找回账号"
                  onPress={() => {
                    setPassword('');
                    setError('');
                    setAuthMode('recover');
                  }}
                />
              </>
            )}
            <Text style={s.small}>请仅填写你信任的平台地址。密码不会保存在手机中。</Text>
          </View>
          <Text style={s.footer}>课程学习 · 实时互动 · 跨端接续</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Screen({ route }: { route: Route }) {
  const auth = useContext(AuthContext);
  return auth ? <Workspace client={auth.client} user={auth.user} route={route} /> : null;
}
function parentRoute(route: Route): Route {
  if (
    route.name === 'profile-settings' ||
    route.name === 'local-reminders' ||
    route.name === 'offline-review'
  )
    return { name: 'me' };
  if (route.name === 'standalone-note' || route.name === 'personal-lesson') return { name: 'personal-notes' };
  if (route.name === 'android-source') return { name: 'android-project', id: route.id };
  if (route.name === 'website-preview') return { name: 'programming-project', id: route.id };
  if (route.name === 'android-project') return { name: 'android-studio' };
  if (route.name === 'school-directory') return { name: 'admin' };
  if (route.name === 'programming-project' || route.name === 'creative') return { name: 'programming' };
  if (route.name === 'authoring-draft') return { name: 'ai-authoring', tab: 'history' };
  if (route.name === 'teaching-announcement') return { name: 'course', id: route.courseId };
  if (route.name === 'ai-report') return { name: 'ai-study', tab: 'history' };
  if (route.name === 'algorithm-forum' && route.problemId) return { name: 'algorithm', id: route.problemId };
  if (route.name === 'algorithmSolution') return { name: 'algorithm', id: route.id };
  if (route.name === 'academic-export')
    return { name: 'academic-records', moduleId: route.moduleId, status: route.status };
  const parents: Partial<Record<Route['name'], Route['name']>> = {
    'algorithm-forum': 'algorithms',
    'algorithm-training': 'algorithms',
    'admin-controls': 'admin',
    conversation: 'messages',
    'academic-record': 'academic-records',
    'academic-module': 'academics',
    'academic-records': 'academics',
    'academic-goals': 'academics',
    organization: 'me',
    'account-security': 'me',
    algorithm: 'algorithms',
    discussion: 'discussions',
    discussionNew: 'discussions',
    announcement: 'announcements',
    course: 'courses',
    classroom: 'live',
    assignment: 'assignments',
    exam: 'exams',
    examAttempt: 'exams',
    practiceSession: 'practice',
    note: 'notes',
    review: 'appeals',
  };
  return { name: parents[route.name] || 'home' } as Route;
}
function Workspace({ client, user, route }: { client: MobileClient; user: MobileUser; route: Route }) {
  const { inboxAction } = useContext(AuthContext)!;
  const [logoutBusy, setLogoutBusy] = useState(false);
  const leaveGuard = useRef<LeaveGuard>(null);
  const registerLeave = (guard: LeaveGuard) => {
    leaveGuard.current = guard;
  };
  const moveRoute = (next: Route) => {
    const { name, ...params } = next;
    const pathnames: Partial<Record<Route['name'], string>> = {
      home: '/',
      'authoring-draft': '/ai-authoring/drafts/[id]',
      conversation: '/messages/[id]',
      'ai-report': '/ai-study/reports/[id]',
      'academic-module': '/academics/modules/[id]',
      'academic-record': '/academic-records/[id]',
      'programming-project': '/programming/[id]',
      'personal-lesson': '/personal-lessons/[id]',
      algorithm: '/algorithms/[id]',
      algorithmSolution: '/algorithm-editorials/[id]',
      discussionNew: '/discussions/new',
      discussion: '/discussions/[id]',
      announcement: '/announcements/[id]',
      practiceSession: '/practice/[id]',
      note: '/notes/[id]',
      course: '/courses/[id]',
      assignment: '/assignments/[id]',
      exam: '/exams/[id]',
      review: '/reviews/[id]',
      examAttempt: '/exam-attempts/[id]',
      classroom: '/live/[id]',
    };
    router.replace({ pathname: pathnames[name] || '/' + name, params } as never);
  };
  const setRoute = (next: Route) => {
    if (leaveGuard.current) leaveGuard.current(() => moveRoute(next));
    else moveRoute(next);
  };
  useEffect(() => {
    const openInbox = () => setRoute({ name: 'notifications' });
    inboxAction.current = openInbox;
    return () => {
      if (inboxAction.current === openInbox) inboxAction.current = null;
    };
  });
  const canLive = user.accountMode !== 'PERSONAL';
  const selected = (name: string) =>
    route.name === name ||
    (name === 'courses' &&
      ['course', 'assignments', 'assignment', 'exams', 'exam', 'examAttempt', 'appeals', 'review'].includes(
        route.name,
      )) ||
    (name === 'live' && route.name === 'classroom');
  useEffect(() => {
    const lifecycle = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        TextInput.State.currentlyFocusedInput()?.blur();
        Keyboard.dismiss();
      }
    });
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // Keyboard visibility is the last reported native event. Focus can return
      // before that event after foregrounding, so consume Back for either state.
      const focused = TextInput.State.currentlyFocusedInput();
      if (Keyboard.isVisible() || focused) {
        focused?.blur();
        Keyboard.dismiss();
        return true;
      }
      if (route.name !== 'home') {
        setRoute(parentRoute(route));
        return true;
      }
      return false;
    });
    return () => {
      lifecycle.remove();
      subscription.remove();
    };
  }, [route]);
  const extraHeadings: Partial<Record<Route['name'], string>> = {
    'profile-settings': '个人资料',
    'local-reminders': '本机提醒',
    'offline-review': '离线复习',
    analytics: '学习统计',
    'teaching-announcement': '发布课程公告',
    'ai-authoring': 'AI 出题',
    'authoring-draft': '审核题目草稿',
    focus: '专注计时',
    'personal-notes': '个人笔记',
    'personal-lesson': '课时笔记',
    'standalone-note': '独立笔记',
    programming: '编程工作区',
    'programming-project': '编程项目',
    creative: '创意作品',
    'ai-study': 'AI 错题学习',
    'ai-report': '错题分析报告',
    'algorithm-forum': '算法论坛',
    'algorithm-training': '算法训练计划',
    'admin-controls': '机构治理',
    messages: '课程消息',
    conversation: '会话',
    'academic-goals': '学习目标',
    'academic-export': '导出记录',
    organization: '所属机构',
    grading: '批阅中心',
    'academic-records': '学习记录',
    'academic-record': '记录详情',
    'academic-module': '专业实验',
    academics: '专业学习',
    admin: '机构管理',
    'teaching-operations': '课程与考务管理',
    'school-directory': '教务名册',
    'android-studio': 'Android 作品',
    'android-project': 'Android 项目',
    'android-source': '源文件',
    'website-preview': '作品预览',
    teach: '教学工作台',
    'account-security': '账号安全',
  };
  const heading =
    extraHeadings[route.name] ??
    (route.name === 'home'
      ? '学习工作台'
      : route.name === 'courses' || route.name === 'course'
        ? '我的课程'
        : route.name === 'live' || route.name === 'classroom'
          ? '互动直播'
          : route.name === 'assignments' || route.name === 'assignment'
            ? '我的作业'
            : route.name === 'appeals' || route.name === 'review'
              ? '成绩复核'
              : ['exams', 'exam', 'examAttempt'].includes(route.name)
                ? '我的考试'
                : route.name === 'planner'
                  ? '学习计划'
                  : route.name === 'practice' ||
                      route.name === 'practiceSession' ||
                      route.name === 'collections'
                    ? '自主练习'
                    : route.name === 'note' || route.name === 'notes'
                      ? '学习笔记'
                      : route.name === 'discussions' ||
                          route.name === 'discussion' ||
                          route.name === 'discussionNew'
                        ? '课程讨论'
                        : ['algorithms', 'algorithm', 'algorithmSolution'].includes(route.name)
                          ? '算法学习'
                          : route.name === 'announcements' || route.name === 'announcement'
                            ? '教学公告'
                            : route.name === 'notifications'
                              ? '学习通知'
                              : '我的空间');
  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <Pressable
          accessibilityLabel={parentRoute(route).name === 'home' ? '知学首页' : '返回列表'}
          onPress={() => setRoute(parentRoute(route))}
        >
          <Text style={s.headerLogo}>{parentRoute(route).name === 'home' ? '知' : '‹'}</Text>
        </Pressable>
        <Text style={s.headerTitle}>{heading}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="打开我的空间"
          onPress={() => setRoute({ name: 'me' })}
        >
          <View style={s.avatar}>
            <Text style={s.avatarText}>{user.name.slice(0, 1)}</Text>
          </View>
        </Pressable>
      </View>
      <View style={s.flex}>
        {route.name === 'home' && <Home client={client} user={user} navigate={setRoute} canLive={canLive} />}
        {route.name === 'assignments' && (
          <Assignments
            client={client}
            courseId={route.courseId}
            open={(id) => setRoute({ name: 'assignment', id })}
          />
        )}
        {route.name === 'assignment' && (
          <Assignment key={route.id} client={client} id={route.id} registerLeave={registerLeave} />
        )}
        {route.name === 'exams' && (
          <Exams client={client} courseId={route.courseId} open={(id) => setRoute({ name: 'exam', id })} />
        )}
        {route.name === 'exam' && (
          <Exam client={client} id={route.id} openAttempt={(id) => setRoute({ name: 'examAttempt', id })} />
        )}
        {route.name === 'examAttempt' && (
          <ExamAnswer
            key={route.id}
            client={client}
            id={route.id}
            registerLeave={registerLeave}
            openReview={(id) => setRoute({ name: 'review', id })}
          />
        )}
        {route.name === 'collections' && (
          <Collections
            client={client}
            courseId={route.courseId}
            registerLeave={registerLeave}
            practice={(courseId) => setRoute({ name: 'practice', courseId })}
          />
        )}
        {route.name === 'practice' && (
          <Practices
            client={client}
            courseId={route.courseId}
            registerLeave={registerLeave}
            open={(id) => setRoute({ name: 'practiceSession', id })}
          />
        )}
        {route.name === 'practiceSession' && (
          <Practice key={route.id} client={client} id={route.id} registerLeave={registerLeave} />
        )}
        {route.name === 'notes' && (
          <Notes client={client} courseId={route.courseId} open={(id) => setRoute({ name: 'note', id })} />
        )}
        {route.name === 'note' && (
          <NoteEditor key={route.id} client={client} id={route.id} registerLeave={registerLeave} />
        )}
        {route.name === 'announcements' && (
          <Announcements
            client={client}
            courseId={route.courseId}
            open={(id) => setRoute({ name: 'announcement', id })}
          />
        )}
        {route.name === 'announcement' && <Announcement key={route.id} client={client} id={route.id} />}
        {route.name === 'discussions' && (
          <Discussions
            client={client}
            courseId={route.courseId}
            open={(id) => setRoute({ name: 'discussion', id })}
            create={() => setRoute({ name: 'discussionNew', courseId: route.courseId })}
          />
        )}
        {route.name === 'discussionNew' && (
          <NewDiscussion
            client={client}
            courseId={route.courseId}
            registerLeave={registerLeave}
            open={(id) => setRoute({ name: 'discussion', id })}
          />
        )}
        {route.name === 'discussion' && (
          <Discussion key={route.id} client={client} id={route.id} registerLeave={registerLeave} />
        )}
        {route.name === 'algorithms' && (
          <Algorithms
            training={() => setRoute({ name: 'algorithm-training' })}
            forum={() => setRoute({ name: 'algorithm-forum' })}
            client={client}
            open={(id) => setRoute({ name: 'algorithm', id })}
          />
        )}
        {route.name === 'algorithm' && (
          <Algorithm
            training={() => setRoute({ name: 'algorithm-training' })}
            forum={(problemId) => setRoute({ name: 'algorithm-forum', problemId })}
            key={route.id}
            client={client}
            id={route.id}
            registerLeave={registerLeave}
            open={(id) => setRoute({ name: 'algorithm', id })}
            editorial={(id) => setRoute({ name: 'algorithmSolution', id })}
          />
        )}
        {route.name === 'algorithmSolution' && (
          <AlgorithmSolution
            key={route.id}
            client={client}
            id={route.id}
            open={(id) => setRoute({ name: 'algorithm', id })}
          />
        )}
        {route.name === 'profile-settings' && <ProfileSettings client={client} user={user} />}
        {route.name === 'local-reminders' && <LocalStudyReminders client={client} user={user} />}
        {route.name === 'offline-review' && <OfflineReview client={client} user={user} />}
        {route.name === 'analytics' && (
          <LearningAnalytics client={client} user={user} registerLeave={registerLeave} />
        )}
        {route.name === 'ai-authoring' && (
          <AiAuthoringHome
            client={client}
            initialTab={route.tab}
            courseId={route.courseId}
            openDraft={(id) => setRoute({ name: 'authoring-draft', id })}
            registerLeave={registerLeave}
          />
        )}
        {route.name === 'authoring-draft' && (
          <AiAuthoringEditor
            client={client}
            id={route.id}
            openHistory={() => setRoute({ name: 'ai-authoring', tab: 'history' })}
            registerLeave={registerLeave}
          />
        )}
        {route.name === 'teaching-announcement' && (
          <TeachingAnnouncement
            client={client}
            courseId={route.courseId}
            openCourse={() => setRoute({ name: 'course', id: route.courseId })}
            registerLeave={registerLeave}
          />
        )}
        {route.name === 'focus' && <Focus client={client} registerLeave={registerLeave} />}
        {route.name === 'personal-notes' && (
          <PersonalNotes
            client={client}
            create={() => setRoute({ name: 'standalone-note' })}
            openNote={(id) => setRoute({ name: 'standalone-note', id })}
            openLesson={(id) => setRoute({ name: 'personal-lesson', id })}
          />
        )}
        {route.name === 'standalone-note' && (
          <StandaloneNoteEditor
            key={route.id || 'new'}
            id={route.id}
            client={client}
            registerLeave={registerLeave}
          />
        )}
        {route.name === 'personal-lesson' && (
          <NoteEditor personal client={client} id={route.id} registerLeave={registerLeave} />
        )}
        {route.name === 'programming' && (
          <Programming
            client={client}
            open={(id) => setRoute({ name: 'programming-project', id })}
            openCreative={() => setRoute({ name: 'creative' })}
          />
        )}
        {route.name === 'creative' && (
          <Creative client={client} openProject={(id) => setRoute({ name: 'programming-project', id })} />
        )}
        {route.name === 'school-directory' && (
          <SchoolDirectoryOperations client={client} user={user} registerLeave={registerLeave} />
        )}
        {route.name === 'android-studio' && (
          <AndroidStudio
            client={client}
            openProject={(id) => setRoute({ name: 'android-project', id })}
            registerLeave={registerLeave}
          />
        )}
        {route.name === 'android-project' && (
          <AndroidWorkspace
            key={route.id}
            id={route.id}
            client={client}
            openFile={(path) => setRoute({ name: 'android-source', id: route.id, path })}
            registerLeave={registerLeave}
          />
        )}
        {route.name === 'android-source' && (
          <AndroidFileEditor
            key={route.id + ':' + route.path}
            id={route.id}
            path={route.path}
            client={client}
            registerLeave={registerLeave}
          />
        )}
        {route.name === 'website-preview' && (
          <NativeProgrammingPreview client={client} id={route.id} registerLeave={registerLeave} />
        )}
        {route.name === 'programming-project' && (
          <ProgrammingProject
            openPreview={() => setRoute({ name: 'website-preview', id: route.id })}
            key={route.id}
            client={client}
            id={route.id}
            registerLeave={registerLeave}
            openProject={(id) => setRoute({ name: 'programming-project', id })}
            removed={() => setRoute({ name: 'programming' })}
          />
        )}
        {route.name === 'ai-study' && (
          <AiStudyHome
            client={client}
            courseId={route.courseId}
            initialTab={route.tab}
            registerLeave={registerLeave}
            openReport={(id) => setRoute({ name: 'ai-report', id })}
          />
        )}
        {route.name === 'ai-report' && (
          <AiStudyReportScreen
            client={client}
            id={route.id}
            registerLeave={registerLeave}
            openHistory={() => setRoute({ name: 'ai-study', tab: 'history' })}
          />
        )}
        {route.name === 'admin-controls' && <AdminControls client={client} user={user} />}
        {route.name === 'algorithm-training' && (
          <AlgorithmTrainingPlans
            client={client}
            open={(id) => setRoute({ name: 'algorithm', id })}
            registerLeave={registerLeave}
          />
        )}
        {route.name === 'algorithm-forum' && (
          <AlgorithmForum client={client} problemId={route.problemId} registerLeave={registerLeave} />
        )}
        {route.name === 'messages' && (
          <Messages client={client} open={(id, title) => setRoute({ name: 'conversation', id, title })} />
        )}
        {route.name === 'conversation' && (
          <MessageConversation
            client={client}
            user={user}
            id={route.id}
            title={route.title}
            registerLeave={registerLeave}
          />
        )}
        {route.name === 'academic-goals' && (
          <AcademicGoals
            client={client}
            moduleId={route.moduleId}
            openModule={(id) => setRoute({ name: 'academic-module', id })}
            registerLeave={registerLeave}
          />
        )}
        {route.name === 'academic-export' && (
          <AcademicRecordsExport
            client={client}
            moduleId={route.moduleId}
            status={route.status}
            registerLeave={registerLeave}
          />
        )}
        {route.name === 'organization' && <Organization client={client} />}
        {route.name === 'grading' && <GradingDesk client={client} />}
        {route.name === 'teaching-operations' && (
          <TeachingOperations client={client} user={user} registerLeave={registerLeave} />
        )}
        {route.name === 'teach' && <Teach client={client} user={user} />}
        {route.name === 'admin' && <AdminWorkspace client={client} user={user} />}
        {route.name === 'account-security' && <AccountSecurity client={client} user={user} />}
        {route.name === 'academics' && (
          <AcademicHome
            client={client}
            openModule={(id) => setRoute({ name: 'academic-module', id })}
            openRecords={() => setRoute({ name: 'academic-records' })}
            openGoals={() => setRoute({ name: 'academic-goals' })}
            registerLeave={registerLeave}
          />
        )}
        {route.name === 'academic-module' && (
          <AcademicWorkbench
            key={route.id + ':' + (route.recordId || '')}
            id={route.id}
            recordId={route.recordId}
            client={client}
            openRecord={(id) => setRoute({ name: 'academic-record', id })}
            openRecords={() => setRoute({ name: 'academic-records', moduleId: route.id })}
            openGoals={(moduleId) => setRoute({ name: 'academic-goals', moduleId })}
            openAlgorithms={() => setRoute({ name: 'algorithms' })}
            registerLeave={registerLeave}
          />
        )}
        {route.name === 'academic-records' && (
          <AcademicRecords
            client={client}
            openExport={(moduleId, status) => setRoute({ name: 'academic-export', moduleId, status })}
            moduleId={route.moduleId}
            openRecord={(id) => setRoute({ name: 'academic-record', id })}
          />
        )}
        {route.name === 'academic-record' && (
          <AcademicRecordDetail
            client={client}
            id={route.id}
            registerLeave={registerLeave}
            openRecords={() => setRoute({ name: 'academic-records' })}
            openModule={(id, recordId) => setRoute({ name: 'academic-module', id, recordId })}
          />
        )}
        {route.name === 'notifications' && <Inbox client={client} open={setRoute} />}
        {route.name === 'appeals' && (
          <Reviews client={client} open={(id) => setRoute({ name: 'review', id })} />
        )}
        {route.name === 'review' && (
          <Review
            key={route.id}
            client={client}
            id={route.id}
            registerLeave={registerLeave}
            openAttempt={(id) => setRoute({ name: 'examAttempt', id })}
          />
        )}
        {route.name === 'planner' && <StudyPlan client={client} user={user} />}
        {route.name === 'courses' && <Courses client={client} navigate={setRoute} />}
        {route.name === 'course' && (
          <CourseDetail client={client} id={route.id} user={user} navigate={setRoute} />
        )}
        {route.name === 'live' && (
          <Classes client={client} navigate={setRoute} canLive={canLive} courseId={route.courseId} />
        )}
        {route.name === 'classroom' && <Classroom client={client} id={route.id} />}
        {route.name === 'me' && (
          <ScrollView contentContainerStyle={s.page}>
            <View style={s.hero}>
              <Text style={s.heroTitle}>{user.name}</Text>
              <Text style={s.heroText}>
                {roles[user.role] || user.role} ·{' '}
                {user.accountMode === 'PERSONAL' ? '个人学习空间' : '机构学习空间'}
              </Text>
            </View>
            <View style={s.card}>
              <Text style={s.sectionTitle}>账号信息</Text>
              {user.role === 'STUDENT' && (
                <Button
                  secondary
                  title="所属机构与加入申请"
                  onPress={() => setRoute({ name: 'organization' })}
                />
              )}
              <Button
                secondary
                title="个人资料与密码"
                onPress={() => setRoute({ name: 'profile-settings' })}
              />
              <Button secondary title="本机学习提醒" onPress={() => setRoute({ name: 'local-reminders' })} />
              {user.role === 'STUDENT' && user.accountMode === 'PERSONAL' && (
                <Button
                  secondary
                  title="离线复习个人笔记"
                  onPress={() => setRoute({ name: 'offline-review' })}
                />
              )}
              <Button
                secondary
                title="账号安全与登录设备"
                onPress={() => setRoute({ name: 'account-security' })}
              />
              <Text style={s.body}>账号：{user.username}</Text>
              <Text style={s.body}>当前平台：{client.origin}</Text>
              <Text style={s.small}>学习资料与网站同步。手机端会话独立，退出不会登出其他设备。</Text>
              <Button
                title={logoutBusy ? '正在退出…' : '退出登录'}
                disabled={logoutBusy}
                secondary
                onPress={() => {
                  setLogoutBusy(true);
                  void client.logout().catch((e) => {
                    Alert.alert('退出失败', (e as Error).message);
                    setLogoutBusy(false);
                  });
                }}
              />
            </View>
            <Text style={s.small}>知学 Android · 预览版 0.13.0{allowLocal ? ' · 本地测试环境' : ''}</Text>
          </ScrollView>
        )}
      </View>
      <View style={s.tabs}>
        {(
          [
            { name: 'home', label: '首页', icon: '⌂' },
            { name: 'courses', label: '课程', icon: '▤' },
            { name: 'planner', label: '计划', icon: '☷' },
            ...(canLive ? [{ name: 'live', label: '直播', icon: '◉' }] : []),
            { name: 'me', label: '我的', icon: '○' },
          ] as const
        ).map((tab) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{
              selected:
                route.name === tab.name ||
                (tab.name === 'courses' &&
                  [
                    'course',
                    'assignments',
                    'assignment',
                    'exams',
                    'exam',
                    'examAttempt',
                    'appeals',
                    'review',
                  ].includes(route.name)) ||
                (tab.name === 'live' && route.name === 'classroom'),
            }}
            key={tab.name}
            style={s.tab}
            onPress={() =>
              setRoute({ name: tab.name as 'home' | 'courses' | 'live' | 'me' | 'planner' | 'assignments' })
            }
          >
            <Text style={[s.tabIcon, selected(tab.name) && s.selected]}>{tab.icon}</Text>
            <Text style={[s.tabText, selected(tab.name) && s.selected]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
function Home({
  client,
  user,
  navigate,
  canLive,
}: {
  client: MobileClient;
  user: MobileUser;
  navigate: (r: Route) => void;
  canLive: boolean;
}) {
  const q = useResource<{ items: Course[]; total: number }>(client, '/courses?page=1&pageSize=4');
  return (
    <ScrollView
      contentContainerStyle={s.page}
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} />}
    >
      <View style={s.hero}>
        <Text style={s.heroEyebrow}>
          {user.role === 'TEACHER'
            ? '教师工作台'
            : user.role === 'SUPER_ADMIN'
              ? '平台管理工作台'
              : user.role === 'ADMIN'
                ? '机构管理工作台'
                : '学习空间'}
        </Text>
        <Text style={s.heroTitle}>你好，{user.name}</Text>
        <Text style={s.heroText}>
          {user.role === 'STUDENT'
            ? '从一节课程、一个问题开始，继续今天的学习。'
            : user.role === 'TEACHER'
              ? '管理授课课程、发布任务并批阅学生作答。'
              : '管理机构账号、教务名册与授权。'}
        </Text>
        <View style={s.heroPill}>
          <Text style={s.heroPillText}>
            {user.role === 'STUDENT' ? '已加入' : user.role === 'TEACHER' ? '授课' : '可见'}{' '}
            {q.data?.total ?? '—'} 门课程
          </Text>
        </View>
      </View>
      <View style={s.quickRow}>
        <Shortcut
          title="我的课程"
          caption="继续学习"
          icon="▤"
          onPress={() => navigate({ name: 'courses' })}
        />
        {canLive && (
          <Shortcut title="互动直播" caption="进入课堂" icon="◉" onPress={() => navigate({ name: 'live' })} />
        )}
      </View>
      <Shortcut
        title="学习计划"
        caption="今日任务与月度日程"
        icon="☷"
        onPress={() => navigate({ name: 'planner' })}
      />
      {user.role === 'STUDENT' && (
        <Shortcut
          title="我的作业"
          caption="作答、提交与成绩反馈"
          icon="✎"
          onPress={() => navigate({ name: 'assignments' })}
        />
      )}
      {user.role === 'STUDENT' && (
        <Shortcut
          title="我的考试"
          caption="限时作答与成绩回执"
          icon="✓"
          onPress={() => navigate({ name: 'exams' })}
        />
      )}
      {user.role === 'STUDENT' && (
        <Shortcut
          title="成绩复核"
          caption="申请进度与成绩变更"
          icon="↺"
          onPress={() => navigate({ name: 'appeals' })}
        />
      )}
      {user.role === 'STUDENT' && (
        <Shortcut
          title="学习通知"
          caption="未读提醒与学习动态"
          icon="♧"
          onPress={() => navigate({ name: 'notifications' })}
        />
      )}
      {user.role === 'STUDENT' && (
        <Shortcut
          title="学习笔记"
          caption="私人记录与课时重点"
          icon="✐"
          onPress={() => navigate({ name: 'notes' })}
        />
      )}
      {user.role === 'STUDENT' && (
        <Shortcut
          title="自主练习"
          caption="逐题作答与学习复盘"
          icon="✧"
          onPress={() => navigate({ name: 'practice' })}
        />
      )}
      {user.role === 'STUDENT' && (
        <Shortcut
          title="错题与收藏"
          caption="掌握状态与个人题目管理"
          icon="☆"
          onPress={() => navigate({ name: 'collections' })}
        />
      )}
      {user.role === 'STUDENT' && (
        <Shortcut
          title="教学公告"
          caption="机构消息与课程安排"
          icon="♧"
          onPress={() => navigate({ name: 'announcements' })}
        />
      )}
      {user.role === 'STUDENT' && (
        <Shortcut
          title="课程讨论"
          caption="交流问题与学习收获"
          icon="♧"
          onPress={() => navigate({ name: 'discussions' })}
        />
      )}
      {user.role === 'STUDENT' && (
        <Shortcut
          title="算法学习"
          caption="题目题解与私人复习记录"
          icon="⌘"
          onPress={() => navigate({ name: 'algorithms' })}
        />
      )}
      {user.accountMode !== 'PERSONAL' && user.permissions.includes('communication.read') && (
        <Shortcut
          title="课程消息"
          caption="联系师生、参与班级会话"
          icon="✉"
          onPress={() => navigate({ name: 'messages' })}
        />
      )}
      {(user.role === 'STUDENT' || user.permissions.includes('analysis.read')) && (
        <Shortcut
          title="学习统计"
          caption="课程完成情况、已发布成绩和学习报告"
          icon="▥"
          onPress={() => navigate({ name: 'analytics' })}
        />
      )}
      {user.role === 'TEACHER' && user.permissions.includes('question.manage') && (
        <Shortcut
          title="AI 出题"
          caption="生成并逐题审核私人草稿"
          icon="✎"
          onPress={() => navigate({ name: 'ai-authoring' })}
        />
      )}
      {user.role === 'STUDENT' && user.permissions.includes('learning.use') && (
        <>
          <Shortcut
            title="专注计时"
            caption="计时、休息与专注记录"
            icon="◷"
            onPress={() => navigate({ name: 'focus' })}
          />
          <Shortcut
            title="编程与创意"
            caption="创建项目、编辑源文件与导出作品"
            icon="⌨"
            onPress={() => navigate({ name: 'programming' })}
          />
        </>
      )}
      {['STUDENT', 'TEACHER'].includes(user.role) && (
        <Shortcut
          title="个人笔记"
          caption="独立笔记与课时笔记"
          icon="✎"
          onPress={() => navigate({ name: 'personal-notes' })}
        />
      )}
      {user.role === 'STUDENT' && user.permissions.includes('learning.use') && (
        <Shortcut
          title="AI 错题学习"
          caption="分析错题、核对来源并导出报告"
          icon="✧"
          onPress={() => navigate({ name: 'ai-study' })}
        />
      )}
      {user.role === 'STUDENT' && (
        <Shortcut
          title="专业学习"
          caption="选择模块、完成实验并保存笔记"
          icon="◇"
          onPress={() => navigate({ name: 'academics' })}
        />
      )}
      {user.role !== 'STUDENT' && user.permissions.includes('question.manage') && (
        <Shortcut
          title="课程与考务管理"
          caption="题库修订、试卷、考试资格与课件"
          icon="▦"
          onPress={() => navigate({ name: 'teaching-operations' })}
        />
      )}
      {user.role !== 'STUDENT' &&
        (user.permissions.includes('course.manage') || user.permissions.includes('course.admin')) && (
          <Shortcut
            title="教学工作台"
            caption="课程、题库、作业、考试与直播预约"
            icon="▤"
            onPress={() => navigate({ name: 'teach' })}
          />
        )}
      {user.role !== 'STUDENT' && user.permissions.includes('assessment.grade') && (
        <Shortcut
          title="批阅中心"
          caption="作业、考试及成绩复核"
          icon="✓"
          onPress={() => navigate({ name: 'grading' })}
        />
      )}
      {['ADMIN', 'SUPER_ADMIN'].includes(user.role) && (
        <Shortcut
          title="机构管理"
          caption="账号与专业、班级、学期及加入申请"
          icon="◎"
          onPress={() => navigate({ name: 'admin' })}
        />
      )}
      {['ADMIN', 'SUPER_ADMIN'].includes(user.role) && (
        <Shortcut
          title="治理与设置"
          caption="举报、审计记录和机构配置"
          icon="⚙"
          onPress={() => navigate({ name: 'admin-controls' })}
        />
      )}
      {user.role === 'STUDENT' && user.permissions.includes('learning.use') && (
        <Shortcut
          title="Android 作品"
          caption="创建应用、修改源文件和下载构建"
          icon="▣"
          onPress={() => navigate({ name: 'android-studio' })}
        />
      )}
      {['ADMIN', 'SUPER_ADMIN'].includes(user.role) && user.permissions.includes('users.manage') && (
        <Shortcut
          title="教务名册"
          caption="批量导入、导出、角色和班课关联"
          icon="▦"
          onPress={() => navigate({ name: 'school-directory' })}
        />
      )}
      <Section title="继续学习" action="全部课程 →" onPress={() => navigate({ name: 'courses' })} />
      <Query state={q} />
      {q.data?.items.map((course) => (
        <CourseCard
          key={course.id}
          course={course}
          onPress={() => navigate({ name: 'course', id: course.id })}
        />
      ))}
      {q.data && !q.data.items.length && (
        <Empty
          text={
            user.accountMode === 'PERSONAL'
              ? '可在「专业学习」选择感兴趣的模块。'
              : '暂无已加入课程，请联系教师或管理员安排选课。'
          }
        />
      )}
      <View style={s.card}>
        <Text style={s.sectionTitle}>跨端接续</Text>
        <Text style={s.body}>
          手机与网站使用同一份课程和学习进度。直播进入后默认关闭设备，由你决定何时开麦和开启摄像头。
        </Text>
      </View>
    </ScrollView>
  );
}
function Courses({ client, navigate }: { client: MobileClient; navigate: (r: Route) => void }) {
  const [page, setPage] = useState(1);
  const q = useResource<{ items: Course[]; total: number }>(client, `/courses?page=${page}&pageSize=12`);
  return (
    <ScrollView
      contentContainerStyle={s.page}
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} />}
    >
      <Section title="我的课程" />
      <Text style={s.muted}>按当前选课和授课资格展示，共 {q.data?.total ?? '—'} 门。</Text>
      <Query state={q} />
      {q.data?.items.map((c) => (
        <CourseCard key={c.id} course={c} onPress={() => navigate({ name: 'course', id: c.id })} />
      ))}
      {q.data && !q.data.items.length && <Empty text="当前没有可访问的课程" />}
      <Pager page={page} total={q.data?.total || 0} size={12} change={setPage} />
    </ScrollView>
  );
}
function CourseDetail({
  client,
  id,
  user,
  navigate,
}: {
  client: MobileClient;
  id: string;
  user: MobileUser;
  navigate: (r: Route) => void;
}) {
  const q = useResource<Course>(client, '/courses/' + encodeURIComponent(id));
  const [lessonId, setLessonId] = useState('');
  const c = q.data;
  const all = c?.chapters?.flatMap((x) => x.lessons) || [],
    lesson = all.find((x) => x.id === lessonId);
  return (
    <ScrollView
      contentContainerStyle={s.page}
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} />}
    >
      <Query state={q} />
      {c && (
        <>
          <View style={s.hero}>
            <Text style={s.heroEyebrow}>{c.category}</Text>
            <Text style={s.heroTitle}>{c.title}</Text>
            <Text style={s.heroText}>{c.teacherName}</Text>
            <Text style={s.heroText}>
              {c.progress?.completed || 0} / {c.progress?.total || 0} 课时已完成
            </Text>
          </View>
          <Text style={s.body}>{c.description}</Text>
          {user.role === 'STUDENT' && (
            <Button
              title="查看课程作业"
              secondary
              onPress={() => navigate({ name: 'assignments', courseId: id })}
            />
          )}
          {user.role === 'STUDENT' && (
            <Button
              title="查看课程考试"
              secondary
              onPress={() => navigate({ name: 'exams', courseId: id })}
            />
          )}
          {user.role === 'STUDENT' && (
            <Button
              title="查看课程笔记"
              secondary
              onPress={() => navigate({ name: 'notes', courseId: id })}
            />
          )}
          {user.role === 'STUDENT' && (
            <Button
              title="课程自主练习"
              secondary
              onPress={() => navigate({ name: 'practice', courseId: id })}
            />
          )}
          {user.role === 'STUDENT' && (
            <Button
              title="查看课程公告"
              secondary
              onPress={() => navigate({ name: 'announcements', courseId: id })}
            />
          )}
          {user.role === 'STUDENT' && (
            <Button
              title="查看课程讨论"
              secondary
              onPress={() => navigate({ name: 'discussions', courseId: id })}
            />
          )}
          {user.role === 'TEACHER' && (
            <Button
              title="发布课程公告"
              secondary
              onPress={() => navigate({ name: 'teaching-announcement', courseId: id })}
            />
          )}
          <Button title="查看课程直播" secondary onPress={() => navigate({ name: 'live', courseId: id })} />
          {user.role === 'STUDENT' && (
            <Button title="课程错题与收藏" onPress={() => navigate({ name: 'collections', courseId: id })} />
          )}
          {lesson && ['STUDENT', 'TEACHER'].includes(user.role) && (
            <Button
              title="本课时私人笔记"
              onPress={() =>
                navigate({ name: user.role === 'TEACHER' ? 'personal-lesson' : 'note', id: lesson.id })
              }
            />
          )}
          {lesson &&
            (user.role === 'STUDENT' ? (
              <Lesson key={lesson.id} client={client} id={lesson.id} onSaved={q.reload} />
            ) : (
              <View style={s.card}>
                <Text style={s.sectionTitle}>{lesson.title}</Text>
                <Text style={s.body}>{plainText(lesson.content)}</Text>
              </View>
            ))}
          {lesson && (
            <Button
              title="在手机网页查看完整课程"
              secondary
              onPress={() => void Linking.openURL(client.origin + '/courses/' + encodeURIComponent(id))}
            />
          )}
          {user.role === 'STUDENT' && (
            <Button
              title="查看课程考试"
              secondary
              onPress={() => navigate({ name: 'exams', courseId: id })}
            />
          )}
          {c.chapters?.map((ch) => (
            <View key={ch.id} style={s.card}>
              <Text style={s.sectionTitle}>{ch.title}</Text>
              {ch.lessons.map((l) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={l.title}
                  key={l.id}
                  style={[s.lessonRow, lessonId === l.id && s.activeLesson]}
                  onPress={() => setLessonId(l.id)}
                >
                  <Text style={s.lessonMarker}>{l.progress?.completed ? '✓' : '○'}</Text>
                  <Text style={s.lessonTitle}>{l.title}</Text>
                  <Text style={s.muted}>›</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}
function Classes({
  client,
  navigate,
  canLive,
  courseId,
}: {
  client: MobileClient;
  navigate: (r: Route) => void;
  canLive: boolean;
  courseId?: string;
}) {
  const [page, setPage] = useState(1);
  const q = useResource<{ items: Live[]; total: number; provider: { available: boolean; reason: string } }>(
    client,
    `/live/classes?page=${page}&pageSize=12${courseId ? `&courseId=${encodeURIComponent(courseId)}` : ''}`,
    10000,
  );
  if (!canLive) return <Empty text="机构课程直播需要有效选课资格。" />;
  return (
    <ScrollView
      contentContainerStyle={s.page}
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} />}
    >
      <Section title="互动直播" />
      <Text style={s.muted}>课程课堂 · 实时交流</Text>
      <Query state={q} />
      {q.data?.provider && !q.data.provider.available && (
        <Text style={s.error}>{q.data.provider.reason}</Text>
      )}
      {q.data?.items.map((c) => (
        <Pressable
          key={c.id}
          accessibilityRole="button"
          accessibilityLabel={c.title}
          style={s.card}
          onPress={() => navigate({ name: 'classroom', id: c.id })}
        >
          <View style={s.row}>
            <Text style={[s.tag, c.status === 'LIVE' && s.liveTag]}>{statuses[c.status]}</Text>
            <Text style={s.small}>{date(c.scheduledAt)}</Text>
          </View>
          <Text style={s.cardTitle}>{c.title}</Text>
          <Text style={s.muted}>{c.courseTitle}</Text>
          <Text style={s.cardLink}>{c.status === 'LIVE' ? '进入直播课堂 →' : '查看课堂 →'}</Text>
        </Pressable>
      ))}
      {q.data && !q.data.items.length && <Empty text="暂无直播预约，教师创建后会显示在这里。" />}
      <Pager page={page} total={q.data?.total || 0} size={12} change={setPage} />
    </ScrollView>
  );
}
function Classroom({ client, id }: { client: MobileClient; id: string }) {
  const q = useResource<Live>(client, '/live/classes/' + encodeURIComponent(id), 4000);
  const c = q.data;
  const [admission, setAdmission] = useState<Admission | null>(null),
    leaseRef = useRef<Admission | null>(null);
  const [busy, setBusy] = useState(false),
    [text, setText] = useState(''),
    [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const epoch = useRef(0);
  const send = (suffix: string, body: unknown = {}) =>
    client.request(`/live/classes/${encodeURIComponent(id)}/${suffix}`, body, 'POST');
  async function leave(reason = '') {
    epoch.current++;
    const lease = leaseRef.current;
    leaseRef.current = null;
    if (mounted.current) {
      setAdmission(null);
      setNotice(reason);
      setBusy(false);
    }
    if (!lease) return;
    try {
      await send('leave', { connectionId: lease.connectionId });
    } catch {}
  }
  useEffect(() => {
    mounted.current = true;
    const background = () => {
      if (
        AppState.currentState === 'background' &&
        !permissionPrompts.activeFor(leaseRef.current?.connectionId)
      )
        void leave('已暂停音视频。返回前台后请重新进入课堂。');
    };
    const subscription = AppState.addEventListener('change', background);
    const unsubscribe = permissionPrompts.subscribe(background);
    return () => {
      mounted.current = false;
      subscription.remove();
      unsubscribe();
      void leave();
    };
  }, []);
  useEffect(() => {
    if (c?.status === 'ENDED' || c?.own?.state === 'BLOCKED' || q.error)
      void leave(
        c?.status === 'ENDED'
          ? '本场课堂已结束'
          : c?.own?.state === 'BLOCKED'
            ? '你已被移出本场课堂'
            : q.error,
      );
  }, [c?.status, c?.own?.state, q.error]);
  useEffect(() => {
    if (!admission) return;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void send('heartbeat', { connectionId: admission.connectionId })
        .catch(() => {
          if (leaseRef.current === admission) void leave('课堂资格或连接已变化，请重新进入。');
        })
        .finally(() => {
          pending = false;
        });
    }, 10000);
    return () => clearInterval(timer);
  }, [admission]);
  async function join() {
    if (busy) return;
    const current = ++epoch.current;
    setBusy(true);
    setNotice('');
    try {
      const next = await send('join');
      if (!mounted.current || epoch.current !== current) {
        void send('leave', { connectionId: next.connectionId }).catch(() => undefined);
        return;
      }
      leaseRef.current = next;
      setAdmission(next);
      q.reload();
    } catch (e) {
      if (mounted.current && epoch.current === current) setNotice((e as Error).message);
    } finally {
      if (mounted.current && epoch.current === current) setBusy(false);
    }
  }
  async function action(path: string, body: unknown = {}) {
    if (busy) return;
    setBusy(true);
    try {
      await send(path, body);
      q.reload();
    } catch (e) {
      Alert.alert('操作未完成', (e as Error).message);
      q.reload();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Query state={q} />
      {c && (
        <>
          <Text style={s.eyebrow}>{c.courseTitle}</Text>
          <Text style={s.title}>{c.title}</Text>
          <View style={s.row}>
            <Text style={[s.tag, c.status === 'LIVE' && s.liveTag]}>{statuses[c.status]}</Text>
            <Text style={s.small}>预约 {date(c.scheduledAt)}</Text>
          </View>
          {!!notice && (
            <Text accessibilityRole="alert" style={s.error}>
              {notice}
            </Text>
          )}
          {admission ? (
            <View style={s.card}>
              <LiveRoom
                key={admission.connectionId}
                origin={client.origin}
                admission={admission}
                onLeave={(reason) => {
                  if (leaseRef.current === admission) void leave(reason);
                }}
              />
              <Button title="离开课堂" secondary onPress={() => void leave()} />
              {!admission.host && (
                <Button
                  title={c.own?.handRaised ? '取消举手' : '举手申请连麦'}
                  disabled={busy || c.own?.approved}
                  secondary
                  onPress={() =>
                    void action('hand', { connectionId: admission.connectionId, raised: !c.own?.handRaised })
                  }
                />
              )}
            </View>
          ) : (
            <View style={s.card}>
              <Text style={s.stageIcon}>◉</Text>
              <Text style={s.sectionTitle}>
                {c.status === 'ENDED'
                  ? '本场课堂已结束'
                  : c.status === 'SCHEDULED'
                    ? '课堂尚未开始'
                    : '准备进入课堂'}
              </Text>
              <Text style={s.body}>进入后默认观看和收听。麦克风与摄像头由你手动开启。</Text>
              <Button
                title={busy ? '正在进入…' : '进入课堂'}
                disabled={busy || c.status !== 'LIVE' || !c.provider?.available}
                onPress={() => void join()}
              />
            </View>
          )}
          {c.canManage && c.status === 'SCHEDULED' && (
            <Button
              title="开始直播"
              disabled={busy || !c.provider?.available}
              onPress={() => void action('start', { revision: c.revision })}
            />
          )}
          {c.canManage && c.status === 'LIVE' && (
            <Button
              title="结束课堂"
              secondary
              disabled={busy}
              onPress={() =>
                Alert.alert('结束课堂', '结束后所有成员会离开，本场课堂无法重新开播。', [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '确认结束',
                    style: 'destructive',
                    onPress: () => void action('end', { revision: c.revision }),
                  },
                ])
              }
            />
          )}
          <View style={s.card}>
            <Section title="课堂成员" />
            {c.canManage && c.status === 'LIVE' && (
              <Button
                title="全员下麦"
                secondary
                disabled={busy}
                onPress={() =>
                  Alert.alert('全员下麦', '收回本场所有学员的连麦资格？', [
                    { text: '取消', style: 'cancel' },
                    { text: '确认下麦', onPress: () => void action('revoke-all') },
                  ])
                }
              />
            )}
            <Text style={s.small}>当前在线 {c.members.filter((m) => m.online).length} 人</Text>
            {c.members.map((m) => (
              <View key={m.id} style={s.member}>
                <View style={s.flex}>
                  <Text style={s.memberName}>
                    {m.name}
                    {m.host ? ' · 教师' : ''}
                  </Text>
                  <Text style={s.small}>
                    {m.online ? '在线' : '离线'}
                    {m.handRaised ? ' · 举手中' : ''}
                    {m.approved && !m.host ? ' · 已允许连麦' : ''}
                    {m.chatMuted ? ' · 已禁言' : ''}
                  </Text>
                </View>
                {c.canManage && m.online && !m.host && (
                  <View>
                    <Button
                      small
                      secondary
                      disabled={busy}
                      title={m.approved ? '收回连麦' : '允许连麦'}
                      onPress={() =>
                        void action(`members/${m.id}`, {
                          action: m.approved ? 'revoke' : 'approve',
                          revision: m.revision,
                        })
                      }
                    />
                    <Button
                      small
                      secondary
                      disabled={busy}
                      title={m.chatMuted ? '解除禁言' : '禁言'}
                      onPress={() =>
                        void action('members/' + m.id, {
                          action: m.chatMuted ? 'unmute-chat' : 'mute-chat',
                          revision: m.revision,
                        })
                      }
                    />
                    <Button
                      small
                      secondary
                      disabled={busy}
                      title="移出课堂"
                      onPress={() =>
                        Alert.alert('移出课堂', m.name, [
                          { text: '取消', style: 'cancel' },
                          {
                            text: '确认移出',
                            style: 'destructive',
                            onPress: () =>
                              void action('members/' + m.id, { action: 'remove', revision: m.revision }),
                          },
                        ])
                      }
                    />
                  </View>
                )}
              </View>
            ))}
          </View>
          <View style={s.card}>
            <Text style={s.sectionTitle}>课堂交流</Text>
            {c.messages.map((m) => (
              <View key={m.id} style={s.chatMessage}>
                <Text style={s.chatName}>{m.name}</Text>
                <Text selectable style={s.body}>
                  {m.text}
                </Text>
              </View>
            ))}
            {!c.messages.length && <Text style={s.muted}>还没有课堂发言</Text>}
            <TextInput
              accessibilityLabel="课堂发言"
              placeholder={c.own?.chatMuted ? '你已被禁言' : '输入问题或学习心得'}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={1000}
              style={[s.input, s.chatInput]}
              editable={!!admission && c.canChat && !c.own?.chatMuted && !busy}
            />
            <Button
              title="发送消息"
              disabled={!admission || !c.canChat || !!c.own?.chatMuted || !text.trim() || busy}
              onPress={() => {
                const current = text.trim();
                if (!admission) return;
                setBusy(true);
                void send('messages', {
                  text: current,
                  clientId: randomUUID(),
                  connectionId: admission.connectionId,
                })
                  .then(() => {
                    setText('');
                    q.reload();
                  })
                  .catch((e) => Alert.alert('发送失败', e.message))
                  .finally(() => setBusy(false));
              }}
            />
          </View>
          <Text style={s.small}>本预览版进入后台会停止摄像头和麦克风并离开课堂。返回后可重新进入。</Text>
        </>
      )}
    </ScrollView>
  );
}
function plainText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(?:p|h[1-6]|li|blockquote|div)>|<br\s*\/?>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
  small = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  small?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, small && s.smallButton, disabled && s.disabled]}
    >
      <Text style={[s.buttonText, secondary && s.secondaryText]}>{title}</Text>
    </Pressable>
  );
}
function Section({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {action && (
        <Pressable accessibilityRole="button" onPress={onPress}>
          <Text style={s.cardLink}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}
function Query({ state }: { state: { loading: boolean; error?: string; reload: () => void } }) {
  return (
    <>
      {state.loading && <ActivityIndicator style={s.spinner} color="#6d45dc" />}
      {state.error && (
        <View style={s.card}>
          <Text accessibilityRole="alert" style={s.error}>
            {state.error}
          </Text>
          <Button title="重试" secondary onPress={state.reload} />
        </View>
      )}
    </>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyIcon}>○</Text>
      <Text style={s.muted}>{text}</Text>
    </View>
  );
}
function CourseCard({ course, onPress }: { course: Course; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={course.title} style={s.card} onPress={onPress}>
      <Text style={s.tag}>{course.category}</Text>
      <Text style={s.cardTitle}>{course.title}</Text>
      <Text style={s.muted}>
        {course.teacherName} · 已完成 {course.completedLessons} / {course.totalLessons} 课时
      </Text>
      <View style={s.progress}>
        <View style={[s.progressFill, { width: `${course.progressPercent || 0}%` }]} />
      </View>
      <Text style={s.cardLink}>继续学习 →</Text>
    </Pressable>
  );
}
function Shortcut({
  title,
  caption,
  icon,
  onPress,
}: {
  title: string;
  caption: string;
  icon: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[s.card, s.shortcut]}
      onPress={onPress}
    >
      <Text style={s.shortcutIcon}>{icon}</Text>
      <Text style={s.memberName}>{title}</Text>
      <Text style={s.small}>{caption} →</Text>
    </Pressable>
  );
}
function Pager({
  page,
  total,
  size,
  change,
}: {
  page: number;
  total: number;
  size: number;
  change: (p: number) => void;
}) {
  if (total <= size && page === 1) return null;
  return (
    <View style={s.pager}>
      <Button title="上一页" disabled={page === 1} secondary onPress={() => change(page - 1)} />
      <Text style={s.muted}>
        {page} / {Math.max(1, Math.ceil(total / size))}
      </Text>
      <Button title="下一页" disabled={page * size >= total} secondary onPress={() => change(page + 1)} />
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f6fb' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: '#f5f6fb' },
  page: { padding: 18, paddingBottom: 32, gap: 16 },
  loginPage: { padding: 24, paddingTop: 40, gap: 20, flexGrow: 1, justifyContent: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  brandMark: {
    backgroundColor: '#6d45dc',
    color: 'white',
    width: 48,
    height: 48,
    borderRadius: 16,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 27,
    fontWeight: '800',
  },
  brandName: { fontSize: 31, fontWeight: '800', color: '#252341' },
  tagline: { fontSize: 15, color: '#76748b', textAlign: 'center', marginBottom: 16 },
  card: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e9e8f2',
    gap: 10,
  },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: '#7c6baf' },
  title: { fontSize: 26, fontWeight: '800', color: '#252341', lineHeight: 36 },
  label: { fontSize: 14, fontWeight: '600', color: '#504b65', marginTop: 10 },
  input: {
    backgroundColor: '#f8f8fc',
    borderColor: '#e1dfea',
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#252341',
  },
  button: {
    minHeight: 48,
    backgroundColor: '#6d45dc',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  buttonText: { color: 'white', fontSize: 15, fontWeight: '700' },
  secondary: { backgroundColor: '#f0edfa' },
  secondaryText: { color: '#6544bd' },
  smallButton: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 8 },
  disabled: { opacity: 0.4 },
  muted: { fontSize: 14, color: '#77748a', lineHeight: 22 },
  small: { fontSize: 12, lineHeight: 20, color: '#8a8799' },
  body: { fontSize: 15, lineHeight: 25, color: '#514d64' },
  error: {
    fontSize: 14,
    lineHeight: 23,
    color: '#b54747',
    backgroundColor: '#fff3f1',
    padding: 12,
    borderRadius: 10,
  },
  footer: { fontSize: 12, color: '#9894a6', textAlign: 'center', padding: 16 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderColor: '#e9e8f2',
    backgroundColor: '#ffffff',
  },
  headerLogo: {
    fontSize: 26,
    fontWeight: '800',
    color: '#6d45dc',
    minWidth: 32,
    minHeight: 40,
    textAlignVertical: 'center',
  },
  headerTitle: { flex: 1, color: '#38334c', fontSize: 17, fontWeight: '700' },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ede6ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: 17, fontWeight: '700', color: '#6d45dc' },
  hero: { backgroundColor: '#6d45dc', borderRadius: 23, padding: 24, gap: 12 },
  heroEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: '#dcd1ff' },
  heroTitle: { fontSize: 27, lineHeight: 38, fontWeight: '800', color: 'white' },
  heroText: { fontSize: 14, lineHeight: 23, color: '#e4dcfc' },
  heroPill: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
    backgroundColor: '#ffffff24',
    marginTop: 6,
  },
  heroPillText: { color: 'white', fontSize: 12 },
  quickRow: { flexDirection: 'row', gap: 12 },
  shortcut: { flex: 1, padding: 16, gap: 8 },
  shortcutIcon: { fontSize: 28, color: '#7655cf' },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { fontSize: 18, lineHeight: 27, fontWeight: '700', color: '#302b43' },
  cardTitle: { fontSize: 19, lineHeight: 28, fontWeight: '700', color: '#302b43' },
  cardLink: { fontSize: 13, color: '#7451c8', fontWeight: '600', marginTop: 4 },
  tag: {
    fontSize: 11,
    color: '#7155aa',
    backgroundColor: '#f0ecfa',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  liveTag: { color: '#07845a', backgroundColor: '#e7f8ef' },
  progress: { height: 5, borderRadius: 4, backgroundColor: '#efecf7', overflow: 'hidden', marginTop: 8 },
  progressFill: { height: 5, borderRadius: 4, backgroundColor: '#9878ea' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderColor: '#e9e8f2',
    paddingTop: 5,
    paddingBottom: 3,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 58, gap: 2 },
  tabIcon: { fontSize: 24, color: '#a29bae' },
  tabText: { fontSize: 11, color: '#8f879f' },
  selected: { color: '#6d45dc', fontWeight: '700' },
  empty: { padding: 30, gap: 10, alignItems: 'center' },
  emptyIcon: { fontSize: 40, color: '#c4b4e7' },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  spinner: { margin: 18 },
  lessonRow: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderColor: '#f3f1f8',
  },
  activeLesson: { backgroundColor: '#f4efff' },
  lessonMarker: { fontSize: 18, color: '#8860ce' },
  lessonTitle: { flex: 1, fontSize: 15, color: '#4b465c', lineHeight: 23 },
  lessonText: { fontSize: 16, lineHeight: 29, color: '#4b465c' },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderColor: '#f3f1f8',
  },
  memberName: { fontSize: 15, fontWeight: '600', color: '#4b465c' },
  chatMessage: { borderBottomWidth: 1, borderColor: '#f3f1f8', paddingVertical: 10 },
  chatName: { fontSize: 12, fontWeight: '700', color: '#8a72b3', marginBottom: 5 },
  chatInput: { minHeight: 80, textAlignVertical: 'top' },
  stageIcon: { fontSize: 48, color: '#b7a3df', textAlign: 'center', paddingVertical: 24 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
