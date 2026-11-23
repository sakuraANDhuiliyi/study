import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import type { MobileClient } from './client';
import type { LeaveGuard } from './Assignments';
import { a, AButton } from './assignment-ui';
import { AcademicQuery, useAcademicLeave, useAcademicLive } from './academic-ui';
import { useResource } from './resource';
import { nativePreviewUrl } from './android-studio-model';
export function NativeProgrammingPreview({
  client,
  id,
  registerLeave,
}: {
  client: MobileClient;
  id: string;
  registerLeave?: (guard: LeaveGuard) => void;
}) {
  const project = useResource<{ title: string; revision: number }>(
      client,
      '/mobile/programming/projects/' + encodeURIComponent(id),
    ),
    status = useResource<{ available: boolean; reason: string; origin: string }>(
      client,
      '/mobile/programming-preview/status',
    ),
    alive = useAcademicLive(client),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [expires, setExpires] = useState('');
  useAcademicLeave(registerLeave, false, busy);
  const open = async () => {
    if (busy || !project.data) return;
    setBusy(true);
    setError('');
    try {
      const result = await client.request<{ url: string; origin: string; expiresAt: string }>(
        '/mobile/programming-preview/projects/' + encodeURIComponent(id),
        { revision: project.data.revision },
        'POST',
      );
      if (!alive()) return;
      const url = nativePreviewUrl(client.origin, result);
      if (!alive()) return;
      await Linking.openURL(url);
      if (alive()) setExpires(result.expiresAt);
    } catch (e) {
      if (alive()) {
        setError((e as Error).message);
        if ((e as { status?: number }).status === 409) project.reload();
      }
    } finally {
      if (alive()) setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={a.page}>
      <Text style={a.title}>网站隔离预览</Text>
      <AcademicQuery {...project} retry={project.reload} />
      <AcademicQuery {...status} retry={status.reload} />
      <View style={a.card}>
        <Text style={a.subtitle}>{project.data?.title}</Text>
        <Text style={a.body}>在系统浏览器运行服务器上已保存的项目快照。尚未保存的编辑不会进入预览。</Text>
        <Text style={a.muted}>
          预览只使用短期项目链接，不向预览网页传递学习平台登录凭据。链接过期或退出账号后需重新打开。
        </Text>
        {status.data && !status.data.available && <Text style={a.error}>{status.data.reason}</Text>}
        {status.data?.origin &&
          ['localhost', '127.0.0.1', '[::1]'].includes(new URL(status.data.origin).hostname) && (
            <Text style={a.muted}>
              当前地址仅供本机访问。真机需要服务器配置手机可访问的独立 HTTPS 预览域名，不能直接访问电脑的
              localhost。
            </Text>
          )}
        <AButton
          title={busy ? '正在准备预览…' : '打开已保存版本的预览'}
          disabled={busy || !project.data || !status.data?.available}
          onPress={() => void open()}
        />
        {expires && <Text style={a.muted}>本次链接到期：{new Date(expires).toLocaleString()}</Text>}
        {error && <Text style={a.error}>{error}</Text>}
      </View>
    </ScrollView>
  );
}
