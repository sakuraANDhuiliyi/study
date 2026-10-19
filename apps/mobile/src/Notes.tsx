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
import { MobileApiError, type MobileClient } from './client';
import type { LeaveGuard } from './Assignments';
import { useResource } from './resource';
import { a, AButton } from './assignment-ui';
import { formatPlanTime } from './planner-model';
import {
  notesApi,
  noteBody,
  sameNote,
  reconcileNote,
  definitiveNoteFailure,
  type NoteDetail,
  type NotesList,
  type PendingNote,
} from './notes-model';
export function Notes({
  client,
  courseId,
  open,
}: {
  client: MobileClient;
  courseId?: string;
  open(id: string): void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState({ page: 1, search: '', pinned: false });
  const q = useResource<NotesList>(
    client,
    '/mobile/notes?' +
      new URLSearchParams({
        page: String(filter.page),
        pageSize: '10',
        search: filter.search,
        ...(courseId ? { courseId } : {}),
        ...(filter.pinned ? { pinned: 'true' } : {}),
      }),
    30000,
  );
  return (
    <FlatList
      contentContainerStyle={a.page}
      data={q.error ? [] : q.data?.items || []}
      keyExtractor={(n) => n.id}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={q.reload} />}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Text style={a.title}>我的私人学习笔记</Text>
          <Text style={a.muted}>
            从课程课时创建笔记，仅你本人可见。网页和手机同步，未保存内容只留在当前页面。
          </Text>
          <TextInput
            accessibilityLabel="搜索笔记"
            style={a.input}
            value={search}
            onChangeText={setSearch}
            maxLength={120}
            placeholder="搜索正文、课程或课时"
            autoCorrect={false}
          />
          <AButton
            title="搜索学习笔记"
            onPress={() => setFilter((f) => ({ ...f, page: 1, search: search.trim() }))}
          />
          <View style={a.row}>
            <AButton
              title="全部笔记"
              secondary={filter.pinned}
              onPress={() => setFilter((f) => ({ ...f, page: 1, pinned: false }))}
            />
            <AButton
              title="仅置顶笔记"
              secondary={!filter.pinned}
              onPress={() => setFilter((f) => ({ ...f, page: 1, pinned: true }))}
            />
          </View>
          <AButton title="刷新笔记列表" secondary onPress={q.reload} />
          {q.loading && <Text style={a.muted}>正在读取笔记…</Text>}
          {q.error && (
            <Text accessibilityRole="alert" style={a.error}>
              {q.error}
            </Text>
          )}
          <Text style={a.muted}>共 {q.error ? '—' : (q.data?.total ?? '—')} 条笔记</Text>
        </View>
      }
      renderItem={({ item: n }) => (
        <View style={a.card}>
          <Text style={a.subtitle}>{n.lessonTitle}</Text>
          <Text style={a.muted}>
            {n.courseTitle} · {n.pinned ? '已置顶' : '普通笔记'}
          </Text>
          <Text selectable style={a.body}>
            {n.preview}
          </Text>
          <Text style={a.muted}>更新：{formatPlanTime(n.updatedAt)}</Text>
          <AButton title={'编辑笔记：' + n.lessonTitle} onPress={() => open(n.lessonId)} />
        </View>
      )}
      ListEmptyComponent={
        q.data && !q.error ? (
          <Text style={a.muted}>当前没有匹配的笔记，请从课程课时记录学习收获。</Text>
        ) : null
      }
      ListFooterComponent={
        <View style={a.row}>
          <AButton
            title="上一页笔记"
            secondary
            disabled={filter.page === 1}
            onPress={() => setFilter((f) => ({ ...f, page: f.page - 1 }))}
          />
          <Text style={a.muted}>第 {filter.page} 页笔记</Text>
          <AButton
            title="下一页笔记"
            secondary
            disabled={!q.data || !!q.error || filter.page * 10 >= q.data.total}
            onPress={() => setFilter((f) => ({ ...f, page: f.page + 1 }))}
          />
        </View>
      }
    />
  );
}
export function NoteEditor({
  client,
  id,
  registerLeave,
}: {
  client: MobileClient;
  id: string;
  registerLeave(g: LeaveGuard): void;
}) {
  const q = useResource<NoteDetail>(client, '/mobile/lessons/' + encodeURIComponent(id) + '/note', 30000);
  const [snapshot, setSnapshot] = useState<NoteDetail | null>(null),
    [body, setBody] = useState(''),
    [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [accessDenied, setAccessDenied] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const flight = useRef(false),
    mounted = useRef(true),
    pending = useRef<PendingNote | null>(null);
  const accept = (d: NoteDetail, message = '') => {
    setSnapshot(d);
    setLatest(null);
    setBody(d.note?.body || '');
    setPinned(d.note?.pinned || false);
    setBlocked(false);
    setAccessDenied(false);
    setUncertain(false);
    pending.current = null;
    setError('');
    setNotice(message);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (q.data && !snapshot) accept(q.data);
  }, [q.data]);
  const dirty =
    !!snapshot && (body !== (snapshot.note?.body || '') || pinned !== (snapshot.note?.pinned || false));
  useEffect(() => {
    registerLeave(
      dirty || busy || uncertain
        ? (proceed) => {
            if (flight.current) {
              Alert.alert('正在处理笔记', '请等待请求结束后再离开。');
              return;
            }
            Alert.alert(
              '离开私人笔记？',
              uncertain
                ? '操作结果尚未确认，重新进入后请先核对服务器上的笔记。'
                : '未保存内容只留在当前页面，离开后会丢失。',
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
  const perform = async (run: () => Promise<void>) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await run();
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        if (e instanceof MobileApiError && [401, 403, 404].includes(e.status)) setAccessDenied(true);
        if (pending.current && !definitiveNoteFailure(e)) setUncertain(true);
        else {
          pending.current = null;
          setBlocked(true);
        }
      }
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const save = () => {
    let text: string;
    try {
      text = noteBody(body);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    void perform(async () => {
      if (!snapshot) return;
      pending.current = { kind: 'save', base: snapshot.note, body: text, pinned };
      const d = await notesApi.save(client, id, text, pinned, snapshot.note);
      if (mounted.current) accept(d, '私人笔记已保存');
    });
  };
  const remove = () =>
    Alert.alert('删除这条私人笔记？', '删除后无法恢复，只删除你本人的笔记。', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认删除笔记',
        style: 'destructive',
        onPress: () =>
          void perform(async () => {
            if (!snapshot?.note) return;
            pending.current = { kind: 'delete', base: snapshot.note };
            await notesApi.remove(client, id, snapshot.note);
            if (mounted.current) accept({ ...snapshot, note: null }, '私人笔记已删除');
          }),
      },
    ]);
  const check = () =>
    void perform(async () => {
      const d = await notesApi.read(client, id);
      if (!mounted.current) return;
      if (pending.current) {
        const outcome = reconcileNote(pending.current, d.note);
        if (outcome === 'applied') {
          accept(d, '已核对服务器，操作结果已确认');
          return;
        }
        if (outcome === 'unchanged') {
          setSnapshot(d);
          setBlocked(false);
          setUncertain(false);
          pending.current = null;
          setNotice('服务器仍为原版本，当前输入已保留，可再次保存。');
          return;
        }
      }
      pending.current = null;
      setUncertain(false);
      if (snapshot && !sameNote(snapshot.note, d.note)) setBlocked(true);
      setNotice('已读取服务器最新内容，当前输入仍保留。需要替换时请选择载入最新笔记。');
      setLatest(d);
    });
  const [latest, setLatest] = useState<NoteDetail | null>(null);
  const load = () => {
    const run = () =>
      void perform(async () => {
        const d = await notesApi.read(client, id);
        if (mounted.current) {
          accept(d, '已载入服务器最新笔记');
          setLatest(null);
          q.reload();
        }
      });
    if (dirty || uncertain)
      Alert.alert('用最新笔记替换当前输入？', '当前未保存内容会被替换，可以先复制保留。', [
        { text: '保留输入', style: 'cancel' },
        { text: '确认载入最新', onPress: run },
      ]);
    else run();
  };
  const disabled = busy || blocked || uncertain || !!q.error;
  return (
    <KeyboardAvoidingView style={a.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={a.page}>
        <Text style={a.title}>私人课时笔记</Text>
        <Text style={a.muted}>仅你本人可见，与网站共用同一份笔记。支持纯文本，最多 10000 个字符。</Text>
        {q.loading && <Text style={a.muted}>正在读取笔记…</Text>}
        {!!(q.error || error) && (
          <Text accessibilityRole="alert" style={a.error}>
            {q.error || error}
          </Text>
        )}
        {uncertain && <Text style={a.error}>操作结果尚未确认，请先核对服务器笔记，避免重复操作。</Text>}
        {notice && <Text style={a.notice}>{notice}</Text>}
        {snapshot && !q.error && !accessDenied && (
          <View style={a.card}>
            <Text style={a.subtitle}>{snapshot.lesson.title}</Text>
            <Text style={a.muted}>{snapshot.course.title}</Text>
            <Text style={a.body}>笔记内容</Text>
            <TextInput
              accessibilityLabel="私人笔记内容"
              style={[a.input, a.textarea, { minHeight: 180 }]}
              value={body}
              onChangeText={setBody}
              multiline
              maxLength={10000}
              editable={!disabled}
              autoCorrect={false}
            />
            <Text style={a.muted}>{body.length} / 10000 字符</Text>
            <AButton
              title={pinned ? '取消置顶此笔记' : '置顶此笔记'}
              secondary
              disabled={disabled}
              onPress={() => setPinned((v) => !v)}
            />
            <Text style={a.notice}>
              {dirty
                ? '笔记有未保存修改'
                : snapshot.note
                  ? '笔记已保存 · 版本 ' + snapshot.note.revision
                  : '尚未创建笔记'}
            </Text>
            <AButton title="保存私人笔记" disabled={disabled || !dirty || !body.trim()} onPress={save} />
            {snapshot.note && <AButton title="删除私人笔记" secondary disabled={disabled} onPress={remove} />}
          </View>
        )}
        <AButton title="核对服务器笔记" secondary disabled={busy} onPress={check} />
        {latest && !q.error && !accessDenied && (
          <View style={a.card}>
            <Text style={a.subtitle}>服务器最新笔记</Text>
            <Text selectable style={a.body}>
              {latest.note?.body || '服务器上暂无笔记'}
            </Text>
          </View>
        )}
        <AButton title="载入最新笔记" secondary disabled={busy} onPress={load} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
