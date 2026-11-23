import React, { useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import type { LeaveGuard } from './Assignments';
import { MobileApiError, type MobileClient } from './client';
import { useResource } from './resource';
import { a, AButton, RichText } from './assignment-ui';
import { AcademicQuery, useAcademicLeave, useAcademicLive } from './academic-ui';
export function TeachingAnnouncement({
  client,
  courseId,
  registerLeave,
  openCourse,
}: {
  client: MobileClient;
  courseId: string;
  registerLeave(guard: LeaveGuard): void;
  openCourse(id: string): void;
}) {
  const course = useResource<{ title: string }>(client, '/courses/' + encodeURIComponent(courseId));
  const [page, setPage] = useState(1);
  const posts = useResource<{
    items: { id: string; title: string; content: string; createdAt: string }[];
    total: number;
  }>(
    client,
    '/mobile/teaching-announcements?' + new URLSearchParams({ courseId, page: String(page), pageSize: '10' }),
  );
  const [title, setTitle] = useState(''),
    [content, setContent] = useState(''),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState('');
  const flight = useRef(false),
    live = useAcademicLive(client);
  useAcademicLeave(registerLeave, !!title || !!content || uncertain, busy);
  const publish = () =>
    Alert.alert('发布课程公告？', '公告将对当前课程成员公开，并向他们发送平台通知。', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认发布',
        onPress: () => {
          if (flight.current || uncertain) return;
          flight.current = true;
          setBusy(true);
          setMessage('');
          void client
            .request(
              '/mobile/teaching-announcements',
              { courseId, title: title.trim(), content: content.trim() },
              'POST',
            )
            .then(() => {
              if (live()) {
                setTitle('');
                setContent('');
                setMessage('公告已发布，课程成员将收到平台通知。');
                setPage(1);
                posts.reload();
              }
            })
            .catch((e) => {
              if (!live()) return;
              setMessage((e as Error).message);
              if (!(e instanceof MobileApiError) || e.status === 0 || e.status >= 500) setUncertain(true);
            })
            .finally(() => {
              flight.current = false;
              if (live()) setBusy(false);
            });
        },
      },
    ]);
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <AcademicQuery loading={course.loading} error={course.error} retry={course.reload} />
      <View style={a.card}>
        <Text style={a.title}>发布课程公告</Text>
        <Text style={a.body}>{course.data?.title}</Text>
        <TextInput
          accessibilityLabel="公告标题"
          style={a.input}
          maxLength={160}
          value={title}
          onChangeText={setTitle}
          editable={!busy && !uncertain}
          placeholder="公告标题"
        />
        <TextInput
          accessibilityLabel="公告正文"
          style={[a.input, a.textarea]}
          multiline
          maxLength={20000}
          value={content}
          onChangeText={setContent}
          editable={!busy && !uncertain}
          placeholder="课程安排、学习要求或教学提醒"
        />
        {!!message && <Text style={a.notice}>{message}</Text>}
        {uncertain && (
          <>
            <Text style={a.notice}>网络中断时公告可能已经发布，请先刷新下方最近公告核对，避免重复通知。</Text>
            <AButton
              title="刷新课程公告核对"
              onPress={() => {
                setPage(1);
                posts.reload();
              }}
            />
            <AButton
              title="已核对未发布，继续编辑"
              secondary
              onPress={() =>
                Alert.alert('确认公告尚未发布？', '重新发布会发送新的课程通知。', [
                  { text: '取消', style: 'cancel' },
                  { text: '确认', onPress: () => setUncertain(false) },
                ])
              }
            />
          </>
        )}
        <AButton
          title={busy ? '正在发布…' : '发布公告'}
          disabled={busy || uncertain || !title.trim() || !content.trim() || !course.data || !!course.error}
          onPress={publish}
        />
      </View>
      <View style={a.card}>
        <Text style={a.subtitle}>最近课程公告</Text>
        <AButton title="刷新公告列表" secondary onPress={posts.reload} disabled={busy} />
        <AButton title="返回课程" secondary onPress={() => openCourse(courseId)} disabled={busy} />
      </View>
      <AcademicQuery loading={posts.loading} error={posts.error} retry={posts.reload} />
      {!posts.error &&
        posts.data?.items.map((post) => (
          <View style={a.card} key={post.id}>
            <Text style={a.subtitle}>{post.title}</Text>
            <Text style={a.muted}>{new Date(post.createdAt).toLocaleString()}</Text>
            <RichText html={post.content} />
          </View>
        ))}
      <View style={a.row}>
        <AButton
          title="上一页公告"
          secondary
          disabled={page === 1 || busy}
          onPress={() => setPage((p) => p - 1)}
        />
        <AButton
          title="下一页公告"
          secondary
          disabled={!posts.data || page * 10 >= posts.data.total || busy}
          onPress={() => setPage((p) => p + 1)}
        />
      </View>
    </ScrollView>
  );
}
