import test from 'node:test';
import assert from 'node:assert/strict';
import type { AcademicGoal } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import {
  academicGoalCreate,
  academicGoalDate,
  academicGoalDelete,
  academicGoalPatch,
  academicGoalQuery,
} from '../apps/api/src/academics/goals.schemas';
import {
  academicGoalDto,
  academicGoalToday,
  compareAcademicGoals,
  AcademicGoalsService,
} from '../apps/api/src/academics/goals.service';
import { AuthService } from '../apps/api/src/auth/auth.service';
import type { PrismaService } from '../apps/api/src/common/prisma.service';
import type { Actor } from '../apps/api/src/auth/auth.guard';

test('目标日期使用真实公历，包含2000闰年但拒绝2100伪闰日和时区/时间注入', () => {
  for (const date of ['2000-02-29', '2024-02-29', '2100-12-31'])
    assert.equal(academicGoalDate.parse(date), date);
  for (const date of [
    '1999-12-31',
    '2101-01-01',
    '2100-02-29',
    '2025-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-1-01',
    '2026-01-01T00:00:00Z',
  ])
    assert.equal(academicGoalDate.safeParse(date).success, false, date);
});

test('目标输入严格限制计数、文本、版本和可修改字段', () => {
  const input = { moduleId: 'matrix-lab', title: '每日矩阵', targetCount: 3 };
  assert.equal(academicGoalCreate.parse(input).title, input.title);
  for (const extra of [
    { targetCount: 0 },
    { targetCount: 1001 },
    { targetCount: 1.5 },
    { title: ' ' },
    { title: 'x'.repeat(161) },
    { title: 'x\0' },
    { organizationId: 'other' },
    { progressCount: 100 },
    { revision: 0 },
  ])
    assert.equal(academicGoalCreate.safeParse({ ...input, ...extra }).success, false);
  assert.equal(academicGoalPatch.safeParse({ revision: 0 }).success, false);
  assert.equal(academicGoalPatch.safeParse({ revision: 0, moduleId: 'algorithms' }).success, false);
  assert.equal(academicGoalPatch.safeParse({ revision: -1, archived: true }).success, false);
  assert.equal(academicGoalPatch.safeParse({ revision: 0, dueDate: null }).success, true);
  assert.equal(academicGoalDelete.safeParse({}).success, false);
  assert.equal(academicGoalDelete.safeParse({ revision: 0, userId: 'other' }).success, false);
  assert.equal(academicGoalQuery.parse({}).status, 'active');
  assert.equal(academicGoalQuery.safeParse({ status: 'done' }).success, false);
});

const row: AcademicGoal = {
  id: 'goal',
  organizationId: 'space',
  userId: 'learner',
  moduleId: 'matrix-lab',
  title: '目标',
  targetCount: 2,
  dueDate: new Date('2026-10-08T00:00:00Z'),
  archived: false,
  revision: 0,
  createdAt: new Date('2026-10-08T00:00:00Z'),
  updatedAt: new Date('2026-10-08T00:00:00Z'),
};
test('北京时间日界判逾期，完成与归档不逾期，真实进度不截断且DTO不泄漏空间信息', () => {
  assert.equal(academicGoalToday(new Date('2026-10-08T15:59:59.999Z')), '2026-10-08');
  assert.equal(academicGoalToday(new Date('2026-10-08T16:00:00.000Z')), '2026-10-09');
  assert.equal(academicGoalDto(row, 1, '2026-10-08').overdue, false);
  assert.equal(academicGoalDto(row, 1, '2026-10-09').overdue, true);
  assert.equal(academicGoalDto({ ...row, archived: true }, 1, '2026-10-09').overdue, false);
  const completed = academicGoalDto(row, 3, '2026-10-09');
  assert.equal(completed.completed, true);
  assert.equal(completed.progressCount, 3);
  assert.equal(completed.overdue, false);
  assert.equal(completed.unit, '次');
  assert.equal(academicGoalDto({ ...row, moduleId: 'algorithms' }, 1).unit, '题');
  assert.equal('organizationId' in completed, false);
  assert.equal('userId' in completed, false);
});
test('目标排序始终先未完成，再截止日期、创建日期与id，无截止日期排在有日期之后', () => {
  const inputs = [
    academicGoalDto({ ...row, id: 'completed', dueDate: new Date('2000-01-01') }, 2),
    academicGoalDto({ ...row, id: 'undated', dueDate: null }, 0),
    academicGoalDto({ ...row, id: 'b' }, 0),
    academicGoalDto({ ...row, id: 'a' }, 0),
    academicGoalDto({ ...row, id: 'earlier', createdAt: new Date('2026-10-07') }, 0),
  ];
  assert.deepEqual(
    inputs.sort(compareAcademicGoals).map((goal) => goal.id),
    ['earlier', 'a', 'b', 'undated', 'completed'],
  );
});
test('目标服务拒绝教师管理员、缺学习权限和已关闭practice，尚未访问目标存储', async () => {
  const actor: Actor = {
    id: 'learner',
    name: '学生',
    role: 'STUDENT',
    organizationId: 'space',
    permissions: ['learning.use'],
  };
  const auth = {
    require: AuthService.prototype.require,
    checkFeature: async () => {},
  } as unknown as AuthService;
  const service = new AcademicGoalsService({} as PrismaService, auth);
  for (const blocked of [
    { ...actor, role: 'TEACHER' },
    { ...actor, role: 'ADMIN' },
    { ...actor, permissions: [] },
  ])
    await assert.rejects(service.list(blocked, {}), ForbiddenException);
  auth.checkFeature = async () => {
    throw new ForbiddenException('机构已关闭');
  };
  await assert.rejects(service.list(actor, {}), ForbiddenException);
});
