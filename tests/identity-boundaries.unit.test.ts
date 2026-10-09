import test from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../apps/api/src/common/prisma.service';
import type { AuditService } from '../apps/api/src/common/audit.service';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import { AuthService } from '../apps/api/src/auth/auth.service';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
// The repository's default tsx test runner has no root decorator configuration.
// Load Nest controllers with the API's existing compiler settings.
function loadController(relative: string) {
  const path = resolve(relative);
  const code = transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      target: ScriptTarget.ES2022,
      module: ModuleKind.CommonJS,
      experimentalDecorators: true,
    },
  }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', code)(createRequire(path), module, module.exports);
  return module.exports;
}
const { AdminController } = loadController('apps/api/src/admin/admin.controller.ts');
const { CoursesController } = loadController('apps/api/src/courses/courses.controller.ts');

const admin: Actor = {
  id: 'admin',
  name: '管理员',
  organizationId: 'institution',
  accountMode: 'ORGANIZATION',
  role: 'ADMIN',
  permissions: ['users.manage', 'org.manage', 'course.admin'],
};
const student = {
  id: 'student',
  organizationId: admin.organizationId,
  accountMode: 'ORGANIZATION',
  active: true,
  authVersion: 3,
  roles: [{ roleId: 'STUDENT' }],
};
const audit = { record: async () => {}, notify: async () => {} } as unknown as AuditService;
const auth = {
  require: AuthService.prototype.require,
  course: async () => ({ id: 'course' }),
} as unknown as AuthService;

function fixture(changes: Record<string, unknown>, allowWrites = false) {
  let locked = false,
    writes = 0;
  const current = { ...student, ...changes };
  const failWrite = async () => {
    writes++;
    if (!allowWrites) assert.fail('过期目标资格不能写入');
    return { id: 'membership' };
  };
  const tx = {
    $queryRaw: async (parts: TemplateStringsArray) => {
      assert.match(parts.join(''), /"User".*FOR UPDATE/);
      locked = true;
      return [{ id: student.id }];
    },
    user: {
      findFirst: async ({ where }: any) => {
        assert.ok(locked, '机构、模式与角色边界必须在User锁内读取');
        if (
          current.organizationId !== where.organizationId ||
          current.accountMode !== where.accountMode ||
          (where.active && !current.active) ||
          (where.roles && !current.roles.some((r: any) => r.roleId === where.roles.some.roleId))
        )
          return null;
        return current;
      },
      update: failWrite,
    },
    class: { findFirst: async () => ({ id: 'class', organizationId: admin.organizationId }) },
    classMember: { upsert: failWrite, updateMany: failWrite },
    enrollment: { upsert: failWrite },
    teachingAssignment: { upsert: failWrite },
    passwordRecovery: { updateMany: failWrite },
  };
  const db = {
    user: { findFirst: async () => assert.fail('目标不能在事务外完成授权检查') },
    $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
  } as unknown as PrismaService;
  return { db, writes: () => writes };
}

test('账号恢复先锁User，退出机构、账号模式或角色提升后拒绝旧管理员操作', async () => {
  for (const [changes, error] of [
    [{ organizationId: 'personal-space', accountMode: 'PERSONAL' }, NotFoundException],
    [{ accountMode: 'PERSONAL' }, NotFoundException],
    [{ roles: [{ roleId: 'ADMIN' }] }, ForbiddenException],
    [{ roles: [{ roleId: 'SUPER_ADMIN' }] }, ForbiddenException],
    [{ active: false }, BadRequestException],
  ] as const) {
    const state = fixture(changes);
    await assert.rejects(new AdminController(state.db, auth, audit).recovery(admin, student.id), error);
    assert.equal(state.writes(), 0);
  }
});

test('班级与课程成员写入在User锁内复核当前机构、机构模式、学生角色与启用状态', async () => {
  for (const changes of [
    { organizationId: 'personal-space', accountMode: 'PERSONAL' },
    { accountMode: 'PERSONAL' },
    { roles: [{ roleId: 'TEACHER' }] },
    { active: false },
  ]) {
    for (const route of ['class', 'course']) {
      const state = fixture(changes);
      if (route === 'class')
        await assert.rejects(
          new AdminController(state.db, auth, audit).classMember(admin, 'class', { userId: student.id }),
          BadRequestException,
        );
      else
        await assert.rejects(
          new CoursesController(state.db, auth, audit).addMember(admin, 'course', { userId: student.id }),
          BadRequestException,
        );
      assert.equal(state.writes(), 0);
    }
  }
});

test('行政班绑定课程重新读取锁内成员，跳过已经返回个人空间的学生', async () => {
  let locked = false,
    enrollmentWrites = 0,
    memberReads = 0;
  const tx = {
    $queryRaw: async (statement: any) => {
      assert.match(statement.sql, /ORDER BY "id" FOR UPDATE/);
      assert.deepEqual(statement.values, [student.id]);
      locked = true;
      return [{ id: student.id }];
    },
    classMember: {
      findMany: async ({ where }: any) => {
        memberReads++;
        if (memberReads === 1) return [{ userId: student.id }];
        assert.ok(locked);
        assert.deepEqual(where.userId.in, []);
        return [];
      },
    },
    user: {
      findMany: async () => {
        assert.ok(locked);
        return [];
      },
    },
    courseClass: { upsert: async () => ({ id: 'teaching-class' }) },
    enrollment: {
      upsert: async () => {
        enrollmentWrites++;
      },
    },
  };
  const db = {
    class: { findFirst: async () => ({ id: 'class', name: '行政班' }) },
    $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
  } as unknown as PrismaService;
  await new AdminController(db, auth, audit).classCourse(admin, 'class', { courseId: 'course' });
  assert.equal(memberReads, 2);
  assert.equal(enrollmentWrites, 0);
});

test('禁用学生仍可移除同机构的旧班级资格', async () => {
  const state = fixture({ active: false }, true);
  await new AdminController(state.db, auth, audit).classMember(admin, 'class', {
    userId: student.id,
    active: false,
  });
  assert.equal(state.writes(), 1);
});
