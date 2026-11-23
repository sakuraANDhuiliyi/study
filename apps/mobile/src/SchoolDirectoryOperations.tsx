import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Text, View } from 'react-native';
import type { MobileClient, MobileUser } from './client';
import type { LeaveGuard } from './Assignments';
import { a, AButton } from './assignment-ui';
import { Pager, Picker, State, confirmAction, usePage } from './staff-ui';
import {
  TeachingField as Field,
  TeachingNotice,
  TeachingPanel,
  useTeachingGuard,
  useTeachingOperation,
  type TeachingGuard,
} from './teaching-ui';
import {
  schoolDirectoryRoot as root,
  schoolDirectoryApi as api,
  type SchoolImportRow,
  type SchoolImportPreview,
  type DirectoryUser,
  type DirectoryBinding,
} from './school-directory-model';
import { pickSchoolImport, shareSchoolDirectoryCsv } from './school-directory-files';
export function SchoolDirectoryOperations({
  client,
  user,
  registerLeave,
}: {
  client: MobileClient;
  user: MobileUser;
  registerLeave(g: LeaveGuard): void;
}) {
  const [tab, setTab] = useState<'import' | 'roles' | 'bindings'>('import'),
    guard = useRef<LeaveGuard>(null),
    register = useCallback(
      (next: LeaveGuard) => {
        guard.current = next;
        registerLeave(next);
      },
      [registerLeave],
    );
  useEffect(() => () => registerLeave(null), [registerLeave]);
  if (user.accountMode !== 'ORGANIZATION' || !['ADMIN', 'SUPER_ADMIN'].includes(user.role))
    return <Text style={a.error}>请使用机构管理员手机身份。</Text>;
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <View style={a.card}>
        <Text style={a.title}>机构人员与班课</Text>
        <View style={a.row}>
          {(
            [
              ['import', '批量导入与导出'],
              ['roles', '账号角色'],
              ['bindings', '班级课程绑定'],
            ] as const
          )
            .filter(([key]) =>
              key === 'bindings'
                ? user.permissions.includes('org.manage') && user.permissions.includes('course.admin')
                : user.permissions.includes('users.manage'),
            )
            .map(([key, label]) => (
              <AButton
                key={key}
                secondary={tab !== key}
                title={label}
                onPress={() => (guard.current ? guard.current(() => setTab(key)) : setTab(key))}
              />
            ))}
        </View>
      </View>
      {tab === 'import' ? (
        <ImportDirectory client={client} user={user} registerLeave={register} />
      ) : tab === 'roles' ? (
        <DirectoryRoles client={client} user={user} registerLeave={register} />
      ) : (
        <ClassCourses client={client} registerLeave={register} />
      )}
    </ScrollView>
  );
}
function ImportDirectory({
  client,
  user,
  registerLeave,
}: {
  client: MobileClient;
  user: MobileUser;
  registerLeave: TeachingGuard;
}) {
  const [rows, setRows] = useState<SchoolImportRow[] | null>(null),
    [preview, setPreview] = useState<SchoolImportPreview>(),
    op = useTeachingOperation(client),
    generation = useRef(0),
    selecting = useRef(false);
  const clear = useCallback(() => {
    generation.current++;
    setRows(null);
    setPreview(undefined);
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        if (selecting.current) {
          setRows(null);
          setPreview(undefined);
        } else clear();
      }
    });
    const off = client.onSessionInvalidated(clear);
    return () => {
      sub.remove();
      off();
    };
  }, [client, clear]);
  useTeachingGuard(!!rows, op.busy, registerLeave);
  const select = () => {
    const n = generation.current;
    selecting.current = true;
    void op.run(
      async () => {
        try {
          return await pickSchoolImport(client, () => op.live() && generation.current === n);
        } finally {
          selecting.current = false;
        }
      },
      (next) => {
        if (generation.current === n && next) {
          setRows(next);
          setPreview(undefined);
        }
      },
    );
  };
  const validate = () => {
    if (!rows) return;
    const n = generation.current;
    void op.run(
      () => api.preview(client, rows),
      (result) => {
        if (n === generation.current) setPreview(result);
      },
    );
  };
  const commit = () => {
    if (!rows || !preview?.valid) return;
    const snapshot = rows,
      n = generation.current;
    setPreview(undefined);
    void op.run(
      () => api.commit(client, snapshot),
      (result) => {
        if (n !== generation.current) return;
        if (result.committed) {
          setRows(null);
          setPreview(result);
        } else setPreview(result);
      },
    );
  };
  return (
    <TeachingPanel busy={op.busy}>
      <Text style={a.subtitle}>用户CSV导入</Text>
      <Text style={a.body}>
        先下载模板，在手机表格工具填写后选择文件。每次最多100人、512KiB；角色用 |
        分隔。预览不创建用户，确认后一次性导入。
      </Text>
      <Text style={a.muted}>
        初始密码仅在导入请求中使用，不在预览中显示。切换到后台将清除当前内存导入内容；原始CSV由你管理。
      </Text>
      <AButton
        secondary
        title="下载导入模板"
        disabled={op.busy}
        onPress={() => void op.run(() => shareSchoolDirectoryCsv(client, 'template', op.live))}
      />
      <AButton
        title="选择用户CSV文件"
        disabled={op.busy}
        onPress={() => (rows ? confirmAction('替换导入内容', '当前未提交数据将清除。', select) : select())}
      />
      {rows && (
        <>
          <Text>待核验 {rows.length} 人；初始密码已隐藏。</Text>
          <AButton title="检查并预览导入" disabled={op.busy} onPress={validate} />
          <AButton secondary title="清除当前导入内容" disabled={op.busy} onPress={clear} />
        </>
      )}
      {preview && (
        <>
          <Text style={preview.valid ? a.notice : a.error}>
            {preview.committed
              ? `已成功导入 ${preview.total} 人`
              : preview.valid
                ? `已通过 ${preview.total} 行校验，尚未创建用户`
                : '存在错误，未创建任何用户'}
          </Text>
          {preview.errors.map((e, i) => (
            <Text key={i} style={a.error}>
              第 {e.row} 行：{e.message}
            </Text>
          ))}
          {!preview.committed &&
            preview.preview?.map((row, i) => (
              <View key={i} style={a.child}>
                <Text>
                  {row.name} · {row.username}
                </Text>
                <Text>
                  {row.roles.join(' / ')}
                  {row.studentNo ? ' · 学号 ' + row.studentNo : ''}
                </Text>
              </View>
            ))}
          {preview.valid && !preview.committed && rows && (
            <AButton
              title="确认批量创建账号"
              disabled={op.busy}
              onPress={() =>
                confirmAction(
                  '批量创建机构账号',
                  `将创建 ${rows.length} 个账号，并按文件初始密码与角色设置。`,
                  commit,
                )
              }
            />
          )}
        </>
      )}
      <Text style={a.subtitle}>导出用户清单</Text>
      <Text style={a.muted}>
        最多导出本机构10,000人的账号、姓名、学号、角色和启用状态，不含密码。需要有效的资料导出敏感授权。
      </Text>
      <AButton
        secondary
        title="导出机构用户CSV"
        disabled={op.busy || !user.permissions.includes('data.export')}
        onPress={() =>
          confirmAction(
            '导出机构人员资料',
            '所选系统应用将获得文件副本，请仅保存到获授权的位置。',
            () => void op.run(() => shareSchoolDirectoryCsv(client, 'export', op.live)),
          )
        }
      />
      <TeachingNotice operation={op} />
    </TeachingPanel>
  );
}
function DirectoryRoles({
  client,
  user,
  registerLeave,
}: {
  client: MobileClient;
  user: MobileUser;
  registerLeave: TeachingGuard;
}) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState<DirectoryUser>(),
    [roles, setRoles] = useState<string[]>([]),
    op = useTeachingOperation(client);
  const q = usePage<DirectoryUser>(client, root + '/users?search=' + encodeURIComponent(search), page),
    dirty = !!selected && JSON.stringify([...roles].sort()) !== JSON.stringify([...selected.roles].sort());
  useTeachingGuard(dirty, op.busy, registerLeave);
  const choose = (row: DirectoryUser) => {
    setSelected(row);
    setRoles(row.roles);
  };
  return (
    <TeachingPanel busy={op.busy}>
      <Text style={a.subtitle}>分配账号角色</Text>
      <Text style={a.muted}>
        只能管理当前机构的下级账号，不能修改本人或超级管理员。更改角色会注销该用户所有设备会话，用户需重新登录。
      </Text>
      <Field
        label="查找姓名或账号"
        value={search}
        set={(s) => {
          setSearch(s);
          setPage(1);
        }}
      />
      <State resource={q} />
      {!q.error &&
        q.data?.items.map((row) => (
          <View key={row.id} style={a.child}>
            <Text>
              {row.name} · {row.username}
            </Text>
            <Text>{row.roles.join(' / ')}</Text>
            {row.id !== user.id &&
              !row.roles.includes('SUPER_ADMIN') &&
              (user.role === 'SUPER_ADMIN' || !row.roles.includes('ADMIN')) && (
                <AButton
                  secondary
                  title="设置此人角色"
                  onPress={() =>
                    dirty
                      ? confirmAction('放弃当前角色选择？', '将切换到另一账号。', () => choose(row))
                      : choose(row)
                  }
                />
              )}
          </View>
        ))}
      {q.data && <Pager page={page} total={q.data.total} change={setPage} />}{' '}
      {selected && (
        <View style={a.child}>
          <Text style={a.subtitle}>{selected.name}</Text>
          {['STUDENT', 'TEACHER', ...(user.role === 'SUPER_ADMIN' ? ['ADMIN'] : [])].map((role) => (
            <AButton
              key={role}
              secondary={!roles.includes(role)}
              title={
                (roles.includes(role) ? '✓ ' : '') +
                ({ STUDENT: '学生', TEACHER: '教师', ADMIN: '管理员' }[role] || role)
              }
              onPress={() =>
                setRoles(roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role])
              }
            />
          ))}
          <AButton
            title="确认更新角色并注销旧会话"
            disabled={op.busy || !roles.length || !dirty}
            onPress={() =>
              confirmAction(
                '更新账号角色',
                selected.name + ' 的所有现有登录会话将注销。移除学生角色会清除该账号的专业分配。',
                () =>
                  void op.run(
                    () => api.roles(client, selected.id, roles),
                    (row) => {
                      choose(row);
                      q.reload();
                    },
                  ),
              )
            }
          />
        </View>
      )}
      <TeachingNotice operation={op} />
    </TeachingPanel>
  );
}
function ClassCourses({ client, registerLeave }: { client: MobileClient; registerLeave: TeachingGuard }) {
  const [page, setPage] = useState(1),
    [coursePage, setCoursePage] = useState(1),
    [classId, setClass] = useState(''),
    [courseId, setCourse] = useState(''),
    [name, setName] = useState(''),
    [revision, setRevision] = useState(0),
    op = useTeachingOperation(client),
    classes = usePage<{ id: string; name: string; grade: string }>(client, root + '/classes', page),
    courses = usePage<{ id: string; title: string; status: string }>(client, root + '/courses', coursePage);
  useTeachingGuard(!!courseId || !!name, op.busy, registerLeave);
  return (
    <TeachingPanel busy={op.busy}>
      <Text style={a.subtitle}>班级课程绑定</Text>
      <Text style={a.muted}>
        绑定会将本班当前有效学生加入课程。重复绑定不会新增重复关系，也不会改变既有绑定名称。
      </Text>
      <State resource={classes} />
      {classes.data && !classes.error && (
        <>
          <Picker
            label="行政班级"
            id={classId}
            items={classes.data.items.map((c) => ({ id: c.id, name: c.name + ' · ' + c.grade }))}
            change={setClass}
          />
          <Pager page={page} total={classes.data.total} change={setPage} />
        </>
      )}
      <State resource={courses} />
      {courses.data && !courses.error && (
        <>
          <Picker
            label="目标课程"
            id={courseId}
            items={courses.data.items
              .filter((c) => c.status !== 'ARCHIVED')
              .map((c) => ({ id: c.id, name: c.title }))}
            change={setCourse}
          />
          <Pager page={coursePage} total={courses.data.total} change={setCoursePage} />
        </>
      )}
      <Field label="教学班名称（可选）" value={name} set={setName} />
      <AButton
        title="确认绑定并同步学生"
        disabled={op.busy || !classId || !courseId}
        onPress={() =>
          confirmAction(
            '绑定班级与课程',
            '将按服务器核验的当前有效成员同步课程名单。',
            () =>
              void op.run(
                () =>
                  client.request(
                    root + '/classes/' + classId + '/courses',
                    { courseId, ...(name.trim() ? { name: name.trim() } : {}) },
                    'POST',
                  ),
                () => {
                  setCourse('');
                  setName('');
                  setRevision((v) => v + 1);
                },
              ),
          )
        }
      />
      {classId && <Bindings key={classId + '-' + revision} client={client} id={classId} />}
      <TeachingNotice operation={op} />
    </TeachingPanel>
  );
}
function Bindings({ client, id }: { client: MobileClient; id: string }) {
  const [page, setPage] = useState(1),
    q = usePage<DirectoryBinding>(client, root + '/classes/' + id + '/courses', page);
  return (
    <View style={a.child}>
      <Text style={a.subtitle}>本班已绑定课程</Text>
      <State resource={q} />
      {!q.error &&
        q.data?.items.map((row) => (
          <Text key={row.id}>
            {row.course?.title || '课程'} · {row.name}
          </Text>
        ))}
      {q.data && <Pager page={page} total={q.data.total} change={setPage} />}
    </View>
  );
}
