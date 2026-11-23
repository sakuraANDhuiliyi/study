import React, { useRef, useState } from 'react';
import { Alert, FlatList, RefreshControl, Text, TextInput, View } from 'react-native';
import type { LeaveGuard } from './Assignments';
import { MobileApiError, type MobileClient } from './client';
import { useResource } from './resource';
import { a, AButton } from './assignment-ui';
import { AcademicChoice, AcademicQuery, useAcademicLeave, useAcademicLive } from './academic-ui';
import {
  academicRoot,
  kindLabels,
  type AcademicCatalog,
  type AcademicMe,
  type ModuleSummary,
} from './academics-model';

export function AcademicHome({
  client,
  openModule,
  openRecords,
  openGoals,
  registerLeave,
}: {
  client: MobileClient;
  openModule(id: string): void;
  openRecords(): void;
  openGoals(): void;
  registerLeave(guard: LeaveGuard): void;
}) {
  const catalog = useResource<AcademicCatalog>(client, academicRoot + '/catalog'),
    me = useResource<AcademicMe>(client, academicRoot + '/me');
  const [search, setSearch] = useState(''),
    [subject, setSubject] = useState(''),
    [onlyMine, setOnlyMine] = useState(false);
  const [editing, setEditing] = useState(false),
    [snapshot, setSnapshot] = useState<AcademicMe | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [majorId, setMajorId] = useState<string | null>(null),
    [majorSearch, setMajorSearch] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [blocked, setBlocked] = useState(false);
  const live = useAcademicLive(client);
  const flight = useRef(false);
  const dirty =
    editing &&
    !!snapshot &&
    (JSON.stringify(selected) !== JSON.stringify(snapshot.selectedModuleIds) || majorId !== snapshot.majorId);
  useAcademicLeave(registerLeave, dirty, busy);
  const begin = () => {
    if (!me.data) return;
    setSnapshot(me.data);
    setSelected(me.data.selectedModuleIds);
    setMajorId(me.data.majorId);
    setEditing(true);
    setBlocked(false);
    setError('');
    setNotice('');
  };
  const close = () => {
    if (!dirty) setEditing(false);
    else
      Alert.alert('放弃尚未保存的选择？', '服务器上的专业和模块选择不会改变。', [
        { text: '继续选择', style: 'cancel' },
        { text: '放弃修改', style: 'destructive', onPress: () => setEditing(false) },
      ]);
  };
  const save = async () => {
    if (!snapshot || flight.current || blocked) return;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      await client.request(
        academicRoot + '/preferences',
        {
          revision: snapshot.revision,
          selectedModuleIds: selected,
          ...(snapshot.accountMode === 'PERSONAL' ? { majorId } : {}),
        },
        'PATCH',
      );
      if (!live()) return;
      setEditing(false);
      setNotice('专业与学习模块已保存');
      me.reload();
    } catch (e) {
      if (!live()) return;
      setError((e as Error).message);
      if (!(e instanceof MobileApiError) || e.status === 0 || e.status >= 500 || e.status === 409)
        setBlocked(true);
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  const refreshVersion = async () => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    try {
      const latest = await client.request<AcademicMe>(academicRoot + '/me');
      if (!live()) return;
      setSnapshot(latest);
      setBlocked(false);
      setError('');
      setNotice('已核对服务器版本，当前选择仍保留。请确认后再次保存。');
    } catch (e) {
      if (live()) setError((e as Error).message);
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  const chosen = new Set(editing ? selected : me.data?.selectedModuleIds || []);
  const modules =
    catalog.data?.modules.filter(
      (m) =>
        (!subject || m.subjectIds.includes(subject)) &&
        (!onlyMine || chosen.has(m.id)) &&
        (m.title + m.description + m.tags.join(' ')).toLowerCase().includes(search.trim().toLowerCase()),
    ) || [];
  const renderModule = ({ item: m }: { item: ModuleSummary }) => (
    <View style={a.card}>
      <Text style={a.subtitle}>{m.title}</Text>
      <Text style={a.muted}>
        {kindLabels[m.kind]} · 约 {m.estimatedMinutes} 分钟{chosen.has(m.id) ? ' · 已选模块' : ''}
      </Text>
      <Text style={a.body}>{m.description}</Text>
      {editing ? (
        <AcademicChoice
          title={'选择模块：' + m.title}
          selected={chosen.has(m.id)}
          disabled={busy}
          onPress={() => {
            setSelected((s) => (s.includes(m.id) ? s.filter((id) => id !== m.id) : [...s, m.id]));
            setNotice('');
          }}
        />
      ) : (
        <AButton title={'打开' + m.title} onPress={() => openModule(m.id)} />
      )}
    </View>
  );
  return (
    <FlatList
      data={catalog.error || me.error ? [] : modules}
      renderItem={renderModule}
      keyExtractor={(m) => m.id}
      contentContainerStyle={a.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={catalog.loading || me.loading}
          onRefresh={() => {
            catalog.reload();
            me.reload();
          }}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 14, paddingBottom: 14 }}>
          <View style={a.card}>
            <Text style={a.title}>专业学习</Text>
            <Text style={a.body}>{me.data?.major?.name || '自由探索，按兴趣选择学习模块'}</Text>
            <Text style={a.muted}>
              {me.data?.accountMode === 'ORGANIZATION'
                ? '专业由机构管理员分配，你可以自由扩展学习模块。'
                : '选择专业获得学习建议，也可以自由使用其他学科工具。'}
            </Text>
            {me.data && (
              <Text style={a.body}>
                记录 {me.data.stats.records} · 已完成 {me.data.stats.completed} · 练习模块{' '}
                {me.data.stats.modulesPracticed}
              </Text>
            )}
            <AButton title="学习目标与真实进度" secondary onPress={openGoals} disabled={busy} />
            <AButton title="我的学习记录与笔记" secondary onPress={openRecords} disabled={busy} />
            {!editing && (
              <AButton title="选择专业与学习模块" onPress={begin} disabled={!me.data || !!me.error} />
            )}
          </View>
          <AcademicQuery
            loading={catalog.loading || me.loading}
            error={catalog.error || me.error}
            retry={() => {
              catalog.reload();
              me.reload();
            }}
          />
          {!!notice && <Text style={a.notice}>{notice}</Text>}
          {!!error && <Text style={a.error}>{error}</Text>}
          {editing && snapshot && (
            <View style={a.card}>
              <Text style={a.subtitle}>我的选择</Text>
              <Text style={a.body}>
                已选择 {selected.length} 个模块。下面的目录可搜索、按学科筛选后逐项选择。
              </Text>
              {snapshot.accountMode === 'PERSONAL' ? (
                <>
                  <Text style={a.subtitle}>自主选择专业</Text>
                  <TextInput
                    accessibilityLabel="搜索专业"
                    placeholder="输入专业名称"
                    style={a.input}
                    value={majorSearch}
                    onChangeText={setMajorSearch}
                  />
                  <AcademicChoice
                    title="暂不选择专业"
                    selected={majorId === null}
                    onPress={() => setMajorId(null)}
                    disabled={busy}
                  />
                  {catalog.data?.majors
                    .filter(
                      (m) =>
                        m.organizationId === null && (m.name + m.description).includes(majorSearch.trim()),
                    )
                    .slice(0, 20)
                    .map((m) => (
                      <AcademicChoice
                        key={m.id}
                        title={m.name}
                        selected={m.id === majorId}
                        disabled={busy}
                        onPress={() => setMajorId(m.id)}
                      />
                    ))}
                  <Text style={a.muted}>
                    每次最多展示20项，输入名称可缩小范围。当前：
                    {catalog.data?.majors.find((m) => m.id === majorId)?.name || '未选择'}
                  </Text>
                </>
              ) : (
                <Text style={a.notice}>
                  机构专业：{snapshot.major?.name || '尚未分配'}。如需调整，请联系管理员。
                </Text>
              )}
              {blocked && (
                <AButton
                  title="核对版本并保留选择"
                  secondary
                  disabled={busy}
                  onPress={() => void refreshVersion()}
                />
              )}
              <AButton
                title={busy ? '正在保存…' : '保存选择'}
                onPress={() => void save()}
                disabled={busy || blocked}
              />
              <AButton title="关闭选择" secondary disabled={busy} onPress={close} />
            </View>
          )}
          {!editing && !!me.data?.recommendations.length && (
            <View style={a.card}>
              <Text style={a.subtitle}>专业学习建议</Text>
              {me.data.recommendations.map((m) => (
                <AButton key={m.id} title={m.title} secondary onPress={() => openModule(m.id)} />
              ))}
            </View>
          )}
          <View style={a.card}>
            <Text style={a.subtitle}>模块目录</Text>
            <TextInput
              accessibilityLabel="搜索学习模块"
              value={search}
              onChangeText={setSearch}
              style={a.input}
              placeholder="搜索名称、知识点或标签"
            />
            <AcademicChoice title="只看已选模块" selected={onlyMine} onPress={() => setOnlyMine((v) => !v)} />
            <AcademicChoice title="全部学科" selected={!subject} onPress={() => setSubject('')} />
            {catalog.data?.subjects.map((s) => (
              <AcademicChoice
                key={s.id}
                title={s.name}
                selected={subject === s.id}
                onPress={() => setSubject(s.id)}
              />
            ))}
            <Text style={a.muted}>匹配 {modules.length} 个模块</Text>
          </View>
        </View>
      }
      ListEmptyComponent={
        !catalog.loading && !catalog.error && !me.error ? (
          <Text style={a.muted}>当前条件下没有模块，请调整筛选。</Text>
        ) : null
      }
    />
  );
}
