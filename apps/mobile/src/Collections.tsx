import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import type { MobileClient } from './client';
import type { LeaveGuard } from './Assignments';
import type { Question } from './assignment-model';
import { useResource } from './resource';
import { a, AButton, RichText } from './assignment-ui';
import { collectionsApi, type CollectionRow, type CollectionList } from './collections-model';
function Body({ question }: { question: Question }) {
  return (
    <View style={{ gap: 8 }}>
      <RichText html={question.stem} />
      {question.options.map((o) => (
        <Text key={o.id} style={a.body}>
          {o.id}. {o.text}
        </Text>
      ))}
      {question.children.map((q, i) => (
        <View key={q.id || String(i)} style={a.child}>
          <Body question={q} />
        </View>
      ))}
    </View>
  );
}
export function Collections({
  client,
  courseId,
  practice,
  registerLeave,
}: {
  client: MobileClient;
  courseId?: string;
  practice(courseId: string): void;
  registerLeave(g: LeaveGuard): void;
}) {
  const [kind, setKind] = useState<'mistakes' | 'favorites'>('mistakes');
  const [mastered, setMastered] = useState('false'),
    [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [message, setMessage] = useState('');
  const path =
    '/mobile/collections/' +
    kind +
    '?' +
    new URLSearchParams({
      page: String(page),
      pageSize: '10',
      ...(courseId ? { courseId } : {}),
      ...(kind === 'mistakes' && mastered ? { mastered } : {}),
    });
  const list = useResource<CollectionList>(client, path);
  const mounted = useRef(true),
    flight = useRef(false),
    currentPath = useRef(path);
  const stale = useRef<CollectionList | undefined>(undefined);
  currentPath.current = path;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!busy && list.data && !list.loading && !list.error && list.data !== stale.current) setBlocked(false);
  }, [list.data, list.loading, list.error, busy]);
  useEffect(() => {
    registerLeave(busy ? () => Alert.alert('正在更新', '请等待本次请求结束后离开。') : null);
    return () => registerLeave(null);
  }, [busy]);
  const mutate = async (row: CollectionRow, action: 'master' | 'favorite', capturedPath: string) => {
    if (!mounted.current || flight.current || blocked || currentPath.current !== capturedPath) return;
    flight.current = true;
    setBusy(true);
    setMessage('');
    stale.current = list.data;
    setBlocked(true);
    try {
      await (action === 'master' ? collectionsApi.master(client, row) : collectionsApi.favorite(client, row));
      if (mounted.current) setMessage('已处理，正在重新核对服务器记录。');
    } catch {
      if (mounted.current) setMessage('未能确认最新状态。请刷新核对后再操作；不会自动重复提交。');
    } finally {
      flight.current = false;
      if (mounted.current) {
        setBusy(false);
        list.reload();
      }
    }
  };
  const confirm = (row: CollectionRow, action: 'master' | 'favorite') => {
    const title =
      action === 'master'
        ? row.mastered
          ? '重新标为未掌握'
          : '标为已掌握'
        : row.favorite
          ? '取消收藏'
          : '收藏题目';
    const capturedPath = path;
    Alert.alert(title + '？', '更新本人的网站与手机共享记录；若记录已变化，请刷新后重新确认。', [
      { text: '取消', style: 'cancel' },
      { text: '确认' + title, onPress: () => void mutate(row, action, capturedPath) },
    ]);
  };
  const disabled = busy || blocked || list.loading || Boolean(list.error);
  return (
    <ScrollView contentContainerStyle={a.page}>
      <Text style={a.title}>错题本与收藏管理</Text>
      <Text style={a.muted}>
        查看已开放练习题，管理本人掌握与收藏状态。答案和解析请进入自主练习逐题提交后查看。
      </Text>
      <View style={a.row}>
        {(['mistakes', 'favorites'] as const).map((k) => (
          <AButton
            key={k}
            title={k === 'mistakes' ? '我的错题' : '我的收藏'}
            secondary={kind !== k}
            disabled={busy}
            onPress={() => {
              setKind(k);
              setPage(1);
              setMessage('');
            }}
          />
        ))}
      </View>
      {kind === 'mistakes' && (
        <View style={a.row}>
          {[
            ['false', '未掌握'],
            ['true', '已掌握'],
            ['', '全部状态'],
          ].map(([v, label]) => (
            <AButton
              key={label}
              title={label}
              secondary={mastered !== v}
              disabled={busy}
              onPress={() => {
                setMastered(v);
                setPage(1);
              }}
            />
          ))}
        </View>
      )}
      <AButton title="刷新错题与收藏" secondary disabled={busy} onPress={list.reload} />
      {message ? (
        <Text accessibilityLiveRegion="polite" style={a.notice}>
          {message}
        </Text>
      ) : null}
      {list.error ? <Text style={a.error}>{list.error}</Text> : null}
      {list.loading ? <Text style={a.muted}>正在加载个人题目记录…</Text> : null}
      {list.data && (
        <Text style={a.muted}>
          共 {list.data.total} 条记录，第 {page} 页
        </Text>
      )}
      {list.data?.items.map((row, index) => (
        <View style={a.card} key={row.id}>
          <Text style={a.subtitle}>
            第 {(page - 1) * 10 + index + 1} 题{row.wrongCount !== null ? ` · 错误 ${row.wrongCount} 次` : ''}
          </Text>
          {row.question && row.available ? (
            <Body question={row.question} />
          ) : (
            <Text style={a.notice}>该题已停止开放练习，正文与参考内容不可见。</Text>
          )}
          {row.mastered !== null && (
            <>
              <Text style={a.muted}>{row.mastered ? '当前已掌握' : '当前未掌握'}</Text>
              <AButton
                title={row.mastered ? '重新标为未掌握' : '标为已掌握'}
                disabled={disabled}
                onPress={() => confirm(row, 'master')}
              />
            </>
          )}
          <AButton
            title={row.favorite ? '取消收藏' : '收藏题目'}
            secondary
            disabled={disabled || (!row.available && !row.favorite)}
            onPress={() => confirm(row, 'favorite')}
          />
          <AButton
            title="进入本课程自主练习"
            secondary
            disabled={busy || !row.available}
            onPress={() => practice(row.courseId)}
          />
        </View>
      ))}
      {list.data && !list.data.total && <Text style={a.body}>当前条件下没有记录。</Text>}
      <View style={a.row}>
        <AButton
          title="上一页记录"
          secondary
          disabled={busy || page <= 1}
          onPress={() => setPage((p) => p - 1)}
        />
        <AButton
          title="下一页记录"
          secondary
          disabled={busy || !list.data || page * 10 >= list.data.total}
          onPress={() => setPage((p) => p + 1)}
        />
      </View>
    </ScrollView>
  );
}
