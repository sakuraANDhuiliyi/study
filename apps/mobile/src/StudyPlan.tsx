import { nativeExamPage } from './exam-model';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MobileApiError, type MobileClient, type MobileUser } from './client';
import { useResource } from './resource';
import {
  assessmentPage,
  formatPlanTime,
  kindLabels,
  monthRange,
  moveMonth,
  parseTaskDate,
  planStatus,
  shanghaiInput,
  type ActionPage,
  type CalendarPage,
  type LearningAction,
  type PlanEvent,
  type Task,
} from './planner-model';

function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, disabled && s.disabled]}
    >
      <Text style={[s.buttonText, secondary && s.secondaryText]}>{title}</Text>
    </Pressable>
  );
}
function Choices<T extends string>({
  label,
  value,
  choices,
  change,
  disabled,
}: {
  label: string;
  value: T;
  choices: { value: T; title: string }[];
  change: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.choices}>
        {choices.map((c) => (
          <Pressable
            key={c.value}
            accessibilityRole="tab"
            accessibilityLabel={c.title}
            accessibilityState={{ selected: value === c.value, disabled }}
            disabled={disabled}
            onPress={() => change(c.value)}
            style={[s.choice, value === c.value && s.choiceOn]}
          >
            <Text style={[s.choiceText, value === c.value && s.choiceTextOn]}>{c.title}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
function Query({ query }: { query: { loading: boolean; error?: string; reload(): void } }) {
  return (
    <>
      {query.loading && <ActivityIndicator color="#6d45dc" />}
      {!!query.error && (
        <View style={s.card}>
          <Text accessibilityRole="alert" style={s.error}>
            {query.error}
          </Text>
          <Button title="重新加载计划" secondary onPress={query.reload} />
        </View>
      )}
    </>
  );
}
function Pages({ page, total, change }: { page: number; total: number; change(p: number): void }) {
  if (total <= 10 && page === 1) return null;
  return (
    <View style={s.row}>
      <Button title="上一页任务" disabled={page === 1} secondary onPress={() => change(page - 1)} />
      <Text style={s.muted}>
        {page} / {Math.max(1, Math.ceil(total / 10))}
      </Text>
      <Button title="下一页任务" disabled={page * 10 >= total} secondary onPress={() => change(page + 1)} />
    </View>
  );
}
function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
const sourceChoices = [
  { value: 'all', title: '全部来源' },
  { value: 'personal', title: '个人计划' },
  { value: 'assignment', title: '课程作业' },
  { value: 'exam', title: '课程考试' },
] as const;

export function StudyPlan({ client, user }: { client: MobileClient; user: MobileUser }) {
  const [view, setView] = useState<'actions' | 'calendar'>(user.role === 'STUDENT' ? 'actions' : 'calendar');
  const [editing, setEditing] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const mounted = useMounted();
  const refresh = () => setVersion((v) => v + 1);
  return (
    <View style={s.flex}>
      <View style={s.top}>
        <Text style={s.title}>学习任务中心</Text>
        <Text style={s.muted}>与网站同步 · 所有时间均为北京时间</Text>
        <Button title="新增个人计划" onPress={() => setEditing('new')} />
        {user.role === 'STUDENT' && (
          <Choices
            label="查看方式"
            value={view}
            change={setView}
            choices={[
              { value: 'actions', title: '待完成行动' },
              { value: 'calendar', title: '月度日程' },
            ]}
          />
        )}
      </View>
      {view === 'actions' ? (
        <Actions client={client} user={user} version={version} refresh={refresh} edit={setEditing} />
      ) : (
        <Calendar
          client={client}
          version={version}
          refresh={refresh}
          edit={setEditing}
          nativeAssignments={user.role === 'STUDENT'}
        />
      )}
      {editing && (
        <TaskEditor
          key={editing}
          client={client}
          id={editing}
          close={() => setEditing(null)}
          changed={() => {
            if (mounted.current) {
              setEditing(null);
              refresh();
            }
          }}
        />
      )}
    </View>
  );
}
function Actions({
  client,
  user,
  version,
  refresh,
  edit,
}: {
  client: MobileClient;
  user: MobileUser;
  version: number;
  refresh(): void;
  edit(id: string): void;
}) {
  const [filter, setFilter] = useState<{
    bucket: 'today' | 'upcoming' | 'overdue';
    type: (typeof sourceChoices)[number]['value'];
    page: number;
    courseId: string;
  }>({ bucket: 'today', type: 'all', page: 1, courseId: '' });
  const [coursePicker, setCoursePicker] = useState(false);
  const [courseTitle, setCourseTitle] = useState('全部课程');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false),
    mounted = useMounted();
  const [notice, setNotice] = useState('');
  const path =
    '/planner/actions?' +
    new URLSearchParams({
      bucket: filter.bucket,
      type: filter.type,
      page: String(filter.page),
      pageSize: '10',
      ...(filter.courseId ? { courseId: filter.courseId } : {}),
    });
  const q = useResource<ActionPage>(client, path, 60000);
  useEffect(() => {
    q.reload();
  }, [version]);
  const change = (next: Partial<typeof filter>) => {
    setNotice('');
    setFilter((f) => ({ ...f, ...next, page: next.page ?? 1 }));
  };
  async function complete(item: LearningAction) {
    if (pending.current || item.revision === undefined) return;
    pending.current = true;
    setBusy(true);
    setNotice('');
    try {
      await client.request(
        '/planner/tasks/' + encodeURIComponent(item.id),
        { revision: item.revision, completed: true },
        'PATCH',
      );
      if (mounted.current) {
        setNotice('已完成，网站计划同步更新。');
        refresh();
        q.reload();
      }
    } catch (e) {
      if (mounted.current) {
        setNotice((e as Error).message);
        if (e instanceof MobileApiError && e.status === 409) q.reload();
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <ScrollView
      contentContainerStyle={s.page}
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} />}
    >
      <Choices
        label="截止时间"
        value={filter.bucket}
        disabled={busy}
        change={(bucket) => change({ bucket })}
        choices={[
          { value: 'today', title: `今日 ${q.data?.counts.today ?? '—'}` },
          { value: 'upcoming', title: `未来七天 ${q.data?.counts.upcoming ?? '—'}` },
          { value: 'overdue', title: `已逾期 ${q.data?.counts.overdue ?? '—'}` },
        ]}
      />
      <Choices
        label="任务来源"
        value={filter.type}
        choices={[...sourceChoices]}
        disabled={busy}
        change={(type) => {
          if (type === 'personal') setCourseTitle('全部课程');
          change({ type, courseId: type === 'personal' ? '' : filter.courseId });
        }}
      />
      {user.permissions.includes('course.read') && (
        <Button
          title={'筛选课程：' + courseTitle}
          secondary
          disabled={busy || filter.type === 'personal'}
          onPress={() => setCoursePicker(true)}
        />
      )}
      <Query query={q} />
      {!!notice && (
        <Text accessibilityRole="alert" style={s.notice}>
          {notice}
        </Text>
      )}
      {q.data && !q.error && <Text style={s.muted}>当前筛选共 {q.data.total} 项 · 以服务器截止时间为准</Text>}
      {!q.error &&
        q.data?.items.map((item) => (
          <View style={s.card} key={item.type + item.id}>
            <Text style={s.badge}>
              {kindLabels[item.type]} · {planStatus[item.status] || item.status}
            </Text>
            <Text style={s.cardTitle}>{item.title}</Text>
            {!!item.courseTitle && <Text style={s.muted}>{item.courseTitle}</Text>}
            <Text style={s.body}>截止：{formatPlanTime(item.dueAt)}</Text>
            {item.originalDueAt && item.originalDueAt !== item.dueAt && (
              <Text style={s.muted}>原截止：{formatPlanTime(item.originalDueAt)}；迟交仍按原时间判定。</Text>
            )}
            {!!item.startsAt && <Text style={s.muted}>开始：{formatPlanTime(item.startsAt)}</Text>}
            {item.type === 'personal' ? (
              <>
                <Button
                  title={'完成计划：' + item.title}
                  disabled={busy}
                  onPress={() => void complete(item)}
                />
                <Button
                  title={'编辑计划：' + item.title}
                  secondary
                  disabled={busy}
                  onPress={() => edit(item.id)}
                />
              </>
            ) : (
              <AssessmentLink client={client} path={item.path} title={item.actionLabel} />
            )}
          </View>
        ))}
      {q.data && !q.error && !q.data.items.length && (
        <Text style={s.empty}>这个时间范围没有待完成任务。</Text>
      )}
      {!q.error && (
        <Pages page={filter.page} total={q.data?.total || 0} change={(page) => change({ page })} />
      )}
      <Text style={s.muted}>行动清单只列出仍需处理的任务。已完成计划可在“月度日程”查看或恢复。</Text>
      {coursePicker && (
        <CoursePicker
          client={client}
          close={() => setCoursePicker(false)}
          choose={(id, title) => {
            setCoursePicker(false);
            setCourseTitle(title);
            change({ courseId: id });
          }}
        />
      )}
    </ScrollView>
  );
}
function AssessmentLink({
  client,
  path,
  title = '查看详情',
  nativeAssignments = true,
}: {
  client: MobileClient;
  path?: string;
  title?: string;
  nativeAssignments?: boolean;
}) {
  const target = assessmentPage(path);
  const examTarget = nativeExamPage(target);
  if (nativeAssignments && examTarget)
    return (
      <Button
        title={title === '查看详情' ? '打开考试' : title}
        onPress={() => router.replace(examTarget as never)}
      />
    );
  if (nativeAssignments && target?.startsWith('/assignments/'))
    return (
      <Button
        title={title === '查看详情' ? '打开作业' : title}
        onPress={() =>
          router.replace({ pathname: '/assignments/[id]', params: { id: target.split('/')[2] } } as never)
        }
      />
    );
  return (
    <View>
      <Text style={s.muted}>此操作仍在手机网页进行，网页需单独登录。</Text>
      {target && (
        <Button
          secondary
          title={title + '（网页）'}
          onPress={() => {
            void Linking.openURL(client.origin + target).catch(() =>
              Alert.alert('无法打开网页', '请在浏览器中打开平台网站。'),
            );
          }}
        />
      )}
    </View>
  );
}
function Calendar({
  client,
  version,
  refresh,
  edit,
  nativeAssignments,
}: {
  client: MobileClient;
  version: number;
  refresh(): void;
  edit(id: string): void;
  nativeAssignments: boolean;
}) {
  const [month, setMonth] = useState(shanghaiInput().slice(0, 7));
  const [type, setType] = useState<(typeof sourceChoices)[number]['value']>('all');
  const [detail, setDetail] = useState<PlanEvent | null>(null);
  const range = monthRange(month);
  const q = useResource<CalendarPage>(client, '/planner?' + new URLSearchParams({ ...range, type }), 60000);
  useEffect(() => {
    q.reload();
  }, [version]);
  const shift = (delta: number) => {
    try {
      setMonth(moveMonth(month, delta));
    } catch {
      Alert.alert('已到日期范围边界');
    }
  };
  return (
    <ScrollView
      contentContainerStyle={s.page}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => {
            q.reload();
            refresh();
          }}
        />
      }
    >
      <View style={s.row}>
        <Button title="上个月" secondary onPress={() => shift(-1)} />
        <Text style={s.cardTitle}>{month}</Text>
        <Button title="下个月" secondary onPress={() => shift(1)} />
      </View>
      <Button
        title="回到本月"
        secondary
        onPress={() => {
          setMonth(shanghaiInput().slice(0, 7));
          q.reload();
        }}
      />
      <Choices label="日程来源" value={type} choices={[...sourceChoices]} change={setType} />
      <Query query={q} />
      {q.data?.truncated && (
        <Text accessibilityRole="alert" style={s.notice}>
          日程数量较多，当前结果不完整。请按来源筛选，网页版支持进一步查看。
        </Text>
      )}
      {!q.error &&
        q.data?.items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={'查看日程：' + item.title}
            onPress={() => (item.type === 'personal' ? edit(item.id) : setDetail(item))}
            style={s.card}
          >
            <Text style={s.badge}>
              {kindLabels[item.type]} · {planStatus[item.status] || item.status}
            </Text>
            <Text style={s.cardTitle}>{item.title}</Text>
            <Text style={s.body}>
              {formatPlanTime(item.startAt)}
              {item.endAt ? ' 至 ' + formatPlanTime(item.endAt) : ''}
            </Text>
            {!!item.courseTitle && <Text style={s.muted}>{item.courseTitle}</Text>}
            <Text style={s.link}>
              {item.type === 'personal' ? '编辑、完成或恢复计划 →' : '查看日程详情 →'}
            </Text>
          </Pressable>
        ))}
      {q.data && !q.error && !q.data.items.length && (
        <Text style={s.empty}>本月暂无日程，可以新增个人计划。</Text>
      )}
      {detail && (
        <Modal visible animationType="slide" onRequestClose={() => setDetail(null)}>
          <SafeAreaView style={s.modal}>
            <ScrollView contentContainerStyle={s.page}>
              <Text style={s.title}>{detail.title}</Text>
              <Text style={s.badge}>{planStatus[detail.status] || detail.status}</Text>
              <Text style={s.body}>
                {formatPlanTime(detail.startAt)}
                {detail.endAt ? ' 至 ' + formatPlanTime(detail.endAt) : ''}
              </Text>
              {!!detail.entryClosesAt && (
                <Text style={s.body}>入场截止：{formatPlanTime(detail.entryClosesAt)}</Text>
              )}
              {!!detail.originalDueAt && detail.originalDueAt !== detail.startAt && (
                <Text style={s.body}>原截止：{formatPlanTime(detail.originalDueAt)}</Text>
              )}
              <Text style={s.body}>{detail.description}</Text>
              <AssessmentLink client={client} path={detail.path} nativeAssignments={nativeAssignments} />
              <Button title="关闭日程详情" secondary onPress={() => setDetail(null)} />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </ScrollView>
  );
}
function CoursePicker({
  client,
  close,
  choose,
}: {
  client: MobileClient;
  close(): void;
  choose(id: string, title: string): void;
}) {
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  const q = useResource<{ items: { id: string; title: string }[]; total: number }>(
    client,
    '/planner/actions/courses?' + new URLSearchParams({ search: query, page: String(page), pageSize: '10' }),
  );
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={s.modal}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}>
          <Text style={s.title}>选择课程</Text>
          <TextInput
            accessibilityLabel="搜索任务课程"
            style={s.input}
            value={search}
            onChangeText={setSearch}
            maxLength={100}
            placeholder="输入课程名称"
          />
          <Button
            title="搜索课程"
            onPress={() => {
              setQuery(search);
              setPage(1);
              q.reload();
            }}
          />
          <Button title="全部课程" secondary onPress={() => choose('', '全部课程')} />
          <Query query={q} />
          {!q.error &&
            q.data?.items.map((c) => (
              <Button
                key={c.id}
                title={'选择课程：' + c.title}
                secondary
                onPress={() => choose(c.id, c.title)}
              />
            ))}
          {q.data && !q.error && !q.data.items.length && <Text style={s.empty}>没有匹配的课程。</Text>}
          {!q.error && <Pages page={page} total={q.data?.total || 0} change={setPage} />}
          <Button title="取消课程筛选" secondary onPress={close} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
function TaskEditor({
  client,
  id,
  close,
  changed,
}: {
  client: MobileClient;
  id: string;
  close(): void;
  changed(): void;
}) {
  const mounted = useMounted(),
    pending = useRef(false);
  const [task, setTask] = useState<Task | null>(null),
    [loading, setLoading] = useState(id !== 'new');
  const [title, setTitle] = useState(''),
    [description, setDescription] = useState('');
  const local = shanghaiInput();
  const [day, setDay] = useState(local.slice(0, 10)),
    [time, setTime] = useState('18:00');
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  async function load() {
    setLoading(true);
    setError('');
    try {
      const next = await client.request<Task>('/planner/tasks/' + encodeURIComponent(id));
      if (!mounted.current) return;
      setTask(next);
      setTitle(next.title);
      setDescription(next.description);
      const date = shanghaiInput(next.dueAt);
      setDay(date.slice(0, 10));
      setTime(date.slice(11));
      setDirty(false);
      setConflict(false);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (id !== 'new') void load();
  }, [id]);
  function discard() {
    if (pending.current) return;
    if (dirty)
      Alert.alert('放弃修改？', '尚未保存的内容会丢失。', [
        { text: '继续编辑', style: 'cancel' },
        { text: '放弃修改', style: 'destructive', onPress: close },
      ]);
    else close();
  }
  async function mutate(mode: 'save' | 'toggle' | 'delete') {
    if (pending.current || loading || conflict || (id !== 'new' && !task)) return;
    let body: unknown;
    try {
      if (mode === 'save') {
        if (!title.trim() || title.trim().length > 160) throw new Error('计划标题需为 1 至 160 个字符。');
        body = {
          title: title.trim(),
          description,
          dueAt: parseTaskDate(day, time),
          ...(task ? { revision: task.revision } : {}),
        };
      } else
        body =
          mode === 'delete'
            ? { revision: task!.revision }
            : { revision: task!.revision, completed: !task!.completedAt };
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await client.request(
        id === 'new' ? '/planner/tasks' : '/planner/tasks/' + encodeURIComponent(id),
        body,
        mode === 'delete' ? 'DELETE' : id === 'new' ? 'POST' : 'PATCH',
      );
      if (mounted.current) changed();
    } catch (e) {
      if (mounted.current) {
        setError(
          e instanceof MobileApiError && e.status === 0
            ? '操作结果尚未确认，请关闭后刷新列表核对，再决定是否重试。'
            : (e as Error).message,
        );
        if (e instanceof MobileApiError && e.status === 409) setConflict(true);
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Modal visible animationType="slide" onRequestClose={discard}>
      <SafeAreaView style={s.modal}>
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}>
            <Text style={s.title}>{id === 'new' ? '新增个人计划' : '编辑个人计划'}</Text>
            <Text style={s.muted}>仅本人可见 · 截止时间为北京时间</Text>
            {loading && <ActivityIndicator color="#6d45dc" />}
            {!!error && (
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            )}
            {conflict && (
              <Button
                title="重新加载最新版本"
                secondary
                onPress={() =>
                  Alert.alert('重新加载？', '将用网站上的最新内容替换当前未保存的编辑。', [
                    { text: '保留编辑', style: 'cancel' },
                    { text: '加载最新内容', onPress: () => void load() },
                  ])
                }
              />
            )}
            {!loading && id !== 'new' && !task && (
              <Button title="重试读取计划" secondary onPress={() => void load()} />
            )}
            {(id === 'new' || task) && (
              <>
                {task?.completedAt && (
                  <Text style={s.badge}>已完成 · {formatPlanTime(task.completedAt)}</Text>
                )}
                <Text style={s.label}>计划标题</Text>
                <TextInput
                  accessibilityLabel="计划标题"
                  style={s.input}
                  value={title}
                  maxLength={160}
                  editable={!busy && !loading}
                  onChangeText={(v) => {
                    setTitle(v);
                    setDirty(true);
                  }}
                  placeholder="例如：复习本周课程"
                />
                <Text style={s.label}>计划说明</Text>
                <TextInput
                  accessibilityLabel="计划说明"
                  style={[s.input, s.description]}
                  value={description}
                  maxLength={10000}
                  editable={!busy && !loading}
                  multiline
                  onChangeText={(v) => {
                    setDescription(v);
                    setDirty(true);
                  }}
                />
                <Text style={s.label}>截止日期（YYYY-MM-DD）</Text>
                <TextInput
                  accessibilityLabel="截止日期"
                  style={s.input}
                  value={day}
                  maxLength={10}
                  autoCapitalize="none"
                  editable={!busy && !loading}
                  onChangeText={(v) => {
                    setDay(v);
                    setDirty(true);
                  }}
                />
                <Text style={s.label}>截止时间（HH:mm，北京时间）</Text>
                <TextInput
                  accessibilityLabel="截止时间"
                  style={s.input}
                  value={time}
                  maxLength={5}
                  editable={!busy && !loading}
                  onChangeText={(v) => {
                    setTime(v);
                    setDirty(true);
                  }}
                />
                <Button
                  title={busy ? '正在处理计划…' : '保存个人计划'}
                  disabled={busy || loading || conflict || !title.trim()}
                  onPress={() => void mutate('save')}
                />
                {task && (
                  <>
                    <Button
                      title={task.completedAt ? '恢复为未完成' : '标记计划完成'}
                      secondary
                      disabled={busy || loading || conflict}
                      onPress={() => {
                        if (dirty)
                          Alert.alert('请先保存或放弃编辑', '完成状态操作不会保存当前编辑的标题和说明。');
                        else void mutate('toggle');
                      }}
                    />
                    <Button
                      title="删除个人计划"
                      secondary
                      disabled={busy || loading || conflict}
                      onPress={() =>
                        Alert.alert('删除计划？', '此操作会同时删除网站上的这条个人计划。', [
                          { text: '取消', style: 'cancel' },
                          { text: '确认删除', style: 'destructive', onPress: () => void mutate('delete') },
                        ])
                      }
                    />
                  </>
                )}
              </>
            )}
            <Button title="关闭计划编辑" secondary disabled={busy} onPress={discard} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
const s = StyleSheet.create({
  flex: { flex: 1 },
  modal: { flex: 1, backgroundColor: '#f5f6fb' },
  top: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 8, gap: 8 },
  page: { padding: 18, paddingBottom: 28, gap: 14 },
  title: { fontSize: 23, fontWeight: '800', color: '#302b43' },
  card: {
    backgroundColor: '#fff',
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e9e8f2',
    gap: 10,
  },
  cardTitle: { fontSize: 18, lineHeight: 27, fontWeight: '700', color: '#302b43' },
  body: { fontSize: 15, lineHeight: 24, color: '#514d64' },
  muted: { fontSize: 13, lineHeight: 21, color: '#77748a' },
  label: { fontSize: 14, fontWeight: '600', color: '#504b65', marginBottom: 6 },
  badge: { fontSize: 12, color: '#7155aa', lineHeight: 20 },
  link: { fontSize: 13, color: '#7451c8', minHeight: 30 },
  choices: { gap: 8 },
  choice: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderRadius: 12,
    backgroundColor: '#ebe8f4',
  },
  choiceOn: { backgroundColor: '#6d45dc' },
  choiceText: { fontSize: 13, color: '#665d7b' },
  choiceTextOn: { color: '#fff', fontWeight: '700' },
  button: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#6d45dc',
  },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  secondary: { backgroundColor: '#eeebf8' },
  secondaryText: { color: '#6544bd' },
  disabled: { opacity: 0.4 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dcd7ea',
    borderRadius: 12,
    minHeight: 50,
    padding: 12,
    fontSize: 15,
    color: '#302b43',
  },
  description: { minHeight: 110, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  error: { color: '#a73636', backgroundColor: '#fff1ef', padding: 12, borderRadius: 10, lineHeight: 23 },
  notice: { color: '#5b4189', backgroundColor: '#ece6fa', padding: 12, borderRadius: 10, lineHeight: 23 },
  empty: { padding: 26, textAlign: 'center', color: '#77748a', lineHeight: 24 },
});
