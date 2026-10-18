import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import { MobileApiError, type MobileClient } from './client';
import { useResource } from './resource';
import { formatPlanTime } from './planner-model';
import {
  referenceRows,
  answerMap,
  answerRows,
  answered,
  assignmentWindow,
  money,
  type Answers,
  type AssignmentDetail,
  type AssignmentFile,
  type AssignmentSummary,
  type Submitted,
} from './assignment-model';
import { a, AButton, AQuery, AnswerDisplay, AnswerInput, RichText } from './assignment-ui';
import { pickAssignmentFile, downloadAssignmentFile } from './assignment-files';
import {
  forgetSubmission,
  pendingSubmission,
  rememberSubmission,
  type PendingSubmission,
} from './submission-ledger';
export type LeaveGuard = ((proceed: () => void) => void) | null;
const base = (id: string) => '/mobile/assignments/' + encodeURIComponent(id);
function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
export function Assignments({
  client,
  courseId,
  open,
}: {
  client: MobileClient;
  courseId?: string;
  open(id: string): void;
}) {
  const [filter, setFilter] = useState({ search: '', page: 1 });
  const [search, setSearch] = useState('');
  const q = useResource<{ items: AssignmentSummary[]; total: number }>(
    client,
    '/mobile/assignments?' +
      new URLSearchParams({
        search: filter.search,
        page: String(filter.page),
        pageSize: '10',
        ...(courseId ? { courseId } : {}),
      }),
    60000,
  );
  return (
    <FlatList
      data={q.error ? [] : q.data?.items || []}
      keyExtractor={(x) => x.id}
      contentContainerStyle={a.page}
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} />}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Text style={a.title}>作业与成绩反馈</Text>
          <Text style={a.muted}>
            {courseId ? '当前课程的作业' : '当前选课及受众范围内的作业'} · 与网站同步
          </Text>
          <TextInput
            accessibilityLabel="搜索作业"
            value={search}
            onChangeText={setSearch}
            maxLength={200}
            style={a.input}
            placeholder="输入作业标题"
          />
          <AButton title="搜索作业" onPress={() => setFilter({ search, page: 1 })} />
          <AQuery q={q} />
          <Text style={a.muted}>共 {q.data?.total ?? '—'} 项作业</Text>
        </View>
      }
      renderItem={({ item: x }) => (
        <View style={a.card}>
          <Text style={a.subtitle}>{x.title}</Text>
          <Text style={a.muted}>{x.courseTitle}</Text>
          <Text style={a.body}>截止：{formatPlanTime(x.dueAt)}</Text>
          <Text style={a.muted}>
            满分 {money(x.totalCents)} 分 · {x.latest ? `已提交 ${x.latest.version} 次` : '尚未提交'}
          </Text>
          {x.latest?.status === 'returned' && (
            <Text style={a.notice}>教师已退回，请进入作业查看重交安排。</Text>
          )}
          {x.latest && (
            <Text style={a.muted}>
              {x.latest.releasedAt ? '最新发布得分：' + money(x.latest.scoreCents) : '最新提交的成绩尚未发布'}
            </Text>
          )}
          <AButton title={'打开作业：' + x.title} onPress={() => open(x.id)} />
        </View>
      )}
      ListEmptyComponent={
        q.data && !q.loading && !q.error ? <Text style={a.muted}>暂无匹配的已发布作业。</Text> : null
      }
      ListFooterComponent={
        <View style={a.row}>
          <AButton
            title="上一页作业"
            disabled={filter.page === 1}
            secondary
            onPress={() => setFilter((f) => ({ ...f, page: f.page - 1 }))}
          />
          <Text style={a.muted}>第 {filter.page} 页</Text>
          <AButton
            title="下一页作业"
            secondary
            disabled={filter.page * 10 >= (q.data?.total || 0)}
            onPress={() => setFilter((f) => ({ ...f, page: f.page + 1 }))}
          />
        </View>
      }
    />
  );
}
export function Assignment({
  client,
  id,
  registerLeave,
}: {
  client: MobileClient;
  id: string;
  registerLeave(guard: LeaveGuard): void;
}) {
  const q = useResource<AssignmentDetail>(client, base(id), 60000),
    mounted = useMounted();
  const [answers, setAnswers] = useState<Answers>({}),
    [attachments, setAttachments] = useState<string[]>([]);
  const [revision, setRevision] = useState(0),
    [submittedVersion, setSubmittedVersion] = useState(0);
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [extraFiles, setExtraFiles] = useState<AssignmentFile[]>([]),
    [history, setHistory] = useState<Submitted | null>(null);
  const [pending, setPending] = useState<PendingSubmission | null>(() => pendingSubmission(client, id));
  const [tick, setTick] = useState(Date.now());
  const initialized = useRef(false),
    running = useRef(false);
  const state = useRef({ dirty, busy, pending });
  state.current = { dirty, busy, pending };
  const receivedAt = useRef({ stamp: '', local: Date.now() });
  const d = q.data;
  if (d && receivedAt.current.stamp !== d.serverTime)
    receivedAt.current = { stamp: d.serverTime, local: Date.now() };
  const serverNow = d ? Date.parse(d.serverTime) + Math.max(0, tick - receivedAt.current.local) : tick;
  const window = d ? assignmentWindow(d, serverNow) : null;
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    const app = AppState.addEventListener('change', (value) => {
      if (value === 'active') {
        setTick(Date.now());
        q.reload();
      }
    });
    return () => {
      clearInterval(timer);
      app.remove();
    };
  }, []);
  function initialize(data: AssignmentDetail) {
    const saved = pendingSubmission(client, id);
    if (saved) {
      setPending(saved);
      setAnswers(answerMap(saved.body.answers));
      setAttachments(saved.body.attachmentIds);
      setRevision(saved.body.expectedDraftRevision);
      setSubmittedVersion(saved.body.expectedSubmissionVersion);
      setDirty(true);
    } else {
      setPending(null);
      setAnswers(answerMap(data.draft?.answers || []));
      setAttachments(data.draft?.attachmentIds || []);
      setRevision(data.draft?.revision || 0);
      setSubmittedVersion(Math.max(0, ...data.mySubmissions.map((s) => s.version)));
      setDirty(false);
    }
    setConflict(false);
    initialized.current = true;
  }
  useEffect(() => {
    if (d && !initialized.current) initialize(d);
  }, [d]);
  useEffect(() => {
    if (q.error) setHistory(null);
  }, [q.error]);
  useEffect(() => {
    registerLeave((proceed) => {
      const current = state.current;
      if (current.busy) {
        Alert.alert('正在处理作业', '请等待当前操作结束。');
        return;
      }
      if (!current.dirty && !current.pending) {
        proceed();
        return;
      }
      Alert.alert(
        '离开作业？',
        current.pending
          ? '提交结果尚未确认。返回此作业后可继续核对；未确认记录只保留在本次登录期间。'
          : '尚未保存的作答将丢失，请先保存草稿。',
        [
          { text: '继续作答', style: 'cancel' },
          { text: '离开作业', style: 'destructive', onPress: proceed },
        ],
      );
    });
    return () => registerLeave(null);
  }, [registerLeave]);
  const editable = initialized.current && !!window?.canWrite && !busy && !conflict && !pending && !q.error;
  function change(question: string, value: Answers[string]) {
    if (running.current || pending) return;
    setAnswers((old) => ({ ...old, [question]: value }));
    setDirty(true);
    setNotice('');
  }
  function showFailure(e: unknown) {
    setError((e as Error).message);
    if (e instanceof MobileApiError && e.status === 409) setConflict(true);
  }
  async function refresh() {
    if (running.current) return;
    const load = async () => {
      running.current = true;
      setBusy(true);
      setError('');
      try {
        const latest = await client.request<AssignmentDetail>(base(id));
        if (mounted.current) {
          initialize(latest);
          q.reload();
        }
      } catch (e) {
        if (mounted.current) showFailure(e);
      } finally {
        running.current = false;
        if (mounted.current) setBusy(false);
      }
    };
    if (dirty && !pending)
      Alert.alert('重新加载作业？', '将用网站上的最新草稿替换当前尚未保存的作答。', [
        { text: '保留作答', style: 'cancel' },
        { text: '加载最新草稿', onPress: () => void load() },
      ]);
    else await load();
  }
  async function save() {
    if (running.current || !editable) return;
    running.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await client.request<{ revision: number }>(
        base(id) + '/draft',
        { revision, answers: answerRows(answers), attachmentIds: attachments },
        'PUT',
      );
      if (mounted.current) {
        setRevision(saved.revision);
        setDirty(false);
        setNotice('草稿已保存，可在网站或其他设备继续作答。草稿不等于正式提交。');
        q.reload();
      }
    } catch (e) {
      if (mounted.current) {
        showFailure(e);
        if (!(e instanceof MobileApiError) || e.status === 0 || e.status >= 500) {
          setConflict(true);
          setError('草稿保存结果尚未确认，请重新加载最新草稿后再继续。');
        }
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function send(p: PendingSubmission) {
    if (running.current || !client.ownsSession(p.epoch)) return;
    running.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await client.request<Submitted>(base(id) + '/submit', p.body, 'POST');
      if (!result?.id || !Number.isInteger(result.version))
        throw new MobileApiError(502, '提交回执无效，请核对结果。');
      forgetSubmission(client, id);
      if (mounted.current) {
        setPending(null);
        setDirty(false);
        setAnswers({});
        setAttachments([]);
        setRevision(0);
        setSubmittedVersion(result.version);
        setNotice(`第 ${result.version} 次作业已正式提交。成绩以教师发布为准。`);
        q.reload();
      }
    } catch (e) {
      if (mounted.current) {
        const definite = e instanceof MobileApiError && e.status >= 400 && e.status < 500;
        if (definite) {
          forgetSubmission(client, id);
          setPending(null);
          showFailure(e);
        } else {
          setPending(p);
          setError('提交结果尚未确认，请核对回执或重试同一次提交；不会自动消耗新的提交次数。');
        }
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function confirmSubmit() {
    if (!d || !editable) return;
    const remaining = d.items.filter((x) => !answered(answers[x.questionVersionId])).length;
    Alert.alert(
      remaining ? `还有 ${remaining} 道题未作答，确认提交？` : '确认正式提交作业？',
      '正式提交会保存独立版本并计入提交次数。',
      [
        { text: '继续作答', style: 'cancel' },
        {
          text: '正式提交',
          onPress: () => {
            if (running.current) return;
            try {
              const next = rememberSubmission(client, id, {
                answers: answerRows(answers),
                attachmentIds: attachments,
                expectedDraftRevision: revision,
                expectedSubmissionVersion: submittedVersion,
                idempotencyKey: randomUUID(),
              });
              setPending(next);
              void send(next);
            } catch (e) {
              setError((e as Error).message);
            }
          },
        },
      ],
    );
  }
  async function checkReceipt() {
    if (!pending || running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      const latest = await client.request<AssignmentDetail>(base(id));
      const receipt = latest.mySubmissions.find((s) => s.idempotencyKey === pending.body.idempotencyKey);
      if (!mounted.current) return;
      if (receipt) {
        forgetSubmission(client, id);
        initialize(latest);
        setNotice(`已核对：第 ${receipt.version} 次作业提交成功。`);
        q.reload();
      } else setNotice('暂未找到本次回执，可重试同一次提交。请勿重复创建新的提交。');
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function upload() {
    if (running.current || !editable || attachments.length >= 20 || !d) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      const file = await pickAssignmentFile(client, id, d.maxUploadBytes);
      if (file && mounted.current) {
        setExtraFiles((old) => [...old, file]);
        setAttachments((old) => [...old, file.id]);
        setDirty(true);
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function download(file: AssignmentFile) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await downloadAssignmentFile(client, id, file);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const files = [...(d?.files || []), ...extraFiles];
  const file = (fileId: string) => files.find((f) => f.id === fileId);
  const downloadControl = (fileId: string) => {
    const metadata = file(fileId);
    return metadata ? (
      <AButton
        key={fileId}
        secondary
        disabled={busy}
        title={'下载附件：' + metadata.name}
        onPress={() => void download(metadata)}
      />
    ) : (
      <Text key={fileId} style={a.muted}>
        附件暂不可用，请重新加载作业。
      </Text>
    );
  };
  return (
    <KeyboardAvoidingView style={a.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={a.page}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} />}
      >
        <AQuery q={q} />
        {d && !q.error && (
          <>
            <View style={a.card}>
              <Text style={a.title}>{d.title}</Text>
              <RichText html={d.description} />
              <Text style={a.body}>开放：{formatPlanTime(d.opensAt)}</Text>
              <Text style={a.body}>原截止：{formatPlanTime(d.dueAt)}</Text>
              {window && window.effectiveDue > Date.parse(d.dueAt) && (
                <Text style={a.notice}>
                  个人补交截止：{formatPlanTime(new Date(window.effectiveDue).toISOString())}
                  。迟交仍按原截止时间判断。
                </Text>
              )}
              <Text style={a.muted}>
                满分 {money(d.totalCents)} 分 · 已提交 {window?.used} / {window?.limit} 次 ·{' '}
                {d.allowLate ? '允许迟交' : '按规定窗口提交'}
              </Text>
              {!!window?.reason && <Text style={a.notice}>{window.reason}</Text>}
              {d.attachmentIds.map(downloadControl)}
              <AButton title="刷新作业与最新草稿" secondary disabled={busy} onPress={() => void refresh()} />
            </View>
            {!!notice && (
              <Text accessibilityRole="alert" style={a.notice}>
                {notice}
              </Text>
            )}
            {!!error && (
              <Text accessibilityRole="alert" style={a.error}>
                {error}
              </Text>
            )}
            {pending && (
              <View style={a.card}>
                <Text style={a.subtitle}>核对本次提交</Text>
                <AButton title="核对提交回执" secondary disabled={busy} onPress={() => void checkReceipt()} />
                <AButton title="重试同一次提交" disabled={busy} onPress={() => void send(pending)} />
                <Text style={a.muted}>
                  未确认记录仅在当前 App 进程和登录会话中保留。重启后请先检查提交历史。
                </Text>
              </View>
            )}
            {conflict && (
              <Text style={a.notice}>当前作答已保留。请先刷新并确认网站上的最新草稿或提交版本。</Text>
            )}
            {d.items.map((item, i) => (
              <View style={a.card} key={item.questionVersionId}>
                <Text style={a.subtitle}>
                  第 {i + 1} 题 · {money(item.question.scoreCents)} 分
                </Text>
                <RichText html={item.question.stem} />
                <AnswerInput
                  question={item.question}
                  label={'第' + (i + 1) + '题'}
                  value={answers[item.questionVersionId]}
                  disabled={!editable}
                  change={(value) => change(item.questionVersionId, value)}
                />
                <AButton
                  title={'清空第' + (i + 1) + '题答案'}
                  secondary
                  disabled={!editable}
                  onPress={() => change(item.questionVersionId, null)}
                />
              </View>
            ))}
            {!!d.items.length && (
              <View style={a.card}>
                <Text style={a.subtitle}>作业附件</Text>
                <Text style={a.muted}>
                  最多 20 个，单文件上限 {Math.floor(d.maxUploadBytes / 1048576)}{' '}
                  MB；文件类型、总容量和权限由服务器检查。
                </Text>
                {attachments.map((fileId) => (
                  <View key={fileId} style={{ gap: 8 }}>
                    {downloadControl(fileId)}
                    <AButton
                      title={'从草稿移除附件：' + (file(fileId)?.name || '附件')}
                      secondary
                      disabled={!editable}
                      onPress={() => {
                        setAttachments((old) => old.filter((x) => x !== fileId));
                        setDirty(true);
                      }}
                    />
                  </View>
                ))}
                <AButton
                  title="选择并上传作业附件"
                  secondary
                  disabled={!editable || attachments.length >= 20}
                  onPress={() => void upload()}
                />
                <AButton
                  title={busy ? '正在处理作业…' : '保存作业草稿'}
                  disabled={!editable}
                  onPress={() => void save()}
                />
                <AButton title="提交作业" disabled={!editable} onPress={confirmSubmit} />
                <Text style={a.muted}>
                  {dirty ? '有尚未保存的作答。' : '草稿状态已同步。'}{' '}
                  保存草稿不会消耗提交次数，正式提交才计入。
                </Text>
                <Text style={a.muted}>下载后可选择其他应用打开或保存；导出的副本由所选应用保留。</Text>
              </View>
            )}
            <View style={a.card}>
              <Text style={a.subtitle}>我的提交与反馈</Text>
              {!d.mySubmissions.length && <Text style={a.muted}>尚无正式提交记录。</Text>}
              {d.mySubmissions.map((s) => (
                <View key={s.id} style={{ gap: 10 }}>
                  <Text style={a.body}>
                    第 {s.version} 次 · {formatPlanTime(s.submittedAt)}
                    {s.late ? ' · 迟交' : ''}
                  </Text>
                  <Text style={a.muted}>
                    {s.status === 'returned' ? '已退回重做' : '已提交'} ·{' '}
                    {s.releasedAt ? '成绩已发布：' + money(s.scoreCents) : '成绩尚未发布'}
                  </Text>
                  <AButton
                    title={'查看第' + s.version + '次提交与反馈'}
                    secondary
                    disabled={busy}
                    onPress={() => setHistory(s)}
                  />
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
      {history && d && (
        <Modal visible animationType="slide" onRequestClose={() => setHistory(null)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f6fb' }}>
            <ScrollView contentContainerStyle={a.page}>
              <Text style={a.title}>第 {history.version} 次提交与反馈</Text>
              <Text style={a.body}>
                {history.releasedAt
                  ? `已发布成绩：${money(history.scoreCents)} 分`
                  : '教师尚未发布成绩与反馈。'}
              </Text>
              {history.releasedAt && (
                <>
                  <RichText html={history.feedback || '暂无总体评语'} />
                  {history.grading.map((g) => (
                    <View key={g.revision} style={a.card}>
                      <Text style={a.subtitle}>第 {g.revision} 版评分反馈</Text>
                      <Text style={a.body}>{g.comment}</Text>
                      {g.items.map((item) => (
                        <Text style={a.muted} key={item.questionVersionId}>
                          第 {d.items.findIndex((q) => q.questionVersionId === item.questionVersionId) + 1}{' '}
                          题：{money(item.scoreCents)} 分 · {item.comment || '暂无评语'}
                        </Text>
                      ))}
                    </View>
                  ))}
                </>
              )}
              {d.items.map((item, i) => (
                <View key={item.questionVersionId} style={a.card}>
                  <Text style={a.subtitle}>第 {i + 1} 题</Text>
                  <RichText html={item.question.stem} />
                  <Text style={a.muted}>本次作答</Text>
                  <AnswerDisplay
                    value={history.answers.find((x) => x.questionVersionId === item.questionVersionId)?.value}
                  />
                  {!!history.releasedAt &&
                    referenceRows(item.question).map((reference, index) => (
                      <View key={index} style={a.child}>
                        <Text style={a.muted}>{reference.label}</Text>
                        {item.question.type === 'composite' && <RichText html={reference.stem} />}
                        <AnswerDisplay value={reference.answer} />
                        {!!reference.explanation && <RichText html={reference.explanation} />}
                      </View>
                    ))}
                </View>
              ))}
              {history.attachmentIds.map(downloadControl)}
              {window?.canWrite && !pending && (
                <AButton
                  title="使用本次答案重新作答"
                  secondary
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      '复制历史作答？',
                      '将替换当前编辑内容，不会自动保存或提交；仍需通过最新草稿版本校验。',
                      [
                        { text: '取消', style: 'cancel' },
                        {
                          text: '复制到当前作答',
                          onPress: () => {
                            setAnswers(answerMap(history.answers));
                            setAttachments(history.attachmentIds);
                            setDirty(true);
                            setHistory(null);
                          },
                        },
                      ],
                    )
                  }
                />
              )}
              <AButton title="关闭提交反馈" secondary onPress={() => setHistory(null)} />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}
