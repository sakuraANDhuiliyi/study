import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import type { AuthService } from '../apps/api/src/auth/auth.service';
import type { PrismaService } from '../apps/api/src/common/prisma.service';
import { ProgrammingService } from '../apps/api/src/programming/programming.service';
import {
  ProgrammingPreviewService,
  readProgrammingPreviewReadLimits,
} from '../apps/api/src/programming/programming-preview.service';

const student = (id: string): Actor => ({
  id,
  organizationId: 'org',
  name: id,
  role: 'STUDENT',
  permissions: ['learning.use'],
  sessionId: id,
});

function previewFixture() {
  const actors = new Map<string, Actor>();
  const holds = new Map<string, Promise<void>>();
  let sessionChecks = 0;
  let projectChecks = 0;
  const auth = {
    async resolveSessionId(sessionId: string) {
      sessionChecks++;
      await holds.get(sessionId);
      return actors.get(sessionId) || null;
    },
    async checkFeature() {},
  };
  const db = {
    programmingProject: {
      async findFirst() {
        projectChecks++;
        return { id: 'project' };
      },
    },
  };
  const service = new ProgrammingPreviewService(
    auth as unknown as AuthService,
    db as unknown as PrismaService,
  );
  const internal = service as any;
  internal.configuration = {
    origin: 'http://127.0.0.1:4173',
    appOrigin: 'http://localhost:5173',
  };
  internal.readLimits = readProgrammingPreviewReadLimits({});
  let sequence = 0;
  function issue(id: string) {
    actors.set(id, student(id));
    const token = (++sequence).toString(16).padStart(64, '0');
    internal.snapshots.set(token, {
      projectId: 'project',
      organizationId: 'org',
      userId: id,
      sessionId: id,
      expiresAt: Date.now() + 600000,
      nonce: 'test-nonce',
      files: [
        { path: 'index.html', content: '<html><head></head><body>Hello</body></html>' },
        ...Array.from({ length: 23 }, (_, i) => ({ path: `file-${i}.js`, content: 'console.log("ok")' })),
      ],
    });
    return token;
  }
  function read(
    token: string,
    options: { method?: string; path?: string; ip?: string; forwarded?: string } = {},
  ) {
    const result = { status: 0, headers: {} as Record<string, string>, body: '' };
    const response = {
      headersSent: false,
      writeHead(status: number, headers: Record<string, string>) {
        result.status = status;
        result.headers = headers;
        this.headersSent = true;
      },
      end(body?: string) {
        result.body = body || '';
      },
    };
    const request = {
      method: options.method || 'GET',
      url: `/preview/${token}/${options.path || 'index.html'}`,
      headers: { host: '127.0.0.1:4173', 'x-forwarded-for': options.forwarded, forwarded: options.forwarded },
      socket: { remoteAddress: options.ip || '127.0.0.1' },
    };
    return internal
      .serve(request as unknown as IncomingMessage, response as unknown as ServerResponse)
      .then(() => result);
  }
  return { service, internal, actors, holds, issue, read, checks: () => ({ sessionChecks, projectChecks }) };
}

test('AI 草稿列表仅查询摘要，详情仍按需提供完整候选源码', async () => {
  const actor = student('owner');
  const content = 'x'.repeat(262000);
  const draft = {
    id: 'draft',
    projectId: 'project',
    baseRevision: 0,
    status: 'ready',
    prompt: '改进网页',
    summary: '结果',
    model: 'fixture',
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    appliedVersionId: null,
    files: [{ path: 'index.html', content }],
    plan: ['步骤'],
    teaching: ['说明'],
  };
  const selections: any[] = [];
  const db = {
    programmingProject: {
      async findFirst(input: any) {
        selections.push(input.select);
        return { id: 'project' };
      },
    },
    programmingAiDraft: {
      async findMany(input: any) {
        selections.push(input.select);
        return [Object.fromEntries(Object.keys(input.select).map((key) => [key, (draft as any)[key]]))];
      },
      async findFirst() {
        return draft;
      },
    },
  };
  const auth = { require() {}, async checkFeature() {} };
  const service = new ProgrammingService(db as any, auth as any, {} as any, {} as any, {} as any);
  (service as any).recoverPending = async () => {};
  const list = await service.drafts(actor, 'project');
  assert.deepEqual(selections[0], { id: true }, '所有权查询也不应加载项目源码');
  for (const field of ['files', 'plan', 'teaching', 'appliedProjectSnapshot', 'operationId']) {
    assert.equal(selections[1][field], undefined, field);
    assert.equal(field in list.items[0], false, field);
  }
  assert.ok(JSON.stringify(list).length < 1000, '最大源码候选不会放大轮询响应');
  const detail = await service.draft(actor, 'project', 'draft');
  assert.deepEqual(detail.files, draft.files);
  assert.deepEqual(detail.plan, draft.plan);
});

test('一个用户跨 token 占满 24 槽后收到 429，其他用户仍能读取多文件预览', async () => {
  const fixture = previewFixture();
  let release!: () => void;
  fixture.holds.set(
    'busy',
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const tokens = [fixture.issue('busy'), fixture.issue('busy'), fixture.issue('busy')];
  const pending = Array.from({ length: 24 }, (_, i) => fixture.read(tokens[i % 3]));
  const refused = await fixture.read(tokens[0], { method: 'HEAD' });
  assert.equal(refused.status, 429);
  assert.equal(refused.headers['Retry-After'], '1');
  assert.equal(refused.body, '');
  assert.equal(fixture.internal.active, 24);
  const other = fixture.issue('other');
  assert.equal((await fixture.read(other)).status, 200);
  release();
  assert.ok((await Promise.all(pending)).every((result) => result.status === 200));
  const page = await Promise.all(
    Array.from({ length: 24 }, (_, i) =>
      fixture.read(other, {
        path: i ? `file-${i - 1}.js` : 'index.html',
      }),
    ),
  );
  assert.ok(
    page.every((result) => result.status === 200),
    '24 文件同时读取均成功',
  );
  assert.equal(fixture.internal.active, 0);
  assert.equal(fixture.internal.activeUsers.size, 0);
  assert.deepEqual(fixture.checks(), { sessionChecks: 49, projectChecks: 49 });
});

test('不同用户的全局在途验证最多 32，释放后可以继续读取', async () => {
  const fixture = previewFixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const a = fixture.issue('a');
  const b = fixture.issue('b');
  fixture.holds.set('a', gate);
  fixture.holds.set('b', gate);
  const pending = [
    ...Array.from({ length: 24 }, () => fixture.read(a)),
    ...Array.from({ length: 8 }, () => fixture.read(b)),
  ];
  const c = fixture.issue('c');
  const refused = await fixture.read(c);
  assert.equal(refused.status, 503);
  assert.equal(refused.headers['Retry-After'], '1');
  assert.equal(fixture.internal.active, 32);
  release();
  await Promise.all(pending);
  assert.equal((await fixture.read(c)).status, 200);
});

test('HTTP 监听器能同时返回一个完整 24 文件页面，忙用户不会阻止其他用户', async () => {
  const fixture = previewFixture();
  const server = createServer((request, response) => {
    void fixture.internal.serve(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  fixture.internal.configuration.origin = origin;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fixture.holds.set('busy', gate);
  const busy = fixture.issue('busy');
  const other = fixture.issue('other');
  const pending = Array.from({ length: 24 }, (_, i) =>
    fetch(`${origin}/preview/${busy}/${i ? `file-${i - 1}.js` : 'index.html'}`),
  );
  try {
    const deadline = Date.now() + 2000;
    while (fixture.checks().sessionChecks < 24 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(fixture.checks().sessionChecks, 24);
    const limited = await fetch(`${origin}/preview/${busy}/index.html`, { method: 'HEAD' });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '1');
    assert.equal(await limited.text(), '');
    const available = await fetch(`${origin}/preview/${other}/index.html`);
    assert.equal(available.status, 200);
    assert.match(await available.text(), /Hello/);
    release();
    const resources = await Promise.all(pending);
    assert.ok(resources.every((response) => response.status === 200));
    for (const response of resources) await response.text();
    assert.equal(fixture.internal.active, 0);
  } finally {
    release();
    await Promise.allSettled(pending);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
});

test('GET/HEAD 的 token、用户与真实 socket IP 共享读配额，过期后恢复且不会信任代理头', async () => {
  const fixture = previewFixture();
  fixture.internal.readLimits = { userConcurrency: 24, tokenReads: 24, userReads: 48, ipReads: 9600 };
  const a = fixture.issue('owner');
  const b = fixture.issue('owner');
  const c = fixture.issue('owner');
  for (let i = 0; i < 24; i++)
    assert.equal((await fixture.read(a, { method: i % 2 ? 'HEAD' : 'GET' })).status, 200);
  const tokenLimited = await fixture.read(a);
  assert.equal(tokenLimited.status, 429);
  assert.ok(Number(tokenLimited.headers['Retry-After']) >= 1);
  for (let i = 0; i < 24; i++) assert.equal((await fixture.read(b)).status, 200);
  assert.equal((await fixture.read(c)).status, 429, '换 token 不能绕过用户读配额');
  for (const bucket of fixture.internal.readRequests.values()) bucket.startedAt -= 60001;
  assert.equal((await fixture.read(c)).status, 200);
  fixture.internal.readLimits.ipReads = 1;
  const other = fixture.issue('other');
  assert.equal((await fixture.read(other, { forwarded: '198.51.100.1' })).status, 429);
  assert.equal((await fixture.read(other, { ip: '192.0.2.2', forwarded: '127.0.0.1' })).status, 200);
});

test('读取限流状态有界，窗口过期会清理；权限撤销仍逐文件生效', async () => {
  const fixture = previewFixture();
  const token = fixture.issue('owner');
  for (let i = 0; i < 1024; i++)
    fixture.internal.readRequests.set(`ip:${i}`, { startedAt: Date.now(), count: 1 });
  const full = await fixture.read(token);
  assert.equal(full.status, 503);
  assert.equal(full.headers['Retry-After'], '1');
  assert.equal(fixture.internal.readRequests.size, 1024);
  for (const bucket of fixture.internal.readRequests.values()) bucket.startedAt -= 60001;
  assert.equal((await fixture.read(token)).status, 200);
  assert.equal(fixture.internal.readRequests.size, 3);
  fixture.actors.delete('owner');
  assert.equal((await fixture.read(token, { path: 'file-1.js' })).status, 404);
  assert.equal((await fixture.read(token)).status, 404);
  assert.equal(fixture.internal.activeUsers.size, 0);
});

test('读取限额配置有安全上下界，单用户永远不能占满全局 32 槽', () => {
  assert.deepEqual(readProgrammingPreviewReadLimits({}), {
    userConcurrency: 24,
    userReads: 480,
    tokenReads: 240,
    ipReads: 9600,
  });
  assert.equal(
    readProgrammingPreviewReadLimits({ PROGRAMMING_PREVIEW_USER_CONCURRENCY: '32' }).userConcurrency,
    24,
  );
  assert.equal(
    readProgrammingPreviewReadLimits({ PROGRAMMING_PREVIEW_USER_CONCURRENCY: '0' }).userConcurrency,
    24,
  );
  assert.equal(
    readProgrammingPreviewReadLimits({ PROGRAMMING_PREVIEW_TOKEN_READS_PER_MINUTE: '25' }).tokenReads,
    25,
  );
});
