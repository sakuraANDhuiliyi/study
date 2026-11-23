import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, ScrollView, Text, TextInput, View } from 'react-native';
import { MobileApiError, type MobileClient } from './client';
import { a, AButton } from './assignment-ui';
import type { LeaveGuard } from './Assignments';
import {
  focusApi,
  focusCategories,
  focusElapsed,
  startFocus,
  toggleFocusPause,
  finishFocus,
  sameFocusRecord,
  type FocusInput,
  type FocusMode,
  type FocusTimer,
} from './personal-learning-model';
const modes = { FOCUS: '专注', SHORT_BREAK: '短休息', LONG_BREAK: '长休息' };
export function Focus({
  client,
  registerLeave,
}: {
  client: MobileClient;
  registerLeave(guard: LeaveGuard): void;
}) {
  const [title, setTitle] = useState(''),
    [category, setCategory] = useState<string>('自由专注'),
    [mode, setMode] = useState<FocusMode>('FOCUS'),
    [minutes, setMinutes] = useState('25'),
    [timer, setTimer] = useState<FocusTimer | null>(null),
    [now, setNow] = useState(Date.now()),
    [ended, setEnded] = useState<FocusInput | null>(null),
    [reflection, setReflection] = useState(''),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [message, setMessage] = useState('');
  const [history, setHistory] = useState<Awaited<ReturnType<typeof focusApi.list>> | null>(null),
    [summary, setSummary] = useState<Awaited<ReturnType<typeof focusApi.summary>> | null>(null);
  const mounted = useRef(true),
    epoch = useRef(client.sessionEpoch()),
    flight = useRef(false),
    pending = useRef<FocusInput | null>(null),
    sequence = useRef(0);
  const alive = () => mounted.current && client.ownsSession(epoch.current);
  const read = async (page = 1) => {
    const seq = ++sequence.current;
    try {
      const [rows, stats] = await Promise.all([focusApi.list(client, page), focusApi.summary(client)]);
      if (alive() && seq === sequence.current) {
        setHistory(rows);
        setSummary(stats);
      }
    } catch (e) {
      if (alive() && seq === sequence.current) setMessage((e as Error).message);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void read();
    const interval = setInterval(() => setNow(Date.now()), 1000);
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setNow(Date.now());
        void read();
      }
    });
    const off = client.onSessionInvalidated(() => {
      mounted.current = false;
      pending.current = null;
      setTimer(null);
      setEnded(null);
      setTitle('');
      setReflection('');
      setHistory(null);
      setSummary(null);
    });
    return () => {
      mounted.current = false;
      clearInterval(interval);
      app.remove();
      off();
    };
  }, [client]);
  useEffect(() => {
    if (timer && !ended && focusElapsed(timer, now) >= timer.plannedMinutes * 60000) {
      setEnded(finishFocus(timer, now));
      setMessage('计时已完成，请填写复盘后保存。后台经过的时间已按起止时间核对。');
    }
  }, [timer, now, ended]);
  useEffect(() => {
    registerLeave(
      timer || ended || busy || unknown
        ? (proceed) => {
            if (flight.current) {
              Alert.alert('正在保存专注记录', '请等待保存结果。');
              return;
            }
            if (timer && !ended) {
              Alert.alert('专注计时仍在进行', '返回桌面或锁屏后计时继续；离开此页面前，请先完成或中断计时。');
              return;
            }
            Alert.alert(
              '离开专注空间？',
              unknown ? '保存结果尚未确认，重新进入后先核对记录。' : '本次计时尚未保存，离开会丢失记录。',
              [
                { text: '继续保存', style: 'cancel' },
                { text: '放弃并离开', style: 'destructive', onPress: proceed },
              ],
            );
          }
        : null,
    );
    return () => registerLeave(null);
  }, [timer, ended, busy, unknown, registerLeave]);
  const start = () => {
    try {
      setTimer(startFocus(title, category, mode, Number(minutes), Date.now()));
      setNow(Date.now());
      setReflection('');
      setMessage('');
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const end = () => {
    if (!timer) return;
    try {
      setEnded(finishFocus(timer, Date.now()));
      setMessage('已停止计时，请保存这次中断记录。');
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const accept = () => {
    pending.current = null;
    setUnknown(false);
    setTimer(null);
    setEnded(null);
    setReflection('');
    setMessage('专注记录已保存。只有完成的专注模式计入统计，休息与中断不计入。');
    void read();
  };
  const save = async (retry = false) => {
    if (flight.current || !ended) return;
    const input = retry ? pending.current : { ...ended, reflection: reflection.trim() || null };
    if (!input) return;
    if ((input.reflection?.length || 0) > 500 || input.reflection?.includes('\0')) {
      setMessage('复盘最多500字符，不能包含空字符');
      return;
    }
    pending.current = input;
    flight.current = true;
    setBusy(true);
    try {
      await focusApi.create(client, input);
      if (alive()) accept();
    } catch (e) {
      if (alive()) {
        setMessage((e as Error).message);
        setUnknown(
          !(e instanceof MobileApiError && [400, 401, 403, 404, 409, 413, 422, 429].includes(e.status)),
        );
      }
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  const check = async () => {
    if (flight.current || !pending.current) return;
    flight.current = true;
    setBusy(true);
    try {
      const rows = await focusApi.list(client);
      if (!alive()) return;
      setHistory(rows);
      const match = rows.items.find((row) => row.startedAt === pending.current!.startedAt);
      if (match && sameFocusRecord(pending.current, match)) accept();
      else
        setMessage(
          match
            ? '服务器该次记录不同，请保留现状并核对历史。'
            : '当前首页尚未找到这次记录。可手动重试同一份冻结记录；服务器会按开始时间防止重复保存。',
        );
    } catch (e) {
      if (alive()) setMessage((e as Error).message);
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  const remaining = timer
    ? Math.max(0, timer.plannedMinutes * 60 - Math.floor(focusElapsed(timer, now) / 1000))
    : 0;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={a.page}>
      <Text style={a.title}>私人专注空间</Text>
      <Text style={a.muted}>
        返回桌面或锁屏后按真实时间继续计时；暂停时间不计入。关闭应用进程不会在服务器自动补造计时记录。
      </Text>
      {message ? (
        <Text accessibilityLiveRegion="polite" style={a.notice}>
          {message}
        </Text>
      ) : null}
      {summary && (
        <Text style={a.notice}>
          今日完成 {summary.todayMinutes} 分钟 · 本周 {summary.weekMinutes} 分钟 · 连续 {summary.streakDays}{' '}
          天
        </Text>
      )}
      {!timer && !ended && (
        <View style={a.card}>
          <TextInput
            accessibilityLabel="专注主题"
            value={title}
            onChangeText={setTitle}
            maxLength={120}
            style={a.input}
            placeholder="这次想完成什么？"
          />
          <View style={a.row}>
            {focusCategories.map((value) => (
              <AButton
                key={value}
                title={value}
                secondary={category !== value}
                onPress={() => setCategory(value)}
              />
            ))}
          </View>
          <View style={a.row}>
            {(['FOCUS', 'SHORT_BREAK', 'LONG_BREAK'] as const).map((value) => (
              <AButton
                key={value}
                title={modes[value]}
                secondary={mode !== value}
                onPress={() => {
                  setMode(value);
                  setMinutes(value === 'FOCUS' ? '25' : value === 'SHORT_BREAK' ? '5' : '15');
                }}
              />
            ))}
          </View>
          <TextInput
            accessibilityLabel="计划专注分钟"
            value={minutes}
            onChangeText={setMinutes}
            keyboardType="number-pad"
            maxLength={3}
            style={a.input}
          />
          <AButton title="开始计时" onPress={start} />
        </View>
      )}
      {timer && (
        <View style={a.card}>
          <Text style={a.subtitle}>
            {timer.title} · {modes[timer.mode]}
          </Text>
          <Text style={[a.title, { fontSize: 42, lineHeight: 54 }]}>
            {String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}
          </Text>
          <Text style={a.muted}>
            {ended
              ? ended.status === 'COMPLETED'
                ? '计时完成'
                : '已中断'
              : timer.resumedAt === null
                ? '已暂停'
                : '计时中'}
          </Text>
          {!ended && (
            <View style={a.row}>
              <AButton
                title={timer.resumedAt === null ? '继续计时' : '暂停计时'}
                onPress={() => {
                  setTimer((value) => (value ? toggleFocusPause(value, Date.now()) : null));
                  setNow(Date.now());
                }}
              />
              <AButton
                title="中断本次计时"
                secondary
                onPress={() =>
                  Alert.alert('中断本次计时？', '保留已计时的时长，之后可保存为中断记录。', [
                    { text: '继续专注', style: 'cancel' },
                    { text: '确认中断', onPress: end },
                  ])
                }
              />
            </View>
          )}
        </View>
      )}
      {ended && (
        <View style={a.card}>
          <Text style={a.subtitle}>
            {ended.status === 'COMPLETED' ? '完成' : '中断'}记录 · {ended.actualSeconds} 秒
          </Text>
          <TextInput
            accessibilityLabel="专注复盘"
            value={reflection}
            onChangeText={setReflection}
            maxLength={500}
            multiline
            editable={!busy && !unknown}
            style={[a.input, a.textarea]}
            placeholder="记录收获或中断原因（可选）"
          />
          {!unknown && <AButton title="保存本次专注记录" disabled={busy} onPress={() => void save()} />}
          {unknown && (
            <>
              <AButton title="核对专注保存结果" disabled={busy} onPress={() => void check()} />
              <AButton title="重试保存同一记录" disabled={busy} secondary onPress={() => void save(true)} />
            </>
          )}
        </View>
      )}
      <AButton title="刷新专注历史" secondary onPress={() => void read()} />
      {history && (
        <>
          <Text style={a.subtitle}>本人记录 · 共 {history.total} 次</Text>
          {history.items.map((row) => (
            <View style={a.card} key={row.id}>
              <Text style={a.subtitle}>{row.title}</Text>
              <Text style={a.muted}>
                {modes[row.mode]} · {row.status === 'COMPLETED' ? '完成' : '中断'} · {row.actualSeconds} 秒 ·{' '}
                {new Date(row.endedAt).toLocaleString()}
              </Text>
              {row.reflection && (
                <Text selectable style={a.body}>
                  {row.reflection}
                </Text>
              )}
            </View>
          ))}
          <View style={a.row}>
            <AButton
              title="上一页专注记录"
              secondary
              disabled={history.page <= 1}
              onPress={() => void read(history.page - 1)}
            />
            <AButton
              title="下一页专注记录"
              secondary
              disabled={history.page * history.pageSize >= history.total}
              onPress={() => void read(history.page + 1)}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}
