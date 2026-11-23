import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { MobileApiError, type MobileClient, type MobileUser } from './client';
import { a, AButton } from './assignment-ui';
import { personalNotesApi, type PersonalNoteList } from './personal-learning-model';
import { personalOfflineVault } from './offline-review.native';
import type { OfflineReviewNote, OfflineReviewVault } from './offline-review-model';
export function OfflineReview({ client, user }: { client: MobileClient; user: MobileUser }) {
  const [saved, setSaved] = useState<OfflineReviewNote[]>([]),
    [online, setOnline] = useState<PersonalNoteList | null>(null),
    [selected, setSelected] = useState<OfflineReviewNote | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [offline, setOffline] = useState(false);
  const mounted = useRef(true),
    epoch = useRef(client.sessionEpoch()),
    vault = useRef<OfflineReviewVault | null>(null),
    flight = useRef(false);
  const alive = () => mounted.current && client.ownsSession(epoch.current);
  const eligible = user.accountMode === 'PERSONAL' && user.role === 'STUDENT';
  useEffect(() => {
    mounted.current = true;
    if (eligible)
      void personalOfflineVault(client.origin, user)
        .then(async (value) => {
          if (!alive()) return;
          vault.current = value;
          const notes = await value.list();
          if (alive()) setSaved(notes);
        })
        .catch((e) => {
          if (alive()) setMessage((e as Error).message);
        });
    const off = client.onSessionInvalidated(() => {
      mounted.current = false;
      setSaved([]);
      setOnline(null);
      setSelected(null);
      void vault.current?.destroy().catch(() => undefined);
    });
    return () => {
      mounted.current = false;
      off();
    };
  }, [client, user.id, user.organizationId, user.role, eligible]);
  const perform = async (work: () => Promise<void>) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (e) {
      if (alive()) setMessage((e as Error).message);
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  const candidates = async (page = 1) => {
    const rows = await personalNotesApi.list(client, { source: 'standalone', page, search: '' });
    if (alive()) setOnline(rows);
  };
  const save = async (id: string) => {
    const current = await personalNotesApi.read(client, id);
    if (!alive() || !vault.current) return;
    const items = await vault.current.put({ ...current, savedAt: new Date().toISOString() });
    if (alive()) {
      setSaved(items);
      setMessage('已加密保存到本机待复习。退出身份会清除本机密钥与副本。');
    }
  };
  const open = async (note: OfflineReviewNote) => {
    setSelected(null);
    setOffline(false);
    try {
      const current = await personalNotesApi.read(client, note.id);
      if (!alive() || !vault.current) return;
      const updated = { ...current, savedAt: new Date().toISOString() };
      const items = await vault.current.put(updated);
      if (alive()) {
        setSaved(items);
        setSelected(updated);
        setMessage('已联网核对本人权限，并更新为服务器最新版本。');
      }
    } catch (e) {
      if (!alive()) return;
      if (e instanceof MobileApiError && e.status === 0) {
        setSelected(note);
        setOffline(true);
        setMessage('网络不可达，正在只读查看上次主动保存的个人笔记副本；恢复网络后重新打开会核对服务器。');
      } else if (e instanceof MobileApiError && [401, 403, 404].includes(e.status)) {
        if (vault.current) setSaved(await vault.current.remove(note.id));
        setMessage('服务器已不允许读取此笔记，本机副本已移除。');
      } else throw e;
    }
  };
  const remove = async (id: string) => {
    if (!vault.current) return;
    const items = await vault.current.remove(id);
    if (alive()) {
      setSaved(items);
      if (selected?.id === id) setSelected(null);
      setMessage('已移除本机副本，服务器笔记未修改。');
    }
  };
  if (!eligible)
    return (
      <ScrollView contentContainerStyle={a.page}>
        <Text style={a.title}>离线待复习</Text>
        <Text style={a.notice}>
          本机离线仅保存个人空间本人创作的独立笔记。机构课程、课时、代码和他人资料需要联网访问。
        </Text>
      </ScrollView>
    );
  return (
    <ScrollView contentContainerStyle={a.page}>
      <Text style={a.title}>离线待复习</Text>
      <Text style={a.muted}>
        仅保存个人空间本人独立笔记，最多20条。内容在应用私有目录加密，密钥受系统安全存储保护；不缓存会话密钥或算法源码。需先联网登录当前身份，之后断网仍可只读复习。注销或切换身份清除副本。
      </Text>
      {message ? (
        <Text accessibilityLiveRegion="polite" style={a.notice}>
          {message}
        </Text>
      ) : null}
      <Text style={a.subtitle}>本机副本 · {saved.length} / 20</Text>
      {saved.map((note) => (
        <View style={a.card} key={note.id}>
          <Text style={a.subtitle}>{note.title}</Text>
          <Text style={a.muted}>
            保存于 {new Date(note.savedAt).toLocaleString()} · 版本 {note.revision}
          </Text>
          <AButton
            title={'复习本机笔记 ' + note.title}
            disabled={busy}
            onPress={() => void perform(() => open(note))}
          />
          <AButton
            title={'移除本机笔记 ' + note.title}
            disabled={busy}
            secondary
            onPress={() =>
              Alert.alert('移除本机副本？', '不会删除服务器笔记。', [
                { text: '取消', style: 'cancel' },
                { text: '确认移除', onPress: () => void perform(() => remove(note.id)) },
              ])
            }
          />
        </View>
      ))}
      {selected && (
        <View style={a.card}>
          <Text style={a.subtitle}>{selected.title}</Text>
          <Text style={a.muted}>
            {offline ? '离线只读副本' : '已联网核对'} · {selected.category || '未分类'}
          </Text>
          <Text selectable style={a.body}>
            {selected.body}
          </Text>
        </View>
      )}
      <AButton
        title="联网选择本人独立笔记"
        disabled={busy}
        secondary
        onPress={() => void perform(() => candidates())}
      />
      {online && (
        <>
          <Text style={a.subtitle}>可保存的本人笔记</Text>
          {online.items.map((note) => (
            <View style={a.card} key={note.id}>
              <Text style={a.subtitle}>{note.title}</Text>
              <AButton
                title={'保存待复习 ' + note.title}
                disabled={busy || !vault.current}
                onPress={() => void perform(() => save(note.id))}
              />
            </View>
          ))}
          <View style={a.row}>
            <AButton
              title="上一页可保存笔记"
              disabled={busy || online.page <= 1}
              secondary
              onPress={() => void perform(() => candidates(online.page - 1))}
            />
            <AButton
              title="下一页可保存笔记"
              disabled={busy || online.page * online.pageSize >= online.total}
              secondary
              onPress={() => void perform(() => candidates(online.page + 1))}
            />
          </View>
        </>
      )}
      <AButton
        title="清除本身份全部离线副本"
        secondary
        disabled={busy}
        onPress={() =>
          Alert.alert('清除本机副本与密钥？', '服务器私人笔记保留。', [
            { text: '取消', style: 'cancel' },
            {
              text: '确认清除',
              style: 'destructive',
              onPress: () =>
                void perform(async () => {
                  await vault.current?.clear();
                  if (alive()) {
                    setSaved([]);
                    setSelected(null);
                  }
                }),
            },
          ])
        }
      />
    </ScrollView>
  );
}
