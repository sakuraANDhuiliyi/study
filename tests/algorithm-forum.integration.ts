import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient(),
  origin = 'http://localhost:3038';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
test(
  'algorithm forum: explicit community visibility, private organizations and transactional moderation',
  { timeout: 120000 },
  async (t) => {
    const database = new URL(process.env.DATABASE_URL!);
    assert.notEqual(process.env.NODE_ENV, 'production');
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
    assert.ok(database.pathname.includes('review'), 'Use isolated local review database');
    const suffix = randomUUID().slice(0, 8),
      orgs: string[] = [],
      users: string[] = [];
    const server = spawn(process.execPath, ['apps/api/dist/main.js'], {
      env: {
        ...process.env,
        PORT: '3038',
        APP_ORIGIN: origin,
        BIND_HOST: '127.0.0.1',
        DISABLE_JOBS: 'true',
        COOKIE_SECURE: 'false',
        PROGRAMMING_PREVIEW_ENABLED: 'false',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    for (const stream of [server.stdout, server.stderr])
      stream.on('data', (chunk) => {
        logs = (logs + chunk.toString()).slice(-20000);
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
        async raw(path: string, method = 'GET', body?: unknown, csrf = true) {
          return fetch(`${origin}/api${path}`, {
            method,
            headers: {
              cookie,
              origin,
              'content-type': 'application/json',
              ...(csrf ? { 'x-csrf-token': payload.csrfToken } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        },
        async call(path: string, method = 'GET', body?: unknown, expected = method === 'POST' ? 201 : 200) {
          const response = await this.raw(path, method, body),
            text = await response.text();
          assert.equal(response.status, expected, `${method} ${path}: ${text.slice(0, 500)}`);
          return JSON.parse(text);
        },
      };
    }
    async function resetRate(id?: string) {
      await db.auditLog.deleteMany({
        where: { userId: id ? id : { in: users }, action: { startsWith: 'algorithm-forum.' } },
      });
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
          /* starting */
        }
        await sleep(100);
      }
      assert.ok(ready);
      const seed = await db.user.findUniqueOrThrow({ where: { username: 'student' } });
      const a = await db.organization.create({ data: { name: `论坛机构A-${suffix}` } }),
        b = await db.organization.create({ data: { name: `论坛机构B-${suffix}` } }),
        p = await db.organization.create({ data: { name: `论坛个人-${suffix}`, kind: 'PERSONAL' } });
      orgs.push(a.id, b.id, p.id);
      async function user(tag: string, roleId = 'STUDENT', organizationId = a.id, personal = false) {
        const row = await db.user.create({
          data: {
            organizationId,
            name: `PRIVATE REAL NAME ${tag}`,
            username: `forum-${tag}-${suffix}`,
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
        foreign = await user('foreign', 'STUDENT', b.id),
        teacher = await user('teacher', 'TEACHER'),
        admin = await user('admin', 'ADMIN'),
        foreignAdmin = await user('foreign-admin', 'ADMIN', b.id),
        personal = await user('personal', 'STUDENT', p.id, true),
        platform = await user('platform', 'SUPER_ADMIN', b.id);
      let publicPost: any, privatePost: any, reply: any;
      const newPost = (scope = 'public', title = 'Array algorithm question') => ({
        scope,
        kind: 'question',
        title,
        body: '<script>globalThis.forumXss=true</script>\nconst total = 1;',
        problemId: 'two-sum-indices',
      });
      await t.test(
        'all logged-in roles can read; anonymous, spoofed fields, invalid scope and missing CSRF rejected',
        async () => {
          assert.equal((await fetch(`${origin}/api/algorithm-forum/posts`)).status, 401);
          for (const actor of [owner, teacher, admin, personal]) await actor.call('/algorithm-forum/status');
          await owner.call('/algorithm-forum/posts?scope=all', 'GET', undefined, 400);
          await owner.call(
            '/algorithm-forum/posts',
            'POST',
            { ...newPost(), authorId: foreign.user.id },
            400,
          );
          assert.equal((await owner.raw('/algorithm-forum/posts', 'POST', newPost(), false)).status, 403);
          await admin.call('/algorithm-forum/posts', 'POST', newPost(), 403);
        },
      );
      await t.test(
        'new public posts visible across organizations, institutional posts fenced from all other spaces',
        async () => {
          publicPost = await owner.call('/algorithm-forum/posts', 'POST', newPost());
          privatePost = await owner.call(
            '/algorithm-forum/posts',
            'POST',
            newPost('organization', 'Private organization topic'),
          );
          assert.equal((await foreign.call(`/algorithm-forum/posts/${publicPost.id}`)).scope, 'public');
          await foreign.call(`/algorithm-forum/posts/${privatePost.id}`, 'GET', undefined, 404);
          await platform.call(`/algorithm-forum/posts/${privatePost.id}`, 'GET', undefined, 404);
          assert.equal((await peer.call('/algorithm-forum/posts?scope=organization')).total, 1);
          assert.equal((await foreign.call('/algorithm-forum/posts?scope=organization')).total, 0);
          assert.match(publicPost.authorLabel, /^学习者·[0-9a-f]{16}$/);
          assert.notEqual(publicPost.authorLabel, privatePost.authorLabel);
          assert.equal(
            (await foreign.call(`/algorithm-forum/posts/${publicPost.id}`)).authorLabel,
            publicPost.authorLabel,
          );
          const aliases = await db.algorithmForumAlias.findMany({ where: { authorId: owner.user.id } });
          assert.equal(aliases.length, 2);
          assert.equal(aliases.find((row) => row.contextKey === 'public')?.label, publicPost.authorLabel);
          assert.equal(
            aliases.find((row) => row.contextKey === `organization:${a.id}`)?.label,
            privatePost.authorLabel,
          );
          await personal.call('/algorithm-forum/posts?scope=organization', 'GET', undefined, 403);
          await personal.call('/algorithm-forum/posts', 'POST', newPost('organization'), 403);
        },
      );
      await t.test(
        'search, kind, problem filters and DTO omit identity/school/private usernames',
        async () => {
          const result = await foreign.call(
            '/algorithm-forum/posts?scope=public&q=array&kind=question&problemId=two-sum-indices&pageSize=1',
          );
          assert.equal(result.total, 1);
          const text = JSON.stringify(result);
          for (const secret of [owner.user.id, a.id, seed.passwordHash, 'PRIVATE REAL NAME', 'forum-owner'])
            assert.ok(!text.includes(secret));
          assert.equal(publicPost.body, newPost().body);
          assert.ok(publicPost.canEdit);
          assert.ok(!result.items[0].canEdit);
          await owner.call('/algorithm-forum/posts?problemId=missing-question', 'GET', undefined, 404);
        },
      );
      await t.test(
        'teachers with communication.write publish new posts; personal users explicitly publish public',
        async () => {
          const tPost = await teacher.call(
            '/algorithm-forum/posts',
            'POST',
            newPost('public', 'Teacher discussion'),
          );
          const pPost = await personal.call(
            '/algorithm-forum/posts',
            'POST',
            newPost('public', 'Personal discussion'),
          );
          assert.equal(tPost.scope, 'public');
          assert.equal(pPost.scope, 'public');
        },
      );
      await t.test(
        'public replies visible but private thread reply paths cannot disclose or accept foreign content',
        async () => {
          reply = await foreign.call(`/algorithm-forum/posts/${publicPost.id}/replies`, 'POST', {
            postRevision: publicPost.revision,
            body: 'Cross-school reply\nconsole.log(2)',
          });
          assert.equal((await peer.call(`/algorithm-forum/posts/${publicPost.id}/replies`)).total, 1);
          await foreign.call(`/algorithm-forum/posts/${privatePost.id}/replies`, 'GET', undefined, 404);
          await foreign.call(
            `/algorithm-forum/posts/${privatePost.id}/replies`,
            'POST',
            { postRevision: 0, body: 'no' },
            404,
          );
          await foreign.call(
            `/algorithm-forum/posts/${publicPost.id}/replies`,
            'POST',
            { postRevision: 0, body: 'no', organizationId: a.id },
            400,
          );
        },
      );
      await t.test(
        'author edits with optimistic revision; racing updates produce one winner without lost content',
        async () => {
          const results = await Promise.all(
            ['version A', 'version B'].map((title) =>
              owner.raw(`/algorithm-forum/posts/${publicPost.id}`, 'PATCH', {
                revision: 0,
                title,
                body: 'Updated body',
              }),
            ),
          );
          assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
          publicPost = await owner.call(`/algorithm-forum/posts/${publicPost.id}`);
          const storedAlias = await db.algorithmForumAlias.findUniqueOrThrow({
            where: { authorId_contextKey: { authorId: owner.user.id, contextKey: 'public' } },
          });
          assert.equal(publicPost.authorLabel, storedAlias.label);
          assert.equal(publicPost.revision, 1);
          assert.equal(publicPost.replyCount, 1);
          await foreign.call(
            `/algorithm-forum/posts/${publicPost.id}`,
            'PATCH',
            { revision: 1, title: 'foreign edit', body: 'bad' },
            403,
          );
          await owner.call(
            `/algorithm-forum/posts/${publicPost.id}`,
            'PATCH',
            { revision: 1, title: 'changed scope', body: 'bad', scope: 'organization' },
            400,
          );
        },
      );
      await t.test(
        'same-institution administrator moderates own organization; another administrator cannot manage public post',
        async () => {
          await foreignAdmin.call(
            `/algorithm-forum/posts/${publicPost.id}/moderation`,
            'PATCH',
            { revision: publicPost.revision, pinned: true },
            403,
          );
          publicPost = await admin.call(`/algorithm-forum/posts/${publicPost.id}/moderation`, 'PATCH', {
            revision: publicPost.revision,
            pinned: true,
            closed: true,
          });
          assert.ok(publicPost.pinned && publicPost.closed);
          await foreign.call(
            `/algorithm-forum/posts/${publicPost.id}/replies`,
            'POST',
            { postRevision: publicPost.revision, body: 'Closed reply' },
            409,
          );
          await owner.call(
            `/algorithm-forum/posts/${publicPost.id}`,
            'PATCH',
            { revision: publicPost.revision, title: 'Closed edit', body: 'no' },
            409,
          );
          publicPost = await admin.call(`/algorithm-forum/posts/${publicPost.id}/moderation`, 'PATCH', {
            revision: publicPost.revision,
            closed: false,
          });
        },
      );
      await t.test(
        'author can mark resolved but cannot pin/close; explicit platform authority moderates public only',
        async () => {
          await resetRate();
          await owner.call(
            `/algorithm-forum/posts/${publicPost.id}/moderation`,
            'PATCH',
            { revision: publicPost.revision, pinned: true },
            403,
          );
          publicPost = await owner.call(`/algorithm-forum/posts/${publicPost.id}/moderation`, 'PATCH', {
            revision: publicPost.revision,
            solved: true,
          });
          assert.equal(publicPost.solved, true);
          publicPost = await platform.call(`/algorithm-forum/posts/${publicPost.id}/moderation`, 'PATCH', {
            revision: publicPost.revision,
            pinned: false,
          });
          assert.equal(publicPost.pinned, false);
        },
      );
      await t.test(
        'reply authors/own-institution moderators can soft-delete, foreign moderators cannot delete content',
        async () => {
          await admin.call(
            `/algorithm-forum/posts/${publicPost.id}/replies/${reply.id}`,
            'DELETE',
            { revision: reply.revision },
            403,
          );
          await foreignAdmin.call(`/algorithm-forum/posts/${publicPost.id}/replies/${reply.id}`, 'DELETE', {
            revision: reply.revision,
          });
          assert.equal((await peer.call(`/algorithm-forum/posts/${publicPost.id}/replies`)).total, 0);
          assert.ok((await db.algorithmForumReply.findUniqueOrThrow({ where: { id: reply.id } })).deletedAt);
        },
      );
      await t.test(
        'feature flags, global communication mute and revoked sessions block fresh reads/writes',
        async () => {
          const flag = await db.systemSetting.create({
            data: { organizationId: a.id, key: 'features', value: { communication: false } },
          });
          await owner.call('/algorithm-forum/status', 'GET', undefined, 403);
          await db.systemSetting.update({ where: { id: flag.id }, data: { value: { practice: false } } });
          await owner.call('/algorithm-forum/posts', 'GET', undefined, 403);
          await db.systemSetting.delete({ where: { id: flag.id } });
          const mute = await db.communicationMute.create({
            data: {
              organizationId: a.id,
              userId: peer.user.id,
              createdBy: admin.user.id,
              reason: 'fixture',
              expiresAt: new Date(Date.now() + 60000),
            },
          });
          await peer.call(
            `/algorithm-forum/posts/${publicPost.id}/replies`,
            'POST',
            { postRevision: publicPost.revision, body: 'muted' },
            403,
          );
          await db.communicationMute.delete({ where: { id: mute.id } });
          await db.session.deleteMany({ where: { userId: peer.user.id } });
          await peer.call('/algorithm-forum/posts', 'GET', undefined, 401);
        },
      );
      await t.test(
        'per-user rate limits remain under concurrent requests and retained deletion history',
        async () => {
          await resetRate(personal.user.id);
          await db.auditLog.createMany({
            data: Array.from({ length: 9 }, (_, i) => ({
              organizationId: p.id,
              userId: personal.user.id,
              action: 'algorithm-forum.fixture',
              resourceType: 'AlgorithmForum',
              resourceId: `fixture-${i}`,
            })),
          });
          const results = await Promise.all([
            personal.raw('/algorithm-forum/posts', 'POST', newPost('public', 'Rate A')),
            personal.raw('/algorithm-forum/posts', 'POST', newPost('public', 'Rate B')),
          ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [201, 429]);
          await resetRate(personal.user.id);
        },
      );
      await t.test(
        'soft-deleted posts disappear from list, detail and replies; audit metadata omits bodies',
        async () => {
          await resetRate();
          await foreign.call(
            `/algorithm-forum/posts/${publicPost.id}`,
            'DELETE',
            { revision: publicPost.revision },
            403,
          );
          await owner.call(`/algorithm-forum/posts/${publicPost.id}`, 'DELETE', {
            revision: publicPost.revision,
          });
          await foreign.call(`/algorithm-forum/posts/${publicPost.id}`, 'GET', undefined, 404);
          await foreign.call(`/algorithm-forum/posts/${publicPost.id}/replies`, 'GET', undefined, 404);
          assert.ok(
            (await db.algorithmForumPost.findUniqueOrThrow({ where: { id: publicPost.id } })).deletedAt,
          );
          const logs = await db.auditLog.findMany({
            where: { userId: { in: users }, action: { startsWith: 'algorithm-forum.' } },
          });
          assert.ok(logs.length);
          assert.ok(!JSON.stringify(logs.map((l) => l.details)).includes('Updated body'));
        },
      );
    } finally {
      server.kill('SIGTERM');
      await sleep(150);
      await db.algorithmForumReply.deleteMany({ where: { authorId: { in: users } } });
      await db.algorithmForumPost.deleteMany({ where: { authorId: { in: users } } });
      await db.auditLog.deleteMany({ where: { organizationId: { in: orgs } } });
      await db.communicationMute.deleteMany({ where: { organizationId: { in: orgs } } });
      await db.systemSetting.deleteMany({ where: { organizationId: { in: orgs } } });
      await db.session.deleteMany({ where: { userId: { in: users } } });
      await db.userRole.deleteMany({ where: { userId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.organization.deleteMany({ where: { id: { in: orgs } } });
      await db.$disconnect();
    }
  },
);
