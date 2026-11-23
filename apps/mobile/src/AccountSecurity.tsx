import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import type { MobileClient, MobileUser } from './client';
import { accountApi, accountRoles, type DeviceSessions, type RecoveryStatus } from './account-model';
import { useResource } from './resource';
import { a, AButton } from './assignment-ui';
import { formatPlanTime } from './planner-model';

export function AccountSecurity({ client, user }: { client: MobileClient; user: MobileUser }) {
  const sessions = useResource<DeviceSessions>(client, '/mobile/auth/sessions', 30000);
  const recovery = useResource<RecoveryStatus>(client, '/mobile/auth/recovery', 30000);
  const [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const alive = useRef(true),
    working = useRef(false),
    foreground = useRef(true);
  useEffect(() => {
    alive.current = true;
    const clear = () => {
      setPassword('');
      setCode('');
    };
    const off = client.onSessionInvalidated(clear);
    const event = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      if (!foreground.current) clear();
    });
    return () => {
      alive.current = false;
      off();
      event.remove();
    };
  }, [client]);
  async function action(work: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      working.current = false;
      if (alive.current) {
        setBusy(false);
        setPassword('');
      }
    }
  }
  const confirmRole = (role: string) =>
    Alert.alert(
      '切换身份',
      `切换为${accountRoles[role] || role}将离开当前身份页面。仅能使用管理员已授予的权限。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '确认切换', onPress: () => void action(() => client.switchRole(role)) },
      ],
    );
  const revoke = (id: string, current: boolean) =>
    Alert.alert('退出设备会话', current ? '确认退出当前设备？' : '该设备将需要重新登录。', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认退出',
        style: 'destructive',
        onPress: () =>
          void action(async () => {
            const result = await accountApi.revoke(client, id);
            if (result.loginRequired) await client.clear();
            else sessions.reload();
          }),
      },
    ]);
  return (
    <ScrollView
      contentContainerStyle={a.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => {
            sessions.reload();
            recovery.reload();
          }}
        />
      }
    >
      <Text style={a.title}>账号与设备安全</Text>
      <Text style={a.muted}>
        {user.name} · {user.username} · {user.accountMode === 'PERSONAL' ? '个人学习空间' : '机构学习空间'}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={a.error}>
          {error}
        </Text>
      )}
      <View style={a.card}>
        <Text style={a.subtitle}>当前身份：{accountRoles[user.role] || user.role}</Text>
        {user.roles
          .filter((role) => role !== user.role)
          .map((role) => (
            <AButton
              key={role}
              title={'切换为' + (accountRoles[role] || role)}
              secondary
              disabled={busy}
              onPress={() => confirmRole(role)}
            />
          ))}
        {user.roles.length === 1 && <Text style={a.muted}>账号目前只有这一种身份。</Text>}
      </View>
      <View style={a.card}>
        <Text style={a.subtitle}>账号恢复码</Text>
        <Text style={a.body}>
          {recovery.error ||
            (recovery.data
              ? recovery.data.configured
                ? '已设置恢复码。生成新码会立即作废旧码。'
                : '尚未设置恢复码。'
              : '正在读取…')}
        </Text>
        <Text style={a.muted}>
          {recovery.data?.requiresOrganizationApproval
            ? '机构账号需管理员开启恢复许可后，才可在登录页使用恢复码。'
            : '个人账号可在登录页用恢复码重置密码。'}{' '}
          恢复码只显示一次，请离线妥善保存，不要分享给他人。
        </Text>
        <TextInput
          accessibilityLabel="当前密码"
          placeholder="输入当前密码以生成恢复码"
          style={a.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          maxLength={128}
          editable={!busy}
        />
        <AButton
          title="生成新的恢复码"
          disabled={busy || !password}
          onPress={() =>
            Alert.alert('生成恢复码', '旧恢复码将立即失效。请准备好安全保存新码。', [
              { text: '取消', style: 'cancel' },
              {
                text: '确认生成',
                onPress: () =>
                  void action(async () => {
                    const epoch = client.sessionEpoch();
                    setCode('');
                    const result = await accountApi.recoveryCode(client, password);
                    if (!/^lmsr_[A-Za-z0-9_-]{43}$/.test(result.code))
                      throw new Error('恢复码响应无效，请重试。');
                    if (alive.current && foreground.current && client.ownsSession(epoch))
                      setCode(result.code);
                    recovery.reload();
                  }),
              },
            ])
          }
        />
        {!!code && (
          <View style={{ gap: 10 }}>
            <Text selectable accessibilityLabel="新恢复码" style={a.body}>
              {code}
            </Text>
            <AButton title="已保存，隐藏恢复码" secondary onPress={() => setCode('')} />
          </View>
        )}
      </View>
      <View style={a.card}>
        <Text style={a.subtitle}>登录设备与网页会话</Text>
        <Text style={a.muted}>
          共 {sessions.data?.total ?? '—'} 个有效会话，最多显示最近100个。设备名称由登录设备提供。
        </Text>
        {sessions.error && (
          <Text accessibilityRole="alert" style={a.error}>
            {sessions.error}
          </Text>
        )}
        <AButton title="刷新设备列表" secondary onPress={sessions.reload} />
        {!sessions.error &&
          sessions.data?.items.map((item) => (
            <View key={item.id} style={a.card}>
              <Text style={a.subtitle}>
                {item.deviceName}
                {item.current ? '（当前设备）' : ''}
              </Text>
              <Text style={a.muted}>
                {item.clientType === 'MOBILE' ? '手机客户端' : '网页'} ·{' '}
                {accountRoles[item.role] || item.role}
              </Text>
              <Text style={a.muted}>
                登录：{formatPlanTime(item.createdAt)} · 到期：{formatPlanTime(item.expiresAt)}
              </Text>
              <AButton
                title={item.current ? '退出当前设备' : '退出此会话'}
                secondary
                disabled={busy}
                onPress={() => revoke(item.id, item.current)}
              />
            </View>
          ))}
      </View>
    </ScrollView>
  );
}
