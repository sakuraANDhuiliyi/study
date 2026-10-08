// Mocked API contract tests: all /api/** traffic is fulfilled locally. These tests do not verify a real model, account, or database.
import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.use({ actionTimeout: 15000 });
const stamp = '2026-10-08T08:00:00.000Z';
const permissions = ['question.manage', 'course.manage', 'assessment.manage'];
const input = {
  mode: 'paper',
  courseId: 'course-algebra',
  chapterId: 'chapter-functions',
  title: '二次函数单元巩固',
  knowledgePoints: ['二次函数', '顶点坐标'],
  requirements: '解析写清推导过程。',
  material: '契约夹具：函数图像与顶点式。',
  blueprint: ['single', 'multiple', 'boolean', 'blank', 'short'].map((type) => ({
    type,
    count: 1,
    scoreCents: 200,
    difficulty: 3,
  })),
};
const questions = [
  {
    type: 'single',
    stem: '函数 y = (x - 2)² + 1 的顶点坐标是？',
    options: [
      { id: 'A', text: '(2, 1)' },
      { id: 'B', text: '(-2, 1)' },
      { id: 'C', text: '(2, -1)' },
    ],
    answer: ['A'],
  },
  {
    type: 'multiple',
    stem: '关于函数 y = x²，下列哪些说法正确？',
    options: [
      { id: 'A', text: '开口向上' },
      { id: 'B', text: '对称轴为 y 轴' },
      { id: 'C', text: '最大值为 0' },
    ],
    answer: ['A', 'B'],
  },
  { type: 'boolean', stem: '函数 y = x² 的最小值为 0。', options: [], answer: ['true'] },
  {
    type: 'blank',
    stem: '函数 y = (x - 2)² + 1 的顶点横坐标为 ___，纵坐标为 ___。',
    options: [],
    answer: ['2', '1'],
  },
  {
    type: 'short',
    stem: '请解释如何由顶点式确定二次函数的最小值。',
    options: [],
    answer: ['先判断二次项系数为正，再由顶点的纵坐标确定最小值。'],
  },
].map((q) => ({
  ...q,
  explanation: '根据二次函数顶点式，结合开口方向判断。',
  knowledgePoints: ['二次函数'],
  scoreCents: 200,
  difficulty: 3,
}));
function draft(id = 'ready-history', status = 'ready', mode = 'paper') {
  return {
    id,
    mode,
    courseId: input.courseId,
    chapterId: input.chapterId,
    title: id === 'ready-history' ? '历史：函数巩固草稿' : input.title,
    status,
    input: { ...input, mode },
    questions: status === 'failed' || status === 'pending' ? [] : structuredClone(questions),
    revision: 1,
    error: status === 'failed' ? '模型暂时不可用，请稍后重试。' : null,
    model: 'contract-fixture-model',
    createdAt: stamp,
    updatedAt: stamp,
    savedQuestionIds: status === 'saved' ? ['q-saved'] : [],
    savedPaperId: status === 'saved' && mode === 'paper' ? 'paper-saved' : null,
  };
}
type FixtureOptions = {
  role?: string;
  permissions?: string[];
  available?: boolean;
  failGenerate?: boolean;
  delayed?: boolean;
};
async function fixture(page: Page, options: FixtureOptions = {}) {
  const bodies: { path: string; method: string; body: any; csrf: string | undefined }[] = [];
  const records = new Map([
    ['ready-history', draft()],
    ['failed-history', draft('failed-history', 'failed')],
    ['pending-history', draft('pending-history', 'pending')],
    ['saved-history', draft('saved-history', 'saved')],
    ['old-history', draft('old-history', 'ready', 'questions')],
  ]);
  let nextConflict = false;
  let release: (() => void) | undefined;
  let pendingStarted = 0;
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (!['GET', 'HEAD'].includes(method))
      bodies.push({ path, method, body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] });
    if (path === '/api/auth/me')
      return json(route, {
        user: {
          id: 'contract-teacher',
          name: '契约教师',
          username: 'fixture',
          role: options.role || 'TEACHER',
          roles: [options.role || 'TEACHER'],
          permissions: options.permissions ?? permissions,
          organizationId: 'fixture-org',
        },
        csrfToken: 'authoring-contract-csrf',
      });
    if (path === '/api/platform') return json(route, { name: '知学' });
    if (path === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    if (path === '/api/courses')
      return json(route, {
        items: [
          { id: input.courseId, title: '高中数学 · 必修第一册' },
          { id: 'course-physics', title: '高中物理' },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      });
    if (path.startsWith('/api/courses/'))
      return json(route, {
        id: path.split('/').at(-1),
        title: '高中数学 · 必修第一册',
        chapters: [{ id: 'chapter-functions', title: '第三章：二次函数' }],
      });
    if (path === '/api/questions' || path === '/api/papers')
      return json(route, { items: [], total: 0, page: 1, pageSize: 15 });
    if (path === '/api/ai-authoring/status')
      return json(route, {
        available: options.available !== false,
        reason: options.available === false ? '未配置 AI API 密钥' : '',
        model: 'contract-fixture-model',
        limits: { maxQuestions: 10, dailyRequests: 20 },
      });
    if (path === '/api/ai-authoring/drafts' && method === 'GET') {
      const number = Number(url.searchParams.get('page') || 1);
      const items = [...records.values()]
        .filter(
          (d) => (options.permissions ?? permissions).includes('assessment.manage') || d.mode === 'questions',
        )
        .filter((d) => (number === 1 ? d.id !== 'old-history' : d.id === 'old-history'))
        .map((d) => ({ ...d, questions: undefined, input: undefined, questionCount: d.questions.length }));
      return json(route, { items, total: 9, page: number, pageSize: 8 });
    }
    if (path === '/api/ai-authoring/drafts' && method === 'POST') {
      const body = request.postDataJSON();
      if (options.delayed)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      const value = draft('generated-fixture', options.failGenerate ? 'failed' : 'ready', body.mode);
      value.input = body;
      value.title = body.title;
      value.courseId = body.courseId;
      value.chapterId = body.chapterId || null;
      value.questions = options.failGenerate
        ? []
        : body.blueprint.flatMap((b: any) =>
            Array.from({ length: b.count }, (_, i) => ({
              ...structuredClone(questions.find((q) => q.type === b.type)!),
              ...(i ? { stem: `变式 ${i}：${questions.find((q) => q.type === b.type)!.stem}` } : {}),
              scoreCents: b.scoreCents,
              difficulty: b.difficulty,
            })),
          );
      records.set(value.id, value);
      return json(route, value, 201);
    }
    const match = path.match(/^\/api\/ai-authoring\/drafts\/([^/]+)(\/commit)?$/);
    if (match) {
      const value = records.get(match[1]);
      if (!value) return json(route, { message: '草稿不存在' }, 404);
      if (method === 'DELETE') {
        records.delete(value.id);
        return json(route, { ok: true });
      }
      if (match[2] && method === 'POST') {
        if (nextConflict) {
          nextConflict = false;
          value.revision++;
          return json(route, { message: '草稿版本已变化，请刷新后重试。' }, 409);
        }
        const body = request.postDataJSON();
        value.status = 'saved';
        value.title = body.title;
        value.questions = body.questions;
        value.revision++;
        value.savedQuestionIds = value.questions.map((_, i) => `saved-q-${i}`);
        value.savedPaperId = value.mode === 'paper' ? 'saved-paper' : null;
        return json(route, value);
      }
      if (value.id === 'pending-history' && !pendingStarted) pendingStarted = Date.now();
      if (value.id === 'pending-history' && Date.now() - pendingStarted > 3000) {
        value.status = 'ready';
        value.questions = structuredClone(questions);
        value.revision++;
      }
      return json(route, value);
    }
    return json(route, { message: '此请求不属于 UI 契约夹具' }, 404);
  });
  return {
    bodies,
    records,
    conflict: () => {
      nextConflict = true;
    },
    release: () => release?.(),
  };
}
async function fillGeneration(page: Page, allTypes = false) {
  await page.getByLabel('题名 / 试卷名称', { exact: false }).fill(input.title);
  const tags = page.locator('#author-knowledge');
  await tags.fill('二次函数');
  await tags.press('Enter');
  await tags.fill('顶点坐标');
  await tags.press('Enter');
  await tags.press('Escape');
  await page.locator('#blueprint-single-count').fill('1');
  if (allTypes)
    for (const name of ['多选题', '判断题', '填空题', '简答题'])
      await page.getByRole('checkbox', { name, exact: true }).check();
  await page.getByLabel('额外要求（选填）').fill(input.requirements);
  await page.getByLabel('参考材料（选填）').fill(input.material);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBeTruthy();
}

test('Mocked API contract: teacher generates, edits every question type, recovers conflict and saves a private paper', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/ai-authoring?mode=paper&courseId=course-algebra');
  await expect(page.getByRole('heading', { name: 'AI 出题', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: '完整试卷' })).toBeChecked();
  await fillGeneration(page, true);
  await page.locator('#author-chapter').locator('..').locator('..').click();
  await page.getByText('第三章：二次函数', { exact: true }).click();
  await mkdir('.data', { recursive: true });
  await page.screenshot({ path: '.data/ai-authoring-compose-desktop.png', animations: 'disabled' });
  await page.getByRole('button', { name: '生成出题草稿' }).click();
  await expect(page.getByRole('heading', { name: '审阅出题草稿' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(5);
  const generation = state.bodies.find((r) => r.path === '/api/ai-authoring/drafts')!;
  expect(generation.csrf).toBe('authoring-contract-csrf');
  expect(generation.body).toEqual(input);
  await page.getByLabel('题干', { exact: true }).first().fill('已审校：函数 y = (x - 2)² + 1 的顶点坐标是？');
  await page.getByLabel('第 1 题选项 B', { exact: true }).fill('(-2, -1)');
  await page.getByRole('checkbox', { name: '第 2 题正确答案 C', exact: true }).check();
  await page.getByRole('radio', { name: '错误', exact: true }).check();
  await page.getByLabel('填空答案（每行对应一空）').fill('2\n1');
  await page.getByLabel('参考答案', { exact: true }).fill('先完成平方，再判断开口方向，并读取顶点纵坐标。');
  await page.locator('#author-question-0-score').fill('2.5');
  await page.getByLabel('答案解析', { exact: true }).first().fill('由顶点式直接读出横坐标 2、纵坐标 1。');
  await page.getByRole('heading', { name: '审阅出题草稿' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.data/ai-authoring-preview-desktop.png', animations: 'disabled' });
  state.conflict();
  await page.getByRole('button', { name: '保存整卷与题目' }).click();
  await expect(page.getByText('草稿版本已变化，请刷新后重试。', { exact: true })).toBeVisible();
  await expect(page.getByLabel('题干', { exact: true }).first()).toHaveValue(/^已审校/);
  await page.getByRole('button', { name: '保留修改并刷新版本' }).click();
  await expect(page.getByText('版本 2', { exact: true })).toBeVisible();
  await expect(page.getByLabel('题干', { exact: true }).first()).toHaveValue(/^已审校/);
  await page.getByRole('button', { name: '保存整卷与题目' }).click();
  await expect(page.getByText('试卷和题目已保存，可在考试中心选择已有试卷。')).toBeVisible();
  await expect(page.getByRole('link', { name: '查看固定版本试卷' })).toHaveAttribute(
    'href',
    '/questions?courseId=course-algebra&tab=papers',
  );
  await expect(page.getByRole('link', { name: '前往考试中心', exact: true })).toHaveAttribute(
    'href',
    '/exams',
  );
  const commits = state.bodies.filter((r) => r.path.endsWith('/commit'));
  expect(commits).toHaveLength(2);
  expect(commits[1].body.revision).toBe(2);
  expect(commits[1].body.questions[0].scoreCents).toBe(250);
  expect(Object.keys(commits[1].body).sort()).toEqual(['questions', 'revision', 'title']);
  for (const q of commits[1].body.questions)
    expect(Object.keys(q).sort()).toEqual([
      'answer',
      'difficulty',
      'explanation',
      'knowledgePoints',
      'options',
      'scoreCents',
      'stem',
      'type',
    ]);
  await noOverflow(page);
});

test('Mocked API contract: failed and pending history recover; mobile layout and deletion preserve retained questions', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ai-authoring?draft=failed-history');
  await expect(page.getByText('本次生成失败', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '调整要求后重试' }).click();
  await expect(page.getByLabel('题名 / 试卷名称', { exact: false })).toHaveValue(input.title);
  await expect(page.getByLabel('参考材料（选填）')).toHaveValue(input.material);
  await expect(page.getByRole('radio', { name: '完整试卷' })).toBeChecked();
  await page.screenshot({ path: '.data/ai-authoring-compose-mobile.png', animations: 'disabled' });
  await noOverflow(page);
  await page.goto('/ai-authoring?draft=pending-history');
  await expect(page.getByText('题目正在生成', { exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(5, { timeout: 10000 });
  await page.getByRole('article').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.data/ai-authoring-preview-mobile.png', animations: 'disabled' });
  await noOverflow(page);
  await page.getByRole('button', { name: '删除第 1 题', exact: true }).click();
  await page.getByRole('button', { name: /^确\s*定$/ }).click();
  await expect(page.getByRole('article')).toHaveCount(4);
  await page.getByRole('button', { name: '保存整卷与题目' }).click();
  await expect(page.getByText('试卷和题目已保存，可在考试中心选择已有试卷。')).toBeVisible();
  expect(state.bodies.find((r) => r.path.endsWith('/commit'))!.body.questions).toHaveLength(4);
  await page.getByRole('button', { name: '删除任务记录', exact: true }).click();
  await expect(page.getByText('只删除任务记录，已保存的题目与试卷仍保留。')).toBeVisible();
  await page.getByRole('button', { name: /^确\s*定$/ }).click();
  await expect(page.getByRole('heading', { name: '设置出题要求' })).toBeVisible();
  expect(state.bodies.some((r) => r.method === 'DELETE' && r.path.endsWith('/pending-history'))).toBeTruthy();
  await page.getByRole('listitem', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('button', { name: /二次函数单元巩固.*待审阅.*题目/s })).toBeVisible();
});

test('Mocked API contract: missing configuration and teacher permission boundaries are explicit', async ({
  page,
}) => {
  await fixture(page, { available: false, permissions: ['question.manage', 'course.manage'] });
  await page.goto('/ai-authoring?mode=paper&courseId=course-algebra');
  await expect(page.getByText('AI 服务尚不可用', { exact: true })).toBeVisible();
  await expect(page.getByText(/config.yaml 中的 AI 密钥/)).toBeVisible();
  await expect(page.getByRole('radio', { name: '完整试卷' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '生成出题草稿' })).toBeDisabled();
  await page.getByRole('button', { name: '刷新状态' }).click();
  await page.goto('/questions');
  await expect(page.getByRole('link', { name: 'AI 生成题目' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'AI 编写试卷' })).toHaveCount(0);
  await page.unrouteAll();
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/questions');
  await expect(page.getByRole('link', { name: 'AI 生成题目' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'AI 编写试卷' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  for (const role of ['STUDENT', 'ADMIN', 'SUPER_ADMIN']) {
    await page.unrouteAll();
    await fixture(page, { role });
    await page.goto('/ai-authoring');
    await expect(page.getByText('当前工作身份没有此功能权限，请切换已获授权的身份。')).toBeVisible();
    await expect(page.getByRole('link', { name: 'AI 出题', exact: true })).toHaveCount(0);
  }
  await page.unrouteAll();
  await fixture(page, { permissions: ['question.manage'] });
  await page.goto('/ai-authoring');
  await expect(page.getByText('当前身份没有课程管理权限', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '生成出题草稿' })).toBeDisabled();
});

test('Mocked API contract: delayed generation cannot replace a newly opened historical draft', async ({
  page,
}) => {
  const state = await fixture(page, { delayed: true });
  await page.goto('/ai-authoring?courseId=course-algebra');
  await fillGeneration(page);
  await page.getByRole('button', { name: '生成出题草稿' }).click();
  await expect.poll(() => state.bodies.filter((r) => r.path === '/api/ai-authoring/drafts').length).toBe(1);
  await expect(page.getByRole('button', { name: /生成出题草稿$/ })).toBeDisabled();
  await expect(page.locator('#author-course')).toBeDisabled();
  await page.evaluate(() => {
    window.history.pushState({}, '', '/ai-authoring?draft=ready-history');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByLabel('题名 / 试卷名称', { exact: false })).toHaveValue('历史：函数巩固草稿');
  state.release();
  await expect.poll(() => state.records.has('generated-fixture')).toBeTruthy();
  await expect(page).toHaveURL(/draft=ready-history/);
  await expect(page.getByLabel('题名 / 试卷名称', { exact: false })).toHaveValue('历史：函数巩固草稿');
  expect(state.bodies.filter((r) => r.path === '/api/ai-authoring/drafts')).toHaveLength(1);
});

test('Mocked API contract: failed model result is not success; blank answer validation preserves edits', async ({
  page,
}) => {
  const state = await fixture(page, { failGenerate: true });
  await page.goto('/ai-authoring?courseId=course-algebra');
  await fillGeneration(page);
  await page.getByRole('button', { name: '生成出题草稿' }).click();
  await expect(page.getByText('本次生成失败', { exact: true })).toBeVisible();
  await expect(page.getByText('草稿已生成，请逐题审阅后保存', { exact: true })).toHaveCount(0);
  await page.goto('/ai-authoring?draft=ready-history');
  await page.getByLabel('填空答案（每行对应一空）').fill('仅一行');
  await page.getByRole('button', { name: '保存整卷与题目' }).click();
  await expect(
    page.getByText('第 4 题：题干中的 ___ 空位数量必须与答案行数一致', { exact: true }),
  ).toBeVisible();
  expect(state.bodies.filter((r) => r.path.endsWith('/commit'))).toHaveLength(0);
  await expect(page.getByLabel('填空答案（每行对应一空）')).toHaveValue('仅一行');
  await page.getByRole('button', { name: '新建出题任务' }).click();
  await expect(page.getByRole('dialog', { name: '离开未保存的草稿？' })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page).toHaveURL(/draft=ready-history/);
});
