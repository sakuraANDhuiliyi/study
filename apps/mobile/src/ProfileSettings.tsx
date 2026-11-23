import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { a, AButton } from './assignment-ui';
import { Field, confirmAction, useSave } from './staff-ui';
import type { MobileClient, MobileUser } from './client';
export function ProfileSettings({ client, user }: { client: MobileClient; user: MobileUser }) {
  const [name, rename] = useState(user.name),
    [old, oldPass] = useState(''),
    [next, newPass] = useState(''),
    [again, confirm] = useState('');
  const profile = useSave(client),
    account = useSave(client);
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <View style={a.card}>
        <Text style={a.subtitle}>个人资料</Text>
        <Text>{user.username}</Text>
        <Field label="显示姓名" value={name} set={rename} />
        <AButton
          title="保存姓名"
          disabled={!name.trim() || name.trim() === user.name || profile.busy}
          onPress={() =>
            void profile.save('/mobile/organization/profile', { name: name.trim() }, 'PATCH', () =>
              client.refreshProfile(),
            )
          }
        />
        {!!profile.notice && <Text>{profile.notice}</Text>}
      </View>
      <View style={a.card}>
        <Text style={a.subtitle}>修改密码</Text>
        <Field secret label="当前密码" value={old} set={oldPass} />
        <Field secret label="新密码" value={next} set={newPass} />
        <Field secret label="确认新密码" value={again} set={confirm} />
        {!!again && next !== again && <Text style={a.error}>两次新密码不一致</Text>}
        <AButton
          title="更改密码"
          disabled={account.busy || !old || next.length < 12 || next !== again}
          onPress={() =>
            confirmAction(
              '更改密码',
              '保存后所有设备须重新登录，已有恢复码也会失效。',
              () =>
                void account.save(
                  '/mobile/organization/password',
                  { oldPassword: old, newPassword: next },
                  'POST',
                  () => void client.clear(),
                ),
            )
          }
        />
        {!!account.notice && <Text>{account.notice}</Text>}
      </View>
    </ScrollView>
  );
}
