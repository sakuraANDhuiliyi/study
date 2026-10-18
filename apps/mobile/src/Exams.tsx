import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { MobileClient } from './client';
import type { LeaveGuard } from './Assignments';
import { useResource } from './resource';
import { a, AButton, AnswerDisplay, AnswerInput, RichText } from './assignment-ui';
import { answered, money, type Question, type AnswerValue } from './assignment-model';
import { formatPlanTime } from './planner-model';
import {
  ExamWriter,
  examApi,
  examEntry,
  secondsLeft,
  type ExamAttempt,
  type ExamDetail,
  type ExamRecord,
} from './exam-model';
const path = (id: string) => '/mobile/exams/' + encodeURIComponent(id);
function Query({ loading, error, reload }: { loading: boolean; error?: string; reload(): void }) {
  return (
    <>
      {loading && <Text style={a.muted}>正在加载考试…</Text>}
      {error && (
        <View style={a.card}>
          <Text accessibilityRole="alert" style={a.error}>
            {error}
          </Text>
          <AButton title="重新加载考试" onPress={reload} />
        </View>
      )}
    </>
  );
}
export function Exams({
  client,
  courseId,
  open,
}: {
  client: MobileClient;
  courseId?: string;
  open(id: string): void;
}) {
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState({ search: '', page: 1 });
  const q = useResource<{
    items: (ExamDetail & { courseTitle: string; latest: ExamRecord | null })[];
    total: number;
  }>(
    client,
    '/mobile/exams?' +
      new URLSearchParams({
        search: filter.search,
        page: String(filter.page),
        pageSize: '10',
        ...(courseId ? { courseId } : {}),
      }),
    60000,
  );
  return (
    <FlatList
      data={q.error ? [] : q.data?.items || []}
      keyExtractor={(x) => x.id}
      contentContainerStyle={a.page}
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} />}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Text style={a.title}>考试与答卷</Text>
          <Text style={a.muted}>按服务器时间作答，已保存答案与网站同步。</Text>
          <TextInput
            accessibilityLabel="搜索考试"
            style={a.input}
            value={search}
            onChangeText={setSearch}
            maxLength={200}
            placeholder="输入考试标题"
          />
          <AButton title="搜索考试" onPress={() => setFilter({ search, page: 1 })} />
          <Query {...q} />
          <Text style={a.muted}>共 {q.data?.total ?? '—'} 项考试</Text>
        </View>
      }
      renderItem={({ item: d }) => (
        <View style={a.card}>
          <Text style={a.subtitle}>{d.title}</Text>
          <Text style={a.muted}>{d.courseTitle}</Text>
          <Text style={a.body}>
            {formatPlanTime(d.startsAt)} — {formatPlanTime(d.endsAt)}
          </Text>
          <Text style={a.muted}>
            {d.durationMinutes} 分钟 · 满分 {money(d.totalCents)} 分 ·{' '}
            {d.status === 'cancelled'
              ? '已取消'
              : d.latest
                ? `第 ${d.latest.number} 次：${d.latest.status === 'in_progress' ? '作答中' : '已结束'}`
                : '尚未作答'}
          </Text>
          <AButton title={'打开考试：' + d.title} onPress={() => open(d.id)} />
        </View>
      )}
      ListEmptyComponent={q.data && !q.error ? <Text style={a.muted}>暂无匹配的考试。</Text> : null}
      ListFooterComponent={
        <View style={a.row}>
          <AButton
            title="上一页考试"
            secondary
            disabled={filter.page === 1}
            onPress={() => setFilter((f) => ({ ...f, page: f.page - 1 }))}
          />
          <Text style={a.muted}>第 {filter.page} 页</Text>
          <AButton
            title="下一页考试"
            secondary
            disabled={!q.data || filter.page * 10 >= q.data.total}
            onPress={() => setFilter((f) => ({ ...f, page: f.page + 1 }))}
          />
        </View>
      }
    />
  );
}
export function Exam({
  client,
  id,
  openAttempt,
}: {
  client: MobileClient;
  id: string;
  openAttempt(id: string): void;
}) {
  const q = useResource<ExamDetail>(client, path(id), 30000),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const d = q.data,
    current = d?.attempts.find((x) => x.status === 'in_progress');
  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await examApi.start(client, id);
      openAttempt(result.id);
    } catch (e) {
      setError((e as Error).message);
      q.reload();
    } finally {
      setBusy(false);
    }
  };
  const reason = d ? examEntry(d, Date.parse(d.serverTime)) : '';
  return (
    <ScrollView contentContainerStyle={a.page}>
      <Query {...q} />
      {!!error && (
        <Text accessibilityRole="alert" style={a.error}>
          {error}
        </Text>
      )}
      {d && !q.error && (
        <>
          <View style={a.card}>
            <Text style={a.title}>{d.title}</Text>
            <RichText html={d.description} />
            <Text style={a.body}>开放：{formatPlanTime(d.startsAt)}</Text>
            <Text style={a.body}>结束：{formatPlanTime(d.endsAt)}</Text>
            <Text style={a.body}>
              允许进入至：{formatPlanTime(d.extension?.deadlineAt || d.entryClosesAt)}
            </Text>
            <Text style={a.body}>
              限时 {d.durationMinutes} 分钟 · 最多 {d.maxAttempts + (d.extension?.extraAttempts || 0)} 次
            </Text>
            <Text style={a.notice}>
              {d.allowBacktrack
                ? '可返回检查已答题目。'
                : '禁止回看：进入下一题后不能返回，请先确认当前答案。'}
            </Text>
            <Text style={a.muted}>
              进入后计时不暂停。切到后台、锁屏或退出仍然计时；以服务器截止与交卷回执为准。
            </Text>
            {current ? (
              <AButton title="继续本次考试" disabled={busy} onPress={() => openAttempt(current.id)} />
            ) : (
              <>
                {!!reason && <Text style={a.error}>{reason}</Text>}
                <AButton
                  title={busy ? '正在进入…' : '开始考试'}
                  disabled={busy || !!reason}
                  onPress={() =>
                    Alert.alert('确认开始考试？', '进入后开始计时，请确保网络稳定。', [
                      { text: '取消', style: 'cancel' },
                      { text: '开始作答', onPress: () => void start() },
                    ])
                  }
                />
              </>
            )}
          </View>
          {d.attempts.map((x) => (
            <View style={a.card} key={x.id}>
              <Text style={a.subtitle}>
                第 {x.number} 次作答 ·{' '}
                {x.status === 'in_progress'
                  ? '进行中'
                  : x.status === 'timed_out'
                    ? '到时交卷'
                    : x.status === 'cancelled'
                      ? '已取消'
                      : '已交卷'}
              </Text>
              <AButton title={'查看第 ' + x.number + ' 次答卷'} secondary onPress={() => openAttempt(x.id)} />
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}
function ExamReview({ question: q, value }: { question: Question; value: AnswerValue | undefined }) {
  return (
    <View style={{ gap: 10 }}>
      <RichText html={q.stem} />
      {q.type === 'composite' ? (
        q.children.map((child) => (
          <View key={child.id} style={a.child}>
            <ExamReview
              question={child}
              value={
                value && typeof value === 'object' && !Array.isArray(value) ? value[child.id] : undefined
              }
            />
          </View>
        ))
      ) : (
        <>
          <Text style={a.muted}>本人答案</Text>
          <AnswerDisplay value={value} />
        </>
      )}
      {Object.hasOwn(q, 'answer') && (
        <>
          <Text style={a.notice}>评分参考</Text>
          <AnswerDisplay value={q.answer} />
        </>
      )}
      {q.explanation && <RichText html={q.explanation} />}
    </View>
  );
}
export function ExamAnswer({
  client,
  id,
  registerLeave,
}: {
  client: MobileClient;
  id: string;
  registerLeave(guard: LeaveGuard): void;
}) {
  const [d, setD] = useState<ExamAttempt | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [, render] = useState(0),
    [remaining, setRemaining] = useState(0),
    [uncertain, setUncertain] = useState(false),
    [syncing, setSyncing] = useState(false);
  const writer = useRef<ExamWriter | null>(null),
    mounted = useRef(true),
    foreground = useRef(true),
    loading = useRef(false),
    operation = useRef(false);
  const received = useRef(0),
    key = useRef(randomUUID()),
    submitUnknown = useRef(false);
  const draw = () => {
    if (mounted.current) render((v) => v + 1);
  };
  const load = async (discard = false) => {
    if (loading.current) return;
    loading.current = true;
    setSyncing(true);
    try {
      await writer.current?.settled();
      const server = await examApi.load(client, id);
      if (!mounted.current) return;
      received.current = performance.now();
      const w = writer.current;
      if (!w || discard || server.status !== 'in_progress') {
        writer.current = new ExamWriter(server, (body) => examApi.save(client, id, body));
        submitUnknown.current = false;
        setUncertain(false);
        setError('');
      } else if (server.revision !== w.revision) {
        w.error = new Error('答卷已在其他设备更新，请核对并重新加载服务器答卷。');
        setError(w.error.message);
      }
      setD(server);
    } catch (e) {
      if (mounted.current) {
        if (writer.current) writer.current.error = e as Error;
        setError((e as Error).message);
      }
    } finally {
      loading.current = false;
      if (mounted.current) setSyncing(false);
      draw();
    }
  };
  const save = async () => {
    if (!writer.current || submitUnknown.current) return false;
    try {
      await writer.current.save();
      if (mounted.current) setError('');
      return true;
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      return false;
    } finally {
      draw();
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    const listener = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      if (state === 'active')
        void (async () => {
          if (operation.current) return;
          await load();
        })();
      else if (!submitUnknown.current) void save();
    });
    return () => {
      mounted.current = false;
      listener.remove();
    };
  }, [client, id]);
  const w = writer.current,
    finished = d?.status !== 'in_progress';
  useEffect(() => {
    if (!d || finished) return;
    const tick = () => {
      const left = secondsLeft(d.deadlineAt, d.serverTime, received.current, performance.now());
      setRemaining(left);
      if (left === 0 && foreground.current && !operation.current) void load();
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [d]);
  useEffect(() => {
    if (
      !d ||
      finished ||
      !w?.dirty ||
      w.error ||
      busy ||
      syncing ||
      !foreground.current ||
      submitUnknown.current ||
      remaining === 0
    )
      return;
    const timer = setTimeout(() => void save(), 900);
    return () => clearTimeout(timer);
  }, [w?.answers, w?.flags, w?.position, busy, syncing, d?.status]);
  useEffect(() => {
    registerLeave(
      !d || finished
        ? null
        : (proceed) => {
            Alert.alert(
              '离开考试？',
              '计时不会暂停。已同步答案可以继续作答；未同步的内容不会在重启后恢复。',
              [
                { text: '继续作答', style: 'cancel' },
                {
                  text: '保存后离开',
                  onPress: () =>
                    void (async () => {
                      if (!submitUnknown.current && (await save())) proceed();
                      else Alert.alert('暂不能离开', '请先核对服务器答卷与保存状态。');
                    })(),
                },
                { text: '放弃未同步内容并离开', style: 'destructive', onPress: proceed },
              ],
            );
          },
    );
    return () => registerLeave(null);
  }, [d?.status, busy]);
  const submit = async () => {
    if (operation.current || loading.current) return;
    operation.current = true;
    setBusy(true);
    try {
      if (!submitUnknown.current && !(await save())) return;
      submitUnknown.current = true;
      setUncertain(true);
      const result = await examApi.submit(client, id, key.current);
      if (mounted.current) {
        setD(result);
        received.current = performance.now();
        setError('');
        setUncertain(false);
        submitUnknown.current = false;
      }
    } catch (e) {
      if (mounted.current) setError('交卷结果尚未确认，请核对回执或重试交卷。' + (e as Error).message);
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const mutate = (action: () => void) => {
    try {
      action();
      draw();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const move = async (next: number) => {
    if (!w || operation.current || loading.current) return;
    operation.current = true;
    setBusy(true);
    try {
      await w.move(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      operation.current = false;
      setBusy(false);
      draw();
    }
  };
  const reload = () =>
    Alert.alert('重新加载服务器答卷？', '未同步的本地修改将被舍弃，请先核对内容。', [
      { text: '保留当前内容', style: 'cancel' },
      { text: '以服务器为准', style: 'destructive', onPress: () => void load(true) },
    ]);
  if (!d || !w)
    return (
      <ScrollView contentContainerStyle={a.page}>
        <Query loading={!error} error={error} reload={() => void load()} />
      </ScrollView>
    );
  const q = d.items[w.position],
    disabled = busy || syncing || !!w.error || uncertain || remaining === 0;
  return (
    <KeyboardAvoidingView style={a.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={a.page}>
        <View style={a.card}>
          <Text style={a.title}>{d.exam.title}</Text>
          <Text style={a.muted}>第 {d.number} 次作答</Text>
          {finished ? (
            <>
              <Text style={a.subtitle}>
                {d.status === 'cancelled'
                  ? '答卷已取消'
                  : d.status === 'timed_out'
                    ? '服务器已到时交卷'
                    : '服务器已接收答卷'}
              </Text>
              {d.submittedAt && <Text style={a.body}>交卷时间：{formatPlanTime(d.submittedAt)}</Text>}
              <Text selectable style={a.muted}>
                答卷回执：{d.id}
              </Text>
              <Text style={a.subtitle}>考试得分：{money(d.scoreCents)}</Text>
              <Text style={a.muted}>
                {d.releaseStatus === 'hidden'
                  ? '成绩、答案与解析按教师发布规则展示。'
                  : d.gradingStatus !== 'graded'
                    ? '教师正在批改。'
                    : '满分 ' + money(d.exam.totalCents) + ' 分'}
              </Text>
              {d.feedback && <RichText html={d.feedback} />}
            </>
          ) : (
            <>
              <Text accessibilityLabel="考试剩余时间" style={a.subtitle}>
                剩余 {Math.floor(remaining / 60)} 分 {remaining % 60} 秒
              </Text>
              <Text style={a.notice}>
                {w.error ? '保存已暂停，请核对服务器答卷' : w.dirty ? '有未同步修改' : '答案已同步到服务器'}
              </Text>
              {w.lastSavedAt && <Text style={a.muted}>最近保存：{formatPlanTime(w.lastSavedAt)}</Text>}
              <Text style={a.muted}>切到后台仍计时。重启只能恢复已同步答案，请确认保存状态。</Text>
              {!d.exam.allowBacktrack && (
                <Text style={a.notice}>禁止返回或跳题，下一题前先同步当前答案。</Text>
              )}
            </>
          )}
        </View>
        {!!error && (
          <Text selectable accessibilityRole="alert" style={a.error}>
            {error}
          </Text>
        )}
        {finished ? (
          d.items.map((item, i) => {
            const answer = d.answers.find((x) => x.questionVersionId === item.id);
            return (
              <View key={item.id} style={a.card}>
                <Text style={a.subtitle}>
                  第 {i + 1} 题 · {money(answer?.scoreCents)} 分
                </Text>
                <ExamReview question={item} value={answer?.value} />
                {answer?.comment && <RichText html={answer.comment} />}
              </View>
            );
          })
        ) : (
          <>
            {q && (
              <View style={a.card}>
                <Text style={a.subtitle}>
                  第 {w.position + 1} / {d.items.length} 题 · {money(q.scoreCents)} 分
                  {w.flags.includes(q.id) ? ' · 已标记' : ''}
                </Text>
                <RichText html={q.stem} />
                <AnswerInput
                  question={q}
                  label={'考试第' + (w.position + 1) + '题'}
                  value={w.answers[q.id]}
                  disabled={disabled}
                  change={(v) => mutate(() => w.change(q.id, v))}
                />
                <AButton
                  title={w.flags.includes(q.id) ? '取消标记本题' : '标记本题'}
                  disabled={disabled}
                  secondary
                  onPress={() => mutate(() => w.flag(q.id))}
                />
              </View>
            )}
            <View style={a.row}>
              <AButton
                title="上一题"
                secondary
                disabled={disabled || !d.exam.allowBacktrack || w.position === 0}
                onPress={() => void move(w.position - 1)}
              />
              <AButton
                title="下一题"
                disabled={disabled || w.position >= d.items.length - 1}
                onPress={() => {
                  if (!d.exam.allowBacktrack)
                    Alert.alert('确认进入下一题？', '进入后不能返回当前题目。', [
                      { text: '继续检查', style: 'cancel' },
                      { text: '进入下一题', onPress: () => void move(w.position + 1) },
                    ]);
                  else void move(w.position + 1);
                }}
              />
            </View>
            {d.exam.allowBacktrack && (
              <View style={a.row}>
                {d.items.map((item, i) => (
                  <AButton
                    key={item.id}
                    title={
                      '转到第' +
                      (i + 1) +
                      '题' +
                      (answered(w.answers[item.id]) ? '（已答）' : '') +
                      (w.flags.includes(item.id) ? '★' : '')
                    }
                    secondary
                    disabled={disabled}
                    onPress={() => void move(i)}
                  />
                ))}
              </View>
            )}
            <AButton title="保存考试答案" disabled={disabled} onPress={() => void save()} />
            <AButton
              title={uncertain ? '重试交卷并核对回执' : '交卷'}
              disabled={busy || (!uncertain && (!!w.error || remaining === 0))}
              onPress={() =>
                Alert.alert(
                  '确认交卷？',
                  `还有 ${d.items.filter((x) => !answered(w.answers[x.id])).length} 道题未作答。交卷后不可修改，系统先同步答案再提交。`,
                  [
                    { text: '继续作答', style: 'cancel' },
                    { text: '确认交卷', onPress: () => void submit() },
                  ],
                )
              }
            />
          </>
        )}
        <AButton title="核对服务器回执" secondary disabled={busy || syncing} onPress={() => void load()} />
        {!finished && (
          <AButton title="重新加载服务器答卷" secondary disabled={busy || syncing} onPress={reload} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
