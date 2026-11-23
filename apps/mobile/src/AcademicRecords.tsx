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
import type { LeaveGuard } from './Assignments';
import { MobileApiError, type MobileClient } from './client';
import { useResource } from './resource';
import { a, AButton } from './assignment-ui';
import {
  AcademicChoice,
  AcademicQuery,
  AcademicResultView,
  useAcademicLeave,
  useAcademicLive,
} from './academic-ui';
import {
  academicRoot,
  academicRecordPath,
  academicsApi,
  academicNotes,
  reconcileAcademicEdit,
  type AcademicCatalog,
  type AcademicRecord,
  type AcademicRecordsPage,
  type AcademicEdit,
} from './academics-model';

export function AcademicRecords({
  client,
  openRecord,
  moduleId,
  openExport,
}: {
  client: MobileClient;
  openRecord(id: string): void;
  moduleId?: string;
  openExport?(moduleId?: string, status?: string): void;
}) {
  const catalog = useResource<AcademicCatalog>(client, academicRoot + '/catalog');
  const [filter, setFilter] = useState({ moduleId: moduleId || '', status: 'all', page: 1 }),
    [showModules, setShowModules] = useState(false),
    [search, setSearch] = useState('');
  const query = new URLSearchParams({
    page: String(filter.page),
    pageSize: '10',
    status: filter.status,
    ...(filter.moduleId ? { moduleId: filter.moduleId } : {}),
  });
  const q = useResource<AcademicRecordsPage>(client, academicRoot + '/records?' + query, 30000);
  useEffect(() => {
    if (!q.loading && !q.error && q.data && filter.page > 1 && !q.data.items.length)
      setFilter((f) => ({ ...f, page: Math.max(1, Math.ceil(q.data!.total / 10)) }));
  }, [q.loading, q.error, q.data, filter.page]);
  return (
    <FlatList
      data={q.error ? [] : q.data?.items || []}
      keyExtractor={(r) => r.id}
      contentContainerStyle={a.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={q.loading} onRefresh={q.reload} />}
      ListHeaderComponent={
        <View style={{ gap: 14, paddingBottom: 14 }}>
          <View style={a.card}>
            <Text style={a.title}>学习记录与笔记</Text>
            <Text style={a.body}>仅展示当前学习空间中本人已保存的实验、测验和笔记。</Text>
            <Text style={a.muted}>
              模块：{catalog.data?.modules.find((m) => m.id === filter.moduleId)?.title || '全部模块'}
            </Text>
            <AButton
              title={showModules ? '收起模块筛选' : '筛选学习模块'}
              secondary
              onPress={() => setShowModules((v) => !v)}
            />
            {showModules && (
              <>
                <TextInput
                  accessibilityLabel="搜索记录所属模块"
                  value={search}
                  onChangeText={setSearch}
                  style={a.input}
                />
                <AcademicChoice
                  title="全部模块"
                  selected={!filter.moduleId}
                  onPress={() => setFilter((f) => ({ ...f, moduleId: '', page: 1 }))}
                />
                {catalog.data?.modules
                  .filter((m) => m.title.includes(search.trim()))
                  .map((m) => (
                    <AcademicChoice
                      key={m.id}
                      title={m.title}
                      selected={filter.moduleId === m.id}
                      onPress={() => setFilter((f) => ({ ...f, moduleId: m.id, page: 1 }))}
                    />
                  ))}
              </>
            )}
            {(
              [
                ['all', '全部状态'],
                ['DRAFT', '继续研究'],
                ['COMPLETED', '已完成'],
              ] as const
            ).map(([status, label]) => (
              <AcademicChoice
                key={status}
                title={label}
                selected={filter.status === status}
                onPress={() => setFilter((f) => ({ ...f, status, page: 1 }))}
              />
            ))}
            {openExport && (
              <AButton
                title="导出当前筛选的记录"
                secondary
                onPress={() => openExport(filter.moduleId || undefined, filter.status)}
              />
            )}
          </View>
          <AcademicQuery loading={q.loading} error={q.error} retry={q.reload} />
          {q.data && !q.error && (
            <Text style={a.muted}>
              共 {q.data.total} 条记录 · 第 {filter.page} 页
            </Text>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <View style={a.card}>
          <Text style={a.subtitle}>{item.title}</Text>
          <Text style={a.muted}>
            {item.status === 'COMPLETED' ? '已完成' : '继续研究'} ·{' '}
            {new Date(item.createdAt).toLocaleString()}
          </Text>
          <Text style={a.body} numberOfLines={3}>
            {item.result.summary}
          </Text>
          <Text style={a.muted}>{item.notes ? '已保存笔记' : '尚未补充笔记'}</Text>
          <AButton title="查看结果与笔记" onPress={() => openRecord(item.id)} />
        </View>
      )}
      ListEmptyComponent={
        !q.loading && !q.error ? (
          <Text style={a.muted}>没有匹配的记录，可以调整条件或先完成一次练习。</Text>
        ) : null
      }
      ListFooterComponent={
        <View style={a.row}>
          <AButton
            title="上一页"
            secondary
            disabled={filter.page === 1 || q.loading}
            onPress={() => setFilter((f) => ({ ...f, page: f.page - 1 }))}
          />
          <AButton
            title="下一页"
            secondary
            disabled={!q.data || !!q.error || q.loading || filter.page * 10 >= q.data.total}
            onPress={() => setFilter((f) => ({ ...f, page: f.page + 1 }))}
          />
        </View>
      }
    />
  );
}
export function AcademicRecordDetail({
  client,
  id,
  openModule,
  openRecords,
  registerLeave,
}: {
  client: MobileClient;
  id: string;
  openModule(id: string, recordId?: string): void;
  openRecords(): void;
  registerLeave(guard: LeaveGuard): void;
}) {
  const q = useResource<AcademicRecord>(client, academicRecordPath(id));
  const [snapshot, setSnapshot] = useState<AcademicRecord | null>(null),
    [title, setTitle] = useState(''),
    [notes, setNotes] = useState(''),
    [status, setStatus] = useState<AcademicRecord['status']>('COMPLETED');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [blocked, setBlocked] = useState(false),
    [denied, setDenied] = useState(false),
    [showValues, setShowValues] = useState(false);
  const flight = useRef(false),
    pending = useRef<{ base: AcademicRecord; intent: AcademicEdit } | null>(null),
    live = useAcademicLive(client);
  const adopt = (record: AcademicRecord) => {
    setSnapshot(record);
    setTitle(record.title);
    setNotes(record.notes);
    setStatus(record.status);
    setBlocked(false);
    setError('');
    pending.current = null;
  };
  useEffect(() => {
    if (q.data && !snapshot) adopt(q.data);
  }, [q.data, snapshot]);
  const dirty =
    !!snapshot && (title !== snapshot.title || notes !== snapshot.notes || status !== snapshot.status);
  useAcademicLeave(registerLeave, dirty || blocked, busy);
  const failure = (e: unknown) => {
    setError((e as Error).message);
    if (e instanceof MobileApiError && [401, 403, 404].includes(e.status)) setDenied(true);
  };
  const save = async () => {
    if (!snapshot || flight.current || blocked || denied) return;
    let intent: AcademicEdit;
    try {
      if (!title.trim()) throw new Error('请填写记录标题');
      intent = { title: title.trim(), notes: academicNotes(notes), status };
    } catch (e) {
      failure(e);
      return;
    }
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    pending.current = { base: snapshot, intent };
    try {
      const saved = await academicsApi.saveRecord(client, snapshot, intent);
      if (!live()) return;
      adopt(saved);
      setNotice('记录与笔记已保存');
    } catch (e) {
      if (!live()) return;
      failure(e);
      if (!(e instanceof MobileApiError) || e.status === 0 || e.status >= 500 || e.status === 409)
        setBlocked(true);
      else pending.current = null;
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  const refreshVersion = async () => {
    if (flight.current || denied) return;
    flight.current = true;
    setBusy(true);
    try {
      const latest = await academicsApi.record(client, id);
      if (!live()) return;
      if (
        pending.current &&
        reconcileAcademicEdit(pending.current.base, pending.current.intent, latest) === 'applied'
      ) {
        adopt(latest);
        setNotice('已核对：刚才的修改已经保存，无需重复提交。');
      } else {
        setSnapshot(latest);
        setBlocked(false);
        pending.current = null;
        setError('');
        setNotice('已刷新服务器版本，保留了你的标题、笔记和状态。请确认内容后再次保存。');
      }
    } catch (e) {
      if (live()) failure(e);
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  const remove = () =>
    Alert.alert('删除此学习记录？', '该记录和笔记将永久删除，相应学习目标的真实进度也会减少。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          if (flight.current || denied) return;
          flight.current = true;
          setBusy(true);
          void client
            .request(academicRecordPath(id), undefined, 'DELETE')
            .then(() => {
              if (live()) {
                registerLeave(null);
                openRecords();
              }
            })
            .catch((e) => {
              if (!live()) return;
              failure(e);
              setNotice('如果网络中断，请返回记录列表刷新核对，避免重复操作。');
            })
            .finally(() => {
              flight.current = false;
              if (live()) setBusy(false);
            });
        },
      },
    ]);
  const disabled = busy || denied || !!q.error;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
        <AcademicQuery loading={q.loading} error={q.error} retry={q.reload} />
        {snapshot && !q.error && (
          <>
            <View style={a.card}>
              <Text style={a.title}>{snapshot.title}</Text>
              <Text style={a.muted}>
                {new Date(snapshot.createdAt).toLocaleString()} ·{' '}
                {snapshot.status === 'COMPLETED' ? '已完成' : '继续研究'}
              </Text>
              <AButton
                title="载入此组参数重新练习"
                secondary
                disabled={disabled}
                onPress={() => openModule(snapshot.moduleId, snapshot.id)}
              />
              <AButton
                title={showValues ? '收起实验输入' : '查看已保存的实验输入'}
                secondary
                onPress={() => setShowValues((v) => !v)}
              />
              {showValues && (
                <Text selectable style={a.body}>
                  {JSON.stringify(snapshot.values, null, 2)}
                </Text>
              )}
            </View>
            <AcademicResultView key={snapshot.id} result={snapshot.result} />
            <View style={a.card}>
              <Text style={a.subtitle}>我的学习笔记</Text>
              <TextInput
                accessibilityLabel="记录标题"
                style={a.input}
                value={title}
                onChangeText={setTitle}
                maxLength={160}
                editable={!disabled}
              />
              <TextInput
                accessibilityLabel="学习记录笔记"
                placeholder="记录推导、实验观察、疑问与下一步计划"
                style={[a.input, a.textarea]}
                multiline
                value={notes}
                onChangeText={setNotes}
                maxLength={12000}
                editable={!disabled}
              />
              <Text style={a.muted}>{notes.length} / 12000 字符 · 纯文本笔记</Text>
              {(['DRAFT', 'COMPLETED'] as const).map((v) => (
                <AcademicChoice
                  key={v}
                  title={v === 'DRAFT' ? '继续研究' : '已完成本次练习'}
                  selected={v === status}
                  disabled={disabled}
                  onPress={() => setStatus(v)}
                />
              ))}
              {!!error && <Text style={a.error}>{error}</Text>}
              {!!notice && <Text style={a.notice}>{notice}</Text>}
              {blocked && (
                <AButton
                  title="保留输入并核对最新版本"
                  secondary
                  disabled={disabled}
                  onPress={() => void refreshVersion()}
                />
              )}
              <AButton
                title={busy ? '正在保存…' : '保存记录与笔记'}
                disabled={disabled || blocked || !dirty}
                onPress={() => void save()}
              />
              <AButton title="删除此记录" secondary disabled={disabled || blocked} onPress={remove} />
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
