import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import type { MobileClient } from './client';
import type { LeaveGuard } from './Assignments';
import { a, AButton } from './assignment-ui';
import { Pager, State, usePage } from './staff-ui';
import { teachingRoot, type TeachingMember } from './teaching-model';
export type TeachingGuard = (g: LeaveGuard) => void;
export function useTeachingOperation(client: MobileClient) {
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    alive = useRef(true),
    flight = useRef(false),
    epoch = useRef(client.sessionEpoch());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const live = () => alive.current && client.ownsSession(epoch.current);
  const run = async <T,>(operation: () => Promise<T>, done?: (result: T) => void) => {
    if (flight.current || !live()) return;
    flight.current = true;
    setBusy(true);
    setNotice('');
    try {
      const result = await operation();
      if (live()) {
        setNotice('操作已完成');
        done?.(result);
      }
    } catch (e) {
      if (live()) setNotice((e as Error).message);
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  return { busy, notice, run, live };
}
export function useTeachingGuard(dirty: boolean, busy: boolean, register: TeachingGuard, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    register(
      busy
        ? () => Alert.alert('正在处理', '请等待操作完成')
        : dirty
          ? (go) =>
              Alert.alert('放弃未保存的修改？', '离开后，本页未保存的输入将丢失。', [
                { text: '继续编辑', style: 'cancel' },
                { text: '放弃并离开', style: 'destructive', onPress: go },
              ])
          : null,
    );
    return () => register(null);
  }, [dirty, busy, register, enabled]);
}
export function TeachingNotice({ operation }: { operation: { notice: string } }) {
  return operation.notice ? (
    <Text accessibilityRole="alert" style={a.notice}>
      {operation.notice}
    </Text>
  ) : null;
}
export function TeachingAudience({
  client,
  course,
  ids,
  change,
  kind = 'student',
}: {
  client: MobileClient;
  course: string;
  ids: string[];
  change(ids: string[]): void;
  kind?: 'student' | 'teacher';
}) {
  const [page, setPage] = useState(1);
  const q = usePage<TeachingMember>(
    client,
    teachingRoot + '/courses/' + encodeURIComponent(course) + '/members?kind=' + kind,
    page,
  );
  return (
    <View style={a.child}>
      <Text style={a.body}>
        {kind === 'student' ? '选择学生' : '选择阅卷教师'}（已选 {ids.length} 人）
      </Text>
      <State resource={q} />
      {!q.error &&
        q.data?.items.map((u) => (
          <AButton
            key={u.id}
            secondary={!ids.includes(u.id)}
            title={(ids.includes(u.id) ? '✓ ' : '') + u.name + ' · ' + u.username}
            onPress={() => change(ids.includes(u.id) ? ids.filter((id) => id !== u.id) : [...ids, u.id])}
          />
        ))}
      {q.data && <Pager page={page} total={q.data.total} change={setPage} />}
    </View>
  );
}

const TeachingBusy = createContext(false);
export function TeachingPanel({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <TeachingBusy.Provider value={busy}>
      <View style={a.card} pointerEvents={busy ? 'none' : 'auto'}>
        {children}
      </View>
    </TeachingBusy.Provider>
  );
}
export function TeachingField({
  label,
  value,
  set,
  multiline = false,
}: {
  label: string;
  value: string;
  set(v: string): void;
  multiline?: boolean;
}) {
  const busy = useContext(TeachingBusy);
  return (
    <View>
      <Text style={a.body}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={[a.input, multiline && a.textarea]}
        value={value}
        onChangeText={set}
        editable={!busy}
        autoCapitalize="none"
        multiline={multiline}
      />
    </View>
  );
}
