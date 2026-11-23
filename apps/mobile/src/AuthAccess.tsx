import React, { useEffect, useRef, useState } from 'react';
import { AppState, Text, TextInput, View } from 'react-native';
import type { MobileClient } from './client';
import { a, AButton } from './assignment-ui';
import { accountPasswordError } from './account-model';

/** Authentication panel embedded in the Router-hosted login shell; secrets stay in memory. */
export function AuthAccess({
  mode,
  prepareClient,
  back,
}: {
  mode: 'register' | 'recover';
  prepareClient(): Promise<MobileClient>;
  back(): void;
}) {
  const [username, setUsername] = useState(''),
    [name, setName] = useState('');
  const [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [code, setCode] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState(false);
  const alive = useRef(true),
    working = useRef(false);
  useEffect(() => {
    alive.current = true;
    const event = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setPassword('');
        setConfirmation('');
        setCode('');
      }
    });
    return () => {
      alive.current = false;
      event.remove();
    };
  }, []);
  async function submit() {
    if (working.current) return;
    const invalid = accountPasswordError(password, confirmation);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (!username.trim() || (mode === 'register' && !name.trim())) {
      setError('请填写账号和姓名。');
      return;
    }
    if (mode === 'recover' && !/^lmsr_[A-Za-z0-9_-]{43}$/.test(code.trim())) {
      setError('请填写完整的恢复码。');
      return;
    }
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const client = await prepareClient();
      if (!alive.current) return;
      if (mode === 'register') await client.register({ username, name, password });
      else {
        await client.recover({ username, code, newPassword: password });
        if (alive.current) setDone(true);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      working.current = false;
      if (alive.current) {
        setBusy(false);
        setPassword('');
        setConfirmation('');
        setCode('');
      }
    }
  }
  if (done)
    return (
      <View style={a.card}>
        <Text style={a.title}>密码已重置</Text>
        <Text style={a.body}>原有登录已退出。请使用新密码登录，并重新生成恢复码。</Text>
        <AButton title="返回登录" onPress={back} />
      </View>
    );
  return (
    <View style={a.card}>
      <Text style={a.title}>{mode === 'register' ? '创建个人学习账号' : '恢复账号'}</Text>
      <Text style={a.muted}>
        {mode === 'register'
          ? '无需组织或邀请码，注册后获得独立个人学习空间。'
          : '输入提前保存的恢复码。机构账号还需管理员先开启恢复许可，个人账号可直接恢复。'}
      </Text>
      <TextInput
        accessibilityLabel="账号"
        placeholder="账号"
        style={a.input}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        maxLength={50}
        editable={!busy}
      />
      {mode === 'register' && (
        <TextInput
          accessibilityLabel="姓名"
          placeholder="姓名或昵称"
          style={a.input}
          value={name}
          onChangeText={setName}
          maxLength={80}
          editable={!busy}
        />
      )}
      {mode === 'recover' && (
        <TextInput
          accessibilityLabel="恢复码"
          placeholder="lmsr_ 开头的恢复码"
          style={a.input}
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          autoComplete="off"
          maxLength={100}
          editable={!busy}
        />
      )}
      <TextInput
        accessibilityLabel="新密码"
        placeholder="新密码（至少12位）"
        style={a.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        maxLength={128}
        editable={!busy}
      />
      <TextInput
        accessibilityLabel="确认新密码"
        placeholder="再次输入新密码"
        style={a.input}
        value={confirmation}
        onChangeText={setConfirmation}
        secureTextEntry
        autoComplete="new-password"
        maxLength={128}
        editable={!busy}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={a.error}>
          {error}
        </Text>
      )}
      <AButton
        title={busy ? '正在处理…' : mode === 'register' ? '注册个人账号' : '重置密码'}
        disabled={busy}
        onPress={() => void submit()}
      />
      <AButton title="返回登录" secondary disabled={busy} onPress={back} />
    </View>
  );
}
