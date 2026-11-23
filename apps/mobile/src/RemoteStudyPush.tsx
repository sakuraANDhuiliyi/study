import React, { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import type { MobileClient } from './client';
import { a, AButton } from './assignment-ui';
import { remotePushApi, type RemotePushStatus } from './remote-push-model';
import { enableRemoteStudyPush, remotePushBuildReady } from './remote-push.native';
import { setRemoteStudyBinding } from './study-reminders.native';
export function RemoteStudyPush({ client }: { client: MobileClient }) {
  const [status, setStatus] = useState<RemotePushStatus | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const mounted = useRef(true),
    epoch = useRef(client.sessionEpoch()),
    flight = useRef(false);
  const alive = () => mounted.current && client.ownsSession(epoch.current);
  const read = async () => {
    try {
      const r = await remotePushApi.status(client);
      if (alive()) setStatus(r);
    } catch (e) {
      if (alive()) setMessage((e as Error).message);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void read();
    return () => {
      mounted.current = false;
    };
  }, [client]);
  const change = async (enable: boolean) => {
    if (flight.current || !status) return;
    flight.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (enable) await enableRemoteStudyPush(client, status);
      else {
        await remotePushApi.remove(client);
        setRemoteStudyBinding(null);
      }
      if (alive()) {
        setMessage(
          enable
            ? '设备已绑定当前身份。新的学习通知会通过系统通道提醒；收件箱仍是查看与已读的依据。'
            : '此手机会话已关闭远程通知。学习收件箱与本机提醒不受影响。',
        );
        await read();
      }
    } catch (e) {
      if (alive()) setMessage((e as Error).message);
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>系统远程通知</Text>
      <Text style={a.muted}>
        主动授权后，服务器将新的学习动态发送到这台手机。锁屏仅显示通用提示，点开后重新核对登录身份和收件箱；不会把课程、成绩或私信正文发给推送服务。
      </Text>
      <Text style={a.notice}>
        {status?.enabled
          ? '当前手机身份已启用'
          : !remotePushBuildReady()
            ? '此安装包未配置远程推送；仍可使用收件箱和本机提醒'
            : status?.reason || '尚未启用远程通知'}
      </Text>
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={a.notice}>
          {message}
        </Text>
      )}
      <AButton
        title={status?.enabled ? '关闭远程学习通知' : '授权并启用远程学习通知'}
        secondary
        disabled={busy || !status || (!status.enabled && (!status.available || !remotePushBuildReady()))}
        onPress={() =>
          Alert.alert(
            status?.enabled ? '关闭远程通知？' : '授权系统远程通知？',
            status?.enabled
              ? '仅关闭当前手机身份，原学习收件箱保留。'
              : '平台仅向官方Expo推送服务发送设备标识和通用提示，不发送学习正文。',
            [
              { text: '取消', style: 'cancel' },
              {
                text: status?.enabled ? '确认关闭' : '授权并启用',
                onPress: () => void change(!status?.enabled),
              },
            ],
          )
        }
      />
      <AButton title="刷新远程通知状态" secondary disabled={busy} onPress={() => void read()} />
    </View>
  );
}
