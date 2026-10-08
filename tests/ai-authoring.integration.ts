import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const origin = 'http://127.0.0.1:3033';
const fakeSecret = 'AUTHORING_LOCAL_FIXTURE_ONLY';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  'teacher AI authoring: isolated DeepSeek HTTP, private drafts and atomic persistence',
  { timeout: 90000 },
  async (t) => {
    assert.notEqual(process.env.NODE_ENV, 'production');
    assert.ok(
      new URL(process.env.DATABASE_URL!).pathname.includes('review'),
      'Use an isolated review database',
    );
    const suffix = randomUUID().slice(0, 8),
      directory = resolve(`.data/ai-authoring-test-${suffix}`);
    await mkdir(directory, { recursive: true });
    let mode: 'success' | 'hold' | 'fail' | 'malformed' | 'partial' = 'success';
    let calls = 0,
      failStatus = 500,
      lastInput: any,
      lastRequest: any;
    let observed: (() => void) | undefined, release: (() => void) | undefined;
    const provider = createServer(async (request, response) => {
      calls++;
      if (request.method !== 'POST' || request.url !== '/deepseek/chat/completions') {
        response.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      lastRequest = JSON.parse(Buffer.concat(chunks).toString());
      const input = JSON.parse(lastRequest.messages.find((message: any) => message.role === 'user').content);
      lastInput = input;
      const currentMode = mode;
      if (currentMode === 'hold') {
        const wait = new Promise<void>((resolve) => {
          release = resolve;
        });
        observed?.();
        await wait;
      }
      if (currentMode === 'fail') {
        response.writeHead(failStatus, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: fakeSecret, upstream: 'https://private-provider.invalid/' }));
        return;
      }
      const questions = input.blueprint.flatMap((row: any) =>
        Array.from({ length: row.count }, (_, index) => ({
          type: row.type,
          stem:
            row.type === 'blank'
              ? `第 ${index + 1} 道填空：1 + 1 = ___。`
              : `${row.type} 第 ${index + 1} 题：整数加法基础。`,
          options: ['single', 'multiple'].includes(row.type)
            ? [
                { id: 'A', text: '2' },
                { id: 'B', text: '4' },
                { id: 'C', text: '5' },
              ]
            : [],
          answer:
            row.type === 'multiple'
              ? ['A', 'B']
              : row.type === 'single'
                ? ['A']
                : row.type === 'boolean'
                  ? ['true']
                  : row.type === 'blank'
                    ? ['2']
                    : ['依据加法定义推导。'],
          explanation: '先核对条件，再依据整数加法定义推导。',
          knowledgePoints: ['整数加法'],
        })),
      );
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: currentMode === 'partial' ? 'length' : 'stop',
              message: {
                role: 'assistant',
                content:
                  currentMode === 'malformed'
                    ? '{invalid'
                    : JSON.stringify({ title: input.title + '初稿', questions }),
              },
            },
          ],
        }),
      );
    });
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const port = (provider.address() as { port: number }).port;
    const configPath = resolve(directory, 'config.yaml');
    const config = (dailyRequests = 100, apiKey = fakeSecret) =>
      writeFile(
        configPath,
        JSON.stringify({
          ai: {
            apiStyle: 'deepseek',
            structuredOutput: 'json_object',
            baseUrl: `http://127.0.0.1:${port}/deepseek`,
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
        PORT: '3033',
        BIND_HOST: '127.0.0.1',
        APP_ORIGIN: origin,
        DISABLE_JOBS: 'true',
        COOKIE_SECURE: 'false',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [api.stdout, api.stderr])
      stream?.on('data', (chunk: Buffer) => {
        logs = (logs + chunk.toString()).slice(-100000);
      });
    async function login(username: string) {
      const response = await fetch(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: process.env.DEV_SEED_PASSWORD }),
      });
      assert.equal(response.status, 201, await response.clone().text());
      const payload = await response.json();
      let csrf = payload.csrfToken;
      const cookie = response.headers
        .getSetCookie()
        .map((v) => v.split(';')[0])
        .join('; ');
      return {
        user: payload.user,
        async call(
          path: string,
          method = 'GET',
          body?: unknown,
          status = method === 'POST' ? 201 : 200,
          withoutCsrf = false,
        ) {
          const response = await fetch(`${origin}/api${path}`, {
            method,
            headers: {
              cookie,
              origin,
              ...(!withoutCsrf ? { 'x-csrf-token': csrf } : {}),
              'content-type': 'application/json',
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          const text = await response.text();
          assert.equal(response.status, status, `${method} ${path}: ${text.slice(0, 800)}`);
          const data =
            response.headers.get('content-type')?.includes('json') && text ? JSON.parse(text) : text;
          if (data?.csrfToken) csrf = data.csrfToken;
          return data;
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
      assert.ok(ready, 'Build the API first and ensure port 3033 is available');
      const seed = await db.user.findUniqueOrThrow({ where: { username: 'student' } });
      const organization = await db.organization.create({ data: { name: `AI出题验收-${suffix}` } });
      const users = [];
      for (const [tag, roleId] of [
        ['teacher', 'TEACHER'],
        ['other', 'TEACHER'],
        ['student', 'STUDENT'],
        ['admin', 'ADMIN'],
      ])
        users.push(
          await db.user.create({
            data: {
              organizationId: organization.id,
              username: `authoring-${tag}-${suffix}`,
              name: `出题验收${tag}`,
              passwordHash: seed.passwordHash,
              roles: { create: { roleId } },
            },
          }),
        );
      const [teacher, other, student, admin] = await Promise.all(users.map((user) => login(user.username)));
      const course = await db.course.create({
        data: {
          organizationId: organization.id,
          teacherId: teacher.user.id,
          title: 'AI出题隔离课程',
          status: 'PUBLISHED',
        },
      });
      const anotherCourse = await db.course.create({
        data: {
          organizationId: organization.id,
          teacherId: other.user.id,
          title: '其他课程',
          status: 'PUBLISHED',
        },
      });
      await db.teachingAssignment.createMany({
        data: [
          { courseId: course.id, userId: teacher.user.id },
          { courseId: course.id, userId: other.user.id },
          { courseId: anotherCourse.id, userId: other.user.id },
        ],
      });
      const chapter = await db.chapter.create({ data: { courseId: course.id, title: '整数基础' } });
      const otherChapter = await db.chapter.create({
        data: { courseId: anotherCourse.id, title: '其他章节' },
      });
      const generation = {
        mode: 'paper',
        courseId: course.id,
        chapterId: chapter.id,
        title: '整数加法',
        knowledgePoints: ['整数加法'],
        requirements: '适合复习的原创题目',
        material: '1 + 1 = 2。',
        blueprint: ['single', 'multiple', 'boolean', 'blank', 'short'].map((type, index) => ({
          type,
          count: 1,
          scoreCents: (index + 1) * 100,
          difficulty: 2,
        })),
      };
      const create = (body: unknown = generation, status = 201) =>
        teacher.call('/ai-authoring/drafts', 'POST', body, status);
      let draft: any;

      await t.test('status is teacher-only and missing configuration consumes no operation', async () => {
        const status = await teacher.call('/ai-authoring/status');
        assert.equal(status.available, true);
        assert.equal(status.model, 'deepseek-flash');
        assert.equal(status.limits.maxQuestions, 10);
        assert.ok(!JSON.stringify(status).includes(fakeSecret));
        await student.call('/ai-authoring/status', 'GET', undefined, 403);
        await admin.call('/ai-authoring/status', 'GET', undefined, 403);
        await config(100, '');
        try {
          assert.equal((await teacher.call('/ai-authoring/status')).available, false);
          await create(generation, 503);
          assert.equal(await db.aiStudyOperation.count({ where: { userId: teacher.user.id } }), 0);
        } finally {
          await config();
        }
      });
      await t.test('invalid scope, chapter, blueprint, input HTML and CSRF never call DeepSeek', async () => {
        const before = calls;
        await create({ ...generation, courseId: anotherCourse.id }, 403);
        await create({ ...generation, chapterId: otherChapter.id }, 400);
        await create({ ...generation, blueprint: [{ ...generation.blueprint[0], count: 11 }] }, 400);
        await create({ ...generation, blueprint: [generation.blueprint[0], generation.blueprint[0]] }, 400);
        await create({ ...generation, requirements: '<script>bad()</script>' }, 400);
        await create({ ...generation, apiKey: 'client-secret' }, 400);
        await teacher.call('/ai-authoring/drafts', 'POST', generation, 403, true);
        assert.equal(calls, before);
        assert.equal(await db.aiAuthoringDraft.count({ where: { userId: teacher.user.id } }), 0);
      });
      await t.test(
        'generation persists only a private draft; provider input excludes institutional and user identifiers',
        async () => {
          draft = await create();
          assert.equal(draft.status, 'ready');
          assert.equal(draft.questions.length, 5);
          assert.equal(draft.revision, 1);
          assert.equal(draft.savedPaperId, null);
          assert.deepEqual(draft.savedQuestionIds, []);
          assert.equal(await db.question.count({ where: { courseId: course.id } }), 0);
          assert.equal(await db.paper.count({ where: { courseId: course.id } }), 0);
          assert.equal(lastRequest.model, 'deepseek-flash');
          assert.deepEqual(lastRequest.response_format, { type: 'json_object' });
          assert.deepEqual(lastRequest.thinking, { type: 'disabled' });
          assert.equal(lastRequest.max_tokens, 6000);
          for (const id of [teacher.user.id, course.id, chapter.id, organization.id])
            assert.ok(!JSON.stringify(lastInput).includes(id));
          assert.deepEqual(
            draft.questions.map((q: any) => q.scoreCents),
            [100, 200, 300, 400, 500],
          );
          const listed = await teacher.call('/ai-authoring/drafts?page=1&pageSize=1');
          assert.equal(listed.total, 1);
          assert.equal(listed.items[0].questionCount, 5);
          assert.equal(listed.items[0].input, undefined);
          await other.call(`/ai-authoring/drafts/${draft.id}`, 'GET', undefined, 404);
          await other.call(`/ai-authoring/drafts/${draft.id}`, 'DELETE', undefined, 404);
          await student.call(`/ai-authoring/drafts/${draft.id}`, 'GET', undefined, 403);
          await admin.call(`/ai-authoring/drafts/${draft.id}`, 'GET', undefined, 403);
          assert.equal((await other.call('/ai-authoring/drafts')).total, 0);
        },
      );
      await t.test(
        'commit rejects stale and invalid content, then concurrent saves create one complete private paper',
        async () => {
          const commit = { revision: draft.revision, title: '教师审定的试卷', questions: draft.questions };
          await teacher.call(
            `/ai-authoring/drafts/${draft.id}/commit`,
            'POST',
            { ...commit, revision: 0 },
            409,
          );
          await teacher.call(
            `/ai-authoring/drafts/${draft.id}/commit`,
            'POST',
            {
              ...commit,
              questions: [
                ...draft.questions.slice(0, 4),
                { ...draft.questions[4], stem: '<img src="https://example.org/x">' },
              ],
            },
            400,
          );
          await teacher.call(
            `/ai-authoring/drafts/${draft.id}/commit`,
            'POST',
            { ...commit, questions: [draft.questions[0], draft.questions[0]] },
            400,
          );
          assert.equal(await db.question.count({ where: { courseId: course.id } }), 0);
          const [a, b] = await Promise.all([
            teacher.call(`/ai-authoring/drafts/${draft.id}/commit`, 'POST', commit),
            teacher.call(`/ai-authoring/drafts/${draft.id}/commit`, 'POST', commit),
          ]);
          assert.equal(a.status, 'saved');
          assert.deepEqual(a.savedQuestionIds, b.savedQuestionIds);
          assert.equal(a.savedPaperId, b.savedPaperId);
          const questions = await db.question.findMany({
            where: { id: { in: a.savedQuestionIds } },
            include: { versions: true },
          });
          assert.equal(questions.length, 5);
          assert.ok(
            questions.every(
              (q) =>
                q.scope === 'private' &&
                !q.practiceEnabled &&
                !q.everPracticeEnabled &&
                q.chapterId === chapter.id &&
                q.creatorId === teacher.user.id,
            ),
          );
          const answer = Object.fromEntries(questions.map((q) => [q.versions[0].type, q.versions[0].answer]));
          assert.deepEqual(answer, {
            single: 'A',
            multiple: ['A', 'B'],
            boolean: true,
            blank: [['2']],
            short: '依据加法定义推导。',
          });
          const paper = await db.paper.findUniqueOrThrow({
            where: { id: a.savedPaperId },
            include: { items: true },
          });
          assert.equal(paper.totalCents, 1500);
          assert.equal(paper.items.length, 5);
          assert.deepEqual(paper.items.map((item) => item.position).sort(), [0, 1, 2, 3, 4]);
          assert.equal(await db.question.count({ where: { courseId: course.id } }), 5);
          assert.equal(await db.exam.count({ where: { courseId: course.id } }), 0);
          assert.equal(
            await db.auditLog.count({ where: { resourceId: draft.id, action: 'ai-authoring.commit' } }),
            1,
          );
          const again = await teacher.call(`/ai-authoring/drafts/${draft.id}/commit`, 'POST', {
            ...commit,
            title: '不应覆盖已保存结果',
          });
          assert.equal(again.title, a.title);
          assert.deepEqual(again.savedQuestionIds, a.savedQuestionIds);
          draft = a;
        },
      );
      await t.test(
        'questions mode accepts teacher edits and deletions without creating a paper or opening practice',
        async () => {
          const generated = await create({ ...generation, mode: 'questions' });
          const before = await db.paper.count({ where: { courseId: course.id } });
          const edited = {
            ...generated.questions[0],
            stem: '经教师修改：2 + 2 的结果？',
            answer: ['B'],
            scoreCents: 777,
          };
          const saved = await teacher.call(`/ai-authoring/drafts/${generated.id}/commit`, 'POST', {
            revision: generated.revision,
            title: '教师修订题目',
            questions: [edited],
          });
          assert.equal(saved.savedQuestionIds.length, 1);
          assert.equal(saved.savedPaperId, null);
          assert.equal(await db.paper.count({ where: { courseId: course.id } }), before);
          const question = await db.question.findUniqueOrThrow({
            where: { id: saved.savedQuestionIds[0] },
            include: { versions: true },
          });
          assert.equal(question.versions[0].answer, 'B');
          assert.equal(question.versions[0].scoreCents, 777);
          assert.ok(question.versions[0].stem.includes('经教师修改'));
          const operations = await db.aiStudyOperation.count({ where: { userId: teacher.user.id } });
          assert.deepEqual(await teacher.call(`/ai-authoring/drafts/${saved.id}`, 'DELETE'), { ok: true });
          assert.equal(await db.aiStudyOperation.count({ where: { userId: teacher.user.id } }), operations);
          assert.ok(await db.question.findUnique({ where: { id: saved.savedQuestionIds[0] } }));
          await teacher.call(`/ai-authoring/drafts/${saved.id}`, 'GET', undefined, 404);
        },
      );
      await t.test(
        'course revocation, archive and foreign institutions do not expose or modify drafts',
        async () => {
          await db.teachingAssignment.update({
            where: { courseId_userId: { courseId: course.id, userId: teacher.user.id } },
            data: { active: false },
          });
          try {
            assert.equal((await teacher.call('/ai-authoring/drafts')).total, 0);
            await teacher.call(`/ai-authoring/drafts/${draft.id}`, 'GET', undefined, 403);
            await teacher.call(
              `/ai-authoring/drafts/${draft.id}/commit`,
              'POST',
              { revision: draft.revision, title: draft.title, questions: draft.questions },
              403,
            );
          } finally {
            await db.teachingAssignment.update({
              where: { courseId_userId: { courseId: course.id, userId: teacher.user.id } },
              data: { active: true },
            });
          }
          await db.course.update({ where: { id: course.id }, data: { status: 'ARCHIVED' } });
          try {
            assert.equal((await teacher.call(`/ai-authoring/drafts/${draft.id}`)).status, 'saved');
            await create(generation, 403);
            await teacher.call(
              `/ai-authoring/drafts/${draft.id}/commit`,
              'POST',
              { revision: draft.revision, title: draft.title, questions: draft.questions },
              403,
            );
          } finally {
            await db.course.update({ where: { id: course.id }, data: { status: 'PUBLISHED' } });
          }
          const foreignOrg = await db.organization.create({ data: { name: `异机构出题-${suffix}` } });
          const foreignUser = await db.user.create({
            data: {
              organizationId: foreignOrg.id,
              username: `authoring-foreign-${suffix}`,
              name: '异机构教师',
              passwordHash: seed.passwordHash,
              roles: { create: { roleId: 'TEACHER' } },
            },
          });
          const foreign = await login(foreignUser.username);
          assert.equal((await foreign.call('/ai-authoring/drafts')).total, 0);
          await foreign.call(`/ai-authoring/drafts/${draft.id}`, 'GET', undefined, 404);
          await foreign.call('/ai-authoring/drafts', 'POST', generation, 404);
        },
      );
      await t.test(
        'paper permission is checked separately; practice-disabled institutions can still author exam questions',
        async () => {
          await db.systemSetting.create({
            data: { organizationId: organization.id, key: 'features', value: { practice: false } },
          });
          try {
            const questions = await create({ ...generation, mode: 'questions' });
            await db.rolePermission.delete({
              where: { roleId_permissionId: { roleId: 'TEACHER', permissionId: 'assessment.manage' } },
            });
            try {
              await teacher.call(`/ai-authoring/drafts/${draft.id}`, 'GET', undefined, 403);
              assert.ok(
                (await teacher.call('/ai-authoring/drafts')).items.every(
                  (item: any) => item.mode === 'questions',
                ),
              );
              await create(generation, 403);
              assert.equal((await teacher.call(`/ai-authoring/drafts/${questions.id}`)).status, 'ready');
            } finally {
              await db.rolePermission.create({
                data: { roleId: 'TEACHER', permissionId: 'assessment.manage' },
              });
            }
          } finally {
            await db.systemSetting.delete({
              where: { organizationId_key: { organizationId: organization.id, key: 'features' } },
            });
          }
        },
      );
      await t.test(
        'one shared pending operation prevents simultaneous generation and pending deletion',
        async () => {
          mode = 'hold';
          const reached = new Promise<void>((resolve) => {
            observed = resolve;
          });
          const pending = create();
          await reached;
          const before = calls;
          await create(generation, 409);
          const listed = await teacher.call('/ai-authoring/drafts');
          const active = listed.items.find((item: any) => item.status === 'pending');
          assert.ok(active);
          await teacher.call(`/ai-authoring/drafts/${active.id}`, 'DELETE', undefined, 409);
          assert.equal(calls, before);
          release?.();
          assert.equal((await pending).status, 'ready');
          mode = 'success';
          const studentOperation = await db.aiStudyOperation.create({
            data: {
              organizationId: organization.id,
              userId: teacher.user.id,
              kind: 'search',
              leaseExpiresAt: new Date(Date.now() + 60000),
            },
          });
          try {
            await create(generation, 409);
          } finally {
            await db.aiStudyOperation.update({
              where: { id: studentOperation.id },
              data: { status: 'failed', errorCode: 'FIXTURE', completedAt: new Date() },
            });
          }
        },
      );
      await t.test(
        'provider failures and malformed/truncated output create safe failed drafts without bank writes',
        async () => {
          const before = await db.question.count({ where: { courseId: course.id } });
          for (const failure of ['fail', 'malformed', 'partial'] as const) {
            mode = failure;
            const result = await create();
            assert.equal(result.status, 'failed');
            assert.ok(result.error);
            assert.ok(!JSON.stringify(result).includes(fakeSecret));
            assert.equal(result.questions.length, 0);
            const operation = await db.aiStudyOperation.findUniqueOrThrow({
              where: {
                id: (await db.aiAuthoringDraft.findUniqueOrThrow({ where: { id: result.id } })).operationId,
              },
            });
            assert.equal(operation.status, 'failed');
            await teacher.call(
              `/ai-authoring/drafts/${result.id}/commit`,
              'POST',
              { revision: result.revision, title: '失败不得保存', questions: draft.questions },
              409,
            );
          }
          mode = 'success';
          assert.equal(await db.question.count({ where: { courseId: course.id } }), before);
        },
      );
      await t.test(
        'provider completion rechecks course, chapter, active role and question permission',
        async () => {
          await db.userRole.create({ data: { userId: teacher.user.id, roleId: 'STUDENT' } });
          for (const revocation of ['course', 'chapter', 'role', 'permission'] as const) {
            mode = 'hold';
            const reached = new Promise<void>((resolve) => {
              observed = resolve;
            });
            const pending = create(generation, revocation === 'chapter' ? 400 : 403);
            await reached;
            if (revocation === 'course')
              await db.teachingAssignment.update({
                where: { courseId_userId: { courseId: course.id, userId: teacher.user.id } },
                data: { active: false },
              });
            if (revocation === 'chapter')
              await db.chapter.update({ where: { id: chapter.id }, data: { courseId: anotherCourse.id } });
            if (revocation === 'role') await teacher.call('/auth/role', 'POST', { role: 'STUDENT' });
            if (revocation === 'permission')
              await db.rolePermission.delete({
                where: { roleId_permissionId: { roleId: 'TEACHER', permissionId: 'question.manage' } },
              });
            release?.();
            try {
              await pending;
            } finally {
              if (revocation === 'course')
                await db.teachingAssignment.update({
                  where: { courseId_userId: { courseId: course.id, userId: teacher.user.id } },
                  data: { active: true },
                });
              if (revocation === 'chapter')
                await db.chapter.update({ where: { id: chapter.id }, data: { courseId: course.id } });
              if (revocation === 'role') await teacher.call('/auth/role', 'POST', { role: 'TEACHER' });
              if (revocation === 'permission')
                await db.rolePermission.create({
                  data: { roleId: 'TEACHER', permissionId: 'question.manage' },
                });
              mode = 'success';
            }
          }
          assert.equal(
            await db.aiAuthoringDraft.count({ where: { userId: teacher.user.id, status: 'pending' } }),
            0,
          );
        },
      );
      await t.test(
        'expired leases recover, including recovery from the student AI entry point; late responses cannot overwrite failure',
        async () => {
          mode = 'hold';
          const reached = new Promise<void>((resolve) => {
            observed = resolve;
          });
          const pending = create(generation, 409);
          await reached;
          const operation = await db.aiStudyOperation.findFirstOrThrow({
            where: { userId: teacher.user.id, status: 'pending' },
          });
          const active = await db.aiAuthoringDraft.findUniqueOrThrow({
            where: { operationId: operation.id },
          });
          await db.aiStudyOperation.update({
            where: { id: operation.id },
            data: { leaseExpiresAt: new Date(Date.now() - 1000) },
          });
          assert.equal((await teacher.call(`/ai-authoring/drafts/${active.id}`)).status, 'failed');
          mode = 'success';
          assert.equal((await create()).status, 'ready');
          release?.();
          await pending;
          assert.equal((await teacher.call(`/ai-authoring/drafts/${active.id}`)).status, 'failed');
          const second = await db.aiStudyOperation.create({
            data: {
              organizationId: organization.id,
              userId: teacher.user.id,
              kind: 'authoring',
              leaseExpiresAt: new Date(Date.now() - 1000),
            },
          });
          const secondDraft = await db.aiAuthoringDraft.create({
            data: {
              organizationId: organization.id,
              userId: teacher.user.id,
              courseId: course.id,
              operationId: second.id,
              mode: 'questions',
              title: '跨入口租约恢复',
              input: generation,
              questions: [],
              model: 'deepseek-flash',
            },
          });
          await teacher.call('/auth/role', 'POST', { role: 'STUDENT' });
          try {
            await teacher.call('/ai-study/reports');
          } finally {
            await teacher.call('/auth/role', 'POST', { role: 'TEACHER' });
          }
          assert.equal((await teacher.call(`/ai-authoring/drafts/${secondDraft.id}`)).status, 'failed');
        },
      );
      await t.test(
        'quota counts failed attempts and shared student operations; deleting a draft never resets quota',
        async () => {
          await config(2);
          const generated = await other.call('/ai-authoring/drafts', 'POST', generation);
          mode = 'fail';
          failStatus = 429;
          const failed = await other.call('/ai-authoring/drafts', 'POST', generation);
          assert.equal(failed.status, 'failed');
          assert.match(failed.error, /额度/);
          mode = 'success';
          await other.call(`/ai-authoring/drafts/${generated.id}`, 'DELETE');
          await other.call(`/ai-authoring/drafts/${failed.id}`, 'DELETE');
          await other.call('/ai-authoring/drafts', 'POST', generation, 429);
          assert.equal(await db.aiStudyOperation.count({ where: { userId: other.user.id } }), 2);
          assert.equal(await db.aiAuthoringDraft.count({ where: { userId: other.user.id } }), 0);
          await config();
        },
      );
      assert.ok(!logs.includes(fakeSecret));
    } finally {
      release?.();
      api.kill('SIGTERM');
      if (api.exitCode === null) await Promise.race([once(api, 'exit'), sleep(3000)]);
      if (api.exitCode === null) api.kill('SIGKILL');
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await writeFile('.data/ai-authoring-api.log', logs);
      await db.$disconnect();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
