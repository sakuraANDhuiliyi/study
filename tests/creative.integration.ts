import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, get } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient(),
  origin = 'http://localhost:3039',
  previewOrigin = 'http://127.0.0.1:4179';
const fakeSecret = 'CREATIVE_PROVIDER_LOCAL_FIXTURE_ONLY';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
test(
  'creative square: curated UI provenance, private favorites/projects, isolated preview and preserved licenses',
  { timeout: 120000 },
  async (t) => {
    const database = new URL(process.env.DATABASE_URL!);
    assert.notEqual(process.env.NODE_ENV, 'production');
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
    assert.ok(database.pathname.includes('review'), 'Use an isolated review database');
    const suffix = randomUUID().slice(0, 8),
      directory = resolve(`.data/creative-test-${suffix}`),
      organizations: string[] = [],
      users: string[] = [];
    await mkdir(directory, { recursive: true });
    let mode: 'valid' | 'notice' | 'invalid' = 'valid',
      calls = 0,
      observed: any;
    let candidate: { path: string; content: string }[] = [];
    const provider = createServer(async (request, response) => {
      calls++;
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/deepseek/chat/completions');
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      observed = JSON.parse(Buffer.concat(chunks).toString());
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  summary: '调整界面说明',
                  plan: ['保留原有交互，修改说明'],
                  teaching: ['理解DOM与样式'],
                  files:
                    mode === 'invalid'
                      ? [{ path: '../index.html', content: 'unsafe' }]
                      : mode === 'notice'
                        ? [
                            ...candidate,
                            { path: 'Notice.txt', content: 'MODEL MUST NOT CHANGE UPSTREAM LICENSE' },
                          ]
                        : candidate,
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
    await writeFile(
      configPath,
      JSON.stringify({
        ai: {
          apiStyle: 'deepseek',
          structuredOutput: 'json_object',
          baseUrl: `http://127.0.0.1:${providerPort}/deepseek`,
          apiKey: fakeSecret,
          model: 'deepseek-flash',
          timeoutMs: 10000,
        },
        webSearch: { enabled: false },
        limits: { dailyRequests: 3 },
      }),
    );
    const server = spawn(process.execPath, ['apps/api/dist/main.js'], {
      env: {
        ...process.env,
        PORT: '3039',
        BIND_HOST: '127.0.0.1',
        APP_ORIGIN: origin,
        COOKIE_SECURE: 'false',
        DISABLE_JOBS: 'true',
        NODE_ENV: 'test',
        AI_CONFIG_PATH: configPath,
        PROGRAMMING_PREVIEW_ENABLED: 'true',
        PROGRAMMING_PREVIEW_PORT: '4179',
        PROGRAMMING_PREVIEW_ORIGIN: previewOrigin,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    for (const stream of [server.stdout, server.stderr])
      stream.on('data', (chunk) => {
        logs = (logs + chunk.toString()).slice(-30000);
      });
    async function login(username: string) {
      const response = await fetch(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: process.env.DEV_SEED_PASSWORD }),
      });
      assert.equal(response.status, 201);
      const payload = await response.json(),
        cookie = response.headers
          .getSetCookie()
          .map((c) => c.split(';')[0])
          .join('; ');
      return {
        user: payload.user,
        async raw(path: string, method = 'GET', body?: unknown, csrf = true, sentOrigin = origin) {
          return fetch(`${origin}/api${path}`, {
            method,
            headers: {
              cookie,
              origin: sentOrigin,
              'content-type': 'application/json',
              ...(csrf ? { 'x-csrf-token': payload.csrfToken } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        },
        async call(path: string, method = 'GET', body?: unknown, expected = method === 'POST' ? 201 : 200) {
          const response = await this.raw(path, method, body),
            text = await response.text();
          assert.equal(response.status, expected, `${method} ${path}: ${text.slice(0, 600)}`);
          return JSON.parse(text);
        },
      };
    }
    try {
      let ready = false;
      for (let i = 0; i < 120; i++) {
        if (server.exitCode !== null) throw new Error(`API stopped: ${logs.slice(-1500)}`);
        try {
          if ((await fetch(`${origin}/api/health`)).ok) {
            ready = true;
            break;
          }
        } catch {
          /*starting*/
        }
        await sleep(100);
      }
      assert.ok(ready);
      const seed = await db.user.findUniqueOrThrow({ where: { username: 'student' } }),
        org = await db.organization.create({ data: { name: `创意验收-${suffix}` } }),
        foreignOrg = await db.organization.create({ data: { name: `创意异机构-${suffix}` } }),
        personalOrg = await db.organization.create({
          data: { name: `创意个人-${suffix}`, kind: 'PERSONAL' },
        });
      organizations.push(org.id, foreignOrg.id, personalOrg.id);
      async function user(tag: string, roleId = 'STUDENT', organizationId = org.id, personal = false) {
        const row = await db.user.create({
          data: {
            organizationId,
            username: `creative-${tag}-${suffix}`,
            name: `PRIVATE CREATIVE NAME ${tag}`,
            passwordHash: seed.passwordHash,
            ...(personal ? { accountMode: 'PERSONAL', personalOrganizationId: organizationId } : {}),
            roles: { create: { roleId } },
          },
        });
        users.push(row.id);
        return login(row.username);
      }
      const owner = await user('owner'),
        peer = await user('peer'),
        foreign = await user('foreign', 'STUDENT', foreignOrg.id),
        personal = await user('personal', 'STUDENT', personalOrg.id, true),
        teacher = await user('teacher', 'TEACHER'),
        revoked = await user('revoked');
      let list: any, item: any, project: any, initialVersion: any, firstDraft: any, applied: any;
      const base = '/programming/creative',
        path = () => `/programming/projects/${project.id}`;
      const notice = (files: { path: string; content: string }[]) =>
        files.find((f) => f.path === 'NOTICE.txt')!.content;
      async function zip(client: typeof owner, url: string, filename: string) {
        const response = await client.raw(url);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'application/zip');
        assert.match(response.headers.get('cache-control') || '', /no-store/);
        const archive = resolve(directory, filename);
        await writeFile(archive, Buffer.from(await response.arrayBuffer()));
        return execFileSync('/usr/bin/unzip', ['-p', archive, 'NOTICE.txt'], { encoding: 'utf8' });
      }
      await t.test(
        'authenticated students list dynamic catalog, paged summaries omit source code/full licenses',
        async () => {
          assert.equal((await fetch(`${origin}/api${base}`)).status, 401);
          await teacher.call(base, 'GET', undefined, 403);
          list = await owner.call(`${base}?pageSize=24`);
          assert.ok(list.totalCatalog > 0);
          assert.equal(list.total, list.totalCatalog);
          assert.equal(list.items.length, Math.min(24, list.total));
          assert.ok(list.repositoryCount > 0);
          assert.equal(
            list.categories.reduce((sum: number, c: any) => sum + c.count, 0),
            list.totalCatalog,
          );
          for (const entry of list.items) {
            assert.equal(entry.files, undefined);
            assert.equal(entry.source.licenseText, undefined);
            assert.match(entry.revision, /^[a-f0-9]{64}$/);
          }
          const second = await owner.call(`${base}?page=2&pageSize=1`);
          assert.equal(second.items.length, 1);
          assert.notEqual(second.items[0].id, list.items[0].id);
          await personal.call(base);
        },
      );
      await t.test(
        'category/search filters and strict bounds reject invalid page/collection/spoofed source',
        async () => {
          const category = list.categories[0];
          const filtered = await owner.call(
            `${base}?category=${encodeURIComponent(category.name)}&pageSize=24`,
          );
          assert.equal(filtered.total, category.count);
          assert.ok(filtered.items.every((x: any) => x.category === category.name));
          const search = await owner.call(`${base}?q=${encodeURIComponent(list.items[0].title)}`);
          assert.ok(search.items.some((x: any) => x.id === list.items[0].id));
          assert.equal((await owner.call(`${base}?category=not-a-category`)).total, 0);
          const newEdition = await owner.call(`${base}?edition=new&pageSize=24`);
          const firstEdition = await owner.call(`${base}?edition=foundation&pageSize=24`);
          assert.equal(newEdition.total, list.newCount);
          assert.equal(newEdition.total + firstEdition.total, list.totalCatalog);
          assert.ok(newEdition.items.every((entry: any) => entry.edition === 2));
          assert.ok(firstEdition.items.every((entry: any) => entry.edition === 1));
          const videoSearch = await owner.call(`${base}?q=rxing365`);
          assert.ok(videoSearch.items.some((entry: any) => entry.id === 'liquid-optics'));
          for (const query of [
            'page=0',
            'pageSize=25',
            'page=Infinity',
            'collection=all-users',
            'edition=unknown',
            `q=${'x'.repeat(101)}`,
            'organizationId=foreign',
          ])
            await owner.call(`${base}?${query}`, 'GET', undefined, 400);
        },
      );
      await t.test(
        'every installed creative detail has pinned GitHub files, exact notice and full original license',
        async () => {
          const summaries = [...list.items];
          for (let page = 2; summaries.length < list.totalCatalog; page++) {
            const next = await owner.call(`${base}?page=${page}&pageSize=24`);
            assert.ok(next.items.length > 0);
            summaries.push(...next.items);
          }
          assert.equal(summaries.length, list.totalCatalog);
          for (const summary of summaries) {
            const detail = await owner.call(`${base}/${summary.id}`);
            assert.match(detail.source.repository, /^https:\/\/github\.com\/[^/]+\/[^/]+$/);
            assert.match(detail.source.commit, /^[a-f0-9]{40}$/);
            assert.ok(detail.source.files.length > 0);
            assert.ok(detail.source.licenseText.length > 100);
            for (const source of detail.source.files)
              assert.ok(source.url.startsWith(`${detail.source.repository}/blob/${detail.source.commit}/`));
            assert.ok(notice(detail.files).includes(detail.source.repository));
            assert.ok(notice(detail.files).includes(detail.source.commit));
            assert.ok(notice(detail.files).includes(detail.source.licenseText));
            assert.ok(detail.files.some((f: any) => f.path === 'index.html'));
          }
          item = await owner.call(`${base}/${list.items[0].id}`);
        },
      );
      await t.test(
        'favorites are idempotent and private to current organization/user including personal spaces',
        async () => {
          const endpoint = `${base}/${item.id}/favorite`;
          const saved = await Promise.all([
            owner.call(endpoint, 'PUT', { saved: true }),
            owner.call(endpoint, 'PUT', { saved: true }),
          ]);
          assert.ok(saved.every((x) => x.saved));
          assert.equal(
            await db.programmingCreativeFavorite.count({
              where: { userId: owner.user.id, creativeId: item.id },
            }),
            1,
          );
          assert.equal((await owner.call(`${base}?collection=saved`)).total, 1);
          for (const other of [peer, foreign, personal]) {
            assert.equal((await other.call(`${base}?collection=saved`)).total, 0);
            assert.equal((await other.call(`${base}/${item.id}`)).saved, false);
          }
          await personal.call(endpoint, 'PUT', { saved: true });
          assert.equal((await personal.call(`${base}?collection=saved`)).total, 1);
          await owner.call(endpoint, 'PUT', { saved: false });
          await owner.call(endpoint, 'PUT', { saved: false });
          assert.equal((await owner.call(`${base}?collection=saved`)).total, 0);
          assert.equal((await personal.call(`${base}?collection=saved`)).total, 1);
        },
      );
      await t.test(
        'creative mutations reject no-CSRF, foreign origins, teacher role and client-provided source files',
        async () => {
          const endpoint = `${base}/${item.id}/projects`;
          assert.equal(
            (await owner.raw(endpoint, 'POST', { revision: item.revision, title: 'Bad CSRF' }, false)).status,
            403,
          );
          assert.equal(
            (
              await owner.raw(
                endpoint,
                'POST',
                { revision: item.revision, title: 'Bad origin' },
                true,
                'http://evil.invalid',
              )
            ).status,
            403,
          );
          await teacher.call(endpoint, 'POST', { revision: item.revision, title: 'Teacher clone' }, 403);
          await owner.call(
            endpoint,
            'POST',
            { revision: item.revision, title: 'Spoofed', files: [{ path: 'index.html', content: 'spoof' }] },
            400,
          );
          await owner.call(`${base}/${item.id}/favorite`, 'PUT', { saved: true, userId: peer.user.id }, 400);
        },
      );
      await t.test(
        'unknown creative IDs and stale recipe revisions cannot preview/create/download/favorite',
        async () => {
          const unknown = `${base}/missing-ui`;
          await owner.call(unknown, 'GET', undefined, 404);
          await owner.call(`${unknown}/favorite`, 'PUT', { saved: true }, 404);
          await owner.call(`${unknown}/projects`, 'POST', { revision: item.revision, title: 'missing' }, 404);
          await owner.call(`${unknown}/preview`, 'POST', { revision: item.revision }, 404);
          assert.equal((await owner.raw(`${unknown}/export`)).status, 404);
          const before = await db.programmingProject.count({ where: { userId: owner.user.id } });
          for (const action of ['preview', 'projects'])
            await owner.call(
              `${base}/${item.id}/${action}`,
              'POST',
              { revision: '0'.repeat(64), ...(action === 'projects' ? { title: 'Stale' } : {}) },
              409,
            );
          assert.equal(await db.programmingProject.count({ where: { userId: owner.user.id } }), before);
        },
      );
      await t.test(
        'temporary creative preview creates no project, uses isolated origin/CSP and sets no cookies',
        async () => {
          const before = await db.programmingProject.count({ where: { userId: owner.user.id } });
          const issued = await owner.call(`${base}/${item.id}/preview`, 'POST', { revision: item.revision });
          assert.ok(issued.url.startsWith(`${previewOrigin}/preview/`));
          assert.match(issued.nonce, /^[a-f0-9]{32}$/);
          const response = await fetch(issued.url);
          assert.equal(response.status, 200);
          assert.equal(response.headers.get('set-cookie'), null);
          assert.equal(response.headers.get('access-control-allow-origin'), '*');
          const csp = response.headers.get('content-security-policy') || '';
          assert.match(csp, /sandbox allow-scripts/);
          assert.ok(!csp.includes('allow-same-origin'));
          assert.match(csp, /connect-src 'none'/);
          assert.match(csp, /frame-ancestors http:\/\/localhost:3039/);
          const html = await response.text();
          assert.ok(html.includes(issued.nonce));
          assert.ok(!html.includes(fakeSecret));
          assert.equal(await db.programmingProject.count({ where: { userId: owner.user.id } }), before);
          assert.equal((await fetch(issued.url, { method: 'POST' })).status, 405);
          const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
            const request = get(issued.url, { headers: { Host: 'localhost:4179' } }, (response) => {
              response.resume();
              resolve(response.statusCode);
            });
            request.on('error', reject);
          });
          assert.equal(wrongHost, 404);
          const noticeURL = new URL('NOTICE.txt', issued.url).toString();
          assert.equal(await (await fetch(noticeURL)).text(), notice(item.files));
        },
      );
      await t.test(
        'logout, role revocation and practice closure invalidate previously issued preview tokens',
        async () => {
          const p1 = await peer.call(`${base}/${item.id}/preview`, 'POST', { revision: item.revision });
          await peer.call('/auth/logout', 'POST', {});
          assert.equal((await fetch(p1.url)).status, 404);
          const p2 = await revoked.call(`${base}/${item.id}/preview`, 'POST', { revision: item.revision });
          await db.userRole.deleteMany({ where: { userId: revoked.user.id, roleId: 'STUDENT' } });
          assert.equal((await fetch(p2.url)).status, 404);
          const p3 = await foreign.call(`${base}/${item.id}/preview`, 'POST', { revision: item.revision });
          const flag = await db.systemSetting.create({
            data: { organizationId: foreignOrg.id, key: 'features', value: { practice: false } },
          });
          assert.equal((await fetch(p3.url)).status, 404);
          await foreign.call(base, 'GET', undefined, 403);
          await db.systemSetting.delete({ where: { id: flag.id } });
        },
      );
      await t.test(
        'canonical creation writes private project, initial immutable version and source audit',
        async () => {
          project = await owner.call(`${base}/${item.id}/projects`, 'POST', {
            revision: item.revision,
            title: 'Creative private workspace',
          });
          assert.equal(project.templateId, `creative:${item.id}`);
          assert.equal(project.revision, 0);
          assert.deepEqual(project.files, item.files);
          for (const other of [foreign, personal]) await other.call(path(), 'GET', undefined, 404);
          const versions = (await owner.call(`${path()}/versions`)).items;
          assert.equal(versions.length, 1);
          initialVersion = await owner.call(`${path()}/versions/${versions[0].id}`);
          assert.deepEqual(initialVersion.files, item.files);
          const audit = await db.auditLog.findFirstOrThrow({
            where: { userId: owner.user.id, resourceId: project.id, action: 'programming.creative.create' },
          });
          assert.equal((audit.details as any).sourceCommit, item.source.commit);
          assert.equal((audit.details as any).recipeRevision, item.revision);
          assert.equal((audit.details as any).files, undefined);
        },
      );
      await t.test(
        'editing cannot delete/change attribution or spoof project provenance; ordinary UI edits succeed',
        async () => {
          const before = await owner.call(path());
          for (const files of [
            project.files.filter((f: any) => f.path !== 'NOTICE.txt'),
            project.files.map((f: any) =>
              f.path === 'NOTICE.txt' ? { ...f, content: 'changed license' } : f,
            ),
            project.files.map((f: any) => (f.path === 'NOTICE.txt' ? { ...f, path: 'notice.txt' } : f)),
          ])
            await owner.call(path(), 'PATCH', { revision: 0, title: project.title, files }, 400);
          await owner.call(
            path(),
            'PATCH',
            { revision: 0, title: 'spoof', files: project.files, templateId: 'starter' },
            400,
          );
          assert.deepEqual(await owner.call(path()), before);
          project = await owner.call(path(), 'PATCH', {
            revision: 0,
            title: 'UI explanation edited',
            files: project.files.map((f: any) =>
              f.path === 'style.css' ? { ...f, content: f.content + '\n/* ordinary UI edit */\n' } : f,
            ),
          });
          assert.equal(project.revision, 1);
          assert.equal(notice(project.files), notice(item.files));
        },
      );
      await t.test(
        'source/project ZIP archives retain exact NOTICE text and require owner access',
        async () => {
          assert.equal(await zip(owner, `${base}/${item.id}/export`, 'creative.zip'), notice(item.files));
          assert.equal(await zip(owner, `${path()}/export`, 'private.zip'), notice(item.files));
          assert.equal((await foreign.raw(`${path()}/export`)).status, 404);
        },
      );
      await t.test(
        'DeepSeek fixture receives editable UI files, no identities or license, and server reattaches NOTICE',
        async () => {
          candidate = project.files
            .filter((f: any) => f.path !== 'NOTICE.txt')
            .map((f: any) =>
              f.path === 'app.js' ? { ...f, content: f.content + '\n// candidate explanation\n' } : f,
            );
          firstDraft = await owner.call(`${path()}/ai-drafts`, 'POST', {
            revision: project.revision,
            prompt: '只修改UI注释并保留初始状态',
          });
          assert.equal(firstDraft.status, 'ready');
          assert.equal(notice(firstDraft.files), notice(item.files));
          const userRequest = JSON.parse(observed.messages.find((m: any) => m.role === 'user').content);
          assert.deepEqual(Object.keys(userRequest).sort(), ['files', 'prompt', 'title']);
          assert.ok(!userRequest.files.some((f: any) => f.path.toLowerCase() === 'notice.txt'));
          const wire = JSON.stringify(userRequest);
          for (const secret of [
            item.source.licenseText,
            owner.user.id,
            owner.user.organizationId,
            project.id,
            fakeSecret,
          ])
            assert.ok(!wire.includes(secret));
          assert.equal(observed.tools, undefined);
          assert.deepEqual((await owner.call(path())).files, project.files);
        },
      );
      await t.test(
        'reviewed apply and retries preserve exact attribution and pre-overwrite source versions',
        async () => {
          const before = project;
          const [a, b] = await Promise.all([
            owner.call(`${path()}/ai-drafts/${firstDraft.id}/apply`, 'POST', { revision: project.revision }),
            owner.call(`${path()}/ai-drafts/${firstDraft.id}/apply`, 'POST', { revision: project.revision }),
          ]);
          assert.deepEqual(a, b);
          applied = a.project;
          project = a.project;
          assert.equal(notice(project.files), notice(item.files));
          const history = (await owner.call(`${path()}/versions`)).items;
          assert.equal(history.length, 3);
          assert.deepEqual((await owner.call(`${path()}/versions/${history[1].id}`)).files, before.files);
          project = await owner.call(path(), 'PATCH', {
            revision: project.revision,
            title: 'Newer private edit',
            files: project.files.map((f: any) =>
              f.path === 'app.js' ? { ...f, content: f.content + '\n// newer edit\n' } : f,
            ),
          });
          const retry = await owner.call(`${path()}/ai-drafts/${firstDraft.id}/apply`, 'POST', {
            revision: project.revision,
          });
          assert.deepEqual(retry.project, applied);
          assert.deepEqual(await owner.call(path()), project);
          assert.equal(notice(project.files), notice(item.files));
        },
      );
      await t.test(
        'model-written alternate NOTICE is discarded; tampered ready drafts cannot apply licenses',
        async () => {
          mode = 'notice';
          candidate = project.files.filter((f: any) => f.path !== 'NOTICE.txt');
          const draft = await owner.call(`${path()}/ai-drafts`, 'POST', {
            revision: project.revision,
            prompt: '保留归属',
          });
          assert.equal(draft.status, 'ready');
          assert.equal(draft.files.filter((f: any) => f.path.toLowerCase() === 'notice.txt').length, 1);
          assert.equal(notice(draft.files), notice(item.files));
          const original = draft.files;
          await db.programmingAiDraft.update({
            where: { id: draft.id },
            data: {
              files: draft.files.map((f: any) =>
                f.path === 'NOTICE.txt' ? { ...f, content: 'invalid replaced notice' } : f,
              ),
            },
          });
          await owner.call(
            `${path()}/ai-drafts/${draft.id}/apply`,
            'POST',
            { revision: project.revision },
            400,
          );
          assert.deepEqual(await owner.call(path()), project);
          await db.programmingAiDraft.update({ where: { id: draft.id }, data: { files: original } });
          project = (
            await owner.call(`${path()}/ai-drafts/${draft.id}/apply`, 'POST', { revision: project.revision })
          ).project;
          assert.equal(notice(project.files), notice(item.files));
        },
      );
      await t.test(
        'invalid model output is failed safely and remains charged against shared quota',
        async () => {
          mode = 'invalid';
          const before = await owner.call(path());
          const failed = await owner.call(`${path()}/ai-drafts`, 'POST', {
            revision: project.revision,
            prompt: '无效模型路径测试',
          });
          assert.equal(failed.status, 'failed');
          assert.ok(!JSON.stringify(failed).includes(fakeSecret));
          assert.deepEqual(await owner.call(path()), before);
          const ledger = await db.aiStudyOperation.findMany({
            where: { userId: owner.user.id, kind: 'programming' },
          });
          assert.equal(ledger.length, 3);
          assert.equal(ledger.filter((x) => x.status === 'failed').length, 1);
          await owner.call(
            `${path()}/ai-drafts`,
            'POST',
            { revision: project.revision, prompt: '不能绕过额度' },
            429,
          );
          assert.equal(calls, 3);
        },
      );
      await t.test(
        'restoring original UI preserves notice and current source in immutable history',
        async () => {
          project = await owner.call(`${path()}/restore`, 'POST', {
            revision: project.revision,
            versionId: initialVersion.id,
          });
          assert.deepEqual(project.files, item.files);
          assert.equal(notice(project.files), notice(item.files));
          const versions = (await owner.call(`${path()}/versions`)).items;
          for (const version of versions) {
            const saved = await owner.call(`${path()}/versions/${version.id}`);
            assert.equal(notice(saved.files), notice(item.files));
          }
          await owner.call(path(), 'DELETE');
          assert.equal(await db.programmingAiDraft.count({ where: { projectId: project.id } }), 0);
          assert.equal(
            await db.aiStudyOperation.count({ where: { userId: owner.user.id, kind: 'programming' } }),
            3,
          );
        },
      );
    } finally {
      server.kill('SIGTERM');
      await Promise.race([once(server, 'exit'), sleep(5000)]);
      if (server.exitCode === null) server.kill('SIGKILL');
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await db.programmingAiDraft.deleteMany({ where: { organizationId: { in: organizations } } });
      await db.programmingVersion.deleteMany({ where: { organizationId: { in: organizations } } });
      await db.programmingProject.deleteMany({ where: { organizationId: { in: organizations } } });
      await db.programmingCreativeFavorite.deleteMany({ where: { organizationId: { in: organizations } } });
      await db.aiStudyOperation.deleteMany({ where: { organizationId: { in: organizations } } });
      await db.auditLog.deleteMany({ where: { organizationId: { in: organizations } } });
      await db.systemSetting.deleteMany({ where: { organizationId: { in: organizations } } });
      await db.session.deleteMany({ where: { userId: { in: users } } });
      await db.userRole.deleteMany({ where: { userId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.organization.deleteMany({ where: { id: { in: organizations } } });
      await writeFile(
        resolve('.data/creative-integration-api.log'),
        logs.replaceAll(fakeSecret, '[fixture]'),
      );
      await rm(directory, { recursive: true, force: true });
      await db.$disconnect();
    }
  },
);
