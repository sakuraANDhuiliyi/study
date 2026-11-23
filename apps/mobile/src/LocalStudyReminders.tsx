import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import type { MobileClient, MobileUser } from './client';
import { a, AButton } from './assignment-ui';
import { deviceLearningScope } from './offline-review.native';
import { cancelStudyReminders, scheduleStudyReminder, studyReminderList } from './study-reminders.native';
import { reminderTime } from './offline-review-model';
export function LocalStudyReminders({ client, user }: { client: MobileClient; user: MobileUser }) {
  const [hour, setHour] = useState('20'),
    [minute, setMinute] = useState('00'),
    [message, setMessage] = useState(''),
    [items, setItems] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const mounted = useRef(true),
    epoch = useRef(client.sessionEpoch()),
    flight = useRef(false);
  const alive = () => mounted.current && client.ownsSession(epoch.current);
  const read = async () => {
    try {
      const next = await studyReminderList(await deviceLearningScope(client.origin, user));
      if (alive())
        setItems(
          next.map((item) => (item.identifier.endsWith('-daily') ? '每日学习提醒' : '一次性学习提醒')),
        );
    } catch (e) {
      if (alive()) setMessage((e as Error).message);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void read();
    const off = client.onSessionInvalidated(() => {
      mounted.current = false;
      setItems([]);
    });
    return () => {
      mounted.current = false;
      off();
    };
  }, [client, user.id, user.organizationId, user.role]);
  const perform = async (kind: 'daily' | 'test' | 'later' | 'clear') => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setMessage('');
    try {
      const scope = await deviceLearningScope(client.origin, user);
      if (kind === 'clear') {
        await cancelStudyReminders(scope);
        if (alive()) setMessage('本身份的本机学习提醒已取消。');
      } else {
        if (kind === 'daily' && (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)))
          throw new Error('请填写有效的小时（0–23）和分钟（0–59）');
        const plan =
          kind === 'daily'
            ? { kind: 'daily' as const, ...reminderTime(Number(hour), Number(minute)) }
            : { kind: 'once' as const, seconds: kind === 'test' ? 10 : 600 };
        await scheduleStudyReminder(scope, plan, alive);
        if (alive())
          setMessage(
            kind === 'daily'
              ? `已设置每天 ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} 提醒（设备当前时区）。`
              : kind === 'test'
                ? '已安排10秒后的测试提醒，可返回桌面验证。'
                : '已安排10分钟后的学习提醒。',
          );
      }
      if (alive()) await read();
    } catch (e) {
      if (alive()) setMessage((e as Error).message);
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <Text style={a.title}>本机学习提醒</Text>
      <Text style={a.muted}>
        提醒由这台手机的系统安排，不需要服务器推送配置。通知不包含笔记、课程或账号信息；注销或切换身份会清理该身份的提醒。系统省电设置可能影响到达时间。
      </Text>
      {message ? (
        <Text accessibilityLiveRegion="polite" style={a.notice}>
          {message}
        </Text>
      ) : null}
      <View style={a.card}>
        <Text style={a.subtitle}>每天复习</Text>
        <View style={a.row}>
          <TextInput
            accessibilityLabel="每日提醒小时"
            value={hour}
            onChangeText={setHour}
            keyboardType="number-pad"
            maxLength={2}
            style={a.input}
          />
          <Text>:</Text>
          <TextInput
            accessibilityLabel="每日提醒分钟"
            value={minute}
            onChangeText={setMinute}
            keyboardType="number-pad"
            maxLength={2}
            style={a.input}
          />
        </View>
        <AButton title="设置每日学习提醒" disabled={busy} onPress={() => void perform('daily')} />
        <AButton title="10分钟后提醒我" disabled={busy} secondary onPress={() => void perform('later')} />
        <AButton
          title="测试系统通知（10秒后）"
          disabled={busy}
          secondary
          onPress={() => void perform('test')}
        />
      </View>
      <Text style={a.subtitle}>已安排提醒</Text>
      {items.length ? (
        items.map((item) => (
          <Text style={a.body} key={item}>
            {item}
          </Text>
        ))
      ) : (
        <Text style={a.muted}>当前身份没有待发送的本机提醒。</Text>
      )}
      <AButton title="刷新本机提醒" disabled={busy} secondary onPress={() => void read()} />
      <AButton
        title="取消本身份全部本机提醒"
        disabled={busy}
        secondary
        onPress={() =>
          Alert.alert('取消本机学习提醒？', '只取消当前身份安排的本机提醒。', [
            { text: '保留', style: 'cancel' },
            { text: '确认取消', onPress: () => void perform('clear') },
          ])
        }
      />
    </ScrollView>
  );
}
