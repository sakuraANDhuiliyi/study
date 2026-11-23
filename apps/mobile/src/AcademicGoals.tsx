import React, { useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import type { LeaveGuard } from './Assignments';
import { MobileApiError, type MobileClient } from './client';
import { useResource } from './resource';
import { a, AButton } from './assignment-ui';
import { AcademicChoice, AcademicQuery, useAcademicLeave, useAcademicLive } from './academic-ui';
import { academicRoot, type AcademicCatalog, type AcademicGoal } from './academics-model';

export function AcademicGoals({
  client,
  openModule,
  registerLeave,
  moduleId: initialModule,
}: {
  client: MobileClient;
  openModule(id: string): void;
  registerLeave(guard: LeaveGuard): void;
  moduleId?: string;
}) {
  const [filter, setFilter] = useState('active');
  const q = useResource<{ items: AcademicGoal[] }>(client, academicRoot + '/goals?status=' + filter, 30000),
    catalog = useResource<AcademicCatalog>(client, academicRoot + '/catalog');
  const [editing, setEditing] = useState(false),
    [base, setBase] = useState<AcademicGoal | null>(null),
    [moduleId, setModuleId] = useState(initialModule || ''),
    [search, setSearch] = useState(''),
    [title, setTitle] = useState(''),
    [count, setCount] = useState('3'),
    [dueDate, setDueDate] = useState(''),
    [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const live = useAcademicLive(client),
    flight = useRef(false);
  useAcademicLeave(registerLeave, editing, busy);
  const begin = (goal: AcademicGoal | null) => {
    setBase(goal);
    setModuleId(goal?.moduleId || initialModule || '');
    setTitle(
      goal?.title || (catalog.data?.modules.find((m) => m.id === initialModule)?.title || '') + '学习目标',
    );
    setCount(String(goal?.targetCount || 3));
    setDueDate(goal?.dueDate || '');
    setArchived(goal?.archived || false);
    setError('');
    setNotice('');
    setBlocked(false);
    setEditing(true);
  };
  const save = async () => {
    if (flight.current || blocked) return;
    const targetCount = Number(count);
    if (
      !moduleId ||
      !title.trim() ||
      !Number.isInteger(targetCount) ||
      targetCount < 1 ||
      targetCount > 1000
    ) {
      setError('请选择模块，填写标题和1至1000的整数目标次数');
      return;
    }
    if (
      dueDate &&
      (!/^(20\d{2}|2100)-\d{2}-\d{2}$/.test(dueDate) ||
        !Number.isFinite(Date.parse(dueDate + 'T00:00:00Z')) ||
        new Date(dueDate + 'T00:00:00Z').toISOString().slice(0, 10) !== dueDate)
    ) {
      setError('期限请填写2000至2100年的有效日期，格式 YYYY-MM-DD');
      return;
    }
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      await client.request(
        academicRoot + '/goals' + (base ? '/' + encodeURIComponent(base.id) : ''),
        {
          title: title.trim(),
          targetCount,
          dueDate: dueDate || null,
          ...(base ? { revision: base.revision, archived } : { moduleId }),
        },
        base ? 'PATCH' : 'POST',
      );
      if (!live()) return;
      setEditing(false);
      setNotice('目标已保存，进度由真实学习记录更新');
      q.reload();
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
  const refresh = async () => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    try {
      const latest = await client.request<{ items: AcademicGoal[] }>(academicRoot + '/goals?status=all');
      if (!live()) return;
      if (base) {
        const goal = latest.items.find((g) => g.id === base.id);
        if (!goal) throw new Error('该目标已被删除，当前输入仍保留，请取消后另建目标。');
        setBase(goal);
        setBlocked(false);
        setNotice('已刷新版本并保留输入，请确认后再次保存。');
      } else {
        setNotice('已刷新目标列表。请先核对是否已创建；确认没有重复后才能再次创建。');
      }
      setError('');
      q.reload();
    } catch (e) {
      if (live()) setError((e as Error).message);
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  const remove = (goal: AcademicGoal) =>
    Alert.alert('删除学习目标？', '只删除目标，已保存的实验记录和笔记仍保留。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          if (flight.current) return;
          flight.current = true;
          setBusy(true);
          void client
            .request(
              academicRoot + '/goals/' + encodeURIComponent(goal.id),
              { revision: goal.revision },
              'DELETE',
            )
            .then(() => {
              if (live()) {
                q.reload();
                setNotice('目标已删除');
              }
            })
            .catch((e) => {
              if (live()) {
                setError((e as Error).message);
                q.reload();
              }
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
      <View style={a.card}>
        <Text style={a.title}>学习目标</Text>
        <Text style={a.body}>
          创建目标后，本模块已完成记录计为次数；算法只计正式通过的不同题目。改为继续研究或删除记录会降低进度。
        </Text>
        <Text style={a.muted}>期限按北京时间的自然日判断，归档不会改变实际完成状态。</Text>
        <AButton title="创建学习目标" onPress={() => begin(null)} disabled={busy || editing} />
        {(['active', 'archived', 'all'] as const).map((v) => (
          <AcademicChoice
            key={v}
            title={v === 'active' ? '进行中的目标' : v === 'archived' ? '已归档目标' : '全部目标'}
            selected={filter === v}
            onPress={() => setFilter(v)}
            disabled={busy}
          />
        ))}
        <AButton title="刷新真实进度" secondary onPress={q.reload} disabled={busy} />
      </View>
      <AcademicQuery
        loading={q.loading || catalog.loading}
        error={q.error || catalog.error}
        retry={() => {
          q.reload();
          catalog.reload();
        }}
      />
      {!!error && <Text style={a.error}>{error}</Text>}
      {!!notice && <Text style={a.notice}>{notice}</Text>}
      {editing && (
        <View style={a.card}>
          <Text style={a.subtitle}>{base ? '编辑目标' : '创建目标'}</Text>
          {!base && (
            <>
              <TextInput
                accessibilityLabel="搜索目标模块"
                style={a.input}
                value={search}
                onChangeText={setSearch}
              />
              {catalog.data?.modules
                .filter((m) => m.title.includes(search.trim()))
                .map((m) => (
                  <AcademicChoice
                    key={m.id}
                    title={m.title}
                    selected={m.id === moduleId}
                    disabled={busy}
                    onPress={() => {
                      setModuleId(m.id);
                      setTitle(m.title + '学习目标');
                    }}
                  />
                ))}
            </>
          )}
          <TextInput
            accessibilityLabel="目标标题"
            value={title}
            onChangeText={setTitle}
            style={a.input}
            maxLength={160}
            editable={!busy}
          />
          <Text style={a.body}>目标数量（1至1000）</Text>
          <TextInput
            accessibilityLabel="目标数量"
            value={count}
            onChangeText={setCount}
            style={a.input}
            keyboardType="number-pad"
            editable={!busy}
          />
          <Text style={a.body}>期限（可选，YYYY-MM-DD）</Text>
          <TextInput
            accessibilityLabel="目标期限"
            value={dueDate}
            onChangeText={setDueDate}
            style={a.input}
            placeholder="2026-12-31"
            maxLength={10}
            editable={!busy}
          />
          {base && (
            <AcademicChoice
              title="归档此目标"
              selected={archived}
              disabled={busy}
              onPress={() => setArchived((v) => !v)}
            />
          )}
          {blocked && (
            <>
              <AButton
                title="保留输入并核对服务器目标"
                secondary
                disabled={busy}
                onPress={() => void refresh()}
              />
              {!base && (
                <AButton
                  title="已核对没有重复，继续创建"
                  secondary
                  disabled={busy}
                  onPress={() =>
                    Alert.alert('确认没有重复目标？', '重新提交将创建一条新目标。', [
                      { text: '取消', style: 'cancel' },
                      { text: '确认', onPress: () => setBlocked(false) },
                    ])
                  }
                />
              )}
            </>
          )}
          <AButton
            title={busy ? '正在保存…' : '保存目标'}
            disabled={busy || blocked}
            onPress={() => void save()}
          />
          <AButton
            title="取消编辑"
            secondary
            disabled={busy}
            onPress={() =>
              Alert.alert('放弃当前输入？', '未保存的修改将丢失。', [
                { text: '继续编辑', style: 'cancel' },
                { text: '放弃', onPress: () => setEditing(false) },
              ])
            }
          />
        </View>
      )}
      {!q.error &&
        q.data?.items.map((goal) => (
          <View key={goal.id} style={a.card}>
            <Text style={a.subtitle}>{goal.title}</Text>
            <Text style={a.body}>
              {goal.progressCount} / {goal.targetCount} {goal.unit} ·{' '}
              {goal.completed ? '已完成' : goal.overdue ? '已过期，尚未完成' : '进行中'}
              {goal.archived ? ' · 已归档' : ''}
            </Text>
            <Text style={a.muted}>期限：{goal.dueDate || '未设置'}</Text>
            <AButton
              title="继续本模块学习"
              onPress={() => openModule(goal.moduleId)}
              disabled={busy || editing}
            />
            <AButton
              title={goal.archived ? '编辑或恢复目标' : '编辑或归档目标'}
              secondary
              disabled={busy || editing}
              onPress={() => begin(goal)}
            />
            <AButton title="删除目标" secondary disabled={busy || editing} onPress={() => remove(goal)} />
          </View>
        ))}
      {!q.loading && !q.error && !q.data?.items.length && (
        <Text style={a.muted}>当前没有目标。可以按模块设定一个小目标开始学习。</Text>
      )}
    </ScrollView>
  );
}
