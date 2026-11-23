import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { a, AButton } from './assignment-ui';
import type { MobileClient, MobileUser } from './client';
import { useResource } from './resource';
import { confirmAction, Field, Pager, Picker, State, usePage, useSave, type Option } from './staff-ui';

import { Invitations, Members, SchoolCatalog } from './SchoolSetup';
import { SchoolAccountActions } from './SchoolAccounts';
import { SchoolRoles } from './SchoolRoles';
const sections = [
  ['users', '机构账号', 'users.manage'],
  ['requests', '加入申请', 'users.manage'],
  ['classes', '班级', 'org.manage'],
  ['terms', '学期', 'org.manage'],
  ['organizations', '机构', 'org.platform'],
  ['jobs', '后台任务', 'audit.read'],
  ['catalog', '学科与专业', 'org.manage'],
  ['roles', '角色权限', 'users.manage'],
] as const;
type Section = (typeof sections)[number][0];
type Row = {
  id: string;
  name?: string;
  username?: string;
  roles?: string[];
  majorId?: string | null;
  active?: boolean;
  status?: string;
  kind?: string;
  grade?: string;
  startsAt?: string;
  endsAt?: string;
  note?: string;
  user?: { name: string };
  organizationName?: string;
};
export function AdminWorkspace({ client, user }: { client: MobileClient; user: MobileUser }) {
  const available = sections.filter(([, , permission]) => user.permissions.includes(permission));
  const [section, choose] = useState<Section | undefined>(available[0]?.[0]);
  if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role) || !available.length)
    return <Text style={a.error}>当前身份无法进入机构管理</Text>;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={a.page}>
      <View style={a.row}>
        {available.map(([id, title]) => (
          <AButton key={id} secondary={section !== id} title={title} onPress={() => choose(id)} />
        ))}
      </View>
      {section === 'requests' && <Invitations client={client} />}
      {section === 'catalog' ? (
        <SchoolCatalog client={client} user={user} />
      ) : section === 'roles' ? (
        <SchoolRoles client={client} user={user} />
      ) : (
        section && <Directory key={section} section={section} client={client} user={user} />
      )}
    </ScrollView>
  );
}
function Directory({ section, client, user }: { section: Section; client: MobileClient; user: MobileUser }) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [name, setName] = useState(''),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [grade, setGrade] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [role, setRole] = useState('STUDENT'),
    [major, setMajor] = useState(''),
    [edit, setEdit] = useState(''),
    [form, setForm] = useState(false);
  const base = '/mobile/staff/' + (section === 'requests' ? 'join-requests' : section);
  const q = usePage<Row>(
    client,
    base +
      (section === 'users'
        ? '?search=' + encodeURIComponent(search)
        : section === 'requests'
          ? '?status=PENDING'
          : ''),
    page,
  );
  const write = useSave(client);
  function reset() {
    setPassword('');
    setName('');
    setUsername('');
    setForm(false);
    setEdit('');
    setGrade('');
    setMajor('');
    setPage(1);
    q.reload();
  }
  const submit = () => {
    let body: Record<string, unknown> = { name: name.trim() };
    if (section === 'users')
      body = {
        ...body,
        username: username.trim(),
        password,
        roles: [role],
        ...(role === 'STUDENT' ? { majorId: major || null } : {}),
      };
    if (section === 'classes') body.grade = grade;
    if (section === 'terms') {
      const startTime = Date.parse(start),
        endTime = Date.parse(end);
      if (!Number.isFinite(startTime) || !(endTime > startTime)) return;
      body.startsAt = new Date(startTime).toISOString();
      body.endsAt = new Date(endTime).toISOString();
    }
    void write.save(base, body, 'POST', reset);
  };
  return (
    <View style={a.card}>
      {section === 'users' && (
        <Field
          label="搜索姓名或账号"
          value={search}
          set={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
      )}
      {!['requests', 'jobs'].includes(section) && !edit && (
        <AButton
          secondary
          title={form ? '收起新增表单' : '新增' + sections.find((s) => s[0] === section)![1]}
          onPress={() => {
            setForm(!form);
            setPassword('');
          }}
        />
      )}
      {form && (
        <>
          <Field label="名称" value={name} set={setName} />
          {section === 'users' && (
            <>
              <Field label="登录账号" value={username} set={setUsername} />
              <Field label="初始密码（至少12位）" value={password} set={setPassword} secret />
              <Picker
                label="角色"
                items={[
                  { id: 'STUDENT', name: '学生' },
                  { id: 'TEACHER', name: '教师' },
                  ...(user.role === 'SUPER_ADMIN' ? [{ id: 'ADMIN', name: '机构管理员' }] : []),
                ]}
                id={role}
                change={setRole}
              />
              {role === 'STUDENT' && <Majors client={client} id={major} change={setMajor} />}
            </>
          )}
          {section === 'classes' && <Field label="年级" value={grade} set={setGrade} />}
          {section === 'terms' && (
            <>
              <Field label="开始日期（YYYY-MM-DD）" value={start} set={setStart} />
              <Field label="结束日期（YYYY-MM-DD）" value={end} set={setEnd} />
            </>
          )}
          <AButton
            title="确认新增"
            disabled={
              write.busy ||
              !name.trim() ||
              (section === 'users' && (!username.trim() || password.length < 12)) ||
              (section === 'classes' && !grade.trim()) ||
              (section === 'terms' && !(Date.parse(end) > Date.parse(start)))
            }
            onPress={submit}
          />
        </>
      )}
      {!!write.notice && (
        <Text accessibilityRole="alert" style={a.notice}>
          {write.notice}
        </Text>
      )}
      <State resource={q} />
      {!q.error &&
        q.data?.items.map((r) => (
          <View key={r.id} style={a.child}>
            <Text style={a.subtitle}>{r.name || r.user?.name || r.kind}</Text>
            <Text style={a.muted}>
              {[
                r.username,
                r.grade,
                r.note,
                r.organizationName,
                r.status,
                r.startsAt?.slice(0, 10),
                r.endsAt?.slice(0, 10),
                r.roles?.join(' / '),
                r.active === false ? '已停用' : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {((section === 'users' &&
              r.id !== user.id &&
              !r.roles?.includes('SUPER_ADMIN') &&
              (user.role === 'SUPER_ADMIN' || !r.roles?.includes('ADMIN'))) ||
              section === 'organizations') && (
              <SchoolAccountActions
                client={client}
                row={r}
                organization={section === 'organizations'}
                reload={q.reload}
              />
            )}
            {section === 'users' && r.roles?.includes('STUDENT') && (
              <>
                {edit === r.id ? (
                  <>
                    <Majors client={client} id={major} change={setMajor} />
                    <AButton
                      title="保存专业"
                      disabled={write.busy}
                      onPress={() =>
                        void write.save(
                          base + '/' + encodeURIComponent(r.id) + '/major',
                          { majorId: major || null },
                          'PATCH',
                          reset,
                        )
                      }
                    />
                    <AButton secondary title="取消修改" onPress={() => setEdit('')} />
                  </>
                ) : (
                  <AButton
                    secondary
                    title="设置专业"
                    onPress={() => {
                      setForm(false);
                      setPassword('');
                      setEdit(r.id);
                      setMajor(r.majorId || '');
                    }}
                  />
                )}
              </>
            )}
            {section === 'classes' && (
              <>
                <AButton secondary title="班级名单" onPress={() => setEdit(edit === r.id ? '' : r.id)} />
                {edit === r.id && <Members client={client} kind="classes" id={r.id} />}
              </>
            )}
            {section === 'requests' &&
              r.status === 'PENDING' &&
              (['APPROVED', 'REJECTED'] as const).map((status) => (
                <AButton
                  key={status}
                  secondary
                  title={status === 'APPROVED' ? '批准' : '拒绝'}
                  disabled={write.busy}
                  onPress={() =>
                    confirmAction(
                      '处理加入申请',
                      r.user?.name || '',
                      () =>
                        void write.save(base + '/' + encodeURIComponent(r.id), { status }, 'PATCH', q.reload),
                    )
                  }
                />
              ))}
          </View>
        ))}
      {!q.error && q.data && !q.data.items.length && <Text style={a.muted}>暂无记录</Text>}
      {q.data && <Pager page={page} total={q.data.total} change={setPage} />}
    </View>
  );
}
function Majors({ client, id, change }: { client: MobileClient; id: string; change(id: string): void }) {
  const q = useResource<{ items: (Option & { active?: boolean })[] }>(client, '/mobile/staff/majors');
  return (
    <>
      <State resource={q} />
      {q.data && !q.error && (
        <Picker
          label="学生专业"
          items={[{ id: '', name: '未分配' }, ...q.data.items.filter((m) => m.active !== false)]}
          id={id}
          change={change}
        />
      )}
    </>
  );
}
