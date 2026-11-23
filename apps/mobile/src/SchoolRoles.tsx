import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { MobileUser, MobileClient } from './client';
import { a, AButton } from './assignment-ui';
import { PersonPicker } from './SchoolSetup';
import { confirmAction, Field, Pager, Picker, State, usePage, useSave } from './staff-ui';
import { useResource } from './resource';
type Permission = { id: string; name: string; sensitive: boolean };
type Role = { id: string; name: string; permissions: { permissionId: string }[] };
export function SchoolRoles({ client, user }: { client: MobileClient; user: MobileUser }) {
  const base = '/mobile/staff/roles',
    roles = useResource<{ items: Role[]; permissions: Permission[] }>(client, base),
    action = useSave(client);
  const [role, choose] = useState(''),
    [permissions, toggle] = useState<string[]>([]),
    [reason, explain] = useState('');
  const canEdit = user.permissions.includes('roles.manage') && !user.roles.includes(role);
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>角色权限</Text>
      <State resource={roles} />
      {roles.data && !roles.error && (
        <>
          <Picker
            label="角色模板"
            items={roles.data.items}
            id={role}
            change={(id) => {
              choose(id);
              toggle(roles.data!.items.find((r) => r.id === id)!.permissions.map((p) => p.permissionId));
              explain('');
            }}
          />
          {!!role && (
            <>
              {roles.data.permissions.map((p) => (
                <AButton
                  secondary
                  key={p.id}
                  disabled={!canEdit}
                  title={(permissions.includes(p.id) ? '已选 · ' : '未选 · ') + p.name}
                  onPress={() =>
                    toggle(
                      permissions.includes(p.id)
                        ? permissions.filter((x) => x !== p.id)
                        : [...permissions, p.id],
                    )
                  }
                />
              ))}
              {canEdit && (
                <>
                  <Field label="变更理由" value={reason} set={explain} />
                  <AButton
                    title="保存角色权限"
                    disabled={action.busy || reason.trim().length < 5}
                    onPress={() =>
                      confirmAction(
                        '修改角色模板',
                        '此操作会影响使用该模板的账号。',
                        () =>
                          void action.save(base + '/' + role, { permissions, reason }, 'PATCH', () => {
                            roles.reload();
                            choose('');
                          }),
                      )
                    }
                  />
                </>
              )}
            </>
          )}
          {user.permissions.includes('grants.manage') && (
            <Grants client={client} permissions={roles.data.permissions} />
          )}
        </>
      )}
      {!!action.notice && <Text>{action.notice}</Text>}
    </View>
  );
}
function Grants({ client, permissions }: { client: MobileClient; permissions: Permission[] }) {
  const base = '/mobile/staff/grants',
    action = useSave(client);
  const [page, selectPage] = useState(1),
    [id, select] = useState(''),
    [permission, choose] = useState(''),
    [end, setEnd] = useState(''),
    [reason, setReason] = useState('');
  const q = usePage<{ id: string; userName: string; permissionId: string; expiresAt: string }>(
    client,
    base,
    page,
  );
  return (
    <View>
      <Text style={a.subtitle}>有期限的敏感授权</Text>
      <PersonPicker client={client} id={id} change={select} />
      <Picker
        label="敏感权限"
        items={permissions.filter((x) => x.sensitive)}
        id={permission}
        change={choose}
      />
      <Field label="到期时间（未来30天内，例如 2026-12-01T18:00）" value={end} set={setEnd} />
      <Field label="授权或撤销理由" value={reason} set={setReason} />
      <AButton
        title="确认授权"
        disabled={
          action.busy || !id || !permission || reason.trim().length < 5 || !(Date.parse(end) > Date.now())
        }
        onPress={() =>
          confirmAction(
            '授予敏感权限',
            permissions.find((x) => x.id === permission)?.name || permission,
            () =>
              void action.save(
                base,
                { userId: id, permissionId: permission, reason, expiresAt: new Date(end).toISOString() },
                'POST',
                q.reload,
              ),
          )
        }
      />
      <State resource={q} />
      {q.data && !q.error && (
        <>
          {q.data.items.map((x) => (
            <View key={x.id}>
              <Text>
                {x.userName} · {x.permissionId} · {new Date(x.expiresAt).toLocaleString()}
              </Text>
              <AButton
                title="撤销授权"
                secondary
                disabled={action.busy || reason.trim().length < 5}
                onPress={() =>
                  confirmAction(
                    '撤销授权',
                    x.userName,
                    () => void action.save(base + '/' + x.id, { reason }, 'DELETE', q.reload),
                  )
                }
              />
            </View>
          ))}
          <Pager page={page} total={q.data.total} change={selectPage} />
        </>
      )}
      {!!action.notice && <Text>{action.notice}</Text>}
    </View>
  );
}
