import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { MobileApiError, type MobileClient } from './client';
import type { LeaveGuard } from './Assignments';
import { a, AButton } from './assignment-ui';
import {
  algorithmLearningApi as api,
  learningText,
  type ForumPage,
  type ForumPost,
  type ForumReply,
  type ForumStatus,
} from './algorithm-learning-model';
const kinds = { question: '提问', solution: '题解', discussion: '讨论' };
export function AlgorithmForum({
  client,
  problemId,
  registerLeave,
}: {
  client: MobileClient;
  problemId?: string;
  registerLeave(guard: LeaveGuard): void;
}) {
  const [status, setStatus] = useState<ForumStatus | null>(null),
    [scope, setScope] = useState<ForumPost['scope']>('public'),
    [list, setList] = useState<ForumPage<ForumPost> | null>(null),
    [selected, setSelected] = useState<ForumPost | null>(null),
    [replies, setReplies] = useState<ForumPage<ForumReply> | null>(null);
  const [kind, setKind] = useState<ForumPost['kind']>('question'),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [reply, setReply] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [checked, setChecked] = useState(false);
  const mounted = useRef(true),
    epoch = useRef(client.sessionEpoch()),
    flight = useRef(false),
    listSequence = useRef(0),
    selection = useRef(0);
  const alive = () => mounted.current && client.ownsSession(epoch.current);
  const load = async (page = 1) => {
    const sequence = ++listSequence.current;
    try {
      const [availability, posts] = await Promise.all([
        api.forumStatus(client),
        api.posts(client, scope, problemId, page),
      ]);
      if (alive() && sequence === listSequence.current) {
        setStatus(availability);
        setList(posts);
        setChecked(true);
      }
    } catch (e) {
      if (alive() && sequence === listSequence.current) {
        setMessage((e as Error).message);
        setList(null);
        setChecked(false);
      }
    }
  };
  useEffect(() => {
    mounted.current = true;
    const off = client.onSessionInvalidated(() => {
      mounted.current = false;
      setList(null);
      setSelected(null);
      setReplies(null);
      setTitle('');
      setBody('');
      setReply('');
    });
    return () => {
      mounted.current = false;
      off();
    };
  }, [client]);
  useEffect(() => {
    selection.current++;
    setSelected(null);
    setReplies(null);
    setList(null);
    setMessage('');
    void load();
  }, [client, scope, problemId]);
  useEffect(() => {
    registerLeave(
      title || body || reply || busy || unknown
        ? (proceed) => {
            if (flight.current) {
              Alert.alert('正在发布', '请等待请求结束。');
              return;
            }
            Alert.alert(
              '离开算法论坛？',
              unknown
                ? '发布结果尚未确认，请先核对讨论列表和回复。'
                : '未发布的内容只留在当前页面，离开会丢失。',
              [
                { text: '继续编辑', style: 'cancel' },
                { text: '放弃并离开', style: 'destructive', onPress: proceed },
              ],
            );
          }
        : null,
    );
    return () => registerLeave(null);
  }, [title, body, reply, busy, unknown, registerLeave]);
  const inspect = async (id: string, page = 1) => {
    const sequence = ++selection.current;
    setMessage('');
    try {
      const [post, next] = await Promise.all([api.post(client, id), api.replies(client, id, page)]);
      if (alive() && sequence === selection.current) {
        setSelected(post);
        setReplies(next);
        setChecked(true);
      }
    } catch (e) {
      if (alive() && sequence === selection.current) {
        setSelected(null);
        setReplies(null);
        setMessage((e as Error).message);
        setChecked(false);
      }
    }
  };
  const choose = (id: string) => {
    if (busy) return;
    if (reply)
      Alert.alert('切换讨论？', '未发布的回复会被清空。', [
        { text: '继续回复', style: 'cancel' },
        {
          text: '放弃并切换',
          style: 'destructive',
          onPress: () => {
            setReply('');
            void inspect(id);
          },
        },
      ]);
    else void inspect(id);
  };
  const publish = async (isReply: boolean) => {
    if (flight.current || unknown || !status?.canWrite || (isReply && !selected)) return;
    try {
      if (isReply) learningText(reply, 15000, '回复');
      else {
        learningText(title, 160, '标题');
        learningText(body, 15000, '正文');
      }
    } catch (e) {
      setMessage((e as Error).message);
      return;
    }
    flight.current = true;
    setBusy(true);
    setMessage('');
    setChecked(false);
    const target = selected;
    try {
      if (isReply && target) {
        await api.reply(client, target, reply);
        if (alive()) {
          setReply('');
          await inspect(target.id);
        }
      } else {
        const post = await api.createPost(client, {
          scope,
          kind,
          title,
          body,
          ...(problemId ? { problemId } : {}),
        });
        if (alive()) {
          setTitle('');
          setBody('');
          await inspect(post.id);
        }
      }
      if (alive()) {
        setMessage(isReply ? '回复已发布' : '讨论已发布');
        await load();
      }
    } catch (e) {
      if (alive()) {
        setMessage((e as Error).message);
        if (!(e instanceof MobileApiError && [400, 401, 403, 404, 409, 413, 422, 429].includes(e.status))) {
          setUnknown(true);
          setMessage('发布结果尚未确认。请刷新讨论和回复核对，不会自动重发。');
        } else if (e instanceof MobileApiError && e.status === 409 && target) {
          await inspect(target.id);
          setMessage('讨论已更新，输入已保留。请核对最新内容后重新确认发布。');
        }
      }
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  const visibility =
    scope === 'public' ? '公共社区，其他机构和个人学习者可见' : '当前机构讨论区，机构成员可见';
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={a.page}>
      <Text style={a.title}>算法论坛</Text>
      <Text style={a.muted}>
        {problemId ? '当前题目的交流与提问。' : '算法学习交流与提问。'}
        讨论使用社区别名，不自动附带私人代码、草稿或运行记录。
      </Text>
      <View style={a.row}>
        <AButton
          title="公共算法社区"
          secondary={scope !== 'public'}
          disabled={busy || !!reply}
          onPress={() => setScope('public')}
        />
        {status?.canOrganization && (
          <AButton
            title="机构算法讨论"
            secondary={scope !== 'organization'}
            disabled={busy || !!reply}
            onPress={() => setScope('organization')}
          />
        )}
      </View>
      <Text style={a.notice}>当前范围：{visibility}</Text>
      {message ? (
        <Text accessibilityLiveRegion="polite" style={a.notice}>
          {message}
        </Text>
      ) : null}
      <AButton title="刷新算法讨论" secondary disabled={busy} onPress={() => void load()} />
      {list && (
        <>
          <Text style={a.muted}>
            共 {list.total} 篇，第 {list.page} 页
          </Text>
          {list.items.map((post) => (
            <View key={post.id} style={a.card}>
              <Text style={a.subtitle}>{post.title}</Text>
              <Text style={a.muted}>
                {kinds[post.kind]} · {post.authorLabel}
                {post.isOwn ? ' · 本人' : ''} · {post.replyCount} 条回复{post.closed ? ' · 已关闭' : ''}
              </Text>
              <Text selectable style={a.body}>
                {post.excerpt}
              </Text>
              <AButton
                title={'打开讨论 ' + post.title}
                secondary
                disabled={busy}
                onPress={() => choose(post.id)}
              />
            </View>
          ))}
          <View style={a.row}>
            <AButton
              title="上一页讨论"
              secondary
              disabled={busy || list.page <= 1}
              onPress={() => void load(list.page - 1)}
            />
            <AButton
              title="下一页讨论"
              secondary
              disabled={busy || list.page * list.pageSize >= list.total}
              onPress={() => void load(list.page + 1)}
            />
          </View>
        </>
      )}
      {selected && (
        <View style={a.card}>
          <Text style={a.subtitle}>{selected.title}</Text>
          <Text style={a.muted}>
            {selected.authorLabel} · {selected.scope === 'public' ? '公共讨论' : '机构讨论'} ·{' '}
            {new Date(selected.createdAt).toLocaleString()}
          </Text>
          <Text selectable style={a.body}>
            {selected.body}
          </Text>
          <AButton
            title="刷新当前讨论与回复"
            secondary
            disabled={busy}
            onPress={() => void inspect(selected.id)}
          />
          {replies?.items.map((item) => (
            <View key={item.id} style={a.child}>
              <Text style={a.muted}>
                {item.authorLabel}
                {item.isOwn ? ' · 本人' : ''} · {new Date(item.createdAt).toLocaleString()}
              </Text>
              <Text selectable style={a.body}>
                {item.body}
              </Text>
            </View>
          ))}
          {replies && (
            <View style={a.row}>
              <AButton
                title="上一页回复"
                secondary
                disabled={busy || replies.page <= 1}
                onPress={() => void inspect(selected.id, replies.page - 1)}
              />
              <AButton
                title="下一页回复"
                secondary
                disabled={busy || replies.page * replies.pageSize >= replies.total}
                onPress={() => void inspect(selected.id, replies.page + 1)}
              />
            </View>
          )}
          <TextInput
            accessibilityLabel="算法讨论回复"
            value={reply}
            onChangeText={setReply}
            multiline
            maxLength={15000}
            editable={!busy && !selected.closed}
            style={[a.input, a.textarea]}
            placeholder="描述思路或补充问题"
          />
          <AButton
            title="发布算法回复"
            disabled={busy || unknown || selected.closed || !status?.canWrite}
            onPress={() =>
              Alert.alert(
                '发布回复？',
                selected.scope === 'public' ? '回复将公开展示给社区学习者。' : '回复将展示给本机构成员。',
                [
                  { text: '取消', style: 'cancel' },
                  { text: '确认发布回复', onPress: () => void publish(true) },
                ],
              )
            }
          />
        </View>
      )}
      <View style={a.card}>
        <Text style={a.subtitle}>发表算法讨论</Text>
        <Text style={a.muted}>发布范围：{visibility}。请自行检查粘贴内容，勿包含不想公开的个人信息。</Text>
        <View style={a.row}>
          {(['question', 'solution', 'discussion'] as const).map((value) => (
            <AButton
              key={value}
              title={kinds[value]}
              secondary={kind !== value}
              disabled={busy}
              onPress={() => setKind(value)}
            />
          ))}
        </View>
        <TextInput
          accessibilityLabel="算法讨论标题"
          value={title}
          onChangeText={setTitle}
          maxLength={160}
          editable={!busy}
          style={a.input}
          placeholder="清楚描述你想讨论的问题"
        />
        <TextInput
          accessibilityLabel="算法讨论正文"
          value={body}
          onChangeText={setBody}
          maxLength={15000}
          editable={!busy}
          multiline
          style={[a.input, a.textarea]}
          placeholder="说明思路、尝试和疑问"
        />
        <AButton
          title="发布算法讨论"
          disabled={busy || unknown || !status?.canWrite}
          onPress={() =>
            Alert.alert('发布讨论？', visibility + '。正文将按你的输入发布。', [
              { text: '取消', style: 'cancel' },
              { text: '确认发布讨论', onPress: () => void publish(false) },
            ])
          }
        />
      </View>
      {unknown && (
        <AButton
          title="已核对发布记录，继续编辑"
          disabled={busy || !checked}
          secondary
          onPress={() =>
            Alert.alert('已检查讨论和回复？', '已有内容请勿重复发布。解除保护不会自动发送。', [
              { text: '返回核对', style: 'cancel' },
              {
                text: '已确认，继续编辑',
                onPress: () => {
                  setUnknown(false);
                  setChecked(false);
                },
              },
            ])
          }
        />
      )}
    </ScrollView>
  );
}
