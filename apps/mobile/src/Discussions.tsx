import { CommunicationAttachmentPicker, DiscussionAttachments } from './CommunicationAttachmentPicker';
import { communicationFileIds, type CommunicationFile } from './communication-files-model';
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
import { a, AButton } from './assignment-ui';
import { decodeText } from './assignment-model';
import { formatPlanTime } from './planner-model';
import { ContentReport } from './Messages';
import {
  discussionsApi,
  discussionText,
  type DiscussionDetail,
  type DiscussionPage,
  type DiscussionWrite,
  type DiscussionReceipt,
} from './discussions-model';

export function Discussions({
  client,
  courseId,
  open,
  create,
}: {
  client: MobileClient;
  courseId?: string;
  open(id: string): void;
  create(): void;
}) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [text, setText] = useState(''),
    [featured, setFeatured] = useState(false);
  const q = useResource<DiscussionPage>(
    client,
    '/mobile/discussions?' +
      new URLSearchParams({
        page: String(page),
        pageSize: '10',
        search,
        ...(courseId ? { courseId } : {}),
        ...(featured ? { featured: 'true' } : {}),
      }),
    30000,
  );
  return (
    <FlatList
      contentContainerStyle={a.page}
      keyboardShouldPersistTaps="handled"
      data={q.error ? [] : q.data?.items || []}
      keyExtractor={(r) => r.id}
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} />}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Text style={a.title}>课程讨论</Text>
          <Text style={a.muted}>与当前授权课程的师生交流。已关闭和归档讨论可阅读，不能新增回复。</Text>
          <AButton title="发布文字话题" onPress={create} />
          <TextInput
            accessibilityLabel="搜索讨论标题"
            placeholder="搜索讨论标题"
            value={text}
            onChangeText={setText}
            maxLength={100}
            style={a.input}
          />
          <View style={a.row}>
            <AButton
              title="搜索讨论"
              onPress={() => {
                setSearch(text.trim());
                setPage(1);
              }}
            />
            <AButton
              title="清除讨论搜索"
              secondary
              onPress={() => {
                setText('');
                setSearch('');
                setPage(1);
              }}
            />
            <AButton
              title={featured ? '显示全部讨论' : '仅看精华讨论'}
              secondary
              onPress={() => {
                setFeatured(!featured);
                setPage(1);
              }}
            />
            <AButton title="刷新讨论列表" secondary onPress={q.reload} />
          </View>
          {courseId && <Text style={a.notice}>仅显示当前课程讨论。</Text>}
          {q.error && (
            <Text accessibilityRole="alert" style={a.error}>
              {q.error}
            </Text>
          )}
          {q.loading && <Text style={a.muted}>正在加载讨论…</Text>}
          <Text style={a.muted}>
            共 {q.error ? '—' : (q.data?.total ?? '—')} 个话题，第 {page} 页
          </Text>
        </View>
      }
      renderItem={({ item: r, index }) => (
        <View style={a.card}>
          <Text style={a.subtitle}>{decodeText(r.title)}</Text>
          <Text style={a.notice}>
            {r.pinned ? '置顶 · ' : ''}
            {r.featured ? '精华 · ' : ''}
            {r.solved ? '已解决 · ' : ''}
            {r.closed ? '已关闭 · ' : ''}
            {r.courseTitle}
          </Text>
          <Text style={a.muted}>
            {r.authorName} · {formatPlanTime(r.createdAt)} · {r.replyCount} 条回复
          </Text>
          <AButton title={'打开第 ' + (index + 1) + ' 个话题'} onPress={() => open(r.id)} />
        </View>
      )}
      ListEmptyComponent={q.data && !q.error ? <Text style={a.muted}>当前条件下没有讨论。</Text> : null}
      ListFooterComponent={
        <View style={a.row}>
          <AButton
            title="上一页话题"
            secondary
            disabled={page === 1 || q.loading}
            onPress={() => setPage(page - 1)}
          />
          <AButton
            title="下一页话题"
            secondary
            disabled={!!q.error || q.loading || !q.data || page * 10 >= q.data.total}
            onPress={() => setPage(page + 1)}
          />
        </View>
      }
    />
  );
}

function Composer({
  client,
  courseId,
  postId,
  quoteId,
  clearQuote,
  disabled,
  registerLeave,
  done,
  lockChange,
}: {
  client: MobileClient;
  courseId?: string;
  postId?: string;
  quoteId?: string;
  clearQuote?(): void;
  disabled: boolean;
  registerLeave(g: LeaveGuard): void;
  done(r: DiscussionReceipt): void;
  lockChange?(v: boolean): void;
}) {
  const [body, setBody] = useState(''),
    [title, setTitle] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false),
    [files, setFiles] = useState<CommunicationFile[]>([]),
    [fileBusy, setFileBusy] = useState(false);
  const pending = useRef<DiscussionWrite | null>(null),
    flight = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    lockChange?.(busy || uncertain || fileBusy || files.length > 0);
  }, [busy, uncertain, fileBusy, files.length]);
  useEffect(() => {
    registerLeave(
      body || title || quoteId || busy || uncertain || fileBusy || files.length
        ? (proceed) => {
            if (flight.current || fileBusy) {
              Alert.alert('正在发布', '请等待本次请求结束后再离开。');
              return;
            }
            Alert.alert(
              '离开讨论编辑？',
              uncertain
                ? '发布结果尚未确认，重新进入后请先查看网站或讨论记录。'
                : '未发布文字只在当前页面，离开后会丢失。',
              [
                { text: '继续编辑', style: 'cancel' },
                { text: '放弃并离开', style: 'destructive', onPress: proceed },
              ],
            );
          }
        : null,
    );
    return () => registerLeave(null);
  }, [body, title, quoteId, busy, uncertain, fileBusy, files.length]);
  const accepted = (r: DiscussionReceipt) => {
    pending.current = null;
    setUncertain(false);
    setBody('');
    setTitle('');
    setFiles([]);
    clearQuote?.();
    registerLeave(null);
    done(r);
  };
  const perform = async (readOnly = false) => {
    if (flight.current || !pending.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      const p = pending.current;
      if (readOnly) {
        const r = await discussionsApi.receipt(client, p);
        if (mounted.current) {
          if (r.found) accepted(r);
          else setError('暂未查到本次发布。可重试同一次发布；重试使用原标识，不会重复创建。');
        }
      } else {
        const r = await discussionsApi.publish(client, p);
        if (mounted.current) accepted(r);
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        if (
          !readOnly &&
          e instanceof MobileApiError &&
          [400, 401, 403, 404, 409, 413, 422, 429].includes(e.status)
        ) {
          // A refused retry cannot prove that an earlier unknown request never committed.
          if (!uncertain) pending.current = null;
        } else if (!readOnly) setUncertain(true);
      }
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const confirm = () => {
    if (flight.current || fileBusy || pending.current || disabled) return;
    try {
      const value = discussionText(body),
        attachmentIds = communicationFileIds(files);
      const input: DiscussionWrite = postId
        ? {
            kind: 'reply',
            postId,
            input: {
              body: value,
              ...(quoteId ? { quoteReplyId: quoteId } : {}),
              key: randomUUID(),
              ...(attachmentIds.length ? { attachmentIds } : {}),
            },
          }
        : {
            kind: 'post',
            input: {
              title: discussionText(title, 160),
              body: value,
              courseId: courseId || '',
              key: randomUUID(),
              ...(attachmentIds.length ? { attachmentIds } : {}),
            },
          };
      if (input.kind === 'post' && !input.input.courseId) throw new Error('请先选择课程。');
      Alert.alert(
        postId ? '确认发布回复？' : '确认发布话题？',
        '发布后课程师生可见，本版 App 不支持修改或撤回。',
        [
          { text: '继续编辑', style: 'cancel' },
          {
            text: '确认发布',
            onPress: () => {
              if (!flight.current && !pending.current) {
                pending.current = input;
                void perform();
              }
            },
          },
        ],
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const locked = busy || uncertain || disabled || fileBusy;
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>{postId ? '发表回复' : '新建文字话题'}</Text>
      <Text style={a.muted}>
        正文最多10000字，可附上当前课程本人上传的文件。关联资源和管理操作请使用网站。
      </Text>
      {!postId && (
        <TextInput
          accessibilityLabel="话题标题"
          placeholder="话题标题"
          style={a.input}
          value={title}
          onChangeText={setTitle}
          maxLength={160}
          editable={!locked}
        />
      )}
      {quoteId && (
        <>
          <Text style={a.notice}>{disabled ? '引用内容暂不可访问' : '将引用选中的回复'}</Text>
          <AButton
            title="取消引用回复"
            secondary
            disabled={busy || uncertain}
            onPress={() => clearQuote?.()}
          />
        </>
      )}
      <TextInput
        accessibilityLabel={postId ? '讨论回复正文' : '话题正文'}
        placeholder={postId ? '写下你的回复' : '写下讨论内容'}
        style={[a.input, a.textarea]}
        multiline
        maxLength={10000}
        value={body}
        onChangeText={setBody}
        editable={!locked}
      />
      {courseId && (
        <CommunicationAttachmentPicker
          key={courseId}
          client={client}
          scope={{ kind: 'course', id: courseId }}
          files={files}
          onChange={setFiles}
          locked={busy || uncertain || disabled}
          onBusy={setFileBusy}
        />
      )}
      {error && (
        <Text accessibilityRole="alert" style={a.error}>
          {error}
        </Text>
      )}
      {uncertain ? (
        <>
          <Text style={a.notice}>
            发布结果不明，文字已冻结。先核对服务器回执，或重试同一次发布；不会自动重复提交。进程退出不会保存未确认的发布标识。
          </Text>
          <AButton title="核对本次发布结果" disabled={busy} onPress={() => void perform(true)} />
          <AButton title="重试同一次发布" secondary disabled={busy} onPress={() => void perform()} />
        </>
      ) : (
        <AButton
          title={postId ? '发布讨论回复' : '提交新话题'}
          disabled={locked || !body.trim() || (!postId && (!courseId || !title.trim()))}
          onPress={confirm}
        />
      )}
      {disabled && <Text style={a.muted}>当前条件不允许发布，请刷新核对课程、禁言和讨论状态。</Text>}
    </View>
  );
}

export function NewDiscussion({
  client,
  courseId,
  registerLeave,
  open,
}: {
  client: MobileClient;
  courseId?: string;
  registerLeave(g: LeaveGuard): void;
  open(id: string): void;
}) {
  const [selected, setSelected] = useState(courseId || ''),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [locked, setLocked] = useState(false);
  const q = useResource<{ items: { id: string; title: string }[]; total: number }>(
    client,
    '/courses?' + new URLSearchParams({ page: String(page), pageSize: '8', search: query }),
    30000,
  );
  return (
    <KeyboardAvoidingView style={a.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={a.page}>
        <Text style={a.title}>发布课程话题</Text>
        <Text style={a.notice}>
          {selected ? '已选择课程。选课与发言权限将在发布时再次核对。' : '请选择话题所属课程。'}
        </Text>
        {!courseId && (
          <View style={a.card}>
            <TextInput
              accessibilityLabel="搜索发帖课程"
              editable={!locked}
              value={search}
              onChangeText={setSearch}
              maxLength={100}
              style={a.input}
              placeholder="搜索课程"
            />
            <AButton
              title="搜索发帖课程"
              disabled={locked}
              secondary
              onPress={() => {
                setQuery(search.trim());
                setPage(1);
              }}
            />
            {q.error && <Text style={a.error}>{q.error}</Text>}
            {!q.error &&
              q.data?.items.map((c) => (
                <AButton
                  key={c.id}
                  title={(selected === c.id ? '已选课程：' : '选择课程：') + c.title}
                  disabled={locked}
                  secondary={selected !== c.id}
                  onPress={() => setSelected(c.id)}
                />
              ))}
            <View style={a.row}>
              <AButton
                title="上一页发帖课程"
                secondary
                disabled={locked || page === 1}
                onPress={() => setPage(page - 1)}
              />
              <AButton
                title="下一页发帖课程"
                secondary
                disabled={locked || !q.data || !!q.error || page * 8 >= q.data.total}
                onPress={() => setPage(page + 1)}
              />
            </View>
          </View>
        )}
        <Composer
          client={client}
          courseId={selected}
          disabled={!!q.error}
          registerLeave={registerLeave}
          lockChange={setLocked}
          done={(r) => open(r.postId)}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Discussion({
  client,
  id,
  registerLeave,
}: {
  client: MobileClient;
  id: string;
  registerLeave(g: LeaveGuard): void;
}) {
  const [page, setPage] = useState(1),
    [quote, setQuote] = useState<string | undefined>(),
    [notice, setNotice] = useState(''),
    [locked, setLocked] = useState(false);
  const q = useResource<DiscussionDetail>(
    client,
    '/mobile/discussions/' + encodeURIComponent(id) + '?page=' + page + '&pageSize=10',
    30000,
  );
  return (
    <KeyboardAvoidingView style={a.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={a.page}>
        <Text style={a.title}>讨论详情</Text>
        <AButton title="刷新讨论详情" secondary onPress={q.reload} />
        {q.loading && <Text style={a.muted}>正在核对讨论权限…</Text>}
        {q.error && (
          <Text accessibilityRole="alert" style={a.error}>
            {q.error}
          </Text>
        )}
        {!!notice && <Text style={a.notice}>{notice}</Text>}
        {!q.error && q.data && (
          <>
            <View style={a.card}>
              <Text style={a.subtitle}>{decodeText(q.data.title)}</Text>
              <Text style={a.muted}>
                {q.data.courseTitle} · {q.data.authorName} · {formatPlanTime(q.data.createdAt)}
              </Text>
              <Text selectable style={a.body}>
                {decodeText(q.data.body)}
              </Text>
              <ContentReport
                client={client}
                target={{ targetType: 'post', targetId: id }}
                label="举报此话题"
              />
              <DiscussionAttachments client={client} postId={id} files={q.data.attachments || []} />
              <Text style={a.notice}>
                {q.data.closed ? '讨论已关闭' : q.data.canReply ? '讨论开放，可回复' : '当前仅允许阅读'}
              </Text>
            </View>
            <Text style={a.subtitle}>
              共 {q.data.replyPage.total} 条回复，第 {page} 页
            </Text>
            {q.data.replies.map((r, i) => (
              <View key={r.id} style={a.card}>
                <Text style={a.muted}>
                  {r.authorName}
                  {r.own ? '（我）' : ''} · {formatPlanTime(r.createdAt)}
                </Text>
                {r.quote && (
                  <Text style={a.notice}>
                    引用 {r.quote.authorName}：{decodeText(r.quote.body)}
                  </Text>
                )}
                <Text selectable style={a.body}>
                  {decodeText(r.body)}
                </Text>
                <ContentReport
                  client={client}
                  target={{ targetType: 'reply', targetId: r.id }}
                  label={'举报第 ' + (i + 1) + ' 条回复'}
                />
                <DiscussionAttachments client={client} postId={id} files={r.attachments || []} />
                <AButton
                  title={'引用第 ' + (i + 1) + ' 条回复'}
                  secondary
                  disabled={locked || !q.data?.canReply}
                  onPress={() => {
                    setQuote(r.id);
                    setNotice('已选择引用回复，请在下方输入。');
                  }}
                />
              </View>
            ))}
            <View style={a.row}>
              <AButton title="上一页回复" secondary disabled={page === 1} onPress={() => setPage(page - 1)} />
              <AButton
                title="下一页回复"
                secondary
                disabled={page * 10 >= q.data.replyPage.total}
                onPress={() => setPage(page + 1)}
              />
            </View>
          </>
        )}
        <Composer
          client={client}
          postId={id}
          courseId={q.data?.courseId}
          quoteId={quote}
          clearQuote={() => setQuote(undefined)}
          disabled={!!q.error || !q.data?.canReply}
          registerLeave={registerLeave}
          lockChange={setLocked}
          done={() => {
            setNotice('回复已发布，网站和手机使用同一条记录。');
            q.reload();
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
