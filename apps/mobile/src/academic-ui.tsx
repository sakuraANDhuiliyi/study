import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { LeaveGuard } from './Assignments';
import type { MobileClient } from './client';
import { a, AButton } from './assignment-ui';
import type { AcademicField, AcademicResult } from './academics-model';

export function useAcademicLive(client: MobileClient) {
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
export function useAcademicLeave(
  registerLeave: ((guard: LeaveGuard) => void) | undefined,
  dirty: boolean,
  busy: boolean,
) {
  useEffect(() => {
    registerLeave?.(
      busy
        ? () => Alert.alert('正在处理', '请等待请求完成后离开。')
        : dirty
          ? (proceed) =>
              Alert.alert('离开此页？', '尚未保存的输入仅保留在当前页面，离开后会丢失。', [
                { text: '继续编辑', style: 'cancel' },
                { text: '离开', style: 'destructive', onPress: proceed },
              ])
          : null,
    );
    return () => registerLeave?.(null);
  }, [registerLeave, dirty, busy]);
}
export function AcademicQuery({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error?: string;
  retry(): void;
}) {
  return (
    <>
      {loading && <ActivityIndicator accessibilityLabel="正在加载内容" />}
      {error && (
        <View style={a.card}>
          <Text style={a.error}>{error}</Text>
          <AButton title="重新加载" onPress={retry} />
        </View>
      )}
    </>
  );
}
export function AcademicChoice({
  title,
  selected,
  onPress,
  disabled = false,
}: {
  title: string;
  selected: boolean;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={title}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[a.option, selected && a.chosen, disabled && a.disabled]}
    >
      <Text style={a.choiceMarker}>{selected ? '✓' : '○'}</Text>
      <Text style={[a.body, { flex: 1 }]}>{title}</Text>
    </Pressable>
  );
}
export function AcademicFieldInput({
  field,
  value,
  setValue,
  disabled,
}: {
  field: AcademicField;
  value: string | boolean | Record<string, string> | undefined;
  setValue(value: string | boolean): void;
  disabled: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={a.subtitle}>
        {field.label}
        {field.required ? ' *' : ''}
      </Text>
      {field.help && <Text style={a.muted}>{field.help}</Text>}
      {field.type === 'checkbox' ? (
        <Switch
          accessibilityLabel={field.label}
          disabled={disabled}
          value={value === true}
          onValueChange={setValue}
        />
      ) : field.type === 'select' ? (
        <View style={{ gap: 8 }}>
          {field.options?.map((option) => (
            <AcademicChoice
              key={option.value}
              title={option.label}
              selected={value === option.value}
              disabled={disabled}
              onPress={() => setValue(option.value)}
            />
          ))}
        </View>
      ) : (
        <TextInput
          accessibilityLabel={field.label}
          editable={!disabled}
          style={[a.input, ['textarea', 'matrix', 'json'].includes(field.type) && a.textarea]}
          value={typeof value === 'string' ? value : ''}
          onChangeText={setValue}
          placeholder={field.placeholder}
          multiline={['textarea', 'matrix', 'json'].includes(field.type)}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={field.type === 'number' ? 'numbers-and-punctuation' : 'default'}
          maxLength={100000}
        />
      )}
      {field.type === 'number' && (
        <Text style={a.muted}>
          {field.step === 1 ? '整数' : '数值'}
          {field.min != null ? ' · 最小 ' + field.min : ''}
          {field.max != null ? ' · 最大 ' + field.max : ''}
        </Text>
      )}
    </View>
  );
}
const cellText = (value: unknown) => (value === null || value === undefined ? '—' : String(value));
function ResultTable({ table }: { table: AcademicResult['tables'][number] }) {
  const [page, setPage] = useState(0),
    size = 20;
  const last = Math.max(0, Math.ceil(table.rows.length / size) - 1),
    current = Math.min(page, last);
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>{table.title}</Text>
      <Text style={a.muted}>横向滑动查看所有列 · 共 {table.rows.length} 行</Text>
      <ScrollView horizontal nestedScrollEnabled accessibilityLabel={table.title + '数据表'}>
        <View>
          <View style={s.tableRow}>
            {table.columns.map((c) => (
              <Text key={c.key} style={[s.cell, s.header]}>
                {c.title}
              </Text>
            ))}
          </View>
          {table.rows.slice(current * size, (current + 1) * size).map((row, i) => (
            <View key={current * size + i} style={s.tableRow}>
              {table.columns.map((c) => (
                <Text selectable key={c.key} style={s.cell}>
                  {cellText(row[c.key])}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {last > 0 && (
        <View style={a.row}>
          <AButton title="前20行" secondary disabled={current === 0} onPress={() => setPage(current - 1)} />
          <Text style={a.muted}>
            第 {current + 1} / {last + 1} 页
          </Text>
          <AButton title="后20行" secondary disabled={current >= last} onPress={() => setPage(current + 1)} />
        </View>
      )}
    </View>
  );
}
function CategoryBars({ chart }: { chart: NonNullable<AcademicResult['categoryChart']> }) {
  const valid =
    Array.isArray(chart.categories) &&
    chart.categories.length > 0 &&
    chart.categories.length <= 100 &&
    Array.isArray(chart.series) &&
    chart.series.length > 0 &&
    chart.series.length <= 10 &&
    chart.series.every(
      (s) =>
        Array.isArray(s.values) &&
        s.values.length === chart.categories.length &&
        s.values.every((n) => Number.isFinite(n) && n >= 0),
    );
  if (!valid) return <Text style={a.notice}>此记录的分类图数据无法绘制，请查阅结果表格。</Text>;
  const max = Math.max(0, ...chart.series.flatMap((s) => s.values));
  const colors = ['#7651c7', '#1e8c86', '#be6845', '#557eb1'];
  return (
    <View style={a.card} accessibilityLabel={chart.title}>
      <Text style={a.subtitle}>{chart.title}</Text>
      <Text style={a.muted}>{chart.yAxisLabel || '数值'} · 从 0 起，同一比例刻度</Text>
      {chart.categories.map((category, i) => (
        <View key={category + i} style={{ gap: 7 }}>
          <Text style={a.body}>{category}</Text>
          {chart.series.map((series, j) => (
            <View
              key={series.name + j}
              accessibilityLabel={`${category}，${series.name}，${series.values[i]}`}
            >
              <Text selectable style={a.muted}>
                {series.name}：{series.values[i]}
              </Text>
              <View style={s.track}>
                <View
                  style={{
                    height: 12,
                    width: `${max === 0 ? 0 : (series.values[i] / max) * 100}%`,
                    backgroundColor: colors[j % colors.length],
                    borderRadius: 3,
                  }}
                />
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
export function AcademicResultView({
  result,
  title = '实验结果',
}: {
  result: AcademicResult;
  title?: string;
}) {
  return (
    <View style={{ gap: 14 }}>
      <View style={a.card}>
        <Text style={a.subtitle}>{title}</Text>
        <Text selectable style={a.body}>
          {result.summary}
        </Text>
        <View style={s.metrics}>
          {result.metrics.map((m, i) => (
            <View key={m.label + i} style={s.metric}>
              <Text style={a.muted}>{m.label}</Text>
              <Text selectable style={a.subtitle}>
                {String(m.value)}
                {m.unit ? ' ' + m.unit : ''}
              </Text>
            </View>
          ))}
        </View>
      </View>
      {result.categoryChart && <CategoryBars chart={result.categoryChart} />}
      {result.chart && (
        <ResultTable
          table={{
            title: result.chart.title + ' · 曲线数据',
            columns: [
              { key: 'x', title: '横坐标 x' },
              { key: 'y', title: '纵坐标 y' },
              { key: 'label', title: '标签' },
            ],
            rows: result.chart.points.map((p) => ({ x: p.x, y: p.y, label: p.label || '' })),
          }}
        />
      )}
      {result.tables.map((table, i) => (
        <ResultTable key={i + table.title} table={table} />
      ))}
      {result.sections.map((section, i) => (
        <View style={a.card} key={i + section.title}>
          <Text style={a.subtitle}>{section.title}</Text>
          <Text selectable style={section.status === 'warning' ? a.notice : a.body}>
            {section.content}
          </Text>
        </View>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  tableRow: { flexDirection: 'row' },
  cell: {
    width: 160,
    padding: 10,
    borderBottomWidth: 1,
    borderColor: '#e7e3ee',
    color: '#514d64',
    fontSize: 14,
    lineHeight: 23,
  },
  header: { fontWeight: '700', backgroundColor: '#f2eff8' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { flexGrow: 1, flexBasis: '45%', padding: 12, backgroundColor: '#f5f2fb', borderRadius: 10 },
  track: { height: 12, backgroundColor: '#efedf4', borderRadius: 3 },
});
