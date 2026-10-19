import React, { useRef, useState } from 'react';
import { Alert, FlatList, RefreshControl, Text, View } from 'react-native';
import type { MobileClient } from './client';
import { useResource } from './resource';
import { a, AButton } from './assignment-ui';
import { formatPlanTime } from './planner-model';
import { inboxApi, type InboxList, type InboxTarget } from './inbox-model';
export function Inbox({ client, open }: { client: MobileClient; open(target: InboxTarget): void }) {
  const [filter, setFilter] = useState({ page: 1, unread: false, kind: '' });
  const q = useResource<InboxList>(
    client,
    '/mobile/notifications?' +
      new URLSearchParams({
        page: String(filter.page),
        pageSize: '10',
        ...(filter.unread ? { unread: 'true' } : {}),
        ...(filter.kind ? { kind: filter.kind } : {}),
      }),
    30000,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const flight = useRef(false);
  const perform = async (action: () => Promise<void>) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message + '。请刷新核对后重试。');
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };
  const read = async (ids: string[]) => {
    await inboxApi.read(client, ids);
    q.reload();
  };
  return (
    <FlatList
      contentContainerStyle={a.page}
      data={q.error ? [] : q.data?.items || []}
      keyExtractor={(x) => x.id}
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} />}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Text style={a.title}>我的学习通知</Text>
          <Text style={a.muted}>
            这里只展示提醒摘要。打开对应功能后，按当前权限查看最新内容和成绩；其他通知详情请在网站查看。
          </Text>
          <Text style={a.notice}>未读 {q.error ? '—' : (q.data?.unreadCount ?? '—')} 条通知</Text>
          <View style={a.row}>
            <AButton
              title="全部通知"
              disabled={busy}
              secondary={filter.unread}
              onPress={() => setFilter((f) => ({ ...f, page: 1, unread: false }))}
            />
            <AButton
              title="仅未读通知"
              disabled={busy}
              secondary={!filter.unread}
              onPress={() => setFilter((f) => ({ ...f, page: 1, unread: true }))}
            />
          </View>
          <View style={a.row}>
            {[
              ['', '全部类型'],
              ['assignment', '作业提醒'],
              ['exam', '考试提醒'],
              ['grade', '成绩提醒'],
              ['course', '课程提醒'],
              ['other', '其他提醒'],
            ].map(([kind, label]) => (
              <AButton
                key={kind}
                title={label}
                secondary={filter.kind !== kind}
                disabled={busy}
                onPress={() => setFilter((f) => ({ ...f, page: 1, kind }))}
              />
            ))}
          </View>
          <AButton title="刷新通知" disabled={busy} secondary onPress={q.reload} />
          {q.loading && <Text style={a.muted}>正在加载通知…</Text>}
          {!!(q.error || error) && (
            <Text accessibilityRole="alert" style={a.error}>
              {q.error || error}
            </Text>
          )}
          <Text style={a.muted}>共 {q.error ? '—' : (q.data?.total ?? '—')} 条通知</Text>
          <AButton
            title="本页未读标记已读"
            secondary
            disabled={busy || !!q.error || !q.data?.items.some((x) => !x.readAt)}
            onPress={() => {
              const ids = q.data!.items.filter((x) => !x.readAt).map((x) => x.id);
              Alert.alert('确认标记本页已读？', '仅处理当前看到的未读提醒，后来收到的新通知仍保留未读。', [
                { text: '取消', style: 'cancel' },
                { text: '确认本页已读', onPress: () => void perform(() => read(ids)) },
              ]);
            }}
          />
        </View>
      }
      renderItem={({ item, index }) => (
        <View style={a.card}>
          <Text style={a.subtitle}>{item.title}</Text>
          <Text style={a.notice}>
            第 {(filter.page - 1) * 10 + index + 1} 条 · {item.readAt ? '已读' : '未读'}
          </Text>
          <Text style={a.muted}>收到时间：{formatPlanTime(item.createdAt)}</Text>
          {item.readAt && <Text style={a.muted}>已读时间：{formatPlanTime(item.readAt)}</Text>}
          <Text style={a.body}>
            {item.canOpen ? '进入对应功能核对最新安排或结果。' : '此类详情尚未迁移，请在网站查看。'}
          </Text>
          {item.canOpen && (
            <AButton
              title={'查看第 ' + (index + 1) + ' 条通知内容'}
              disabled={busy}
              onPress={() =>
                void perform(async () => {
                  const target = await inboxApi.target(client, item.id);
                  // Opening never silently changes read status; the explicit read action is idempotent.
                  open(target);
                })
              }
            />
          )}
          {!item.readAt && (
            <AButton
              title={'标记第 ' + (index + 1) + ' 条为已读'}
              secondary
              disabled={busy}
              onPress={() => void perform(() => read([item.id]))}
            />
          )}
        </View>
      )}
      ListEmptyComponent={q.data && !q.error ? <Text style={a.muted}>当前没有匹配的通知。</Text> : null}
      ListFooterComponent={
        <View style={a.row}>
          <AButton
            title="上一页通知"
            secondary
            disabled={busy || filter.page === 1}
            onPress={() => setFilter((f) => ({ ...f, page: f.page - 1 }))}
          />
          <Text style={a.muted}>第 {filter.page} 页通知</Text>
          <AButton
            title="下一页通知"
            secondary
            disabled={busy || !q.data || filter.page * 10 >= q.data.total}
            onPress={() => setFilter((f) => ({ ...f, page: f.page + 1 }))}
          />
        </View>
      }
    />
  );
}
