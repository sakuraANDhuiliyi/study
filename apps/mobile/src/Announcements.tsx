import React, { useState } from 'react';
import { FlatList, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import type { MobileClient } from './client';
import { useResource } from './resource';
import { a, AButton, RichText } from './assignment-ui';
import { formatPlanTime } from './planner-model';
export type AnnouncementSummary = {
  id: string;
  title: string;
  courseId: string | null;
  courseTitle: string | null;
  createdAt: string;
};
type AnnouncementList = { items: AnnouncementSummary[]; total: number; page: number; pageSize: number };
export function Announcements({
  client,
  courseId,
  open,
}: {
  client: MobileClient;
  courseId?: string;
  open(id: string): void;
}) {
  const [scope, setScope] = useState('all'),
    [page, setPage] = useState(1);
  const [text, setText] = useState(''),
    [search, setSearch] = useState('');
  const list = useResource<AnnouncementList>(
    client,
    '/mobile/announcements?' +
      new URLSearchParams({
        page: String(page),
        pageSize: '10',
        scope,
        ...(courseId ? { courseId } : {}),
        ...(search ? { search } : {}),
      }),
    30000,
  );
  return (
    <FlatList
      contentContainerStyle={a.page}
      data={list.error ? [] : list.data?.items || []}
      keyExtractor={(r) => r.id}
      refreshControl={<RefreshControl refreshing={false} onRefresh={list.reload} />}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Text style={a.title}>教学公告</Text>
          <Text style={a.muted}>查看机构和当前授权课程的最新公告。打开公告不会自动标记通知已读。</Text>
          {!courseId && (
            <View style={a.row}>
              {[
                ['all', '全部公告'],
                ['organization', '机构公告'],
                ['courses', '课程公告'],
              ].map(([v, label]) => (
                <AButton
                  key={v}
                  title={label}
                  secondary={v !== scope}
                  onPress={() => {
                    setScope(v);
                    setPage(1);
                  }}
                />
              ))}
            </View>
          )}
          {courseId && <Text style={a.notice}>仅显示当前课程公告。</Text>}
          <TextInput
            accessibilityLabel="搜索公告标题"
            placeholder="搜索公告标题"
            value={text}
            onChangeText={setText}
            maxLength={100}
            style={a.input}
            returnKeyType="search"
            onSubmitEditing={() => {
              setSearch(text.trim());
              setPage(1);
            }}
          />
          <View style={a.row}>
            <AButton
              title="搜索公告"
              onPress={() => {
                setSearch(text.trim());
                setPage(1);
              }}
            />
            <AButton
              title="清除公告搜索"
              secondary
              onPress={() => {
                setText('');
                setSearch('');
                setPage(1);
              }}
            />
            <AButton title="刷新公告" secondary onPress={list.reload} />
          </View>
          {list.loading && <Text style={a.muted}>正在加载公告…</Text>}
          {list.error && (
            <Text accessibilityRole="alert" style={a.error}>
              {list.error}
            </Text>
          )}
          <Text style={a.muted}>
            共 {list.error ? '—' : (list.data?.total ?? '—')} 条公告，第 {page} 页
          </Text>
        </View>
      }
      renderItem={({ item, index }) => (
        <View style={a.card}>
          <Text style={a.subtitle}>{item.title}</Text>
          <Text style={a.notice}>{item.courseId ? '课程公告 · ' + item.courseTitle : '机构公告'}</Text>
          <Text style={a.muted}>发布时间：{formatPlanTime(item.createdAt)}</Text>
          <AButton title={'查看第 ' + (index + 1) + ' 条公告'} onPress={() => open(item.id)} />
        </View>
      )}
      ListEmptyComponent={list.data && !list.error ? <Text style={a.muted}>当前条件下没有公告。</Text> : null}
      ListFooterComponent={
        <View style={a.row}>
          <AButton
            title="上一页公告"
            secondary
            disabled={page <= 1 || list.loading}
            onPress={() => setPage((p) => p - 1)}
          />
          <AButton
            title="下一页公告"
            secondary
            disabled={!!list.error || list.loading || !list.data || page * 10 >= list.data.total}
            onPress={() => setPage((p) => p + 1)}
          />
        </View>
      }
    />
  );
}
export function Announcement({ client, id }: { client: MobileClient; id: string }) {
  const q = useResource<AnnouncementSummary & { content: string }>(
    client,
    '/mobile/announcements/' + encodeURIComponent(id),
    30000,
  );
  return (
    <ScrollView contentContainerStyle={a.page}>
      <Text style={a.title}>公告详情</Text>
      <AButton title="刷新公告详情" secondary onPress={q.reload} />
      {q.loading && <Text style={a.muted}>正在核对公告访问权限…</Text>}
      {q.error && (
        <Text accessibilityRole="alert" style={a.error}>
          {q.error}
        </Text>
      )}
      {!q.error && q.data && (
        <View style={a.card}>
          <Text style={a.subtitle}>{q.data.title}</Text>
          <Text style={a.notice}>{q.data.courseId ? '课程公告 · ' + q.data.courseTitle : '机构公告'}</Text>
          <Text style={a.muted}>发布时间：{formatPlanTime(q.data.createdAt)}</Text>
          <RichText html={q.data.content} />
        </View>
      )}
    </ScrollView>
  );
}
