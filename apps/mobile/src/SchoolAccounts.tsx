import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { a, AButton } from './assignment-ui';
import { confirmAction, Field, useSave } from './staff-ui';
import type { MobileClient } from './client';
type Row = { id: string; name?: string; username?: string; active?: boolean; roles?: string[] };
export function SchoolAccountActions({
  client,
  row,
  organization,
  reload,
}: {
  client: MobileClient;
  row: Row;
  organization: boolean;
  reload(): void;
}) {
  const [open, toggle] = useState(false),
    [name, setName] = useState(row.name || ''),
    [reason, setReason] = useState(''),
    [username, login] = useState(''),
    [password, credential] = useState('');
  const [adminName, setAdmin] = useState('');
  const op = useSave(client),
    path = '/mobile/staff/' + (organization ? 'organizations' : 'users') + '/' + encodeURIComponent(row.id);
  return (
    <View>
      <AButton
        secondary
        title={open ? '收起管理' : '管理' + (organization ? '机构' : '账号')}
        onPress={() => {
          toggle(!open);
          credential('');
        }}
      />
      {open && (
        <View style={a.card}>
          <Field label="显示名称" value={name} set={setName} />
          {organization && <Field label="管理理由" value={reason} set={setReason} />}
          <AButton
            secondary
            title="更新名称"
            disabled={op.busy || !name.trim() || (organization && reason.trim().length < 5)}
            onPress={() => void op.save(path, { name, ...(organization ? { reason } : {}) }, 'PATCH', reload)}
          />
          <AButton
            secondary
            title={row.active ? '停用' : '重新启用'}
            disabled={op.busy || (organization && reason.trim().length < 5)}
            onPress={() =>
              confirmAction(
                '更改启用状态',
                row.name || '',
                () =>
                  void op.save(
                    path,
                    { active: !row.active, ...(organization ? { reason } : {}) },
                    'PATCH',
                    reload,
                  ),
              )
            }
          />
          {organization ? (
            <>
              <Text style={a.subtitle}>设置机构管理员</Text>
              <Field label="新管理员姓名" value={adminName} set={setAdmin} />
              <Field label="管理员登录账号" value={username} set={login} />
              <Field secret label="管理员初始密码" value={password} set={credential} />
              <AButton
                title="创建机构管理员"
                disabled={
                  op.busy || !username || !adminName || password.length < 12 || reason.trim().length < 5
                }
                onPress={() =>
                  confirmAction(
                    '创建机构管理员',
                    row.name || '',
                    () =>
                      void op.save(
                        path + '/admins',
                        { name: adminName, username, password, reason },
                        'POST',
                        () => {
                          credential('');
                          login('');
                          setAdmin('');
                          reload();
                        },
                      ),
                  )
                }
              />
            </>
          ) : (
            <AButton
              secondary
              title="开启账号恢复许可"
              disabled={op.busy}
              onPress={() =>
                confirmAction(
                  '开启账号恢复许可',
                  '该用户仍需使用本人预留的恢复码设置新密码。',
                  () => void op.save(path + '/recovery', {}, 'POST', reload),
                )
              }
            />
          )}
          {!!op.notice && <Text>{op.notice}</Text>}
        </View>
      )}
    </View>
  );
}
