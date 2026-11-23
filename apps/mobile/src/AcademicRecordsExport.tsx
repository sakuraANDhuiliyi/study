import React, { useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import type { LeaveGuard } from './Assignments';
import type { MobileClient } from './client';
import { useResource } from './resource';
import { a, AButton } from './assignment-ui';
import { AcademicChoice, AcademicQuery, useAcademicLeave, useAcademicLive } from './academic-ui';
import { academicRoot, type AcademicCatalog, type AcademicRecordsPage } from './academics-model';
import { exportAcademicFile, type AcademicExportInput } from './academic-files';
export function AcademicRecordsExport({
  client,
  moduleId: initialModule,
  status: initialStatus,
  registerLeave,
}: {
  client: MobileClient;
  moduleId?: string;
  status?: string;
  registerLeave(guard: LeaveGuard): void;
}) {
  const [moduleId, setModuleId] = useState(initialModule || ''),
    [status, setStatus] = useState<AcademicExportInput['status']>(
      initialStatus === 'DRAFT' || initialStatus === 'COMPLETED' ? initialStatus : 'all',
    ),
    [format, setFormat] = useState<'csv' | 'md'>('csv'),
    [limit, setLimit] = useState('20'),
    [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const flight = useRef(false),
    live = useAcademicLive(client);
  useAcademicLeave(registerLeave, false, busy);
  const catalog = useResource<AcademicCatalog>(client, academicRoot + '/catalog');
  const query = new URLSearchParams({ page: '1', pageSize: '1', status, ...(moduleId ? { moduleId } : {}) });
  const records = useResource<AcademicRecordsPage>(client, academicRoot + '/records?' + query);
  const amount = format === 'csv' ? 5000 : Number(limit),
    validLimit = Number.isInteger(amount) && amount >= 1 && amount <= (format === 'csv' ? 5000 : 50);
  const download = async () => {
    if (flight.current || !validLimit || !records.data?.total || records.error) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const input: AcademicExportInput = { format, status, limit: amount, ...(moduleId ? { moduleId } : {}) };
    try {
      await exportAcademicFile(client, input, live);
      if (live()) setNotice('文件已交给系统保存或分享面板。仅包含服务器已保存内容，具体导出条数以文件为准。');
    } catch (e) {
      if (live()) setError((e as Error).message);
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <View style={a.card}>
        <Text style={a.title}>导出学习记录</Text>
        <Text style={a.body}>
          只导出本人当前学习空间的已保存内容，不会保存页面中尚未提交的输入。导出范围不受列表当前页影响。
        </Text>
        <Text style={a.muted}>
          按创建时间从新到旧导出。CSV 是摘要与笔记标记，Markdown 包含实验输入、完整结果和笔记。
        </Text>
        <AcademicChoice
          title="CSV 总览（最多5000条）"
          selected={format === 'csv'}
          disabled={busy}
          onPress={() => setFormat('csv')}
        />
        <AcademicChoice
          title="Markdown 详细笔记"
          selected={format === 'md'}
          disabled={busy}
          onPress={() => setFormat('md')}
        />
        {format === 'md' && (
          <>
            <Text style={a.body}>导出最新多少条（1至50）</Text>
            <TextInput
              accessibilityLabel="详细笔记导出条数"
              value={limit}
              onChangeText={setLimit}
              style={a.input}
              keyboardType="number-pad"
              editable={!busy}
            />
          </>
        )}
        <Text style={a.subtitle}>状态</Text>
        {(
          [
            ['all', '全部状态'],
            ['DRAFT', '继续研究'],
            ['COMPLETED', '已完成'],
          ] as const
        ).map(([v, label]) => (
          <AcademicChoice
            key={v}
            title={label}
            selected={v === status}
            disabled={busy}
            onPress={() => setStatus(v)}
          />
        ))}
        <Text style={a.subtitle}>学习模块</Text>
        <TextInput
          accessibilityLabel="搜索导出模块"
          style={a.input}
          value={search}
          onChangeText={setSearch}
          editable={!busy}
        />
        <AcademicChoice
          title="全部模块"
          selected={!moduleId}
          disabled={busy}
          onPress={() => setModuleId('')}
        />
        {catalog.data?.modules
          .filter((m) => m.title.includes(search.trim()))
          .map((m) => (
            <AcademicChoice
              key={m.id}
              title={m.title}
              selected={moduleId === m.id}
              disabled={busy}
              onPress={() => setModuleId(m.id)}
            />
          ))}
      </View>
      <AcademicQuery
        loading={catalog.loading || records.loading}
        error={catalog.error || records.error}
        retry={() => {
          catalog.reload();
          records.reload();
        }}
      />
      <View style={a.card}>
        {records.data && !records.error && (
          <Text style={a.body}>
            当前匹配 {records.data.total} 条，预计导出最新{' '}
            {validLimit ? Math.min(records.data.total, amount) : 0} 条。
            {validLimit && records.data.total > amount ? '超出上限的较早记录不会包含在本次文件中。' : ''}
          </Text>
        )}
        <Text style={a.muted}>
          单文件最多8MiB，每分钟最多成功导出5次。文件交给其他应用后，副本由你选择的应用管理。
        </Text>
        {!!error && <Text style={a.error}>{error}</Text>}
        {!!notice && <Text style={a.notice}>{notice}</Text>}
        <AButton
          title={busy ? '正在生成导出文件…' : '生成文件并保存或分享'}
          disabled={
            busy ||
            records.loading ||
            !!records.error ||
            !!catalog.error ||
            !records.data?.total ||
            !validLimit
          }
          onPress={() => void download()}
        />
      </View>
    </ScrollView>
  );
}
