import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import type { MobileClient } from './client';
import { MobileApiError } from './client';
import type { LeaveGuard } from './Assignments';
import { useResource } from './resource';
import { a, AButton } from './assignment-ui';
import {
  algorithmNote,
  algorithmsApi,
  reconcileAlgorithmEdit,
  sameAlgorithmEdit,
  type AlgorithmDetail,
  type AlgorithmEdit,
  type AlgorithmEditorial,
  type AlgorithmList,
  type AlgorithmState,
} from './algorithms-model';
const difficulty = { easy: '入门', medium: '进阶', hard: '挑战' };
const review = { none: '未标记', review: '待复习', mastered: '已掌握' };
export function Algorithms({ client, open }: { client: MobileClient; open(id: string): void }) {
  const [search, setSearch] = useState(''),
    [tag, setTag] = useState(''),
    [query, setQuery] = useState({ q: '', tag: '' }),
    [page, setPage] = useState(1);
  const [level, setLevel] = useState(''),
    [status, setStatus] = useState(''),
    [favorite, setFavorite] = useState(false),
    [reviewState, setReviewState] = useState('');
  const path =
    '/mobile/algorithms/problems?' +
    new URLSearchParams({
      page: String(page),
      pageSize: '10',
      q: query.q,
      ...(query.tag ? { tag: query.tag } : {}),
      ...(level ? { difficulty: level } : {}),
      ...(status ? { status } : {}),
      ...(favorite ? { favorite: 'true' } : {}),
      ...(reviewState ? { review: reviewState } : {}),
    });
  const q = useResource<AlgorithmList>(client, path, 30000),
    data = q.error ? undefined : q.data;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={a.page}>
      <Text style={a.title}>算法学习与复习</Text>
      <Text style={a.muted}>
        阅读题目与题解，保存本人的收藏、复习状态和私人笔记。代码编辑、运行判题、训练计划和论坛请使用网站。
      </Text>
      <TextInput
        accessibilityLabel="搜索算法题"
        style={a.input}
        value={search}
        onChangeText={setSearch}
        maxLength={100}
        placeholder="题号、标题或知识点"
      />
      <TextInput
        accessibilityLabel="算法标签筛选"
        style={a.input}
        value={tag}
        onChangeText={setTag}
        maxLength={60}
        placeholder="标签完整名称，可留空"
      />
      <AButton
        title="搜索算法题库"
        onPress={() => {
          setQuery({ q: search.trim(), tag: tag.trim() });
          setPage(1);
        }}
      />
      <View style={a.row}>
        {[
          ['', '全部难度'],
          ['easy', '入门'],
          ['medium', '进阶'],
          ['hard', '挑战'],
        ].map(([v, label]) => (
          <AButton
            key={v}
            title={label}
            secondary={level !== v}
            onPress={() => {
              setLevel(v);
              setPage(1);
            }}
          />
        ))}
      </View>
      <View style={a.row}>
        {[
          ['', '全部答题状态'],
          ['todo', '尚未尝试'],
          ['attempted', '已经尝试'],
          ['solved', '已经通过'],
        ].map(([v, label]) => (
          <AButton
            key={v}
            title={label}
            secondary={status !== v}
            onPress={() => {
              setStatus(v);
              setPage(1);
            }}
          />
        ))}
      </View>
      <AButton
        title={favorite ? '显示全部算法题' : '仅看算法收藏'}
        secondary={!favorite}
        onPress={() => {
          setFavorite((v) => !v);
          setPage(1);
        }}
      />
      <View style={a.row}>
        {[
          ['', '全部复习状态'],
          ['review', '待复习'],
          ['mastered', '已掌握'],
        ].map(([v, label]) => (
          <AButton
            key={v}
            title={label}
            secondary={reviewState !== v}
            onPress={() => {
              setReviewState(v);
              setPage(1);
            }}
          />
        ))}
      </View>
      <AButton title="刷新算法题库" secondary onPress={q.reload} />
      {q.loading && <Text style={a.muted}>正在加载算法题库…</Text>}
      {q.error && <Text style={a.error}>{q.error}</Text>}
      {data && (
        <>
          <Text style={a.muted}>
            共 {data.total} 道算法题，第 {page} 页
          </Text>
          <Text style={a.muted}>
            题库 {data.stats.total} 道，已尝试 {data.stats.attempted} 道，已通过 {data.stats.solved}{' '}
            道。通过状态来自正式提交，标记掌握不会改变通过数。
          </Text>
          {data.items.map((p, i) => (
            <View key={p.id} style={a.card}>
              <Text style={a.subtitle}>
                {p.number}. {p.title}
              </Text>
              <Text style={a.muted}>
                {difficulty[p.difficulty]} · {p.tags.join(' / ')} ·{' '}
                {p.status === 'solved' ? '已通过' : p.status === 'attempted' ? '已尝试' : '未尝试'}
              </Text>
              <Text style={a.body}>
                {p.favorite ? '已收藏 · ' : ''}
                {review[p.reviewStatus as keyof typeof review] || '未标记'}
              </Text>
              <AButton title={'打开第 ' + (i + 1) + ' 道算法题'} onPress={() => open(p.id)} />
            </View>
          ))}
          {!data.total && <Text style={a.body}>当前条件下没有算法题。</Text>}
        </>
      )}
      <View style={a.row}>
        <AButton title="上一页算法题" secondary disabled={page <= 1} onPress={() => setPage((p) => p - 1)} />
        <AButton
          title="下一页算法题"
          secondary
          disabled={!data || page * 10 >= data.total}
          onPress={() => setPage((p) => p + 1)}
        />
      </View>
    </ScrollView>
  );
}
export function Algorithm({
  client,
  id,
  open,
  editorial,
  registerLeave,
}: {
  client: MobileClient;
  id: string;
  open(id: string): void;
  editorial(id: string): void;
  registerLeave(g: LeaveGuard): void;
}) {
  const q = useResource<AlgorithmDetail>(
    client,
    '/mobile/algorithms/problems/' + encodeURIComponent(id),
    30000,
  );
  const [snapshot, setSnapshot] = useState<AlgorithmState | null>(null),
    [edit, setEdit] = useState<AlgorithmEdit>({ favorite: false, reviewStatus: 'none', note: '' });
  const [latest, setLatest] = useState<AlgorithmState | null>(null),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState('');
  const flight = useRef(false),
    mounted = useRef(true),
    pending = useRef<{ base: AlgorithmState; intent: AlgorithmEdit } | null>(null);
  const dirty = Boolean(snapshot && !sameAlgorithmEdit(snapshot, edit));
  const accept = (state: AlgorithmState, notice = '') => {
    setSnapshot(state);
    setEdit({ favorite: state.favorite, reviewStatus: state.reviewStatus, note: state.note });
    setLatest(null);
    setBlocked(false);
    setUncertain(false);
    pending.current = null;
    setMessage(notice);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!q.data || q.error || busy || uncertain) return;
    const current = q.data.learningState;
    if (!snapshot) accept(current);
    else if (current.revision !== snapshot.revision) {
      if (dirty) {
        setLatest(current);
        setBlocked(true);
        setMessage('学习记录已在其他设备更新。当前输入已保留，请确认后加载服务器记录。');
      } else accept(current);
    } else if (!latest) setBlocked(false);
  }, [q.data, q.error]);
  useEffect(() => {
    registerLeave(
      dirty || busy || uncertain
        ? (proceed) => {
            if (flight.current) {
              Alert.alert('正在保存学习记录', '请等待请求完成后再离开。');
              return;
            }
            Alert.alert(
              '离开算法学习？',
              uncertain
                ? '保存结果尚未确认，重新进入后请先核对服务器记录。'
                : '未保存的私人笔记和学习状态只留在当前页面，离开会丢失。',
              [
                { text: '继续编辑', style: 'cancel' },
                { text: '放弃并离开', style: 'destructive', onPress: proceed },
              ],
            );
          }
        : null,
    );
    return () => registerLeave(null);
  }, [dirty, busy, uncertain]);
  const save = async () => {
    if (!snapshot || flight.current || blocked || q.error) return;
    try {
      algorithmNote(edit.note);
    } catch (e) {
      setMessage((e as Error).message);
      return;
    }
    const request = { base: snapshot, intent: { ...edit } };
    flight.current = true;
    setBusy(true);
    setMessage('');
    pending.current = request;
    try {
      const current = await algorithmsApi.save(client, id, request.base, request.intent);
      if (mounted.current) {
        accept(current, '算法学习记录已保存');
        q.reload();
      }
    } catch (e) {
      if (mounted.current) {
        setBlocked(true);
        if (e instanceof MobileApiError && [400, 401, 403, 404, 409, 413, 422, 429].includes(e.status)) {
          pending.current = null;
          if (e.status === 409) {
            setMessage('学习记录已在其他设备更新。当前输入已保留，请确认后加载服务器记录。');
            q.reload();
          } else {
            setMessage(e.message);
            q.reload();
          }
        } else {
          setUncertain(true);
          setMessage('保存结果尚未确认。请先只读核对服务器记录，不会自动重复保存。');
        }
      }
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const recover = async () => {
    if (flight.current || !pending.current) return;
    const request = pending.current;
    flight.current = true;
    setBusy(true);
    try {
      const current = await algorithmsApi.learning(client, id);
      if (!mounted.current) return;
      const result = reconcileAlgorithmEdit(request.base, request.intent, current);
      if (result === 'applied') {
        accept(current, '已核对：算法学习记录已保存，没有重复写入。');
        q.reload();
      } else if (result === 'unchanged') {
        pending.current = null;
        setUncertain(false);
        setBlocked(false);
        setMessage('服务器仍是原版本，当前输入已保留。需要时请重新确认保存。');
        q.reload();
      } else {
        pending.current = null;
        setUncertain(false);
        setLatest(current);
        setBlocked(true);
        setMessage('服务器记录已变化，当前输入已保留。请确认后加载服务器记录。');
      }
    } catch {
      if (mounted.current) setMessage('暂时无法核对，请恢复网络后再试。');
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const loadLatest = () => {
    if (!latest || busy) return;
    Alert.alert('加载服务器学习记录？', '这会舍弃当前未保存的私人笔记和学习状态。', [
      { text: '继续编辑', style: 'cancel' },
      { text: '舍弃并加载', style: 'destructive', onPress: () => accept(latest, '已加载服务器最新学习记录') },
    ]);
  };
  const data = q.error ? undefined : q.data,
    disabled = busy || blocked || uncertain || !snapshot || Boolean(q.error);
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={a.page}>
      <Text style={a.title}>算法题目与学习记录</Text>
      <AButton title="刷新算法题目" secondary disabled={busy} onPress={q.reload} />
      {q.loading && <Text style={a.muted}>正在核对题目与本人学习记录…</Text>}
      {q.error && <Text style={a.error}>{q.error}</Text>}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={a.notice}>
          {message}
        </Text>
      ) : null}
      {uncertain && <AButton title="核对算法保存结果" disabled={busy} onPress={() => void recover()} />}
      {latest && <AButton title="加载服务器学习记录" disabled={busy} onPress={loadLatest} />}
      {data && (
        <>
          <View style={a.card}>
            <Text style={a.subtitle}>
              {data.number}. {data.title}
            </Text>
            <Text style={a.muted}>
              {difficulty[data.difficulty]} · {data.tags.join(' / ')} · {data.timeLimitMs} ms /{' '}
              {data.memoryLimitMb} MiB
            </Text>
            <Text selectable style={a.body}>
              {data.description}
            </Text>
            <Text style={a.subtitle}>输入格式</Text>
            <Text selectable style={a.body}>
              {data.inputFormat}
            </Text>
            <Text style={a.subtitle}>输出格式</Text>
            <Text selectable style={a.body}>
              {data.outputFormat}
            </Text>
            <Text style={a.subtitle}>数据范围</Text>
            <Text selectable style={a.body}>
              {data.constraints}
            </Text>
            {data.examples.map((e, i) => (
              <View key={i} style={a.child}>
                <Text style={a.subtitle}>样例 {i + 1}</Text>
                <Text selectable style={a.body}>
                  输入：{'\n'}
                  {e.input}
                </Text>
                <Text selectable style={a.body}>
                  输出：{'\n'}
                  {e.output}
                </Text>
                <Text style={a.body}>{e.explanation}</Text>
              </View>
            ))}
            <AButton
              title="阅读算法题解"
              secondary
              disabled={!data.editorialAvailable || busy}
              onPress={() => editorial(id)}
            />
          </View>
          <View style={a.card}>
            <Text style={a.subtitle}>本人算法学习记录</Text>
            <Text style={a.muted}>
              只修改本人的记录，与网站共用版本。标记掌握不代表代码通过判题；未保存内容不会持久缓存。
            </Text>
            <AButton
              title={edit.favorite ? '已选择收藏算法题' : '收藏算法题'}
              secondary={!edit.favorite}
              disabled={disabled}
              onPress={() => setEdit((v) => ({ ...v, favorite: !v.favorite }))}
            />
            <View style={a.row}>
              {(['none', 'review', 'mastered'] as const).map((v) => (
                <AButton
                  key={v}
                  title={'标记' + review[v]}
                  secondary={edit.reviewStatus !== v}
                  disabled={disabled}
                  onPress={() => setEdit((e) => ({ ...e, reviewStatus: v }))}
                />
              ))}
            </View>
            <TextInput
              accessibilityLabel="算法私人笔记"
              style={[a.input, a.textarea]}
              multiline
              value={edit.note}
              onChangeText={(note) => setEdit((v) => ({ ...v, note }))}
              maxLength={12000}
              editable={!disabled}
              placeholder="记录思路、边界条件或需要复习的地方"
            />
            <AButton
              title="保存算法学习记录"
              disabled={disabled || !dirty}
              onPress={() =>
                Alert.alert('保存算法学习记录？', '将当前收藏、复习状态和私人笔记同步到网站。', [
                  { text: '继续编辑', style: 'cancel' },
                  { text: '确认保存学习记录', onPress: () => void save() },
                ])
              }
            />
          </View>
          <View style={a.row}>
            <AButton
              title="上一道算法题"
              secondary
              disabled={!data.navigation.previousProblemId || busy}
              onPress={() => open(data.navigation.previousProblemId!)}
            />
            <AButton
              title="下一道算法题"
              secondary
              disabled={!data.navigation.nextProblemId || busy}
              onPress={() => open(data.navigation.nextProblemId!)}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}
export function AlgorithmSolution({
  client,
  id,
  open,
}: {
  client: MobileClient;
  id: string;
  open(id: string): void;
}) {
  const q = useResource<AlgorithmEditorial>(
    client,
    '/mobile/algorithms/problems/' + encodeURIComponent(id) + '/editorial',
    30000,
  );
  const [language, setLanguage] = useState<'cpp' | 'python' | 'javascript' | 'java'>('cpp');
  const data = q.error ? undefined : q.data,
    e = data?.editorial;
  return (
    <ScrollView contentContainerStyle={a.page}>
      <Text style={a.title}>算法题解与复盘</Text>
      <Text style={a.muted}>按需阅读提示、推导和参考代码。这里不会执行代码，也不会发起AI或判题请求。</Text>
      <AButton title="返回算法题目" secondary onPress={() => open(id)} />
      <AButton title="刷新算法题解" secondary onPress={q.reload} />
      {q.loading && <Text style={a.muted}>正在加载题解…</Text>}
      {q.error && <Text style={a.error}>{q.error}</Text>}
      {e && (
        <>
          <View style={a.card}>
            <Text style={a.subtitle}>阅读指引</Text>
            <Text selectable style={a.body}>
              {e.introduction}
            </Text>
            {e.prerequisites.map((v, i) => (
              <Text key={'p' + i} style={a.body}>
                预备知识：{v}
              </Text>
            ))}
            {e.readingGuide.map((v, i) => (
              <Text key={'g' + i} style={a.body}>
                {i + 1}. {v}
              </Text>
            ))}
          </View>
          <View style={a.card}>
            <Text style={a.subtitle}>解题提示</Text>
            {e.hints.map((v, i) => (
              <Text key={i} style={a.body}>
                {i + 1}. {v}
              </Text>
            ))}
          </View>
          {e.approaches.map((v, i) => (
            <View key={i} style={a.card}>
              <Text style={a.subtitle}>{v.name}</Text>
              <Text selectable style={a.body}>
                {v.intuition}
              </Text>
              {v.steps.map((v, i) => (
                <Text key={i} style={a.body}>
                  {i + 1}. {v}
                </Text>
              ))}
              <Text selectable style={a.body}>
                正确性：{v.correctness}
              </Text>
              <Text style={a.body}>
                时间复杂度：{v.timeComplexity}
                {'\n'}空间复杂度：{v.spaceComplexity}
              </Text>
              <Text style={a.body}>{v.tradeoff}</Text>
            </View>
          ))}
          <View style={a.card}>
            <Text style={a.subtitle}>样例推演</Text>
            <Text selectable style={a.body}>
              输入：{e.walkthrough.input}
            </Text>
            {e.walkthrough.steps.map((v) => (
              <Text key={v.step} selectable style={a.body}>
                {v.step}. {v.state}
                {'\n'}
                {v.explanation}
              </Text>
            ))}
            <Text selectable style={a.body}>
              结果：{e.walkthrough.result}
            </Text>
          </View>
          <View style={a.card}>
            <Text style={a.subtitle}>边界条件与常见错误</Text>
            {e.edgeCases.map((v, i) => (
              <Text key={'e' + i} style={a.body}>
                {v.case}：{v.why}
              </Text>
            ))}
            {e.mistakes.map((v, i) => (
              <Text key={'m' + i} style={a.body}>
                {v.mistake}：{v.fix}
              </Text>
            ))}
            {e.followUp.map((v, i) => (
              <Text key={'f' + i} style={a.body}>
                继续思考：{v}
              </Text>
            ))}
          </View>
          <View style={a.card}>
            <Text style={a.subtitle}>参考代码（只读）</Text>
            <View style={a.row}>
              {(
                [
                  ['cpp', 'C++'],
                  ['python', 'Python'],
                  ['javascript', 'JavaScript'],
                  ['java', 'Java'],
                ] as const
              ).map(([v, label]) => (
                <AButton
                  key={v}
                  title={'查看' + label + '参考代码'}
                  secondary={language !== v}
                  onPress={() => setLanguage(v)}
                />
              ))}
            </View>
            <Text accessibilityLabel="算法参考代码" selectable style={[a.body, { fontFamily: 'monospace' }]}>
              {e.referenceCode[language] || '该语言参考代码尚未发布。'}
            </Text>
          </View>
          {data?.relatedProblems.map((p) => (
            <AButton key={p.id} title={'延伸题：' + p.title} secondary onPress={() => open(p.id)} />
          ))}
        </>
      )}
    </ScrollView>
  );
}
