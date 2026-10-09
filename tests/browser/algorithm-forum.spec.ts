// Local mocked API contracts; no provider calls or actual forum/user writes.
import { expect, test, type Page, type Route } from '@playwright/test';
test.use({ actionTimeout: 15000 });
const stamp = '2026-10-09T09:00:00.000Z';
async function fixture(
  page: Page,
  options: { personal?: boolean; role?: string; conflict?: boolean; moderate?: boolean } = {},
) {
  const writes: { path: string; body: any; csrf?: string }[] = [];
  let post: any = {
    id: 'post-one',
    scope: 'public',
    kind: 'question',
    title: '如何用哈希表解题',
    body: '<script>window.forumXss = true</script>\nconst value = 2;',
    excerpt: '哈希表讨论',
    problemId: 'two-sum-indices',
    problem: { id: 'two-sum-indices', number: 4, title: '两数之和下标' },
    revision: 0,
    pinned: false,
    closed: false,
    solved: false,
    authorLabel: '学习者·1234abcd5678ef90',
    isOwn: true,
    canEdit: true,
    canDelete: true,
    canModerate: !!options.moderate,
    canSolve: true,
    replyCount: 0,
    createdAt: stamp,
    updatedAt: stamp,
  };
  const replies: any[] = [];
  let conflict = !!options.conflict;
  const json = (route: Route, value: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method();
    if (!['GET', 'HEAD'].includes(method))
      writes.push({ path, body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] });
    if (path === '/api/auth/me')
      return json(route, {
        csrfToken: 'forum-contract-csrf',
        user: {
          id: 'fixture-user',
          organizationId: 'fixture-org',
          accountMode: options.personal ? 'PERSONAL' : 'ORGANIZATION',
          name: '契约学生',
          username: 'fixture',
          role: options.role || 'STUDENT',
          roles: [options.role || 'STUDENT'],
          permissions:
            options.role === 'ADMIN'
              ? ['communication.read', 'communication.moderate']
              : ['learning.use', 'communication.write', 'communication.read'],
        },
      });
    if (path === '/api/algorithm-forum/status')
      return json(route, {
        canWrite: options.role !== 'ADMIN',
        canOrganization: !options.personal,
        problems: [{ id: 'two-sum-indices', number: 4, title: '两数之和下标' }],
      });
    if (path === '/api/algorithm-forum/posts' && method === 'GET')
      return json(route, {
        items:
          url.searchParams.get('scope') === 'organization'
            ? [{ ...post, id: 'private-post', title: '机构内思路讨论', scope: 'organization' }]
            : [post],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    if (path === '/api/algorithm-forum/posts' && method === 'POST') {
      post = { ...post, ...request.postDataJSON() };
      return json(route, post, 201);
    }
    if (path === '/api/algorithm-forum/posts/post-one' && method === 'GET') return json(route, post);
    if (path === '/api/algorithm-forum/posts/post-one' && method === 'PATCH') {
      if (conflict) {
        conflict = false;
        post = { ...post, revision: 1, title: '另一个页面更新的标题', body: '新的服务端内容' };
        return json(route, { message: '讨论已更新，请刷新后重试' }, 409);
      }
      post = { ...post, ...request.postDataJSON(), revision: post.revision + 1 };
      return json(route, post);
    }
    if (path === '/api/algorithm-forum/posts/post-one/moderation') {
      post = { ...post, ...request.postDataJSON(), revision: post.revision + 1 };
      return json(route, post);
    }
    if (path === '/api/algorithm-forum/posts/post-one/replies' && method === 'GET')
      return json(route, { items: replies, total: replies.length, page: 1, pageSize: 20 });
    if (path === '/api/algorithm-forum/posts/post-one/replies' && method === 'POST') {
      const row = {
        id: 'reply-one',
        ...request.postDataJSON(),
        revision: 0,
        authorLabel: '学习者·1234abcd5678ef90',
        isOwn: true,
        canDelete: true,
        createdAt: stamp,
      };
      replies.push(row);
      post.replyCount++;
      return json(route, row, 201);
    }
    if (path.includes('/replies/') && method === 'DELETE') {
      replies.length = 0;
      return json(route, { ok: true });
    }
    if (path === '/api/notifications') return json(route, { items: [], total: 0, unreadCount: 0 });
    if (path === '/api/platform') return json(route, { name: '知学' });
    return json(route, {});
  });
  return writes;
}
test('new public topic requires explicit visibility and sends CSRF, kind and problem association', async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto('/algorithms/forum');
  await expect(page.getByRole('heading', { name: '算法论坛', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '发表讨论', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText('发表后全站已登录用户可见。请勿包含真实姓名、账号、密钥或其他私人资料。'),
  ).toBeVisible();
  await dialog.getByRole('textbox', { name: '讨论标题', exact: true }).fill('我如何理解前缀和');
  await dialog.getByRole('textbox', { name: '讨论内容', exact: true }).fill('先定义 prefix[i] 的含义。');
  await dialog.getByRole('button', { name: '确认发表到公共社区' }).click();
  await expect(page).toHaveURL(/forum\/post-one$/);
  const body = writes.find((w) => w.path === '/api/algorithm-forum/posts')!;
  expect(body.body.scope).toBe('public');
  expect(body.body.kind).toBe('question');
  expect(body.csrf).toBe('forum-contract-csrf');
  expect(body.body).not.toHaveProperty('authorId');
});
test('institution forum switches scope in URL and publisher explicitly chooses institution visibility', async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto('/algorithms/forum');
  await page.getByRole('tab', { name: '本机构讨论', exact: true }).click();
  await expect(page).toHaveURL(/scope=organization/);
  await expect(page.getByRole('link', { name: '机构内思路讨论' })).toBeVisible();
  await expect(page.getByRole('link', { name: '如何用哈希表解题' })).toHaveCount(0);
  await page.getByRole('button', { name: '发表讨论', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('仅当前学校 / 机构用户可见。发表后不能改变可见范围。')).toBeVisible();
  await dialog.getByRole('textbox', { name: '讨论标题', exact: true }).fill('本班动态规划交流');
  await dialog.getByRole('textbox', { name: '讨论内容', exact: true }).fill('状态定义讨论');
  await dialog.getByRole('button', { name: '确认发表到本机构讨论' }).click();
  await expect
    .poll(() => writes.find((w) => w.path === '/api/algorithm-forum/posts')?.body.scope)
    .toBe('organization');
});
test('publishing from a filtered forum preserves its selected problem without manual selection', async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto('/algorithms/forum?scope=public&problemId=two-sum-indices');
  await page.getByRole('button', { name: '发表讨论', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: '关联算法题目' })).toBeDisabled();
  await expect(dialog.getByText('4. 两数之和下标', { exact: true })).toBeVisible();
  await dialog.getByRole('textbox', { name: '讨论标题', exact: true }).fill('这道题的边界输入');
  await dialog
    .getByRole('textbox', { name: '讨论内容', exact: true })
    .fill('从题目筛选列表直接发表，无需重新选择题目。');
  await dialog.getByRole('button', { name: '确认发表到公共社区' }).click();
  await expect(page).toHaveURL(/forum\/post-one$/);
  const post = writes.find((write) => write.path === '/api/algorithm-forum/posts');
  expect(post?.body.problemId).toBe('two-sum-indices');
  expect(post?.body.scope).toBe('public');
});
test('personal students see public community and no institutional publishing option', async ({ page }) => {
  await fixture(page, { personal: true });
  await page.goto('/algorithms/forum');
  await expect(page.getByRole('tab', { name: '本机构讨论', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '发表讨论', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: '讨论可见范围' }).focus();
  await dialog.getByRole('combobox', { name: '讨论可见范围' }).press('ArrowDown');
  await expect(page.getByRole('option', { name: /仅本机构/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '确认发表到公共社区' })).toBeVisible();
});
test('reduced-motion forum dropdowns remain in viewport and accept mouse selection', async ({ page }) => {
  const writes = await fixture(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/algorithms/forum');
  await page.locator('.forum-filters .ant-select-selector').first().click();
  const kind = page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')
    .filter({ hasText: /^题解$/ });
  await expect(kind).toBeInViewport();
  await kind.click();
  await expect(page).toHaveURL(/kind=solution/);
  await page.getByRole('button', { name: '发表讨论', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('label').filter({ hasText: '关联题目' }).locator('.ant-select-selector').click();
  const problem = page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')
    .filter({ hasText: '4. 两数之和下标' });
  await expect(problem).toBeInViewport();
  await problem.click();
  await dialog.getByRole('textbox', { name: '讨论标题', exact: true }).fill('鼠标选择题目后的讨论');
  await dialog
    .getByRole('textbox', { name: '讨论内容', exact: true })
    .fill('减少动态效果模式下，也能用鼠标正常选择关联题目。');
  await dialog.getByRole('button', { name: '确认发表到公共社区' }).click();
  await expect(page).toHaveURL(/forum\/post-one$/);
  expect(writes.find((write) => write.path === '/api/algorithm-forum/posts')?.body.problemId).toBe(
    'two-sum-indices',
  );
});
test('topic and replies render HTML/code as literal text, reply and soft-delete controls work', async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto('/algorithms/forum/post-one');
  await expect(page.locator('.forum-topic .forum-plain-content')).toContainText(
    '<script>window.forumXss = true</script>',
  );
  expect(await page.evaluate(() => (window as any).forumXss)).toBeUndefined();
  await page
    .getByRole('textbox', { name: '回复内容' })
    .fill('<img src=x onerror=alert(1)>\nconst answer = 42;');
  await page.getByRole('button', { name: '发表回复', exact: true }).click();
  await expect(page.locator('.forum-replies .forum-plain-content')).toContainText(
    '<img src=x onerror=alert(1)>',
  );
  const write = writes.find((w) => w.path.endsWith('/replies'))!;
  expect(write.body.postRevision).toBe(0);
  await expect(page.getByRole('textbox', { name: '回复内容' })).toHaveValue('');
  await page.getByRole('button', { name: '删除回复', exact: true }).click();
  await page.getByRole('button', { name: '确认删除回复' }).click();
  await expect(page.locator('.forum-replies .forum-plain-content')).toHaveCount(0);
});
test('stale edits preserve input and require reviewing a new revision before retry', async ({ page }) => {
  const writes = await fixture(page, { conflict: true });
  await page.goto('/algorithms/forum/post-one');
  await page.getByRole('button', { name: '编辑帖子' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '编辑讨论内容' }).fill('我的未保存输入');
  await dialog.getByRole('button', { name: '保存讨论修改' }).click();
  await expect(dialog.getByRole('textbox', { name: '编辑讨论内容' })).toHaveValue('我的未保存输入');
  await expect(dialog.getByRole('button', { name: '保存讨论修改' })).toBeDisabled();
  await dialog.locator('summary').click();
  await expect(dialog.getByText('新的服务端内容', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '基于最新版本继续编辑' }).click();
  await dialog.getByRole('button', { name: '保存讨论修改' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes.filter((w) => w.path.endsWith('/post-one')).map((w) => w.body.revision)).toEqual([0, 1]);
  await expect(page.locator('.forum-topic .forum-plain-content')).toHaveText('我的未保存输入');
});
test('administrators can moderate but cannot silently publish; 390px forum and detail do not overflow', async ({
  page,
}) => {
  await fixture(page, { role: 'ADMIN', moderate: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/algorithms/forum');
  await expect(page.getByRole('button', { name: '发表讨论', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto('/algorithms/forum/post-one');
  await page.getByRole('button', { name: '关闭讨论', exact: true }).click();
  await expect(page.getByText('讨论已关闭，不再接受回复。')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
