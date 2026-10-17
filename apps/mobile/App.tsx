import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
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
import { useResource } from './src/resource';
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
  chapters?: { id: string; title: string; lessons: Lesson[] }[];
  progress?: { completed: number; total: number; percent: number };
};
type Lesson = {
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
  | { name: 'home' | 'courses' | 'live' | 'me'; courseId?: string }
  | { name: 'course'; id: string }
  | { name: 'classroom'; id: string };

const AuthContext = createContext<{ client: MobileClient; user: MobileUser } | null>(null);
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [server, setServer] = useState(defaultOrigin),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false);
  const create = (origin: string) => {
    const next = new MobileClient(origin, store, (u) => {
      if (active.current === next) setUser(u);
    });
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
  async function login() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const origin = serverOrigin(server, allowLocal);
      let next = client;
      if (!next || next.origin !== origin) {
        if (next) await next.clear();
        next = create(origin);
      }
      await SecureStore.setItemAsync(originKey, origin);
      await next.login(username, password);
      setPassword('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!loading && user && client) router.replace('/');
  }, [loading, user?.id, client?.origin]);
  if (loading)
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator color="#6d45dc" />
        <Text style={s.muted}>正在连接你的学习空间…</Text>
      </SafeAreaView>
    );
  if (user && client)
    return (
      <AuthContext.Provider key={client.origin + user.id} value={{ client, user }}>
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
            <Text style={s.eyebrow}>WELCOME BACK</Text>
            <Text style={s.title}>登录学习空间</Text>
            <Text style={s.muted}>使用与网站相同的账号，接续课程和直播。</Text>
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
function Workspace({ client, user, route }: { client: MobileClient; user: MobileUser; route: Route }) {
  const [logoutBusy, setLogoutBusy] = useState(false);
  const setRoute = (next: Route) => {
    const pathname =
      next.name === 'home'
        ? '/'
        : next.name === 'course'
          ? '/courses/[id]'
          : next.name === 'classroom'
            ? '/live/[id]'
            : '/' + next.name;
    const params =
      next.name === 'course' || next.name === 'classroom'
        ? { id: next.id }
        : next.name === 'live' && next.courseId
          ? { courseId: next.courseId }
          : {};
    router.replace({ pathname, params } as never);
  };
  const canLive = user.accountMode !== 'PERSONAL';
  const selected = (name: string) =>
    route.name === name ||
    (name === 'courses' && route.name === 'course') ||
    (name === 'live' && route.name === 'classroom');
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'course' || route.name === 'classroom') {
        setRoute({ name: route.name === 'course' ? 'courses' : 'live' });
        return true;
      }
      if (route.name !== 'home') {
        setRoute({ name: 'home' });
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [route]);
  const heading =
    route.name === 'home'
      ? '学习工作台'
      : route.name === 'courses' || route.name === 'course'
        ? '我的课程'
        : route.name === 'live' || route.name === 'classroom'
          ? '互动直播'
          : '我的空间';
  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <Pressable
          accessibilityLabel={route.name === 'course' || route.name === 'classroom' ? '返回列表' : '知学首页'}
          onPress={() =>
            setRoute({
              name: route.name === 'course' ? 'courses' : route.name === 'classroom' ? 'live' : 'home',
            })
          }
        >
          <Text style={s.headerLogo}>
            {route.name === 'course' || route.name === 'classroom' ? '‹' : '知'}
          </Text>
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
            <Text style={s.small}>知学 Android · 预览版 0.1.0{allowLocal ? ' · 本地测试环境' : ''}</Text>
          </ScrollView>
        )}
      </View>
      <View style={s.tabs}>
        {(
          [
            { name: 'home', label: '首页', icon: '⌂' },
            { name: 'courses', label: '课程', icon: '▤' },
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
                (tab.name === 'courses' && route.name === 'course') ||
                (tab.name === 'live' && route.name === 'classroom'),
            }}
            key={tab.name}
            style={s.tab}
            onPress={() => setRoute({ name: tab.name as 'home' | 'courses' | 'live' | 'me' })}
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
        <Text style={s.heroEyebrow}>YOUR LEARNING SPACE</Text>
        <Text style={s.heroTitle}>你好，{user.name}</Text>
        <Text style={s.heroText}>从一节课程、一个问题开始，继续今天的学习。</Text>
        <View style={s.heroPill}>
          <Text style={s.heroPillText}>已加入 {q.data?.total ?? '—'} 门课程</Text>
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
              ? '当前还没有机构课程，可以在手机网页使用个人专业学习功能。'
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
  const [busy, setBusy] = useState(false);
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
          <Button title="查看课程直播" secondary onPress={() => navigate({ name: 'live', courseId: id })} />
          {lesson && (
            <View style={s.card}>
              <Text style={s.sectionTitle}>{lesson.title}</Text>
              <Text selectable style={s.lessonText}>
                {plainText(lesson.content) || '本课时暂无文字内容。'}
              </Text>
              {lesson.type !== 'TEXT' && (
                <Text style={s.small}>
                  视频和附件可在手机网页中查看；手机 App 完整课件阅读会在后续版本补充。
                </Text>
              )}
              {user.role === 'STUDENT' && (
                <Button
                  title={busy ? '正在保存…' : lesson.progress?.completed ? '取消完成标记' : '我已完成学习'}
                  disabled={busy}
                  onPress={() => {
                    setBusy(true);
                    void client
                      .request(
                        `/lessons/${encodeURIComponent(lesson.id)}/progress`,
                        {
                          completed: !lesson.progress?.completed,
                          positionSeconds: lesson.progress?.positionSeconds || 0,
                        },
                        'PUT',
                      )
                      .then(q.reload)
                      .catch((e) => Alert.alert('保存失败', e.message))
                      .finally(() => setBusy(false));
                  }}
                />
              )}
              <Button
                title="在手机网页查看完整课程"
                secondary
                onPress={() => void Linking.openURL(client.origin + '/courses/' + encodeURIComponent(id))}
              />
            </View>
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
