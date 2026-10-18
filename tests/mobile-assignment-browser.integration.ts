import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createLiveFixture } from './live.fixture';
import { attachLogin } from './live-browser.fixture';

test(
  'website submission detects native draft and submission changes without consuming another attempt',
  { timeout: 120000 },
  async () => {
    const f = await createLiveFixture();
    const browser = await chromium.launch({
      headless: true,
      ...(process.platform === 'darwin' ? { channel: 'chrome' } : {}),
    });
    try {
      const question = (
        await f.call(f.clients.teacher, '/questions', 'POST', {
          courseId: f.course.id,
          type: 'short',
          stem: '<p>Cross-device short question</p>',
          answer: 'reference',
          scoreCents: 100,
        })
      ).body;
      const task = (
        await f.call(f.clients.teacher, '/assignments', 'POST', {
          courseId: f.course.id,
          title: 'Native-browser-concurrency',
          opensAt: new Date(Date.now() - 60000).toISOString(),
          dueAt: new Date(Date.now() + 3600000).toISOString(),
          maxAttempts: 3,
          questionVersionIds: [question.versions[0].id],
          audienceIds: [f.users.student.id],
        })
      ).body;
      await f.call(f.clients.teacher, '/assignments/' + task.id + '/publish', 'POST');
      const login = await fetch(f.origin + '/api/mobile/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: f.users.student.username,
          password: f.password,
          deviceName: 'isolated browser parity',
        }),
      });
      assert.equal(login.status, 201);
      const token = (await login.json()).accessToken;
      const native = async (path: string, body: unknown, method = 'POST') => {
        const r = await fetch(f.origin + '/api/mobile/assignments/' + task.id + path, {
          method,
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        assert.ok(r.ok, 'Native fixture request failed: ' + r.status);
        return r.json();
      };
      const context = await browser.newContext();
      await attachLogin(context, f.clients.student, f.origin);
      const page = await context.newPage();
      await page.goto(f.origin + '/assignments/' + task.id);
      await expect(page.getByText('Cross-device short question', { exact: true })).toBeVisible();
      await page.locator('textarea').first().fill('Website old answer');
      const draft = await native(
        '/draft',
        {
          revision: 0,
          answers: [{ questionVersionId: question.versions[0].id, value: 'Native latest answer' }],
          attachmentIds: [],
        },
        'PUT',
      );
      await page.getByRole('button', { name: '正式提交', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '正式提交', exact: true }).click();
      await expect(page.getByText('另一页面已保存新草稿，请刷新后再提交', { exact: true })).toBeVisible();
      assert.equal(await f.db.assignmentSubmission.count({ where: { assignmentId: task.id } }), 0);
      await page.reload();
      await expect(page.locator('textarea').first()).toHaveValue('Native latest answer');
      await native('/submit', {
        answers: draft.answers,
        attachmentIds: [],
        idempotencyKey: 'native-concurrent-first',
        expectedDraftRevision: draft.revision,
        expectedSubmissionVersion: 0,
      });
      await page.getByRole('button', { name: '正式提交', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '正式提交', exact: true }).click();
      await expect(page.getByText('另一页面已保存新草稿，请刷新后再提交', { exact: true })).toBeVisible();
      assert.equal(await f.db.assignmentSubmission.count({ where: { assignmentId: task.id } }), 1);
      await page.reload();
      await expect(page.getByText('Cross-device short question', { exact: true })).toBeVisible();
      await page.locator('textarea').first().fill('Website confirmed second version');
      await page.getByRole('button', { name: '正式提交', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '正式提交', exact: true }).click();
      await expect(page.getByText('第 2 次提交', { exact: true })).toBeVisible();
      assert.equal(await f.db.assignmentSubmission.count({ where: { assignmentId: task.id } }), 2);
    } finally {
      await browser.close();
      await f.cleanup();
    }
  },
);
