// Browser contract fixtures. Computation, auth, and persistence here are mocked;
// real-service tests separately verify the server and calculators.
import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test.use({ actionTimeout: 15000 });
const stamp = '2026-10-09T08:00:00Z';
const subject = {
  id: 'subject-science',
  name: '理学',
  description: '理解数量与规律',
  active: true,
  revision: 0,
  organizationId: null,
};
const major = {
  id: 'major-math',
  name: '数学与应用数学',
  description: '用计算实验连接理论与应用。',
  subjectId: subject.id,
  moduleIds: ['matrix-lab', 'concept-quiz'],
  active: true,
  revision: 0,
  organizationId: null,
};
const base = {
  subjectIds: [subject.id],
  tags: ['基础', '数学'],
  estimatedMinutes: 20,
  learningObjectives: ['比较参数变化对结果的影响。'],
  concepts: [{ title: '先理解输入', content: '明确变量含义与单位后再计算。' }],
  instructions: ['输入参数。', '运行并记录自己的发现。'],
  resources: [],
};
const modules: any[] = [
  {
    ...base,
    id: 'matrix-lab',
    title: '矩阵运算实验',
    description: '输入矩阵，观察计算结果和计算过程。',
    kind: 'calculator',
    fields: [
      { key: 'matrix', label: '输入矩阵', type: 'matrix', required: true, help: '使用 JSON 二维数组。' },
      { key: 'factor', label: '缩放倍数', type: 'number', min: -10, max: 10, required: true },
    ],
    defaultValues: {
      matrix: [
        [1, 2],
        [3, 4],
      ],
      factor: 2,
    },
    examples: [
      {
        title: '起步示例',
        values: {
          matrix: [
            [1, 2],
            [3, 4],
          ],
          factor: 2,
        },
        explanation: '将每个元素乘以2。',
      },
    ],
  },
  {
    ...base,
    id: 'concept-quiz',
    title: '数据结构概念练习',
    description: '根据题干选择答案，提交后查看解释。',
    kind: 'quiz',
    fields: [],
    defaultValues: {},
    examples: [],
    questions: [
      {
        id: 'q1',
        prompt: '哪种结构遵循先进先出？',
        choices: [
          { id: 'a', label: '栈' },
          { id: 'b', label: '队列' },
        ],
      },
    ],
  },
  {
    ...base,
    id: 'study-notebook',
    title: '自由学习笔记',
    description: '保存学习主题、要点与想法。',
    kind: 'workspace',
    fields: [
      { key: 'title', label: '学习主题', type: 'text', required: true },
      { key: 'body', label: '笔记内容', type: 'textarea', required: true },
      { key: 'tags', label: '关键词', type: 'text' },
    ],
    defaultValues: { title: '', body: '', tags: '' },
    examples: [],
  },
  {
    ...base,
    id: 'sql-lab',
    title: 'SQL 查询实验',
    description: '在练习数据中探索只读查询。',
    kind: 'sql',
    fields: [{ key: 'query', label: 'SQL 查询', type: 'textarea', required: true }],
    defaultValues: { query: 'SELECT * FROM students' },
    examples: [],
  },
  {
    ...base,
    id: 'algorithms',
    title: '算法编程',
    description: '编写、运行、提交代码。',
    kind: 'algorithm',
    fields: [],
    defaultValues: {},
    examples: [],
  },
];
const result = {
  summary: '运算完成，已保存你的矩阵实验。',
  metrics: [{ label: '矩阵元素数', value: 4 }],
  sections: [{ title: '计算解释', content: '矩阵的每一个元素乘以缩放倍数。', status: 'success' }],
  tables: [
    {
      title: '计算结果',
      columns: [
        { key: 'a', title: '第一列' },
        { key: 'b', title: '第二列' },
      ],
      rows: [
        { a: 2, b: 4 },
        { a: 6, b: 8 },
      ],
    },
  ],
};
async function setup(page: Page, mode: 'personal' | 'guest' | 'admin' | 'organization' = 'personal') {
  let authenticated = mode !== 'guest';
  let revision = 0;
  let selected = ['matrix-lab'];
  let chosenMajor: string | null = major.id;
  const records: any[] = [];
  const users: any[] = [];
  const majors: any[] = [major];
  const requests: { path: string; method: string; body: any }[] = [];
  let conflict = false;
  let joinEnabled = false;
  const joins = [
    {
      id: 'request-1',
      user: { id: 'joining-user', name: '申请同学', username: 'joining-student' },
      organization: { id: 'org-fixture', name: '测试学习组织' },
      status: 'PENDING',
      majorId: null,
      note: '希望加入本学期班级。',
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  const user = () => ({
    id: 'academic-fixture',
    name: '学习同学',
    username: 'student',
    role: mode === 'admin' ? 'ADMIN' : 'STUDENT',
    roles: [mode === 'admin' ? 'ADMIN' : 'STUDENT'],
    organizationId: 'org-fixture',
    accountMode: mode === 'admin' || mode === 'organization' ? 'ORGANIZATION' : 'PERSONAL',
    majorId: chosenMajor,
    major: majors.find((item) => item.id === chosenMajor) || null,
    canReturnToPersonal: mode === 'organization',
    permissions: mode === 'admin' ? ['users.manage', 'org.manage', 'learning.use'] : ['learning.use'],
  });
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body = request.method() === 'GET' || request.method() === 'DELETE' ? null : request.postDataJSON();
    requests.push({ path: path + url.search, method: request.method(), body });
    if (path === '/api/auth/me')
      return authenticated
        ? json(route, { user: user(), csrfToken: 'fixture-csrf' })
        : json(route, { message: '请登录' }, 401);
    if (path === '/api/auth/register' || path === '/api/auth/login') {
      authenticated = true;
      return json(route, { user: user(), csrfToken: 'fixture-csrf' });
    }
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    if (path === '/api/dashboard')
      return json(route, { metrics: [], courses: [], todos: [], announcements: [], activities: [] });
    if (path === '/api/academics/catalog')
      return json(route, { subjects: [subject], majors: majors.filter((item) => item.active), modules });
    if (path === '/api/academics/me')
      return json(route, {
        accountMode: user().accountMode,
        revision,
        majorId: chosenMajor,
        major: user().major,
        selectedModuleIds: selected,
        stats: {
          records: records.length,
          completed: records.length,
          modulesPracticed: new Set(records.map((record) => record.moduleId)).size,
        },
        recentRecords: records.slice(0, 8),
        recommendations: modules.slice(0, 2),
      });
    if (path === '/api/academics/preferences') {
      if (body.revision !== revision) return json(route, { message: '学习设置已修改' }, 409);
      selected = body.selectedModuleIds;
      if ('majorId' in body) chosenMajor = body.majorId;
      revision++;
      return json(route, { revision, selectedModuleIds: selected, majorId: chosenMajor });
    }
    if (path.startsWith('/api/academics/modules/')) {
      const id = path.split('/')[4];
      const module = modules.find((item) => item.id === id);
      if (path.endsWith('/evaluate')) {
        const output =
          module.kind === 'quiz'
            ? {
                ...result,
                summary: '练习完成',
                sections: [
                  { title: '第 1 题 · 回答正确', content: '队列先进先出，栈后进先出。', status: 'success' },
                ],
              }
            : module.kind === 'workspace'
              ? { ...result, summary: '笔记已保存', metrics: [], tables: [], sections: [] }
              : result;
        const record = {
          id: `record-${records.length + 1}`,
          moduleId: id,
          title: body.title || body.values.title || module.title,
          values: body.values,
          result: output,
          status: 'COMPLETED',
          revision: 0,
          notes: '',
          createdAt: stamp,
          updatedAt: stamp,
        };
        records.unshift(record);
        return json(route, { record, result: output }, 201);
      }
      return module ? json(route, module) : json(route, { message: '模块不存在' }, 404);
    }
    if (path === '/api/academics/records') {
      const items = records.filter(
        (record) => !url.searchParams.get('moduleId') || record.moduleId === url.searchParams.get('moduleId'),
      );
      return json(route, { items, total: items.length, page: 1, pageSize: 12 });
    }
    if (path.startsWith('/api/academics/records/')) {
      const index = records.findIndex((record) => path.endsWith(record.id));
      if (index < 0) return json(route, { message: '找不到记录' }, 404);
      if (request.method() === 'DELETE') {
        records.splice(index, 1);
        return json(route, { ok: true });
      }
      if (conflict) {
        records[index] = {
          ...records[index],
          notes: '另一个窗口的笔记',
          revision: records[index].revision + 1,
        };
        conflict = false;
      }
      if (body.revision !== records[index].revision) return json(route, { message: '记录已更新' }, 409);
      records[index] = { ...records[index], ...body, revision: body.revision + 1 };
      return json(route, records[index]);
    }
    if (path === '/api/account/organization')
      return json(route, {
        accountMode: user().accountMode,
        organization: user().accountMode === 'PERSONAL' ? null : { id: 'org-fixture', name: '测试学习组织' },
        canReturnToPersonal: false,
      });
    if (path === '/api/account/join-requests')
      return request.method() === 'POST' ? json(route, joins[0]) : json(route, { items: joins });
    if (path === '/api/academics/admin/subjects') return json(route, { items: [subject] });
    if (path === '/api/academics/admin/majors') {
      if (request.method() === 'POST') {
        const item = {
          ...body,
          id: 'major-custom',
          active: true,
          revision: 0,
          organizationId: 'org-fixture',
        };
        majors.push(item);
        return json(route, item);
      }
      return json(route, { items: majors });
    }
    if (path === '/api/admin/join-settings') {
      if (request.method() === 'PATCH') joinEnabled = body.joinEnabled;
      return json(route, { joinEnabled, inviteCode: 'JOIN-FIXTURE' });
    }
    if (path === '/api/admin/users') {
      if (request.method() === 'POST') {
        const item = { ...body, id: 'created-student', active: true, createdAt: stamp };
        users.push(item);
        return json(route, item);
      }
      return json(route, { items: users, total: users.length });
    }
    if (path === '/api/admin/users/import')
      return json(route, { valid: true, preview: body.rows, errors: [] });
    if (path === '/api/admin/join-requests')
      return json(route, {
        items: joins.filter((item) => item.status === url.searchParams.get('status')),
        total: joins.filter((item) => item.status === url.searchParams.get('status')).length,
      });
    if (path.startsWith('/api/admin/join-requests/')) {
      Object.assign(joins[0], body);
      return json(route, joins[0]);
    }
    return json(route, { message: `未模拟的接口：${path}` }, 404);
  });
  return {
    records,
    requests,
    joins,
    failRevision: () => {
      conflict = true;
    },
    selected: () => selected,
    majors,
  };
}

test('个人注册后进入自主学习空间，组织教学菜单隐藏', async ({ page }) => {
  const fixture = await setup(page, 'guest');
  await page.goto('/login');
  await page.getByText('个人注册', { exact: true }).click();
  await page.getByLabel('姓名或昵称').fill('新同学');
  await page.getByLabel('账号', { exact: true }).fill('new-student');
  await page.getByLabel('密码', { exact: true }).fill('long-fixture-password');
  await page.getByLabel('确认密码', { exact: true }).fill('long-fixture-password');
  await page.getByRole('button', { name: '注册并开始学习' }).click();
  await expect(page.getByRole('heading', { name: '我的学习空间', exact: true })).toBeVisible();
  expect(fixture.requests.find((item) => item.path === '/api/auth/register')?.body).toEqual({
    username: 'new-student',
    password: 'long-fixture-password',
    name: '新同学',
  });
  await expect(page.getByRole('link', { name: '我的课程', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '在线考试', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '专业学习中心', exact: true })).toBeVisible();
  await page.goto('/courses');
  await expect(page.getByText('此功能属于组织教学空间', { exact: true })).toBeVisible();
  expect(
    fixture.requests.some((item) => item.path === '/api/dashboard' || item.path.startsWith('/api/courses')),
  ).toBeFalsy();
});

test('个人模块选择保存，组织学生不能自行修改专业', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics');
  await page.getByRole('button', { name: '定制学习模块' }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('combobox', { name: '我的专业' }).press('ArrowDown');
  await page.locator('.ant-select-item-option[title="数学与应用数学"]').click();
  await modal.locator('.academic-module-choice').filter({ hasText: '数据结构概念练习' }).click();
  await modal.getByRole('button', { name: '保存学习设置' }).click();
  await expect(modal).toHaveCount(0);
  expect(fixture.selected()).toContain('concept-quiz');
  await page.reload();
  await page.getByRole('button', { name: '只看已选', exact: true }).click();
  await expect(page.locator('.academic-module-card')).toHaveCount(2);
  await page.unroute('**/api/**');
  await setup(page, 'organization');
  await page.goto('/academics');
  await page.getByRole('button', { name: '定制学习模块' }).click();
  await expect(page.getByRole('combobox', { name: '我的专业' })).toBeDisabled();
});

test('模块字段、计算保存、历史恢复和笔记冲突处理', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/modules/matrix-lab');
  await page.getByLabel('输入矩阵', { exact: true }).fill('[[2,3],[4,5]]');
  await page.getByRole('spinbutton', { name: '缩放倍数' }).fill('3');
  await page.getByRole('button', { name: '运行并保存结果' }).click();
  await expect(page.getByText('运算完成，已保存你的矩阵实验。', { exact: true })).toBeVisible();
  expect(fixture.records[0].values).toMatchObject({ matrix: '[[2,3],[4,5]]', factor: 3 });
  await page.getByLabel('学习记录笔记').fill('我已经理解缩放规律');
  fixture.failRevision();
  await page.getByRole('button', { name: '保存记录与笔记' }).click();
  await expect(page.getByText('记录版本冲突', { exact: true })).toBeVisible();
  await expect(page.getByLabel('学习记录笔记')).toHaveValue('我已经理解缩放规律');
  await page.getByRole('button', { name: '保留我的输入并重新保存' }).click();
  await page.getByRole('button', { name: '保存我的内容', exact: true }).click();
  await expect.poll(() => fixture.records[0].notes).toBe('我已经理解缩放规律');
  await page.getByRole('tab', { name: /学习记录 · 1/ }).click();
  await page.getByRole('button', { name: '恢复输入', exact: true }).click();
  await page.getByRole('tooltip').getByRole('button', { name: '恢复输入', exact: true }).click();
  await expect(page.getByLabel('输入矩阵', { exact: true })).toHaveValue('[[2,3],[4,5]]');
});

test('概念练习提交后才展示解析，自由笔记可保存并删除', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/academics/modules/concept-quiz');
  await expect(page.getByText('队列先进先出，栈后进先出。', { exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: '队列', exact: true }).check();
  await page.getByRole('button', { name: '提交练习并查看解析' }).click();
  await expect(page.getByText('队列先进先出，栈后进先出。', { exact: true })).toBeVisible();
  expect(fixture.records[0].values).toEqual({ answers: { q1: 'b' } });
  await page.goto('/notes');
  await page.getByRole('button', { name: '写一篇学习笔记' }).click();
  await page.getByLabel('学习主题', { exact: true }).fill('今天的学习');
  await page.getByLabel('笔记内容', { exact: true }).fill('理解队列的先进先出。');
  await page.getByRole('button', { name: '保存学习记录', exact: true }).click();
  await expect(page.getByText('笔记已保存', { exact: true })).toBeVisible();
  await page.goto('/notes');
  await expect(page.getByRole('heading', { name: '今天的学习', exact: true })).toBeVisible();
  const noteCard = page
    .locator('.academic-record-grid .panel')
    .filter({ has: page.getByRole('heading', { name: '今天的学习', exact: true }) });
  await noteCard.getByRole('button', { name: '查看与编辑' }).click();
  await page.getByLabel('学习记录笔记').fill('这份还未同步的复盘也要保留。');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await noteCard.getByRole('button', { name: '查看与编辑' }).click();
  await expect(page.getByLabel('学习记录笔记')).toHaveValue('这份还未同步的复盘也要保留。');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: '删除今天的学习' }).click();
  await page.getByRole('button', { name: '删除记录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今天的学习', exact: true })).toHaveCount(0);
});

test('管理员复制专业模板，并给加入申请指定专业', async ({ page }) => {
  const fixture = await setup(page, 'admin');
  await page.goto('/admin/academics');
  await page.getByRole('button', { name: '复制新建', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('名称', { exact: true }).fill('计算数学实验班');
  await modal.getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('计算数学实验班', { exact: true })).toBeVisible();
  expect(fixture.majors[1].moduleIds).toEqual(major.moduleIds);
  await page.getByRole('tab', { name: '邀请码与加入审批' }).click();
  await page.getByRole('switch', { name: '接受组织加入申请' }).click();
  await page.getByRole('combobox', { name: '为申请同学指定专业' }).click();
  await page.getByTitle('计算数学实验班', { exact: true }).click();
  await page.getByRole('button', { name: '批准加入', exact: true }).click();
  await page.getByRole('tooltip').getByRole('button', { name: '批准加入', exact: true }).click();
  await expect.poll(() => fixture.joins[0].status).toBe('APPROVED');
  expect(fixture.joins[0].majorId).toBe('major-custom');
});

test('390px专业学习、实验结果、注册与管理页面无横向溢出', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mkdir('test-results/academics', { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/academics');
  await expect(page.getByRole('heading', { name: '专业学习中心', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBeTruthy();
  await page.screenshot({ path: 'test-results/academics/center-mobile.png', fullPage: true });
  await page.goto('/academics/modules/matrix-lab');
  await page.getByRole('button', { name: '运行并保存结果' }).click();
  await expect(page.getByText('计算解释', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBeTruthy();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: 'test-results/academics/workbench-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/academics');
  await expect(page.locator('.academic-module-card')).toHaveCount(5);
  await page.screenshot({ path: 'test-results/academics/center-desktop.png', fullPage: true });
  await page.unroute('**/api/**');
  await setup(page, 'guest');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page.getByText('个人注册', { exact: true }).click();
  await expect(page.getByRole('button', { name: '注册并开始学习' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBeTruthy();
  await page.screenshot({ path: 'test-results/academics/register-mobile.png', fullPage: true });
  await page.unroute('**/api/**');
  await setup(page, 'admin');
  await page.goto('/admin/academics');
  await expect(page.getByRole('button', { name: '新建专业', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBeTruthy();
  await page.getByRole('tab', { name: '邀请码与加入审批' }).click();
  await expect(page.getByRole('button', { name: '批准加入', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBeTruthy();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: 'test-results/academics/admin-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('个人通过邀请码发送组织加入申请', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/organization');
  await page.getByLabel('组织邀请码', { exact: true }).fill(' JOIN-FIXTURE ');
  await page.getByLabel('申请说明（可选）').fill('希望加入实验班。');
  await page.getByRole('button', { name: '提交加入申请' }).click();
  await expect
    .poll(
      () =>
        fixture.requests.find((item) => item.path === '/api/account/join-requests' && item.method === 'POST')
          ?.body,
    )
    .toEqual({ inviteCode: 'JOIN-FIXTURE', note: '希望加入实验班。' });
  await expect(page.getByText('申请已发送，请等待组织管理员审核', { exact: true })).toBeVisible();
});

test('管理员创建学生指定专业，CSV未填专业时不发送空标识', async ({ page }) => {
  const fixture = await setup(page, 'admin');
  await page.goto('/admin/users');
  await page.getByRole('button', { name: '新增用户', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('姓名', { exact: true }).fill('指定专业学生');
  await modal.getByLabel('账号', { exact: true }).fill('major-student');
  await modal.getByLabel('初始密码', { exact: true }).fill('fixture-only-password');
  await modal.getByRole('combobox', { name: '学生专业', exact: true }).press('ArrowDown');
  await page.locator('.ant-select-item-option[title="数学与应用数学"]').click();
  await modal.getByRole('button', { name: /确\s*定/ }).click();
  await expect
    .poll(
      () =>
        fixture.requests.find((item) => item.path === '/api/admin/users' && item.method === 'POST')?.body
          .majorId,
    )
    .toBe(major.id);
  await expect(page.getByText('指定专业学生', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '批量导入', exact: true }).click();
  await page
    .getByRole('dialog')
    .locator('textarea')
    .fill(
      'username,name,password,role,studentNo,majorId\nempty-major,空专业学生,fixture-only-password,STUDENT,202601,',
    );
  await page.getByRole('button', { name: '校验并预览', exact: true }).click();
  await expect
    .poll(() => fixture.requests.filter((item) => item.path === '/api/admin/users/import').length)
    .toBe(1);
  expect(
    fixture.requests.find((item) => item.path === '/api/admin/users/import')?.body.rows[0],
  ).not.toHaveProperty('majorId');
});
