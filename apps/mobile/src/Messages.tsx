import { CommunicationAttachmentPicker } from './CommunicationAttachmentPicker';
import { communicationFileIds, type CommunicationFile } from './communication-files-model';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { MobileClient, MobileUser } from './client';
import type { LeaveGuard } from './Assignments';
import { useResource } from './resource';
import { a, AButton } from './assignment-ui';
import { decodeText } from './assignment-model';
import { formatPlanTime } from './planner-model';
import {
  messageRoot,
  messagesApi,
  prepareMessage,
  messageDefinitelyRefused,
  type Conversation,
  type MessageAttempt,
  type MessagePage,
  type ReportTarget,
} from './messages-model';
import { openMessageFile } from './message-files';

function useLive(client: MobileClient) {
  const mounted = useRef(true),
    epoch = useRef(client.sessionEpoch());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return () => mounted.current && client.ownsSession(epoch.current);
}
export function ContentReport({
  client,
  target,
  label = '举报此内容',
}: {
  client: MobileClient;
  target: ReportTarget;
  label?: string;
}) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const live = useLive(client),
    flight = useRef(false);
  const send = async () => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setNotice('');
    try {
      await messagesApi.report(client, target, reason);
      if (live()) {
        setOpen(false);
        setReason('');
        setNotice('举报已提交，授权管理人员将处理。');
      }
    } catch (e) {
      if (live()) setNotice((e as Error).message);
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <AButton title={label} secondary disabled={busy} onPress={() => setOpen(!open)} />
      {open && (
        <>
          <TextInput
            accessibilityLabel="举报原因"
            style={[a.input, a.textarea]}
            value={reason}
            onChangeText={setReason}
            maxLength={1000}
            multiline
            editable={!busy}
            placeholder="说明原因（3–1000字）"
          />
          <AButton
            title="提交举报"
            disabled={busy || reason.trim().length < 3}
            onPress={() =>
              Alert.alert('提交举报？', '举报会记录当前内容与原因，请如实描述。', [
                { text: '取消', style: 'cancel' },
                { text: '确认举报', onPress: () => void send() },
              ])
            }
          />
        </>
      )}
      {!!notice && <Text style={a.notice}>{notice}</Text>}
    </View>
  );
}
export function Messages({ client, open }: { client: MobileClient; open(id: string, title: string): void }) {
  const [tab, setTab] = useState<'conversations' | 'contacts' | 'classes'>('conversations');
  return (
    <View style={a.flex}>
      <View style={[a.row, { padding: 16 }]}>
        {(['conversations', 'contacts', 'classes'] as const).map((kind, i) => (
          <AButton
            key={kind}
            title={['我的会话', '课程联系人', '班级交流'][i]}
            secondary={tab !== kind}
            onPress={() => setTab(kind)}
          />
        ))}
      </View>
      <MessageDirectory key={tab} client={client} kind={tab} open={open} />
    </View>
  );
}
function MessageDirectory({
  client,
  kind,
  open,
}: {
  client: MobileClient;
  kind: 'conversations' | 'contacts' | 'classes';
  open(id: string, title: string): void;
}) {
  const [page, setPage] = useState(1),
    [text, setText] = useState(''),
    [search, setSearch] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const flight = useRef(false),
    live = useLive(client);
  type Row = Conversation & { name?: string; grade?: string; role?: string; courseNames?: string[] };
  const q = useResource<{ items: Row[]; total?: number }>(
    client,
    messageRoot +
      '/' +
      kind +
      (kind === 'classes'
        ? ''
        : '?' +
          new URLSearchParams({
            page: String(page),
            pageSize: '20',
            ...(kind === 'contacts' ? { q: search } : {}),
          })),
    30000,
  );
  const enter = async (item: Row) => {
    if (flight.current) return;
    if (kind === 'conversations') {
      open(item.id, item.title);
      return;
    }
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      const c = await (kind === 'contacts'
        ? messagesApi.direct(client, item.id)
        : messagesApi.classroom(client, item.id));
      if (live()) open(c.id, c.title);
    } catch (e) {
      if (live()) setError((e as Error).message);
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <Text style={a.title}>师生交流</Text>
      <Text style={a.muted}>联系人依据当前课程关系。进入或刷新会话不会自动标记已读。</Text>
      {kind === 'contacts' && (
        <View style={a.card}>
          <TextInput
            accessibilityLabel="搜索联系人"
            style={a.input}
            value={text}
            onChangeText={setText}
            maxLength={80}
            placeholder="联系人姓名"
          />
          <AButton
            title="搜索联系人"
            onPress={() => {
              setSearch(text.trim());
              setPage(1);
            }}
          />
        </View>
      )}
      <AButton title="刷新交流列表" secondary onPress={q.reload} />
      {q.loading && <Text style={a.muted}>正在核对交流权限…</Text>}
      {(q.error || error) && (
        <Text accessibilityRole="alert" style={a.error}>
          {q.error || error}
        </Text>
      )}
      {!q.error &&
        q.data?.items.map((item) => (
          <View key={item.id} style={a.card}>
            <Text style={a.subtitle}>{item.name || item.title}</Text>
            {item.courseNames && (
              <Text style={a.muted}>
                {item.role === 'TEACHER' ? '教师' : '学生'} · {item.courseNames.join('、')}
              </Text>
            )}
            {item.grade && <Text style={a.muted}>{item.grade}</Text>}
            {item.lastMessage && (
              <Text style={a.body} numberOfLines={3}>
                {decodeText(item.lastMessage.body)}
              </Text>
            )}
            {item.unreadCount !== undefined && <Text style={a.notice}>{item.unreadCount} 条未读</Text>}
            <AButton
              title={'进入会话：' + (item.name || item.title)}
              disabled={busy}
              onPress={() => void enter(item)}
            />
          </View>
        ))}
      {!q.error && q.data?.items.length === 0 && (
        <Text style={a.muted}>
          当前没有可访问的{kind === 'contacts' ? '师生联系人' : kind === 'classes' ? '班级' : '会话'}。
        </Text>
      )}
      {kind !== 'classes' && (
        <View style={a.row}>
          <AButton
            title="上一页交流"
            secondary
            disabled={page === 1 || q.loading || busy}
            onPress={() => setPage(page - 1)}
          />
          <Text style={a.muted}>
            第 {page} 页 · 共 {q.data?.total ?? '—'} 条
          </Text>
          <AButton
            title="下一页交流"
            secondary
            disabled={q.loading || busy || !!q.error || !q.data || page * 20 >= (q.data.total || 0)}
            onPress={() => setPage(page + 1)}
          />
        </View>
      )}
    </ScrollView>
  );
}
export function MessageConversation({
  client,
  user,
  id,
  title,
  registerLeave,
}: {
  client: MobileClient;
  user: MobileUser;
  id: string;
  title?: string;
  registerLeave(g: LeaveGuard): void;
}) {
  const [page, setPage] = useState(1),
    [body, setBody] = useState(''),
    [files, setFiles] = useState<CommunicationFile[]>([]),
    [fileBusy, setFileBusy] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const pending = useRef<MessageAttempt | null>(null),
    flight = useRef(false),
    live = useLive(client);
  const q = useResource<MessagePage>(
    client,
    messageRoot + '/conversations/' + encodeURIComponent(id) + '/messages?page=' + page + '&pageSize=20',
    15000,
  );
  useEffect(() => {
    registerLeave(
      busy || fileBusy
        ? () => Alert.alert('正在处理', '请等待本次操作结束。')
        : body || uncertain || files.length
          ? (proceed) =>
              Alert.alert(
                '离开会话？',
                uncertain
                  ? '发送结果尚未确认，请稍后先核对会话，避免重复编辑发送。未确认编号不会保留到下一次进入。'
                  : '未发送的文字只在当前页面，离开后会丢失。',
                [
                  { text: '继续编辑', style: 'cancel' },
                  { text: '离开', style: 'destructive', onPress: proceed },
                ],
              )
          : null,
    );
    return () => registerLeave(null);
  }, [body, busy, uncertain, fileBusy, files.length, registerLeave]);
  const send = async () => {
    if (flight.current || fileBusy || q.error) return;
    try {
      pending.current ||= prepareMessage(id, body, randomUUID(), communicationFileIds(files));
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const attempt = pending.current,
        receipt = await messagesApi.send(client, attempt);
      if (receipt.clientId !== attempt.clientId || receipt.conversationId !== id)
        throw new Error('消息回执不一致，请核对会话后重试同一次发送。');
      if (live()) {
        pending.current = null;
        setUncertain(false);
        setBody('');
        setFiles([]);
        setPage(1);
        setNotice('消息已发送。');
        q.reload();
      }
    } catch (e) {
      if (live()) {
        setError((e as Error).message);
        if (!uncertain && messageDefinitelyRefused(e)) pending.current = null;
        else setUncertain(true);
      }
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  const action = async (perform: () => Promise<unknown>, success: string) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      await perform();
      if (live()) {
        setNotice(success);
        q.reload();
      }
    } catch (e) {
      if (live()) setError((e as Error).message);
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  const latest = q.data?.items.at(-1);
  return (
    <KeyboardAvoidingView style={a.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
        <Text style={a.title}>{title || '师生会话'}</Text>
        <Text style={a.muted}>按时间从早到晚显示本页。纯文字消息最多10000字，附件仅在你主动打开时下载。</Text>
        <View style={a.row}>
          <AButton title="刷新消息" secondary disabled={busy} onPress={q.reload} />
          <AButton
            title="标记本页及之前消息已读"
            disabled={busy || !!q.error || !latest}
            onPress={() =>
              latest && void action(() => messagesApi.read(client, id, latest.id), '已更新已读位置。')
            }
          />
        </View>
        {q.loading && <Text style={a.muted}>正在加载消息…</Text>}
        {(q.error || error) && (
          <Text accessibilityRole="alert" style={a.error}>
            {q.error || error}
          </Text>
        )}
        {!!notice && <Text style={a.notice}>{notice}</Text>}
        {!q.error &&
          q.data?.items.map((m, index) => (
            <View key={m.id} style={a.card}>
              <Text style={a.muted}>
                {m.senderName || '用户'}
                {m.senderId === user.id ? '（我）' : ''} · {formatPlanTime(m.createdAt)}
              </Text>
              <Text selectable style={a.body}>
                {decodeText(m.body)}
              </Text>
              {m.attachments.map((file) => (
                <View key={file.id}>
                  <Text style={a.muted}>
                    {file.name} · {(file.size / 1024).toFixed(1)} KiB
                  </Text>
                  <AButton
                    title={'打开附件：' + file.name}
                    secondary
                    disabled={busy}
                    onPress={() =>
                      Alert.alert(
                        '打开消息附件？',
                        '仅下载此私有附件。选择外部应用后，该应用可能保存副本。',
                        [
                          { text: '取消', style: 'cancel' },
                          {
                            text: '打开或保存',
                            onPress: () =>
                              void action(() => openMessageFile(client, id, file), '已打开系统文件选择器。'),
                          },
                        ],
                      )
                    }
                  />
                </View>
              ))}
              {m.senderId === user.id && !m.retractedAt && (
                <AButton
                  title={'撤回第 ' + (index + 1) + ' 条消息'}
                  secondary
                  disabled={busy}
                  onPress={() =>
                    Alert.alert('撤回这条消息？', '仅支持发送后两分钟内撤回本人消息，服务器将再次核验。', [
                      { text: '取消', style: 'cancel' },
                      {
                        text: '撤回',
                        style: 'destructive',
                        onPress: () => void action(() => messagesApi.retract(client, m.id), '消息已撤回。'),
                      },
                    ])
                  }
                />
              )}
              <ContentReport
                client={client}
                target={{ targetType: 'message', targetId: m.id }}
                label={'举报第 ' + (index + 1) + ' 条消息'}
              />
            </View>
          ))}
        {!q.error && q.data?.items.length === 0 && <Text style={a.muted}>当前没有消息。</Text>}
        <View style={a.row}>
          <AButton
            title="较新的消息"
            secondary
            disabled={busy || page === 1}
            onPress={() => setPage(page - 1)}
          />
          <Text style={a.muted}>第 {page} 页</Text>
          <AButton
            title="更早的消息"
            secondary
            disabled={busy || !!q.error || !q.data?.hasMore}
            onPress={() => setPage(page + 1)}
          />
        </View>
        <View style={a.card}>
          <TextInput
            accessibilityLabel="消息正文"
            placeholder="写下消息"
            style={[a.input, a.textarea]}
            value={body}
            onChangeText={setBody}
            editable={!busy && !uncertain}
            multiline
            maxLength={10000}
          />
          <CommunicationAttachmentPicker
            client={client}
            scope={{ kind: 'conversation', id }}
            files={files}
            onChange={setFiles}
            locked={busy || uncertain || !!q.error}
            onBusy={setFileBusy}
          />
          {uncertain && (
            <Text style={a.notice}>发送结果暂不确定，正文已冻结。重试会保留原消息编号，不会重复创建。</Text>
          )}
          <AButton
            title={uncertain ? '重试同一次发送' : '发送消息'}
            disabled={busy || fileBusy || !!q.error || !q.data || !body.trim()}
            onPress={() => void send()}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
