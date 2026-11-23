import React, { useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import type { LeaveGuard } from './Assignments';
import type { MobileClient, MobileUser } from './client';
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
  nativeAnalyticsResult,
  type LearningAnalyticsData,
  type AnalyticsFilters,
} from './learning-analytics-model';
import { shareTeachingFile } from './teaching-files';
export function LearningAnalytics({
  client,
  user,
  registerLeave,
}: {
  client: MobileClient;
  user: MobileUser;
  registerLeave(guard: LeaveGuard): void;
}) {
  const [filters, setFilters] = useState({ courseId: '', classId: '', termId: '' }),
    [search, setSearch] = useState(''),
    [expanded, setExpanded] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const options = useResource<AnalyticsFilters>(client, '/mobile/analytics/filters');
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
  const q = useResource<LearningAnalyticsData>(client, '/mobile/analytics?' + qs);
  const live = useAcademicLive(client),
    flight = useRef(false);
  useAcademicLeave(registerLeave, false, busy);
  const canExport = !!options.data?.canExport && !options.error;
  const download = async () => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setMessage('');
    try {
      await shareTeachingFile(
        client,
        '/mobile/analytics/export?' + qs + (qs.size ? '&' : '') + 'format=report',
        live,
      );
      if (live()) setMessage('已打开系统文件保存或分享面板，导出内容与当前筛选一致。');
    } catch (e) {
      if (live()) setMessage((e as Error).message);
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={a.page}>
      <View style={a.card}>
        <Text style={a.title}>{user.role === 'STUDENT' ? '我的学习统计' : '教学与学习统计'}</Text>
        <Text style={a.body}>数据来自当前授权课程。缺失成绩保持“数据不足”，按实际已发布记录统计。</Text>
        <AButton
          title={expanded ? '收起统计筛选' : '筛选课程、班级与学期'}
          secondary
          disabled={busy}
          onPress={() => setExpanded((v) => !v)}
        />
        {expanded && (
          <>
            <TextInput
              accessibilityLabel="搜索统计课程"
              style={a.input}
              value={search}
              onChangeText={setSearch}
            />
            <AcademicChoice
              title="全部授权课程"
              selected={!filters.courseId}
              disabled={busy}
              onPress={() => setFilters((f) => ({ ...f, courseId: '' }))}
            />
            {options.data?.courses
              .filter((c) => c.title.includes(search.trim()))
              .map((c) => (
                <AcademicChoice
                  key={c.id}
                  title={c.title}
                  selected={filters.courseId === c.id}
                  disabled={busy}
                  onPress={() => setFilters((f) => ({ ...f, courseId: c.id }))}
                />
              ))}
            <Text style={a.subtitle}>班级</Text>
            <AcademicChoice
              title="全部授权班级"
              selected={!filters.classId}
              disabled={busy}
              onPress={() => setFilters((f) => ({ ...f, classId: '' }))}
            />
            {options.data?.classes.map((c) => (
              <AcademicChoice
                key={c.id}
                title={c.name}
                selected={filters.classId === c.id}
                disabled={busy}
                onPress={() => setFilters((f) => ({ ...f, classId: c.id }))}
              />
            ))}
            <Text style={a.subtitle}>学期</Text>
            <AcademicChoice
              title="全部学期"
              selected={!filters.termId}
              disabled={busy}
              onPress={() => setFilters((f) => ({ ...f, termId: '' }))}
            />
            {options.data?.terms.map((t) => (
              <AcademicChoice
                key={t.id}
                title={t.name}
                selected={filters.termId === t.id}
                disabled={busy}
                onPress={() => setFilters((f) => ({ ...f, termId: t.id }))}
              />
            ))}
          </>
        )}
        <AButton
          title="刷新统计"
          secondary
          disabled={busy}
          onPress={() => {
            q.reload();
            options.reload();
          }}
        />
        <AButton
          title={busy ? '正在生成文件…' : '导出当前统计 CSV'}
          disabled={busy || !canExport || q.loading || !!q.error || !q.data?.hasExportData}
          onPress={() => void download()}
        />
        {!canExport && <Text style={a.muted}>当前身份暂不能导出教学明细，可在获得相应授权后使用。</Text>}
        {q.data && !q.data.hasExportData && <Text style={a.muted}>当前范围暂无可导出的有效学习数据。</Text>}
        {!!message && <Text style={a.notice}>{message}</Text>}
      </View>
      <AcademicQuery
        loading={q.loading || options.loading}
        error={q.error || options.error}
        retry={() => {
          q.reload();
          options.reload();
        }}
      />
      {q.data && !q.error && (
        <AcademicResultView
          title="统计结果"
          key={qs.toString()}
          result={nativeAnalyticsResult(q.data, user.role === 'STUDENT')}
        />
      )}
    </ScrollView>
  );
}
