import React, { useState } from 'react';
import { Text, View, ScrollView } from 'react-native';
import { a, AButton } from './assignment-ui';
import { useResource } from './resource';
import { confirmAction, Field, State, useSave } from './staff-ui';
import type { MobileClient } from './client';
type Join = { id: string; status: string; organization: { name: string }; note: string };
const statuses: Record<string, string> = {
  PENDING: '待审核',
  APPROVED: '已批准',
  REJECTED: '已拒绝',
  CANCELLED: '已取消',
};
export function Organization({ client }: { client: MobileClient }) {
  const base = '/mobile/organization',
    info = useResource<{
      accountMode: string;
      canReturnToPersonal: boolean;
      organization: { name: string } | null;
    }>(client, base),
    requests = useResource<{ items: Join[] }>(client, base + '/requests');
  const write = useSave(client);
  const [code, setCode] = useState(''),
    [note, setNote] = useState('');
  return (
    <ScrollView contentContainerStyle={a.page}>
      <State resource={info} />
      {info.data && !info.error && (
        <View style={a.card}>
          <Text style={a.title}>{info.data.organization?.name || '个人学习空间'}</Text>
          {info.data.accountMode === 'PERSONAL' && (
            <>
              <Field label="机构邀请码" value={code} set={setCode} />
              <Field multiline label="申请说明（选填）" value={note} set={setNote} />
              <AButton
                title="提交加入申请"
                disabled={
                  write.busy ||
                  code.trim().length < 16 ||
                  requests.data?.items.some((r) => r.status === 'PENDING')
                }
                onPress={() =>
                  void write.save(base + '/requests', { inviteCode: code, note }, 'POST', () => {
                    setCode('');
                    setNote('');
                    requests.reload();
                  })
                }
              />
            </>
          )}
          {info.data.canReturnToPersonal && (
            <AButton
              secondary
              title="返回个人空间"
              disabled={write.busy}
              onPress={() =>
                confirmAction(
                  '离开机构',
                  '离开后需重新登录，机构课程访问权限也会结束。',
                  () => void write.save(base + '/leave', {}, 'POST', () => void client.clear()),
                )
              }
            />
          )}
        </View>
      )}
      {!!write.notice && <Text style={a.notice}>{write.notice}</Text>}
      <Text style={a.subtitle}>我的申请</Text>
      <State resource={requests} />
      {!requests.error &&
        requests.data?.items.map((row) => (
          <View key={row.id} style={a.card}>
            <Text>
              {row.organization.name} · {statuses[row.status]}
            </Text>
            <Text>{row.note}</Text>
            {row.status === 'PENDING' && (
              <AButton
                secondary
                title="取消申请"
                disabled={write.busy}
                onPress={() =>
                  confirmAction(
                    '取消加入申请',
                    row.organization.name,
                    () =>
                      void write.save(base + '/requests/' + row.id + '/cancel', {}, 'POST', requests.reload),
                  )
                }
              />
            )}
          </View>
        ))}
      {requests.data?.items.length === 0 && <Text>暂无加入申请</Text>}
    </ScrollView>
  );
}
