import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { a, AButton } from './assignment-ui';
import { useResource } from './resource';
import type { MobileClient, MobileUser } from './client';
import { confirmAction, Field, Pager, Picker, State, usePage, useSave, type Option } from './staff-ui';

const staff = '/mobile/staff';
export function PersonPicker({
  client,
  role,
  id,
  change,
}: {
  client: MobileClient;
  role?: string;
  id: string;
  change(id: string): void;
}) {
  const [page, pageTo] = useState(1),
    [search, find] = useState('');
  const q = usePage<Option & { username: string }>(
    client,
    staff + '/people?search=' + encodeURIComponent(search) + (role ? '&role=' + role : ''),
    page,
  );
  return (
    <View>
      <Field
        label="按姓名查找人员"
        value={search}
        set={(s) => {
          find(s);
          pageTo(1);
          change('');
        }}
      />
      <State resource={q} />
      {q.data && !q.error && (
        <>
          <Picker
            label="选择人员"
            items={q.data.items.map((x) => ({ id: x.id, name: x.name + '（' + x.username + '）' }))}
            id={id}
            change={change}
          />
          <Pager page={page} total={q.data.total} change={pageTo} />
        </>
      )}
    </View>
  );
}
export function Invitations({ client }: { client: MobileClient }) {
  const q = useResource<{ joinEnabled: boolean; inviteCode: string | null }>(
      client,
      staff + '/join-settings',
    ),
    action = useSave(client),
    [show, reveal] = useState(false);
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>邀请码与入校申请</Text>
      <State resource={q} />
      {q.data && !q.error && (
        <>
          <AButton
            secondary
            disabled={action.busy}
            title={q.data.joinEnabled ? '关闭入校申请' : '开启入校申请'}
            onPress={() =>
              confirmAction(
                '更改入校申请设置',
                q.data!.joinEnabled ? '学生将不能提交新的入校申请。' : '学生可以使用邀请码申请加入机构。',
                () =>
                  void action.save(
                    staff + '/join-settings',
                    { joinEnabled: !q.data!.joinEnabled },
                    'PATCH',
                    q.reload,
                  ),
              )
            }
          />
          {q.data.joinEnabled && !!q.data.inviteCode && (
            <>
              <AButton secondary title={show ? '收起邀请码' : '查看邀请码'} onPress={() => reveal(!show)} />
              {show && <Text selectable>{q.data.inviteCode}</Text>}
              <AButton
                secondary
                disabled={action.busy}
                title="更换邀请码"
                onPress={() =>
                  confirmAction(
                    '更换邀请码',
                    '原有邀请码将失效。',
                    () => void action.save(staff + '/join-settings/rotate', {}, 'POST', q.reload),
                  )
                }
              />
            </>
          )}
        </>
      )}
      {!!action.notice && <Text>{action.notice}</Text>}
    </View>
  );
}
export function Members({
  client,
  id,
  kind,
}: {
  client: MobileClient;
  id: string;
  kind: 'courses' | 'classes';
}) {
  const [user, select] = useState(''),
    [page, setPage] = useState(1);
  const base = staff + '/' + kind + '/' + encodeURIComponent(id) + '/members';
  const q = usePage<Option & { username: string }>(client, base, page),
    action = useSave(client);
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>成员名单</Text>
      <PersonPicker client={client} role="STUDENT" id={user} change={select} />
      <AButton
        title="添加学生"
        disabled={!user || action.busy}
        onPress={() =>
          void action.save(base, { userId: user }, 'POST', () => {
            select('');
            q.reload();
          })
        }
      />
      <State resource={q} />
      {q.data && !q.error && (
        <>
          {q.data.items.map((x) => (
            <View key={x.id}>
              <Text>
                {x.name} · {x.username}
              </Text>
              {kind === 'classes' && (
                <AButton
                  title="移出班级"
                  secondary
                  disabled={action.busy}
                  onPress={() =>
                    confirmAction(
                      '移出班级',
                      x.name,
                      () => void action.save(base, { userId: x.id, active: false }, 'POST', q.reload),
                    )
                  }
                />
              )}
            </View>
          ))}
          <Pager page={page} total={q.data.total} change={setPage} />
        </>
      )}
      {!!action.notice && <Text>{action.notice}</Text>}
    </View>
  );
}
type Entry = Option & {
  revision: number;
  active: boolean;
  organizationId: string | null;
  description: string;
  subjectId?: string;
  moduleIds?: string[];
};
type Catalog = { subjects: Entry[]; majors: Entry[]; modules: { id: string; title: string }[] };
export function SchoolCatalog({ client, user }: { client: MobileClient; user: MobileUser }) {
  const q = useResource<Catalog>(client, staff + '/catalog'),
    action = useSave(client);
  const [kind, setKind] = useState<'subjects' | 'majors'>('majors'),
    [editing, setEditing] = useState<Entry | null>(null),
    [name, setName] = useState(''),
    [desc, setDesc] = useState(''),
    [subject, setSubject] = useState(''),
    [modules, setModules] = useState<string[]>([]),
    [selected, pick] = useState('');
  function fill(row: Entry | null) {
    setEditing(row);
    setName(row?.name || '');
    setDesc(row?.description || '');
    setSubject(row?.subjectId || '');
    setModules(row?.moduleIds || []);
    pick('');
  }
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>学科与专业目录</Text>
      <Picker
        label="目录类型"
        id={kind}
        items={[
          { id: 'subjects', name: '学科' },
          { id: 'majors', name: '专业' },
        ]}
        change={(s) => {
          setKind(s as typeof kind);
          fill(null);
        }}
      />
      <State resource={q} />
      {q.data && !q.error && (
        <>
          <Picker
            label="编辑本机构条目"
            items={[
              { id: '', name: '新建' },
              ...q.data[kind].filter((x) => x.organizationId === user.organizationId),
            ]}
            id={editing?.id || ''}
            change={(id) => fill(q.data![kind].find((x) => x.id === id) || null)}
          />
          <Field label={kind === 'subjects' ? '学科名称' : '专业名称'} value={name} set={setName} />
          <Field multiline label="简介" value={desc} set={setDesc} />
          {kind === 'majors' && (
            <>
              <Picker
                label="所属学科"
                items={q.data.subjects.filter((x) => x.active)}
                id={subject}
                change={setSubject}
              />
              <Picker
                label="添加学习模块"
                id={selected}
                items={q.data.modules
                  .filter((x) => !modules.includes(x.id))
                  .map((x) => ({ id: x.id, name: x.title }))}
                change={(id) => {
                  setModules([...modules, id]);
                  pick('');
                }}
              />
              {modules.map((id) => (
                <AButton
                  secondary
                  key={id}
                  title={'移除 · ' + (q.data!.modules.find((x) => x.id === id)?.title || id)}
                  onPress={() => setModules(modules.filter((x) => x !== id))}
                />
              ))}
            </>
          )}
          <AButton
            title={editing ? '保存修改' : '创建'}
            disabled={!name.trim() || action.busy || (kind === 'majors' && (!subject || !modules.length))}
            onPress={() =>
              void action.save(
                staff + '/' + kind + (editing ? '/' + editing.id : ''),
                {
                  name,
                  description: desc,
                  ...(editing ? { revision: editing.revision } : {}),
                  ...(kind === 'majors' ? { subjectId: subject, moduleIds: modules } : {}),
                },
                editing ? 'PATCH' : 'POST',
                () => {
                  fill(null);
                  q.reload();
                },
              )
            }
          />
          {editing && (
            <AButton
              secondary
              title={editing.active ? '停用条目' : '启用条目'}
              disabled={action.busy}
              onPress={() =>
                confirmAction(
                  '更改条目状态',
                  editing.name,
                  () =>
                    void action.save(
                      staff + '/' + kind + '/' + editing.id,
                      { revision: editing.revision, active: !editing.active },
                      'PATCH',
                      () => {
                        fill(null);
                        q.reload();
                      },
                    ),
                )
              }
            />
          )}
        </>
      )}
      {!!action.notice && <Text>{action.notice}</Text>}
    </View>
  );
}
