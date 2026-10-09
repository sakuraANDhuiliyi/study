import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient(),
  origin = 'http://localhost:3034';
const fakeSecret = 'PROGRAMMING_LOCAL_FIXTURE_ONLY';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  'programming workspace: private multi-file projects, immutable snapshots and reviewed DeepSeek proposals',
  { timeout: 120000 },
  async (t) => {
    assert.notEqual(process.env.NODE_ENV, 'production');
    const database = new URL(process.env.DATABASE_URL!);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
    assert.ok(database.pathname.includes('review'), 'Use an isolated local review database');
    const suffix = randomUUID().slice(0, 8),
      directory = resolve(`.data/programming-test-${suffix}`);
    await mkdir(directory, { recursive: true });
    let mode: 'success' | 'hold' | 'fail' | 'malformed' | 'unsafe' | 'partial' = 'success';
    let calls = 0,
      requestBody: any,
      observed: (() => void) | undefined,
      release: (() => void) | undefined;
    const candidate = [
      {
        path: 'index.html',
        content:
          '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles/site.css"></head><body><button id="count">0</button><script src="scripts/app.js"></script></body></html>',
      },
      { path: 'styles/site.css', content: 'body{font-family:system-ui;color:#2563eb}' },
      {
        path: 'scripts/app.js',
        content: 'let count=0;document.getElementById("count").onclick=e=>e.target.textContent=++count;',
      },
    ];
    const provider = createServer(async (request, response) => {
      calls++;
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/deepseek/chat/completions');
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requestBody = JSON.parse(Buffer.concat(chunks).toString());
      const current = mode;
      if (current === 'hold') {
        const wait = new Promise<void>((resolve) => {
          release = resolve;
        });
        observed?.();
        await wait;
      }
      if (current === 'fail') {
        response
          .writeHead(500, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: fakeSecret }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          choices: [
            {
              finish_reason: current === 'partial' ? 'length' : 'stop',
              message: {
                role: 'assistant',
                content:
                  current === 'malformed'
                    ? '{invalid'
                    : JSON.stringify({
                        summary: '增加按钮计数',
                        plan: ['添加DOM事件监听器'],
                        teaching: ['用闭包保留计数状态'],
                        files:
                          current === 'unsafe' ? [{ path: '../index.html', content: 'unsafe' }] : candidate,
                      }),
              },
            },
          ],
        }),
      );
    });
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const providerPort = (provider.address() as { port: number }).port,
      configPath = resolve(directory, 'config.yaml');
    const config = (dailyRequests = 100, apiKey = fakeSecret) =>
      writeFile(
        configPath,
        JSON.stringify({
          ai: {
            apiStyle: 'deepseek',
            structuredOutput: 'json_object',
            baseUrl: `http://127.0.0.1:${providerPort}/deepseek`,
            apiKey,
            model: 'deepseek-flash',
            timeoutMs: 10000,
          },
          webSearch: { enabled: false },
          limits: { dailyRequests },
        }),
      );
    await config();
    let logs = '';
    const api = spawn(process.execPath, ['apps/api/dist/main.js'], {
      env: {
        ...process.env,
        AI_CONFIG_PATH: configPath,
        PORT: '3034',
        BIND_HOST: '127.0.0.1',
        APP_ORIGIN: origin,
        DISABLE_JOBS: 'true',
        COOKIE_SECURE: 'false',
        NODE_ENV: 'test',
        PROGRAMMING_PREVIEW_PORT: '4175',
        PROGRAMMING_PREVIEW_ORIGIN: 'http://127.0.0.1:4175',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [api.stdout, api.stderr])
      stream?.on('data', (chunk: Buffer) => {
        logs = (logs + chunk.toString()).slice(-100000);
      });
    const organizations: string[] = [],
      users: string[] = [];
    async function login(username: string) {
      const response = await fetch(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: process.env.DEV_SEED_PASSWORD }),
      });
      assert.equal(response.status, 201, await response.clone().text());
      const payload = await response.json(),
        csrf = payload.csrfToken;
      const cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
      return {
        user: payload.user,
        cookie,
        csrf,
        async raw(path: string, method = 'GET', body?: unknown, withoutCsrf = false, sentOrigin = origin) {
          return fetch(`${origin}/api${path}`, {
            method,
            headers: {
              cookie,
              origin: sentOrigin,
              'content-type': 'application/json',
              ...(!withoutCsrf ? { 'x-csrf-token': csrf } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        },
        async call(
          path: string,
          method = 'GET',
          body?: unknown,
          status = method === 'POST' ? 201 : 200,
          withoutCsrf = false,
        ) {
          const response = await this.raw(path, method, body, withoutCsrf),
            text = await response.text();
          assert.equal(response.status, status, `${method} ${path}: ${text.slice(0, 800)}`);
          return text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
        },
      };
    }
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (api.exitCode !== null) throw new Error('Isolated API stopped before ready');
        try {
          if ((await fetch(`${origin}/api/health`)).ok) {
            ready = true;
            break;
          }
        } catch {
          /* starting */
        }
        await sleep(100);
      }
      assert.ok(ready, 'Build API first and ensure ports 3034/4175 are available');
      const seed = await db.user.findUniqueOrThrow({ where: { username: 'student' } });
      const organization = await db.organization.create({ data: { name: `编程验收-${suffix}` } });
      organizations.push(organization.id);
      const foreignOrg = await db.organization.create({ data: { name: `编程异机构-${suffix}` } });
      organizations.push(foreignOrg.id);
      const personalOrg = await db.organization.create({
        data: { name: `编程个人-${suffix}`, kind: 'PERSONAL' },
      });
      organizations.push(personalOrg.id);
      async function user(
        tag: string,
        roleId = 'STUDENT',
        organizationId = organization.id,
        personal = false,
      ) {
        const row = await db.user.create({
          data: {
            organizationId,
            username: `programming-${tag}-${suffix}`,
            name: `编程验收${tag}`,
            passwordHash: seed.passwordHash,
            ...(personal ? { accountMode: 'PERSONAL', personalOrganizationId: organizationId } : {}),
            roles: { create: { roleId } },
          },
        });
        users.push(row.id);
        return login(row.username);
      }
      const owner = await user('owner'),
        other = await user('other'),
        teacher = await user('teacher', 'TEACHER'),
        foreign = await user('foreign', 'STUDENT', foreignOrg.id),
        personal = await user('personal', 'STUDENT', personalOrg.id, true);
      let project: any, initialVersion: any, aiDraft: any, issued: any;
      const path = () => `/programming/projects/${project.id}`;
      async function generate(prompt = '增加按钮计数', status = 201) {
        return owner.call(`${path()}/ai-drafts`, 'POST', { revision: project.revision, prompt }, status);
      }
      async function hold() {
        mode = 'hold';
        const reached = new Promise<void>((resolve) => {
          observed = resolve;
        });
        const pending = generate();
        await reached;
        return { pending };
      }

      await t.test(
        'status and templates available for organization and personal students; other roles and CSRF rejected',
        async () => {
          const status = await owner.call('/programming/status');
          assert.equal(status.ai.available, true);
          assert.equal(status.preview.available, true);
          assert.equal(status.deployment.available, false);
          assert.equal(status.preview.origin, 'http://127.0.0.1:4175');
          assert.equal(status.limits.maxFiles, 24);
          const templates = await owner.call('/programming/templates');
          assert.deepEqual(
            templates.items.map((item: any) => item.id),
            ['starter', 'counter', 'todo'],
          );
          await teacher.call('/programming/status', 'GET', undefined, 403);
          await owner.call(
            '/programming/projects',
            'POST',
            { title: '未经CSRF', templateId: 'starter' },
            403,
            true,
          );
          const wrongOrigin = await owner.raw(
            '/programming/projects',
            'POST',
            { title: '错误来源', templateId: 'starter' },
            false,
            'https://attacker.invalid',
          );
          assert.equal(wrongOrigin.status, 403);
          const personalProject = await personal.call('/programming/projects', 'POST', {
            title: '个人作品',
            templateId: 'starter',
          });
          assert.ok(personalProject.id);
          assert.equal((await personal.call('/programming/projects')).total, 1);
        },
      );
      await t.test('create project with initial snapshot and validate paths and byte budgets', async () => {
        project = await owner.call('/programming/projects', 'POST', {
          title: '我的项目',
          templateId: 'counter',
        });
        assert.equal(project.revision, 0);
        assert.ok(project.files.some((file: any) => file.path === 'index.html'));
        initialVersion = (await owner.call(`${path()}/versions`)).items[0];
        assert.equal(initialVersion.number, 1);
        assert.deepEqual((await owner.call(`${path()}/versions/${initialVersion.id}`)).files, project.files);
        for (const files of [
          [{ path: '../index.html', content: '' }],
          [
            { path: 'index.html', content: '' },
            { path: 'INDEX.html', content: '' },
          ],
          [{ path: '.env', content: fakeSecret }],
          [{ path: 'index.html', content: '中'.repeat(22000) }],
          [{ path: 'index.html', content: '\0' }],
          Array.from({ length: 25 }, (_, i) => ({ path: i === 0 ? 'index.html' : `${i}.js`, content: '' })),
        ])
          await owner.call(path(), 'PATCH', { title: project.title, revision: project.revision, files }, 400);
        await owner.call('/programming/projects', 'POST', { title: '非法模板', templateId: 'unknown' }, 400);
        await owner.call(
          '/programming/projects',
          'POST',
          { title: '伪造用户', templateId: 'starter', userId: other.user.id },
          400,
        );
      });
      await t.test(
        'private owner scope covers all reads, writes, versions, drafts and downloads',
        async () => {
          for (const outsider of [other, foreign]) {
            assert.equal((await outsider.call('/programming/projects')).total, 0);
            for (const suffix of ['', '/versions', `/versions/${initialVersion.id}`, '/ai-drafts', '/export'])
              await outsider.call(`${path()}${suffix}`, 'GET', undefined, 404);
            await outsider.call(path(), 'PATCH', { title: '越权', revision: 0, files: project.files }, 404);
            await outsider.call(path(), 'DELETE', undefined, 404);
            await outsider.call(`${path()}/preview`, 'POST', { revision: 0, files: project.files }, 404);
            await outsider.call(`${path()}/ai-drafts`, 'POST', { revision: 0, prompt: '越权' }, 404);
          }
        },
      );
      await t.test(
        'optimistic saves, immutable snapshot, restore as a new version and per-project version scope',
        async () => {
          const previous = project.files;
          const changes = { title: '编辑后的项目', revision: project.revision, files: candidate };
          const concurrent = await Promise.all([
            owner.raw(path(), 'PATCH', changes),
            owner.raw(path(), 'PATCH', changes),
          ]);
          assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 409]);
          project = await owner.call(path());
          assert.equal(project.revision, 1);
          assert.deepEqual(project.files, candidate);
          assert.deepEqual((await owner.call(`${path()}/versions/${initialVersion.id}`)).files, previous);
          const saved = await owner.call(`${path()}/versions`, 'POST', {
            revision: project.revision,
            note: '可点击版本',
          });
          project = saved.project;
          assert.equal(saved.version.number, 2);
          const beforeRestoreFiles = candidate.map((file) => ({
            ...file,
            content: file.content + '\n/* 草稿编辑 */',
          }));
          project = await owner.call(path(), 'PATCH', {
            revision: project.revision,
            title: '尚未保存版本的草稿',
            files: beforeRestoreFiles,
          });
          await owner.call(`${path()}/restore`, 'POST', { revision: 0, versionId: initialVersion.id }, 409);
          const another = await owner.call('/programming/projects', 'POST', {
            title: '另一作品',
            templateId: 'starter',
          });
          const anotherVersion = (await owner.call(`/programming/projects/${another.id}/versions`)).items[0];
          await owner.call(
            `${path()}/restore`,
            'POST',
            { revision: project.revision, versionId: anotherVersion.id },
            404,
          );
          project = await owner.call(`${path()}/restore`, 'POST', {
            revision: project.revision,
            versionId: initialVersion.id,
          });
          assert.equal(project.title, '我的项目');
          assert.deepEqual(project.files, previous);
          const history = (await owner.call(`${path()}/versions`)).items;
          assert.equal(history[0].number, 4);
          assert.deepEqual(
            (await owner.call(`${path()}/versions/${history[1].id}`)).files,
            beforeRestoreFiles,
          );
        },
      );
      await t.test(
        'private ZIP downloads preserve real UTF-8 sources and are recognized by standard unzip',
        async () => {
          const response = await owner.raw(`${path()}/export`);
          assert.equal(response.status, 200);
          assert.ok(response.headers.get('content-type')?.includes('application/zip'));
          assert.match(response.headers.get('cache-control')!, /no-store/);
          const archive = resolve(directory, 'project.zip');
          await writeFile(archive, Buffer.from(await response.arrayBuffer()));
          execFileSync('unzip', ['-t', archive], { stdio: 'pipe' });
          for (const file of project.files)
            assert.equal(
              execFileSync('unzip', ['-p', archive, file.path], { encoding: 'utf8' }),
              file.content,
            );
        },
      );
      await t.test(
        'unsaved preview uses independent origin and private, network-limited, no-cookie static snapshot',
        async () => {
          const unsaved = candidate.map((file) => ({
            ...file,
            content:
              file.path === 'index.html'
                ? file.content.replace('0</button>', '预览未保存</button>')
                : file.content,
          }));
          issued = await owner.call(`${path()}/preview`, 'POST', {
            revision: project.revision,
            files: unsaved,
          });
          assert.equal(new URL(issued.url).origin, 'http://127.0.0.1:4175');
          assert.ok(issued.nonce);
          assert.ok(Date.parse(issued.expiresAt) > Date.now());
          const response = await fetch(issued.url);
          assert.equal(response.status, 200);
          assert.match(await response.text(), /预览未保存/);
          assert.equal(response.headers.get('set-cookie'), null);
          assert.match(response.headers.get('content-security-policy')!, /connect-src 'none'/);
          assert.match(response.headers.get('cache-control')!, /no-store/);
          assert.deepEqual((await owner.call(path())).files, project.files);
          await owner.call(
            `${path()}/preview`,
            'POST',
            { revision: project.revision - 1, files: unsaved },
            409,
          );
          const traversal = new URL('../.env', issued.url);
          assert.equal((await fetch(traversal)).status, 404);
        },
      );
      await t.test(
        'DeepSeek request excludes identity, secrets and tools and generated files remain a candidate until apply',
        async () => {
          project = await owner.call(path(), 'PATCH', {
            revision: project.revision,
            title: '生成前未版本化的草稿',
            files: project.files.map((file: any) => ({
              ...file,
              content: file.content + '\n<!-- 未版本化编辑 -->',
            })),
          });
          const before = await owner.call(path());
          aiDraft = await generate();
          assert.equal(aiDraft.status, 'ready');
          assert.equal(aiDraft.baseRevision, project.revision);
          assert.deepEqual(aiDraft.files, candidate);
          assert.deepEqual((await owner.call(path())).files, before.files);
          assert.equal(requestBody.model, 'deepseek-flash');
          assert.deepEqual(requestBody.thinking, { type: 'disabled' });
          assert.deepEqual(requestBody.response_format, { type: 'json_object' });
          assert.equal(requestBody.tools, undefined);
          const request = JSON.parse(
            requestBody.messages.find((message: any) => message.role === 'user').content,
          );
          assert.deepEqual(Object.keys(request).sort(), ['files', 'prompt', 'title']);
          assert.ok(!JSON.stringify(request).includes(owner.user.id));
          assert.ok(!JSON.stringify(request).includes(project.id));
          assert.ok(!JSON.stringify(request).includes(fakeSecret));
          await other.call(`${path()}/ai-drafts/${aiDraft.id}`, 'GET', undefined, 404);
          await other.call(
            `${path()}/ai-drafts/${aiDraft.id}/apply`,
            'POST',
            { revision: project.revision },
            404,
          );
        },
      );
      await t.test(
        'apply is atomic and concurrent/idempotent retries return original snapshot without overwriting later changes',
        async () => {
          const beforeApply = project.files;
          const body = { revision: project.revision },
            applyPath = `${path()}/ai-drafts/${aiDraft.id}/apply`;
          const [a, b] = await Promise.all([
            owner.call(applyPath, 'POST', body),
            owner.call(applyPath, 'POST', body),
          ]);
          assert.equal(a.draft.status, 'applied');
          assert.equal(a.draft.appliedVersionId, b.draft.appliedVersionId);
          assert.deepEqual(a.project, b.project);
          const originalResult = a.project;
          project = a.project;
          assert.deepEqual(project.files, candidate);
          const history = (await owner.call(`${path()}/versions`)).items;
          assert.equal(history.length, 6);
          assert.deepEqual((await owner.call(`${path()}/versions/${history[1].id}`)).files, beforeApply);
          project = await owner.call(path(), 'PATCH', {
            revision: project.revision,
            title: '应用后继续编辑',
            files: candidate.map((file) => ({ ...file, content: file.content + '\n' })),
          });
          const retry = await owner.call(applyPath, 'POST', body);
          assert.deepEqual(retry.project, originalResult);
          assert.deepEqual(await owner.call(path()), project);
          assert.equal((await owner.call(`${path()}/versions`)).items.length, 6);
        },
      );
      await t.test(
        'editing while AI runs makes candidate stale; it remains readable but cannot overwrite current files',
        async () => {
          const { pending } = await hold();
          project = await owner.call(path(), 'PATCH', {
            revision: project.revision,
            title: 'AI期间编辑',
            files: project.files,
          });
          release?.();
          const stale = await pending;
          mode = 'success';
          assert.equal(stale.status, 'ready');
          assert.notEqual(stale.baseRevision, project.revision);
          await owner.call(
            `${path()}/ai-drafts/${stale.id}/apply`,
            'POST',
            { revision: project.revision },
            409,
          );
          assert.deepEqual(await owner.call(path()), project);
        },
      );
      await t.test(
        'shared AI operation prevents simultaneous requests and deletion of an active project',
        async () => {
          const { pending } = await hold(),
            before = calls;
          await generate('第二次', 409);
          await owner.call(path(), 'DELETE', undefined, 409);
          assert.equal(calls, before);
          assert.equal((await owner.call(`${path()}/ai-drafts`)).items[0].status, 'pending');
          release?.();
          assert.equal((await pending).status, 'ready');
          mode = 'success';
          const operation = await db.aiStudyOperation.create({
            data: {
              organizationId: organization.id,
              userId: owner.user.id,
              kind: 'search',
              leaseExpiresAt: new Date(Date.now() + 60000),
            },
          });
          try {
            await generate('共享额度', 409);
          } finally {
            await db.aiStudyOperation.update({
              where: { id: operation.id },
              data: { status: 'failed', completedAt: new Date() },
            });
          }
        },
      );
      await t.test(
        'failed, malformed, truncated and unsafe provider results are stored safely without source changes',
        async () => {
          const before = await owner.call(path());
          for (const current of ['fail', 'malformed', 'partial', 'unsafe'] as const) {
            mode = current;
            const draft = await generate(current);
            assert.equal(draft.status, 'failed');
            assert.ok(!draft.error.includes(fakeSecret));
            assert.deepEqual(draft.files, []);
          }
          mode = 'success';
          assert.deepEqual(await owner.call(path()), before);
        },
      );
      await t.test(
        'disabled institution and session revocation during provider response reject completion and preview access',
        async () => {
          const { pending } = await hold();
          await db.systemSetting.create({
            data: { organizationId: organization.id, key: 'features', value: { practice: false } },
          });
          release?.();
          await assert.rejects(pending, /403/);
          mode = 'success';
          for (const endpoint of [
            '/programming/status',
            '/programming/templates',
            '/programming/projects',
            path(),
          ])
            await owner.call(endpoint, 'GET', undefined, 403);
          assert.ok([403, 404, 410].includes((await fetch(issued.url)).status));
          await db.systemSetting.delete({
            where: { organizationId_key: { organizationId: organization.id, key: 'features' } },
          });
          const held = await hold();
          await db.user.update({ where: { id: owner.user.id }, data: { active: false } });
          release?.();
          await assert.rejects(held.pending, /403/);
          mode = 'success';
          await db.user.update({ where: { id: owner.user.id }, data: { active: true } });
          assert.ok(
            (await owner.call(`${path()}/ai-drafts`)).items.filter((draft: any) => draft.status === 'failed')
              .length >= 6,
          );
        },
      );
      await t.test(
        'expired leases recover and late provider completion cannot turn an old request ready',
        async () => {
          const { pending } = await hold();
          const operation = await db.aiStudyOperation.findFirstOrThrow({
            where: { userId: owner.user.id, status: 'pending' },
          });
          await db.aiStudyOperation.update({
            where: { id: operation.id },
            data: { leaseExpiresAt: new Date(Date.now() - 1) },
          });
          const recovered = (await owner.call(`${path()}/ai-drafts`)).items[0];
          assert.equal(recovered.status, 'failed');
          release?.();
          await assert.rejects(pending, /409/);
          mode = 'success';
          assert.equal((await owner.call(`${path()}/ai-drafts/${recovered.id}`)).status, 'failed');
        },
      );
      await t.test(
        'failure attempts consume shared Beijing-day quota; deletion preserves operation ledger and revokes previews',
        async () => {
          const used = await db.aiStudyOperation.count({ where: { userId: owner.user.id } });
          await config(used);
          await generate('已用额度', 429);
          await config();
          const refreshed = await owner.call(`${path()}/preview`, 'POST', {
            revision: project.revision,
            files: project.files,
          });
          await owner.call(path(), 'DELETE');
          await owner.call(path(), 'GET', undefined, 404);
          assert.equal(await db.aiStudyOperation.count({ where: { userId: owner.user.id } }), used);
          assert.equal(await db.programmingVersion.count({ where: { projectId: project.id } }), 0);
          assert.equal(await db.programmingAiDraft.count({ where: { projectId: project.id } }), 0);
          assert.ok([404, 410].includes((await fetch(refreshed.url)).status));
        },
      );
      await t.test(
        'maximum project/version/draft counts are enforced and unavailable AI keeps editor usable',
        async () => {
          const many = await other.call('/programming/projects', 'POST', {
            title: '边界项目',
            templateId: 'starter',
          });
          await db.programmingProject.createMany({
            data: Array.from({ length: 19 }, (_, index) => ({
              organizationId: organization.id,
              userId: other.user.id,
              title: `边界${index}`,
              templateId: 'starter',
              files: many.files,
            })),
          });
          await other.call(
            '/programming/projects',
            'POST',
            { title: '超量项目', templateId: 'starter' },
            409,
          );
          await db.programmingVersion.createMany({
            data: Array.from({ length: 29 }, (_, index) => ({
              organizationId: organization.id,
              userId: other.user.id,
              projectId: many.id,
              number: index + 2,
              title: many.title,
              note: '边界',
              files: many.files,
            })),
          });
          await other.call(
            `/programming/projects/${many.id}/versions`,
            'POST',
            { revision: 0, note: '超量' },
            409,
          );
          assert.equal((await other.call(`/programming/projects/${many.id}`)).revision, 0);
          const operations = await Promise.all(
            Array.from({ length: 20 }, () =>
              db.aiStudyOperation.create({
                data: {
                  organizationId: organization.id,
                  userId: other.user.id,
                  kind: 'programming',
                  status: 'failed',
                  leaseExpiresAt: new Date(),
                  completedAt: new Date(),
                },
              }),
            ),
          );
          await db.programmingAiDraft.createMany({
            data: operations.map((operation) => ({
              organizationId: organization.id,
              userId: other.user.id,
              projectId: many.id,
              operationId: operation.id,
              baseRevision: 0,
              prompt: '边界',
              status: 'failed',
              model: 'fixture',
            })),
          });
          await other.call(
            `/programming/projects/${many.id}/ai-drafts`,
            'POST',
            { revision: 0, prompt: '超量草稿' },
            409,
          );
          // With 29 snapshots, replacing an unsnapshotted draft needs two slots.
          // Both the preservation insert and the project update must roll back.
          await db.programmingVersion.deleteMany({ where: { projectId: many.id, number: 30 } });
          const dirty = await other.call(`/programming/projects/${many.id}`, 'PATCH', {
            revision: 0,
            title: '尚未版本化的当前草稿',
            files: many.files,
          });
          const first = await db.programmingVersion.findFirstOrThrow({
            where: { projectId: many.id, number: 1 },
          });
          await other.call(
            `/programming/projects/${many.id}/restore`,
            'POST',
            {
              revision: dirty.revision,
              versionId: first.id,
            },
            409,
          );
          assert.deepEqual(await other.call(`/programming/projects/${many.id}`), dirty);
          assert.equal(await db.programmingVersion.count({ where: { projectId: many.id } }), 29);
          await db.aiStudyOperation.update({
            where: { id: operations[0].id },
            data: { status: 'completed' },
          });
          const ready = await db.programmingAiDraft.update({
            where: { operationId: operations[0].id },
            data: {
              status: 'ready',
              baseRevision: dirty.revision,
              summary: '容量回滚验收',
              plan: ['添加计数事件'],
              teaching: ['保留操作前后源码'],
              files: candidate,
            },
          });
          await other.call(
            `/programming/projects/${many.id}/ai-drafts/${ready.id}/apply`,
            'POST',
            {
              revision: dirty.revision,
            },
            409,
          );
          assert.deepEqual(await other.call(`/programming/projects/${many.id}`), dirty);
          assert.equal(await db.programmingVersion.count({ where: { projectId: many.id } }), 29);
          assert.equal(
            (await db.programmingAiDraft.findUniqueOrThrow({ where: { id: ready.id } })).status,
            'ready',
          );
          await config(100, '');
          assert.equal((await other.call('/programming/status')).ai.available, false);
          await other.call(
            `/programming/projects/${many.id}/ai-drafts`,
            'POST',
            { revision: dirty.revision, prompt: '未配置' },
            503,
          );
          assert.equal((await other.call(`/programming/projects/${many.id}`)).id, many.id);
          await config();
        },
      );
    } finally {
      release?.();
      api.kill('SIGTERM');
      await Promise.race([once(api, 'exit'), sleep(5000)]);
      if (api.exitCode === null) api.kill('SIGKILL');
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      if (organizations.length) {
        await db.programmingAiDraft.deleteMany({ where: { organizationId: { in: organizations } } });
        await db.programmingVersion.deleteMany({ where: { organizationId: { in: organizations } } });
        await db.programmingProject.deleteMany({ where: { organizationId: { in: organizations } } });
        await db.aiStudyOperation.deleteMany({ where: { organizationId: { in: organizations } } });
        await db.auditLog.deleteMany({ where: { organizationId: { in: organizations } } });
        await db.systemSetting.deleteMany({ where: { organizationId: { in: organizations } } });
        await db.session.deleteMany({ where: { userId: { in: users } } });
        await db.userRole.deleteMany({ where: { userId: { in: users } } });
        await db.user.deleteMany({ where: { id: { in: users } } });
        await db.organization.deleteMany({ where: { id: { in: organizations } } });
      }
      await writeFile(
        resolve('.data/programming-integration-api.log'),
        logs.replaceAll(fakeSecret, '[fixture]'),
      );
      await rm(directory, { recursive: true, force: true });
      await db.$disconnect();
    }
  },
);
