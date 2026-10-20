import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
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
import { MobileApiError, type MobileClient } from './client';
import type { LeaveGuard } from './Assignments';
import { useResource } from './resource';
import { a, AButton, AnswerInput, AnswerDisplay, RichText } from './assignment-ui';
import { answered, money, type AnswerValue, type Question } from './assignment-model';
import { formatPlanTime } from './planner-model';
import {
  practiceApi,
  practiceInput,
  practiceRate,
  definitivePracticeFailure,
  type PracticeInput,
  type PracticeDetail,
  type PracticeList,
} from './practice-model';
const types = [
  ['', '全部题型'],
  ['single', '单选题'],
  ['multiple', '多选题'],
  ['boolean', '判断题'],
  ['blank', '填空题'],
  ['short', '简答题'],
  ['composite', '综合题'],
];
export function Practices({
  client,
  courseId,
  open,
  registerLeave,
}: {
  client: MobileClient;
  courseId?: string;
  open(id: string): void;
  registerLeave(g: LeaveGuard): void;
}) {
  const [selected, setSelected] = useState(courseId || ''),
    [search, setSearch] = useState(''),
    [coursePage, setCoursePage] = useState(1);
  const courses = useResource<{ items: { id: string; title: string }[]; total: number }>(
    client,
    '/courses?' +
      new URLSearchParams({ page: String(coursePage), pageSize: '8', ...(search ? { search } : {}) }),
  );
  const [count, setCount] = useState(''),
    [type, setType] = useState(''),
    [difficulty, setDifficulty] = useState(0),
    [knowledge, setKnowledge] = useState(''),
    [mode, setMode] = useState<PracticeInput['mode']>('random');
  const [filter, setFilter] = useState({ page: 1, status: '' });
  const recent = useResource<PracticeList>(
    client,
    '/mobile/practice?' +
      new URLSearchParams({
        page: String(filter.page),
        pageSize: '10',
        ...(courseId ? { courseId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      }),
    30000,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ input: PracticeInput; key: string } | null>(null),
    flight = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    registerLeave(
      busy || uncertain
        ? (proceed) => {
            if (flight.current) {
              Alert.alert('正在创建练习', '请等待请求结束后再离开。');
              return;
            }
            Alert.alert('离开创建页面？', '结果尚未确认，返回后请先核对最近练习，避免重复创建。', [
              { text: '继续核对', style: 'cancel' },
              { text: '离开并稍后核对', onPress: proceed },
            ]);
          }
        : null,
    );
    return () => registerLeave(null);
  }, [busy, uncertain]);
  const create = async () => {
    if (flight.current) return;
    try {
      if (!pending.current)
        pending.current = {
          input: practiceInput(selected, count, type, difficulty, knowledge, mode),
          key: randomUUID(),
        };
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    flight.current = true;
    setBusy(true);
    setError('');
    let next = '';
    try {
      const d = await practiceApi.create(client, pending.current.input, pending.current.key);
      if (mounted.current) {
        pending.current = null;
        setUncertain(false);
        next = d.id;
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        if (definitivePracticeFailure(e)) {
          pending.current = null;
          setUncertain(false);
        } else setUncertain(true);
      }
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
    if (next) {
      registerLeave(null);
      open(next);
    }
  };
  const disabled = busy || uncertain;
  return (
    <FlatList
      contentContainerStyle={a.page}
      data={recent.error ? [] : recent.data?.items || []}
      keyExtractor={(x) => x.id}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={recent.reload} />}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Text style={a.title}>自主练习中心</Text>
          <Text style={a.muted}>
            单题首次提交后显示参考答案与解析，提交后不能修改。简答、综合题用于自主复盘，不计客观正确率。
          </Text>
          <View style={a.card}>
            <Text style={a.subtitle}>定制一次练习</Text>
            <Text style={a.muted}>
              当前课程：
              {courses.data?.items.find((x) => x.id === selected)?.title ||
                (selected ? '已选择课程' : '未选择')}
            </Text>
            {!courseId && (
              <>
                <TextInput
                  accessibilityLabel="搜索练习课程"
                  style={a.input}
                  value={search}
                  editable={!disabled}
                  maxLength={100}
                  onChangeText={(v) => {
                    setSearch(v);
                    setCoursePage(1);
                  }}
                  placeholder="搜索已加入课程"
                />
                {courses.data?.items.map((c) => (
                  <AButton
                    key={c.id}
                    title={'选择练习课程：' + c.title}
                    secondary={selected !== c.id}
                    disabled={disabled}
                    onPress={() => setSelected(c.id)}
                  />
                ))}
                <View style={a.row}>
                  <AButton
                    title="上一页练习课程"
                    disabled={disabled || coursePage === 1}
                    secondary
                    onPress={() => setCoursePage((p) => p - 1)}
                  />
                  <AButton
                    title="下一页练习课程"
                    disabled={disabled || !courses.data || coursePage * 8 >= courses.data.total}
                    secondary
                    onPress={() => setCoursePage((p) => p + 1)}
                  />
                </View>
              </>
            )}
            {courses.error && <Text style={a.error}>{courses.error}</Text>}
            <TextInput
              accessibilityLabel="练习题目数量"
              style={a.input}
              value={count}
              onChangeText={setCount}
              editable={!disabled}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="1–30题，留空按实际题库选择（最多10题）"
            />
            <View style={a.row}>
              {types.map(([v, label]) => (
                <AButton
                  key={v}
                  title={'练习' + label}
                  secondary={type !== v}
                  disabled={disabled}
                  onPress={() => setType(v)}
                />
              ))}
            </View>
            <View style={a.row}>
              {[0, 1, 2, 3, 4, 5].map((v) => (
                <AButton
                  key={v}
                  title={v ? '难度 ' + v : '全部难度'}
                  secondary={difficulty !== v}
                  disabled={disabled}
                  onPress={() => setDifficulty(v)}
                />
              ))}
            </View>
            <TextInput
              accessibilityLabel="练习知识点"
              style={a.input}
              value={knowledge}
              onChangeText={setKnowledge}
              editable={!disabled}
              maxLength={100}
              placeholder="知识点（可选，完整名称）"
            />
            <View style={a.row}>
              {(
                [
                  ['random', '随机练习'],
                  ['mistakes', '错题复习'],
                  ['favorites', '收藏题练习'],
                ] as const
              ).map(([v, label]) => (
                <AButton
                  key={v}
                  title={label}
                  secondary={mode !== v}
                  disabled={disabled}
                  onPress={() => setMode(v)}
                />
              ))}
            </View>
            {!!error && (
              <Text style={a.error} accessibilityRole="alert">
                {error}
              </Text>
            )}
            {uncertain && (
              <Text style={a.notice}>
                创建结果尚未确认。重试会使用同一标识与条件，也可离开后核对最近练习。
              </Text>
            )}
            <AButton
              title={uncertain ? '重试同一次创建' : '开始本次练习'}
              disabled={busy || !!courses.error}
              onPress={() => void create()}
            />
          </View>
          <Text style={a.subtitle}>最近练习</Text>
          <View style={a.row}>
            {[
              ['', '全部练习'],
              ['active', '未完成练习'],
              ['completed', '已完成练习'],
            ].map(([status, label]) => (
              <AButton
                key={status}
                title={label}
                secondary={filter.status !== status}
                onPress={() => setFilter({ page: 1, status })}
              />
            ))}
          </View>
          <AButton title="刷新最近练习" secondary onPress={recent.reload} />
          {recent.error && <Text style={a.error}>{recent.error}</Text>}
          <Text style={a.muted}>共 {recent.error ? '—' : (recent.data?.total ?? '—')} 次练习</Text>
        </View>
      }
      renderItem={({ item: x, index }) => (
        <View style={a.card}>
          <Text style={a.subtitle}>{x.status === 'completed' ? '练习已完成' : '练习进行中'}</Text>
          <Text style={a.muted}>
            {formatPlanTime(x.createdAt)} · 已答 {x._count.answers} 题
          </Text>
          <AButton title={'打开第 ' + (index + 1) + ' 次练习'} onPress={() => open(x.id)} />
        </View>
      )}
      ListFooterComponent={
        <View style={a.row}>
          <AButton
            title="上一页最近练习"
            secondary
            disabled={filter.page === 1}
            onPress={() => setFilter((f) => ({ ...f, page: f.page - 1 }))}
          />
          <Text style={a.muted}>第 {filter.page} 页练习</Text>
          <AButton
            title="下一页最近练习"
            secondary
            disabled={!recent.data || filter.page * 10 >= recent.data.total}
            onPress={() => setFilter((f) => ({ ...f, page: f.page + 1 }))}
          />
        </View>
      }
    />
  );
}
function Reference({ question: q }: { question: Question }) {
  return (
    <View style={a.child}>
      {Object.hasOwn(q, 'answer') && (
        <>
          <Text style={a.subtitle}>参考答案</Text>
          <AnswerDisplay value={q.answer} />
        </>
      )}
      {!!q.explanation && (
        <>
          <Text style={a.subtitle}>本题解析</Text>
          <Text selectable style={a.body}>
            {q.explanation}
          </Text>
        </>
      )}
      {q.children?.map((c) => (
        <Reference key={c.id} question={c} />
      ))}
    </View>
  );
}
export function Practice({
  client,
  id,
  registerLeave,
}: {
  client: MobileClient;
  id: string;
  registerLeave(g: LeaveGuard): void;
}) {
  const q = useResource<PracticeDetail>(client, '/mobile/practice/' + encodeURIComponent(id), 30000);
  const [d, setD] = useState<PracticeDetail | null>(null),
    [value, setValue] = useState<AnswerValue>(null),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [accessDenied, setAccessDenied] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [report, setReport] = useState(false);
  const flight = useRef(false),
    mounted = useRef(true);
  const accept = (fresh: PracticeDetail) => {
    setD(fresh);
    setValue(
      fresh.answers.find((a) => a.questionVersionId === fresh.items[fresh.currentPosition]?.id)?.value ??
        null,
    );
    setBlocked(false);
    setAccessDenied(false);
    setError('');
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (q.data && !d) accept(q.data);
  }, [q.data]);
  const question = d?.items[d.currentPosition],
    saved = d?.answers.find((a) => a.questionVersionId === question?.id),
    dirty = !saved && answered(value);
  useEffect(() => {
    registerLeave(
      dirty || busy || blocked
        ? (proceed) => {
            if (flight.current) {
              Alert.alert('正在保存练习', '请等待请求结束。');
              return;
            }
            Alert.alert(
              '离开自主练习？',
              blocked
                ? '结果需要核对，重新进入后请以服务器记录为准。'
                : '本题未提交答案只保留在当前页面，离开后会丢失。',
              [
                { text: '继续练习', style: 'cancel' },
                { text: '放弃并离开练习', style: 'destructive', onPress: proceed },
              ],
            );
          }
        : null,
    );
    return () => registerLeave(null);
  }, [dirty, busy, blocked]);
  const perform = async (run: () => Promise<void>) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await run();
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        setBlocked(true);
        if (e instanceof MobileApiError && [401, 403, 404].includes(e.status)) setAccessDenied(true);
      }
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const reload = () => {
    const run = () =>
      void perform(async () => {
        const fresh = await practiceApi.read(client, id);
        if (mounted.current) {
          accept(fresh);
          setNotice('已核对服务器练习记录');
          q.reload();
        }
      });
    if (dirty || blocked)
      Alert.alert('载入服务器练习？', '当前未提交输入会被替换；已受理的首份答案保持不变。', [
        { text: '保留当前输入', style: 'cancel' },
        { text: '确认载入练习', onPress: run },
      ]);
    else run();
  };
  const progress = (position: number, flags = d?.flags || []) =>
    void perform(async () => {
      if (!d) return;
      const result = await practiceApi.progress(client, id, d.revision, flags, position);
      if (mounted.current) {
        setD({ ...d, ...result });
        if (position !== d.currentPosition)
          setValue(d.answers.find((a) => a.questionVersionId === d.items[position]?.id)?.value ?? null);
        setNotice('练习位置与标记已保存');
      }
    });
  const move = (position: number) => {
    if (dirty)
      Alert.alert('切换练习题目？', '本题未提交输入会丢失，请先提交或明确放弃。', [
        { text: '继续作答', style: 'cancel' },
        { text: '放弃并切换题目', onPress: () => progress(position) },
      ]);
    else progress(position);
  };
  const submit = () =>
    Alert.alert('确认提交本题？', '本题仅接收首次答案，提交后不可修改；之后可查看参考与解析。', [
      { text: '继续检查', style: 'cancel' },
      {
        text: '确认提交练习答案',
        onPress: () =>
          void perform(async () => {
            if (!question) return;
            const fresh = await practiceApi.answer(client, id, question.id, value);
            if (mounted.current) {
              accept(fresh);
              setNotice('本题首份答案已记录');
            }
          }),
      },
    ]);
  const disabled = busy || blocked || !!q.error,
    available = question?.available && q.data?.items.find((x) => x.id === question.id)?.available !== false;
  return (
    <KeyboardAvoidingView style={a.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={a.page}>
        <Text style={a.title}>自主练习与复盘</Text>
        {q.loading && <Text style={a.muted}>正在读取练习…</Text>}
        {!!(error || q.error) && (
          <Text accessibilityRole="alert" style={a.error}>
            {q.error || error}
          </Text>
        )}
        {!!notice && <Text style={a.notice}>{notice}</Text>}
        {blocked && (
          <Text style={a.error}>
            操作结果或版本需要核对，写入已暂停。请先载入服务器练习，避免重复提交或覆盖其他设备的进度。
          </Text>
        )}
        <AButton title="载入服务器练习" secondary disabled={busy} onPress={reload} />
        {d && !q.error && !accessDenied && (
          <>
            <Text style={a.subtitle}>{d.courseTitle}</Text>
            <Text style={a.notice}>
              已答 {d.report.answered} / {d.report.total} 题 · 客观正确率 {practiceRate(d.report)}
            </Text>
            <AButton
              title={report ? '返回练习作答' : '查看本次练习报告'}
              secondary
              disabled={busy}
              onPress={() => setReport((v) => !v)}
            />
            {report ? (
              <View style={a.card}>
                <Text style={a.subtitle}>本次练习报告</Text>
                <Text style={a.body}>
                  客观题答对 {d.report.correct} / {d.report.objectivelyScored}
                </Text>
                <Text style={a.body}>
                  自动得分 {money(d.report.scoreCents)} / {money(d.report.totalCents)}
                </Text>
                <Text style={a.muted}>{d.report.note}</Text>
                {d.items.map((x, i) => (
                  <AButton
                    key={x.id}
                    title={'复盘第 ' + (i + 1) + ' 题'}
                    secondary
                    onPress={() => {
                      setReport(false);
                      move(i);
                    }}
                  />
                ))}
              </View>
            ) : (
              question && (
                <View style={a.card}>
                  <Text style={a.subtitle}>
                    练习第 {d.currentPosition + 1} / {d.items.length} 题
                  </Text>
                  {!available ? (
                    <Text style={a.error}>该题已停止开放练习，无法继续作答或查看参考，请联系教师。</Text>
                  ) : (
                    <>
                      <RichText html={question.stem} />
                      <AnswerInput
                        question={question}
                        label={'练习第' + (d.currentPosition + 1) + '题'}
                        value={saved?.value ?? value}
                        change={setValue}
                        disabled={disabled || !!saved}
                      />
                      {blocked && dirty && (
                        <>
                          <Text style={a.muted}>当前未提交输入</Text>
                          <AnswerDisplay value={value} />
                        </>
                      )}
                      {saved ? (
                        <>
                          <Text style={a.notice}>
                            {saved.correct === true
                              ? '本题回答正确'
                              : saved.correct === false
                                ? '本题需要巩固，错题已记录'
                                : '主观题已记录，请对照参考自主复盘'}
                          </Text>
                          <Reference question={question} />
                        </>
                      ) : (
                        <AButton
                          title="提交本题练习"
                          disabled={disabled || !answered(value)}
                          onPress={submit}
                        />
                      )}
                    </>
                  )}
                  <AButton
                    title={d.flags.includes(question.id) ? '取消本题复习标记' : '标记本题稍后复习'}
                    secondary
                    disabled={disabled}
                    onPress={() =>
                      progress(
                        d.currentPosition,
                        d.flags.includes(question.id)
                          ? d.flags.filter((x) => x !== question.id)
                          : [...d.flags, question.id],
                      )
                    }
                  />
                  <View style={a.row}>
                    <AButton
                      title="上一道练习题"
                      secondary
                      disabled={disabled || d.currentPosition === 0}
                      onPress={() => move(d.currentPosition - 1)}
                    />
                    <AButton
                      title="下一道练习题"
                      disabled={disabled || d.currentPosition === d.items.length - 1}
                      onPress={() => move(d.currentPosition + 1)}
                    />
                  </View>
                  <Text style={a.muted}>进度版本 {d.revision} · 首次答案提交后不可修改</Text>
                </View>
              )
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
