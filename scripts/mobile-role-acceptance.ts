import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { createLiveFixture } from '../tests/live.fixture';

type Controls = {
  tap(label: string): Promise<void>;
  find(label: string): Promise<unknown>;
  type(label: string, value: string): Promise<void>;
  resetLogin(username: string, password: string, name: string): Promise<void>;
  resetToLogin(): void;
  setApiConnected(connected: boolean): void;
  screenshot(name: string): void;
  passed(name: string): void;
};
export async function verifyMobileRoles(f: Awaited<ReturnType<typeof createLiveFixture>>, ui: Controls) {
  await ui.tap('专业学习');
  await ui.find('选择专业与学习模块');
  await ui.screenshot('android-role-student-academics');
  ui.passed('student opens native major and module selection');
  await ui.tap('首页');
  await ui.tap('算法学习');
  await ui.tap('私人算法训练计划');
  await ui.find('刷新本人训练计划');
  ui.passed('student navigates from problem bank into native training plans');
  await ui.resetLogin(f.users.teacher.username, f.password, f.users.teacher.name);
  await ui.tap('教学工作台');
  await ui.find('新课程名称');
  const title = 'NativeCourse' + randomUUID().slice(0, 6);
  await ui.type('新课程名称', title);
  await ui.tap('创建课程草稿');
  await ui.find('已保存');
  const course = await f.db.course.findFirstOrThrow({ where: { title, organizationId: f.organization.id } });
  assert.ok(
    await f.db.teachingAssignment.findFirst({
      where: { userId: f.users.teacher.id, courseId: course.id, active: true },
    }),
  );
  await ui.screenshot('android-role-teacher-course');
  ui.passed('teacher creates a draft course from Android and owns its teaching assignment');
  await ui.resetLogin(f.users.admin.username, f.password, f.users.admin.name);
  await ui.tap('机构管理');
  await ui.tap('新增机构账号');
  await ui.type('名称', 'NativeStudent');
  const username = 'native_' + randomUUID().slice(0, 8);
  await ui.type('登录账号', username);
  await ui.type('初始密码（至少12位）', f.password);
  await ui.tap('确认新增');
  await ui.find('已保存');
  const student = await f.db.user.findUniqueOrThrow({ where: { username }, include: { roles: true } });
  assert.equal(student.organizationId, f.organization.id);
  assert.deepEqual(
    student.roles.map((x) => x.roleId),
    ['STUDENT'],
  );
  await ui.screenshot('android-role-admin-users');
  ui.passed('institution administrator creates a student in own organization through Android');
  const platform = await f.db.user.create({
    data: {
      username: 'platform_' + randomUUID().slice(0, 8),
      name: '平台验收',
      passwordHash: f.users.admin.passwordHash,
      organizationId: f.organization.id,
      roles: { create: { roleId: 'SUPER_ADMIN' } },
    },
  });
  await ui.resetLogin(platform.username, f.password, platform.name);
  await ui.tap('机构管理');
  await ui.tap('机构');
  await ui.tap('新增机构');
  const organization = 'NativeSchool' + randomUUID().slice(0, 8);
  await ui.type('名称', organization);
  await ui.tap('确认新增');
  await ui.find('已保存');
  assert.ok(await f.db.organization.findFirst({ where: { name: organization } }));
  await ui.screenshot('android-role-platform-schools');
  ui.passed('platform administrator creates a separate institution from Android');
  ui.resetToLogin();
  await ui.tap('个人注册');
  const personalLogin = 'personal_' + randomUUID().slice(0, 8);
  for (const [field, value] of [
    ['账号', personalLogin],
    ['姓名', 'Independent'],
    ['新密码', f.password],
    ['确认新密码', f.password],
  ]) {
    await ui.tap(field);
    await ui.type(field, value);
  }
  await ui.tap('注册个人账号');
  await ui.find('你好，Independent');
  const personal = await f.db.user.findUniqueOrThrow({ where: { username: personalLogin } });
  assert.equal(personal.accountMode, 'PERSONAL');
  assert.equal(personal.organizationId, personal.personalOrganizationId);
  ui.passed('personal registration creates an independent student space without an invitation');
  await ui.tap('个人笔记');
  await ui.tap('新建独立笔记');
  const noteTitle = 'NativeOffline' + randomUUID().slice(0, 6);
  const body = 'OfflineReviewText';
  await ui.type('独立笔记标题', noteTitle);
  await ui.tap('独立笔记正文');
  await ui.type('独立笔记正文', body);
  await ui.tap('保存独立笔记');
  assert.ok(await f.db.standaloneNote.findFirst({ where: { title: noteTitle, body, userId: personal.id } }));
  await ui.tap('打开我的空间');
  await ui.tap('离线复习个人笔记');
  await ui.tap('联网选择本人独立笔记');
  await ui.tap('保存待复习 ' + noteTitle);
  await ui.tap('本机副本 · 1 / 20');
  ui.setApiConnected(false);
  try {
    await ui.tap('复习本机笔记 ' + noteTitle);
    await ui.find('离线只读副本 · 未分类');
    await ui.find(body);
    ui.screenshot('android-role-personal-offline');
  } finally {
    ui.setApiConnected(true);
  }
  ui.passed(
    'personal note persists on the server and its encrypted Android copy opens with the API disconnected',
  );
}
