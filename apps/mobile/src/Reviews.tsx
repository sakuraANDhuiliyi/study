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
import type { MobileClient } from './client';
import type { LeaveGuard } from './Assignments';
import { useResource } from './resource';
import { a, AButton } from './assignment-ui';
import { money } from './assignment-model';
import { formatPlanTime } from './planner-model';
import {
  reviewApi,
  definitiveReviewFailure,
  reviewReason,
  type ReviewDetail,
  type ReviewList,
} from './review-model';
function Query({ loading, error, reload }: { loading: boolean; error?: string; reload(): void }) {
  return (
    <>
      {loading && <Text style={a.muted}>正在核对复核记录…</Text>}
      {error && (
        <View style={a.card}>
          <Text accessibilityRole="alert" style={a.error}>
            {error}
          </Text>
          <AButton title="重新加载复核记录" onPress={reload} />
        </View>
      )}
    </>
  );
}
export function Reviews({ client, open }: { client: MobileClient; open(id: string): void }) {
  const [filter, setFilter] = useState({ page: 1, status: '' });
  const q = useResource<ReviewList>(
    client,
    '/mobile/appeals?' +
      new URLSearchParams({
        page: String(filter.page),
        pageSize: '10',
        ...(filter.status ? { status: filter.status } : {}),
      }),
    30000,
  );
  return (
    <FlatList
      contentContainerStyle={a.page}
      data={q.error ? [] : q.data?.items || []}
      keyExtractor={(x) => x.id}
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} />}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Text style={a.title}>我的成绩复核</Text>
          <Text style={a.muted}>查看本人申请的受理进度、教师意见及有效成绩。教师在网站处理。</Text>
          <View style={a.row}>
            {[
              ['', '全部复核'],
              ['pending', '待处理复核'],
              ['resolved', '已处理复核'],
            ].map(([status, label]) => (
              <AButton
                key={status}
                title={label}
                secondary={filter.status !== status}
                onPress={() => setFilter({ page: 1, status })}
              />
            ))}
          </View>
          <Query {...q} />
          <Text style={a.muted}>共 {q.data?.total ?? '—'} 项复核</Text>
        </View>
      }
      renderItem={({ item: x }) => (
        <View style={a.card}>
          <Text style={a.subtitle}>{x.title}</Text>
          <Text style={a.notice}>{x.status === 'resolved' ? '复核已处理' : '复核待处理'}</Text>
          <Text style={a.muted}>申请时间：{formatPlanTime(x.createdAt)}</Text>
          <Text style={a.body}>申请理由：{x.reason}</Text>
          <Text style={a.body}>当前有效成绩：{money(x.scoreCents)}</Text>
          {x.resolution && (
            <Text selectable style={a.body}>
              处理意见：{x.resolution}
            </Text>
          )}
          <AButton title={'查看复核：' + x.title} onPress={() => open(x.attemptId)} />
        </View>
      )}
      ListEmptyComponent={q.data && !q.error ? <Text style={a.muted}>当前没有匹配的复核申请。</Text> : null}
      ListFooterComponent={
        <View style={a.row}>
          <AButton
            title="上一页复核"
            secondary
            disabled={filter.page === 1}
            onPress={() => setFilter((f) => ({ ...f, page: f.page - 1 }))}
          />
          <Text style={a.muted}>第 {filter.page} 页</Text>
          <AButton
            title="下一页复核"
            secondary
            disabled={!q.data || filter.page * 10 >= q.data.total}
            onPress={() => setFilter((f) => ({ ...f, page: f.page + 1 }))}
          />
        </View>
      }
    />
  );
}
export function Review({
  client,
  id,
  registerLeave,
  openAttempt,
}: {
  client: MobileClient;
  id: string;
  registerLeave(guard: LeaveGuard): void;
  openAttempt(id: string): void;
}) {
  const [page, setPage] = useState(1),
    q = useResource<ReviewDetail>(
      client,
      '/mobile/exam-attempts/' + encodeURIComponent(id) + '/review?pageSize=10&page=' + page,
      30000,
    );
  const [receipt, setReceipt] = useState<ReviewDetail | null>(null),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const pending = useRef<string | null>(null),
    flight = useRef(false),
    mounted = useRef(true);
  const d = receipt || q.data;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (q.data) {
      // Every authorized server snapshot replaces cached presentation, including withdrawn publication.
      setReceipt(q.data);
      if (q.data.appeal) {
        setReason('');
        pending.current = null;
        setUncertain(false);
        setError('');
      }
    }
  }, [q.data]);
  useEffect(() => {
    registerLeave(
      reason || uncertain || busy
        ? (proceed) => {
            if (flight.current) {
              Alert.alert('正在提交复核', '请等待结果，或在网络请求结束后核对服务器回执。');
              return;
            }
            Alert.alert(
              '离开成绩复核？',
              uncertain
                ? '提交结果尚未确认。离开后请先核对复核记录，服务器只保留本次答卷的首份申请。'
                : '未提交的理由只保存在当前页面，离开后将丢失。',
              [
                { text: '继续填写', style: 'cancel' },
                { text: '离开并稍后核对', style: 'destructive', onPress: proceed },
              ],
            );
          }
        : null,
    );
    return () => registerLeave(null);
  }, [reason, uncertain, busy]);
  const apply = async () => {
    if (flight.current) return;
    let frozen: string;
    try {
      frozen = pending.current || reviewReason(reason);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    pending.current = frozen;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await reviewApi.apply(client, id, frozen);
      if (mounted.current) {
        setReceipt(result);
        setReason('');
        pending.current = null;
        setUncertain(false);
        q.reload();
      }
    } catch (e) {
      if (mounted.current) {
        if (definitiveReviewFailure(e)) {
          pending.current = null;
          setUncertain(false);
          setError((e as Error).message);
          q.reload();
        } else {
          setUncertain(true);
          setError('申请结果尚未确认，请先核对记录；重试会发送同一份理由。' + (e as Error).message);
        }
      }
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const confirm = () => {
    try {
      if (!pending.current) reviewReason(reason);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    Alert.alert(
      '确认申请成绩复核？',
      '每份答卷只受理一次申请。首份理由提交后不能修改，请说明题目、评分疑问及依据。',
      [
        { text: '继续检查', style: 'cancel' },
        { text: '确认提交复核', onPress: () => void apply() },
      ],
    );
  };
  return (
    <KeyboardAvoidingView style={a.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={a.page}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => {
              if (!busy) q.reload();
            }}
          />
        }
      >
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
              <Text style={a.muted}>第 {d.number} 次答卷 · 成绩复核</Text>
              <Text style={a.subtitle}>当前有效成绩：{money(d.scoreCents)}</Text>
              <Text style={a.body}>
                复核截止：{d.deadlineAt ? formatPlanTime(d.deadlineAt) : '未设置固定截止时间'}
              </Text>
              <AButton title="查看本次答卷" secondary disabled={busy} onPress={() => openAttempt(id)} />
            </View>
            {d.appeal ? (
              <View style={a.card}>
                <Text style={a.subtitle}>
                  {d.appeal.status === 'resolved' ? '复核已处理' : '复核申请已受理'}
                </Text>
                <Text selectable style={a.muted}>
                  复核回执：{d.appeal.id}
                </Text>
                <Text style={a.muted}>提交：{formatPlanTime(d.appeal.createdAt)}</Text>
                <Text selectable style={a.body}>
                  申请理由：{d.appeal.reason}
                </Text>
                <Text style={a.muted}>每份答卷仅保留首份申请理由，重复点击不会创建新申请。</Text>
                {d.appeal.resolution ? (
                  <>
                    <Text style={a.subtitle}>教师处理意见</Text>
                    <Text selectable style={a.body}>
                      {d.appeal.resolution}
                    </Text>
                  </>
                ) : (
                  <Text style={a.muted}>
                    {d.appeal.status === 'resolved'
                      ? '处理意见随正式成绩公开后展示。'
                      : '请等待教师处理，可在这里刷新进度。'}
                  </Text>
                )}
                {d.appeal.resolvedAt && (
                  <Text style={a.muted}>处理：{formatPlanTime(d.appeal.resolvedAt)}</Text>
                )}
              </View>
            ) : (
              <View style={a.card}>
                <Text style={a.subtitle}>填写复核申请</Text>
                <Text style={a.muted}>请具体说明评分疑问。申请仅用于本人答卷，不会直接修改分数。</Text>
                {!!d.blockedReason && <Text style={a.notice}>{d.blockedReason}</Text>}
                <TextInput
                  accessibilityLabel="成绩复核理由"
                  placeholder="题目、评分疑问与依据（至少5个字）"
                  multiline
                  style={[a.input, a.textarea]}
                  maxLength={4000}
                  value={reason}
                  onChangeText={setReason}
                  editable={d.canApply && !busy && !uncertain}
                />
                <Text style={a.muted}>{reason.length} / 4000 · 未提交的理由不会在重启后恢复</Text>
                <AButton
                  title={busy ? '正在提交复核…' : uncertain ? '重试同一份复核申请' : '提交成绩复核'}
                  disabled={busy || (!uncertain && !d.canApply)}
                  onPress={confirm}
                />
              </View>
            )}
            <AButton title="核对复核回执与处理进度" disabled={busy} onPress={q.reload} />
            <View style={a.card}>
              <Text style={a.subtitle}>成绩变更记录</Text>
              <Text style={a.muted}>共 {d.revisions.total} 次成绩变更 · 成绩未公开时不展示明细</Text>
              {d.revisions.items.map((x) => (
                <View key={x.id} style={a.child}>
                  <Text style={a.subtitle}>
                    {money(x.oldScoreCents)} → {money(x.newScoreCents)} 分
                  </Text>
                  <Text selectable style={a.body}>
                    {x.reason}
                  </Text>
                  <Text style={a.muted}>{formatPlanTime(x.createdAt)}</Text>
                </View>
              ))}
              {!d.revisions.items.length && <Text style={a.muted}>当前没有可公开的成绩变更记录。</Text>}
              <View style={a.row}>
                <AButton
                  title="上一页成绩变更"
                  secondary
                  disabled={busy || page === 1}
                  onPress={() => setPage((p) => p - 1)}
                />
                <Text style={a.muted}>第 {page} 页</Text>
                <AButton
                  title="下一页成绩变更"
                  secondary
                  disabled={busy || page * 10 >= d.revisions.total}
                  onPress={() => setPage((p) => p + 1)}
                />
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
