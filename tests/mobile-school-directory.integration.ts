import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createLiveFixture } from './live.fixture';
import { MobileClient, MobileApiError } from '../apps/mobile/src/client';
import {
  schoolDirectoryRoot as root,
  schoolDirectoryApi as api,
  parseSchoolImportCsv,
  type DirectoryBinding,
  type SchoolImportRow,
} from '../apps/mobile/src/school-directory-model';
test(
  'native school directory: previewed atomic import, scoped export, role ceiling and real class enrollment',
  { timeout: 180000 },
  async (t) => {
    const f = await createLiveFixture();
    const mobile = async (username: string) => {
      let saved: string | null = null;
      const c = new MobileClient(
        f.origin,
        {
          get: async () => saved,
          set: async (v) => {
            saved = v;
          },
          remove: async () => {
            saved = null;
          },
        },
        () => {},
      );
      await c.login(username, f.password);
      return c;
    };
    const denied = (p: Promise<unknown>, s: number | number[]) =>
      assert.rejects(
        p,
        (e) => e instanceof MobileApiError && (Array.isArray(s) ? s : [s]).includes(e.status),
      );
    const suffix = randomBytes(5).toString('hex');
    try {
      const admin = await mobile(f.users.admin.username),
        teacher = await mobile(f.users.teacher.username),
        student = await mobile(f.users.student.username),
        foreign = await mobile(f.users.outsider.username);
      let importedId = '',
        grantId = '';
      const rows: SchoolImportRow[] = [
        {
          username: 'native_import_' + suffix,
          name: '=SUM(1,2)',
          password: f.password,
          roles: ['STUDENT'],
          studentNo: 'native-' + suffix,
        },
      ];
      await t.test(
        'only current native institution administrators may manage directory; broad web routes and unknown fields remain blocked',
        async () => {
          for (const c of [teacher, student, foreign])
            for (const path of ['/users', '/users/template', '/classes'])
              await denied(c.request(root + path), 403);
          await f.call(f.clients.admin, root + '/users', 'GET', undefined, 403);
          await denied(admin.request('/admin/users'), 403);
          for (const q of ['?organizationId=' + f.foreign.id, '?page=1&page=2', '?pageSize=21'])
            await denied(admin.request(root + '/users' + q), 400);
          await denied(
            admin.request(
              root + '/users/import',
              { rows, commit: false, organizationId: f.foreign.id },
              'POST',
            ),
            400,
          );
          await f.call(f.clients.admin, '/admin/users/import', 'POST', { rows, commit: true }, 403, false);
          const template = await admin.download(root + '/users/template');
          const text = Buffer.from(template.bytes).toString('utf8');
          assert.ok(text.startsWith('\ufeffusername,name,password,studentNo,roles,majorId'));
          assert.equal(parseSchoolImportCsv(text).length, 1);
          assert.equal(template.filename, 'user-import-template.csv');
        },
      );
      await t.test(
        'preview never writes or echoes passwords; failed mixed import is atomic, confirmed valid input creates one private account',
        async () => {
          const before = await f.db.user.count({ where: { organizationId: f.organization.id } });
          const preview = await api.preview(admin, rows);
          assert.equal(preview.valid, true);
          assert.equal(preview.committed, false);
          assert.equal(preview.preview?.[0].username, rows[0].username);
          assert.equal(JSON.stringify(preview).includes(f.password), false);
          assert.equal('password' in preview.preview![0], false);
          assert.equal(await f.db.user.count({ where: { organizationId: f.organization.id } }), before);
          const invalid = await api.commit(admin, [
            ...rows,
            { ...rows[0], username: 'other_' + suffix, roles: ['ADMIN'] },
          ]);
          assert.equal(invalid.valid, false);
          assert.equal(invalid.committed, false);
          assert.equal(await f.db.user.count({ where: { organizationId: f.organization.id } }), before);
          const committed = await api.commit(admin, rows);
          assert.equal(committed.committed, true);
          assert.equal(committed.total, 1);
          const u = await f.db.user.findUniqueOrThrow({
            where: { username: rows[0].username },
            include: { roles: true },
          });
          importedId = u.id;
          assert.equal(u.organizationId, f.organization.id);
          assert.equal(u.accountMode, 'ORGANIZATION');
          assert.deepEqual(
            u.roles.map((r) => r.roleId),
            ['STUDENT'],
          );
          const duplicate = await api.commit(admin, rows);
          assert.equal(duplicate.committed, false);
          assert.equal(await f.db.user.count({ where: { organizationId: f.organization.id } }), before + 1);
        },
      );
      await t.test(
        'CSV export requires an effective sensitive grant and never includes other spaces, passwords or spreadsheet formulas',
        async () => {
          await denied(admin.download(root + '/users/export'), 403);
          const grant = await f.db.sensitiveGrant.create({
            data: {
              userId: f.users.admin.id,
              organizationId: f.organization.id,
              permissionId: 'data.export',
              grantedBy: f.users.admin.id,
              reason: '原生目录限时导出验收',
              expiresAt: new Date(Date.now() + 600000),
            },
          });
          grantId = grant.id;
          const output = await admin.download(root + '/users/export');
          const csv = Buffer.from(output.bytes).toString('utf8');
          assert.ok(csv.startsWith('\ufeff'));
          assert.ok(csv.includes(rows[0].username));
          assert.ok(csv.includes('"\'=SUM(1,2)"'));
          assert.equal(csv.includes(f.users.outsider.username), false);
          assert.equal(csv.includes(f.password), false);
          assert.equal(csv.includes('passwordHash'), false);
          assert.equal(output.filename, 'users.csv');
          assert.ok(
            await f.db.auditLog.count({
              where: { organizationId: f.organization.id, action: 'data.export', resourceType: 'User' },
            }),
          );
          await f.db.sensitiveGrant.delete({ where: { id: grantId } });
          await denied(admin.download(root + '/users/export'), 403);
        },
      );
      await t.test(
        'role updates obey hierarchy and revoke all old devices; supplied password or self-elevation is refused',
        async () => {
          const imported = await mobile(rows[0].username);
          await imported.request('/mobile/auth/me');
          await denied(api.roles(admin, importedId, ['ADMIN']), 403);
          await denied(api.roles(admin, f.users.admin.id, ['STUDENT']), 403);
          await denied(
            admin.request(
              root + '/users/' + importedId + '/roles',
              { roles: ['TEACHER'], password: 'must-not-write' },
              'PATCH',
            ),
            400,
          );
          await denied(api.roles(admin, f.users.outsider.id, ['TEACHER']), 404);
          const changed = await api.roles(admin, importedId, ['TEACHER', 'STUDENT']);
          assert.deepEqual([...changed.roles].sort(), ['STUDENT', 'TEACHER']);
          await denied(imported.request('/mobile/auth/me'), 401);
          assert.equal(await f.db.session.count({ where: { userId: importedId } }), 0);
          assert.equal((await f.db.user.findUniqueOrThrow({ where: { id: importedId } })).authVersion, 1);
        },
      );
      await t.test(
        'class binding synchronizes current students once and isolates foreign classes and archived courses',
        async () => {
          const cls = (
            await f.call(f.clients.admin, '/admin/classes', 'POST', {
              name: '原生课程绑定班',
              grade: '一年级',
            })
          ).body;
          await f.call(f.clients.admin, '/admin/classes/' + cls.id + '/members', 'POST', {
            userId: f.users.student.id,
          });
          await f.call(f.clients.admin, '/admin/classes/' + cls.id + '/members', 'POST', {
            userId: f.users.student2.id,
          });
          const course = await f.db.course.create({
            data: {
              organizationId: f.organization.id,
              teacherId: f.users.teacher.id,
              title: '新绑定课程',
              status: 'PUBLISHED',
            },
          });
          const body = { courseId: course.id, name: '原生教学班' };
          const first = await admin.request<{ id: string }>(
            root + '/classes/' + cls.id + '/courses',
            body,
            'POST',
          );
          const second = await admin.request<{ id: string }>(
            root + '/classes/' + cls.id + '/courses',
            { ...body, name: '不能覆盖已有名称' },
            'POST',
          );
          assert.equal(first.id, second.id);
          const bindings = await admin.request<{ items: DirectoryBinding[]; total: number }>(
            root + '/classes/' + cls.id + '/courses',
          );
          assert.equal(bindings.total, 1);
          assert.equal(bindings.items[0].course?.title, course.title);
          assert.equal(bindings.items[0].name, '原生教学班');
          assert.equal(await f.db.enrollment.count({ where: { courseId: course.id, active: true } }), 2);
          const foreignClass = await f.db.class.create({
            data: { organizationId: f.foreign.id, name: '外部班级', grade: '一年级' },
          });
          await denied(admin.request(root + '/classes/' + foreignClass.id + '/courses'), 404);
          await denied(admin.request(root + '/classes/' + foreignClass.id + '/courses', body, 'POST'), 404);
          await f.db.course.update({ where: { id: course.id }, data: { status: 'ARCHIVED' } });
          await denied(admin.request(root + '/classes/' + cls.id + '/courses', body, 'POST'), 403);
          assert.equal(await f.db.courseClass.count({ where: { classId: cls.id } }), 1);
        },
      );
      await t.test(
        'current permissions and session revocation stop further directory reads or imports',
        async () => {
          await f.db.rolePermission.delete({
            where: { roleId_permissionId: { roleId: 'ADMIN', permissionId: 'users.manage' } },
          });
          await denied(admin.request(root + '/users'), 403);
          await denied(api.preview(admin, rows), 403);
          await f.db.session.deleteMany({ where: { userId: f.users.admin.id, clientType: 'MOBILE' } });
          await denied(admin.request(root + '/classes'), 401);
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
