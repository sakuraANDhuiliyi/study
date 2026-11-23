import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { MobileApiError, type MobileClient } from './client';
import { a, AButton } from './assignment-ui';
import type { LeaveGuard } from './Assignments';
import {
  personalNotesApi as api,
  personalNoteInput,
  reconcilePersonalNote,
  samePersonalNote,
  type PersonalNote,
  type PersonalNoteEdit,
  type PersonalNoteList,
} from './personal-learning-model';
const empty: PersonalNoteEdit = { title: '', category: null, body: '', pinned: false };
export function PersonalNotes({
  client,
  create,
  openNote,
  openLesson,
}: {
  client: MobileClient;
  create(): void;
  openNote(id: string): void;
  openLesson(id: string): void;
}) {
  const [data, setData] = useState<PersonalNoteList | null>(null),
    [source, setSource] = useState<'all' | 'lesson' | 'standalone'>('all'),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [pinned, setPinned] = useState(false),
    [page, setPage] = useState(1),
    [version, setVersion] = useState(0),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const epoch = client.sessionEpoch();
    setData(null);
    setError('');
    void api
      .list(client, { source, search: query, page, ...(pinned ? { pinned: 'true' as const } : {}) })
      .then((result) => {
        if (active && client.ownsSession(epoch)) setData(result);
      })
      .catch((e) => {
        if (active && client.ownsSession(epoch)) setError(e.message);
      });
    const off = client.onSessionInvalidated(() => {
      active = false;
      setData(null);
      setSearch('');
      setQuery('');
    });
    return () => {
      active = false;
      off();
    };
  }, [client, source, query, pinned, page, version]);
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={a.page}>
      <Text style={a.title}>我的私人笔记</Text>
      <Text style={a.muted}>
        独立笔记不依赖课程；课时笔记按当前课程访问权限显示。与网站同步，仅本人当前学习空间可见。
      </Text>
      <AButton title="新建独立笔记" onPress={create} />
      <View style={a.row}>
        {(
          [
            ['all', '全部私人笔记'],
            ['standalone', '独立笔记'],
            ['lesson', '课时笔记'],
          ] as const
        ).map(([value, label]) => (
          <AButton
            key={value}
            title={label}
            secondary={source !== value}
            onPress={() => {
              setSource(value);
              setPage(1);
            }}
          />
        ))}
      </View>
      <TextInput
        accessibilityLabel="搜索私人笔记"
        value={search}
        onChangeText={setSearch}
        maxLength={120}
        style={a.input}
      />
      <AButton
        title="搜索私人笔记"
        onPress={() => {
          setQuery(search.trim());
          setPage(1);
        }}
      />
      <AButton
        title={pinned ? '查看全部置顶状态' : '仅看置顶私人笔记'}
        secondary
        onPress={() => {
          setPinned((value) => !value);
          setPage(1);
        }}
      />
      <AButton title="刷新私人笔记" secondary onPress={() => setVersion((value) => value + 1)} />
      {error ? <Text style={a.error}>{error}</Text> : null}
      {data && (
        <>
          <Text style={a.muted}>
            共 {data.total} 条，第 {data.page} 页
          </Text>
          {data.items.map((note) => (
            <View key={note.source + ':' + note.id} style={a.card}>
              <Text style={a.subtitle}>{note.title}</Text>
              <Text style={a.muted}>
                {note.source === 'standalone' ? '独立笔记' : note.courseTitle} · {note.category || '未分类'}
                {note.pinned ? ' · 置顶' : ''}
              </Text>
              <Text selectable style={a.body}>
                {note.preview}
              </Text>
              <AButton
                title={'打开私人笔记 ' + note.title}
                onPress={() =>
                  note.source === 'lesson' && note.lessonId ? openLesson(note.lessonId) : openNote(note.id)
                }
              />
            </View>
          ))}
          <View style={a.row}>
            <AButton
              title="上一页私人笔记"
              secondary
              disabled={page <= 1}
              onPress={() => setPage((value) => value - 1)}
            />
            <AButton
              title="下一页私人笔记"
              secondary
              disabled={page * 10 >= data.total}
              onPress={() => setPage((value) => value + 1)}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}
export function StandaloneNoteEditor({
  client,
  id,
  registerLeave,
}: {
  client: MobileClient;
  id?: string;
  registerLeave(guard: LeaveGuard): void;
}) {
  const [base, setBase] = useState<PersonalNote | null>(null),
    [edit, setEdit] = useState<PersonalNoteEdit>(empty),
    [latest, setLatest] = useState<PersonalNote | null>(null),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [blocked, setBlocked] = useState(false),
    [loaded, setLoaded] = useState(!id),
    [message, setMessage] = useState(''),
    [checked, setChecked] = useState(false);
  const mounted = useRef(true),
    epoch = useRef(client.sessionEpoch()),
    flight = useRef(false),
    pending = useRef<{
      kind: 'save' | 'create' | 'delete';
      base: PersonalNote | null;
      intent: PersonalNoteEdit;
    } | null>(null);
  const alive = () => mounted.current && client.ownsSession(epoch.current);
  const accept = (note: PersonalNote | null, notice: string) => {
    setBase(note);
    setEdit(
      note
        ? { title: note.title, category: note.category, body: note.body, pinned: note.pinned }
        : { ...empty },
    );
    setLatest(null);
    setUnknown(false);
    setBlocked(false);
    setLoaded(true);
    pending.current = null;
    setMessage(notice);
  };
  useEffect(() => {
    mounted.current = true;
    if (id)
      void api
        .read(client, id)
        .then((note) => {
          if (alive()) accept(note, '');
        })
        .catch((e) => {
          if (alive()) setMessage(e.message);
        });
    const off = client.onSessionInvalidated(() => {
      mounted.current = false;
      pending.current = null;
      setBase(null);
      setEdit({ ...empty });
      setLatest(null);
    });
    return () => {
      mounted.current = false;
      off();
    };
  }, [client, id]);
  const dirty = !samePersonalNote(base || empty, edit);
  useEffect(() => {
    registerLeave(
      dirty || busy || unknown
        ? (proceed) => {
            if (flight.current) {
              Alert.alert('正在保存私人笔记', '请等待请求完成。');
              return;
            }
            Alert.alert(
              '离开独立笔记？',
              unknown ? '保存结果尚未确认，请先核对服务器。' : '未保存输入只留在当前页面。',
              [
                { text: '继续编辑', style: 'cancel' },
                { text: '放弃并离开', style: 'destructive', onPress: proceed },
              ],
            );
          }
        : null,
    );
    return () => registerLeave(null);
  }, [dirty, busy, unknown, registerLeave]);
  const save = async () => {
    if (flight.current || unknown || blocked || !loaded) return;
    let intent: PersonalNoteEdit;
    try {
      intent = personalNoteInput(edit);
    } catch (e) {
      setMessage((e as Error).message);
      return;
    }
    pending.current = { kind: base ? 'save' : 'create', base, intent };
    flight.current = true;
    setBusy(true);
    setChecked(false);
    try {
      const note = base ? await api.save(client, base, intent) : await api.create(client, intent);
      if (alive()) accept(note, '独立笔记已保存。');
    } catch (e) {
      if (alive()) {
        setMessage((e as Error).message);
        if (e instanceof MobileApiError && [400, 401, 403, 404, 409, 413, 422, 429].includes(e.status)) {
          pending.current = null;
          setBlocked(e.status === 409);
          if (e.status === 409 && base) {
            try {
              const newest = await api.read(client, base.id);
              if (alive()) setLatest(newest);
            } catch {
              /* retain input until explicit reread */
            }
          }
        } else setUnknown(true);
      }
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  const remove = async () => {
    if (!base || flight.current || unknown || blocked) return;
    pending.current = { kind: 'delete', base, intent: edit };
    flight.current = true;
    setBusy(true);
    try {
      await api.remove(client, base);
      if (alive()) accept(null, '独立笔记已删除。');
    } catch (e) {
      if (alive()) {
        setMessage((e as Error).message);
        if (e instanceof MobileApiError && [400, 401, 403, 404, 409, 413, 422, 429].includes(e.status)) {
          pending.current = null;
          setBlocked(true);
        } else setUnknown(true);
      }
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  const check = async () => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    const request = pending.current;
    try {
      if (request?.kind === 'create') {
        await api.list(client, { source: 'standalone', page: 1, search: request.intent.title });
        if (alive()) {
          setChecked(true);
          setMessage(
            '已读取服务器列表。创建请求无幂等标识，请返回列表核对是否已有此笔记；不会自动重复创建。',
          );
        }
        return;
      }
      const target = request?.base?.id || base?.id || id;
      if (!target) return;
      const note = await api.read(client, target);
      if (!alive()) return;
      if (!loaded && !request) {
        accept(note, '已读取服务器笔记。');
        return;
      }
      if (request?.kind === 'save' && request.base) {
        const result = reconcilePersonalNote(request.base, request.intent, note);
        if (result === 'applied') {
          accept(note, '已核对保存成功，没有重复写入。');
          return;
        }
        if (result === 'unchanged') {
          setUnknown(false);
          setBlocked(false);
          pending.current = null;
          setMessage('服务器仍是原版本，当前输入已保留。');
          return;
        }
      }
      setLatest(note);
      setUnknown(false);
      setBlocked(true);
      pending.current = null;
      setMessage('服务器最新版本已读取。请比较后确认加载或保留本地输入。');
    } catch (e) {
      if (alive()) {
        if (request?.kind === 'delete' && e instanceof MobileApiError && e.status === 404)
          accept(null, '已核对：笔记已删除。');
        else setMessage((e as Error).message);
      }
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  const chooseLatest = (load: boolean) => {
    if (!latest) return;
    Alert.alert(
      load ? '加载最新笔记？' : '保留当前输入？',
      load ? '当前未保存内容将被替换。' : '以最新版本为基础，保留当前输入。之后需要再次手动保存。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认',
          onPress: () => {
            if (load) accept(latest, '已加载服务器笔记。');
            else {
              setBase(latest);
              setLatest(null);
              setBlocked(false);
              setMessage('输入已保留，尚未写入服务器。');
            }
          },
        },
      ],
    );
  };
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={a.page}>
      <Text style={a.title}>{base ? '编辑独立笔记' : '新建独立笔记'}</Text>
      <Text style={a.muted}>纯文本私人笔记，不依赖课程。网页和手机共用版本，出现冲突不会直接覆盖。</Text>
      {message ? (
        <Text accessibilityLiveRegion="polite" style={a.notice}>
          {message}
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel="独立笔记标题"
        value={edit.title}
        onChangeText={(title) => setEdit((value) => ({ ...value, title }))}
        editable={!busy && loaded && !unknown}
        maxLength={120}
        style={a.input}
      />
      <TextInput
        accessibilityLabel="独立笔记分类"
        value={edit.category || ''}
        onChangeText={(category) => setEdit((value) => ({ ...value, category: category || null }))}
        editable={!busy && loaded && !unknown}
        maxLength={60}
        style={a.input}
        placeholder="分类（可选）"
      />
      <TextInput
        accessibilityLabel="独立笔记正文"
        value={edit.body}
        onChangeText={(body) => setEdit((value) => ({ ...value, body }))}
        editable={!busy && loaded && !unknown}
        maxLength={10000}
        multiline
        style={[a.input, a.textarea, { minHeight: 260 }]}
      />
      <AButton
        title={edit.pinned ? '已置顶独立笔记' : '置顶独立笔记'}
        secondary={!edit.pinned}
        disabled={busy || !loaded || unknown}
        onPress={() => setEdit((value) => ({ ...value, pinned: !value.pinned }))}
      />
      <AButton
        title="保存独立笔记"
        disabled={busy || unknown || blocked || !loaded || !dirty}
        onPress={() => void save()}
      />
      <AButton title="核对服务器独立笔记" secondary disabled={busy} onPress={() => void check()} />
      {base && (
        <AButton
          title="删除独立笔记"
          secondary
          disabled={busy || unknown || blocked}
          onPress={() =>
            Alert.alert('删除本人独立笔记？', '删除后无法恢复。', [
              { text: '取消', style: 'cancel' },
              { text: '确认删除', style: 'destructive', onPress: () => void remove() },
            ])
          }
        />
      )}
      {latest && (
        <View style={a.card}>
          <Text style={a.subtitle}>
            服务器版本 {latest.revision} · {latest.title}
          </Text>
          <Text style={a.muted}>
            {latest.category || '未分类'} · {latest.pinned ? '置顶' : '普通'}
          </Text>
          <Text selectable style={a.body}>
            {latest.body}
          </Text>
          <AButton title="加载服务器笔记" disabled={busy} onPress={() => chooseLatest(true)} />
          <AButton title="比较后保留当前输入" secondary disabled={busy} onPress={() => chooseLatest(false)} />
        </View>
      )}
      {unknown && pending.current?.kind === 'create' && checked && (
        <AButton
          title="已核对未创建，允许重新保存"
          secondary
          disabled={busy}
          onPress={() =>
            Alert.alert('确认列表没有此次笔记？', '已有笔记请勿重复新建。此操作不会自动保存。', [
              { text: '继续核对', style: 'cancel' },
              {
                text: '确认未创建',
                onPress: () => {
                  pending.current = null;
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
