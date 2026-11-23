import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { AlgorithmsService } from '../apps/api/src/algorithms/algorithms.service';
import { AuthService } from '../apps/api/src/auth/auth.service';
import { mobileForumListQuery } from '../apps/api/src/mobile/mobile-algorithms.schemas';
import {
  analysisSubmission,
  algorithmLearningApi,
  learningText,
} from '../apps/mobile/src/algorithm-learning-model';
import { mobileAlgorithmExecutionRouteAllowed as allowed } from '../apps/api/src/mobile/mobile-algorithms.policy';
import { mobileAlgorithmSubmissionQuery } from '../apps/api/src/mobile/mobile-algorithms.schemas';
import {
  acceptCodeDraft,
  canRetryUnknownExecution,
  codeIsDirty,
  initialCodeState,
  reconcileCodeDraft,
  submissionKind,
  submissionVerdict,
  validateAlgorithmCode,
  validateAlgorithmStdin,
  type CodeDraft,
  type CodeHistory,
} from '../apps/mobile/src/algorithm-workspace-model';

test('mobile execution allowlist permits exact native methods, never host execution or web APIs', () => {
  for (const [method, path] of [
    ['GET', 'status'],
    ['GET', 'problems/sum-of-two/workspace'],
    ['PUT', 'problems/sum-of-two/draft'],
    ['POST', 'problems/sum-of-two/submissions'],
    ['GET', 'problems/sum-of-two/submissions'],
    ['GET', 'submissions/record_1'],
  ]) {
    const full = '/api/mobile/algorithms/' + path;
    assert.equal(allowed(full, method), true);
    for (const other of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter(
      (value) => value !== method && !(path.endsWith('/submissions') && ['GET', 'POST'].includes(value)),
    ))
      assert.equal(allowed(full, other), false);
    assert.equal(allowed(full + '/extra', method), false);
  }
  for (const path of [
    '/api/algorithms/problems/a/submissions',
    '/api/mobile/algorithms/exec',
    '/api/mobile/algorithms/problems/a%2fb/submissions',
    '/api/mobile/algorithms/problems/../submissions',
    '/api/mobile/algorithms/problems/' + 'a'.repeat(101) + '/submissions',
  ])
    assert.equal(allowed(path, 'POST'), false);
});
test('native history queries are strictly bounded and preserve exact intersecting filters', () => {
  assert.deepEqual(mobileAlgorithmSubmissionQuery.parse({}), { page: 1, pageSize: 10 });
  assert.deepEqual(
    mobileAlgorithmSubmissionQuery.parse({
      page: '2',
      pageSize: '20',
      kind: 'custom',
      language: 'python',
      status: 'running',
    }),
    { page: 2, pageSize: 20, kind: 'custom', language: 'python', status: 'running' },
  );
  for (const q of [
    { page: [] },
    { page: true },
    { pageSize: 21 },
    { organizationId: 'other' },
    { kind: 'run' },
    { language: 'sh' },
    { status: 'accepted ' },
    { status: ['accepted'] },
  ])
    assert.equal(mobileAlgorithmSubmissionQuery.safeParse(q).success, false);
});
test('mobile learning endpoints allow only student plan/analysis/post operations, never forum moderation', () => {
  for (const [method, path] of [
    ['GET', 'training-plans'],
    ['POST', 'training-plans'],
    ['PATCH', 'training-plans/id'],
    ['DELETE', 'training-plans/id'],
    ['POST', 'problems/sum-of-two/analysis'],
    ['GET', 'problems/sum-of-two/analyses'],
    ['GET', 'forum/status'],
    ['GET', 'forum/posts'],
    ['POST', 'forum/posts'],
    ['GET', 'forum/posts/id'],
    ['GET', 'forum/posts/id/replies'],
    ['POST', 'forum/posts/id/replies'],
  ])
    assert.equal(allowed('/api/mobile/algorithms/' + path, method), true);
  for (const [method, path] of [
    ['PATCH', 'forum/posts/id'],
    ['PATCH', 'forum/posts/id/moderation'],
    ['DELETE', 'forum/posts/id/replies/reply'],
    ['POST', 'training-plans/id'],
    ['GET', 'problems/id/analysis'],
    ['POST', 'problems/id/analyses'],
    ['POST', 'forum/posts/id'],
    ['GET', 'forum/posts/id/replies/other'],
  ])
    assert.equal(allowed('/api/mobile/algorithms/' + path, method), false);
  assert.deepEqual(mobileForumListQuery.parse({}), { page: 1, pageSize: 10, scope: 'public' });
  for (const value of [
    { page: true },
    { page: ['1', '2'] },
    { pageSize: 21 },
    { scope: 'all' },
    { organizationId: 'other' },
  ])
    assert.equal(mobileForumListQuery.safeParse(value).success, false);
});
test('AI diagnostics attach only the selected completed code snapshot; hint/explanation never attach a result', async () => {
  const intent = { language: 'python' as const, code: 'print("我😀")' },
    selected = { ...intent, id: 'owned-result', status: 'accepted', mode: 'submit' } as any;
  assert.equal(analysisSubmission(intent, selected), 'owned-result');
  for (const row of [
    null,
    { ...selected, code: 'old' },
    { ...selected, language: 'cpp' },
    { ...selected, status: 'running' },
  ])
    assert.equal(analysisSubmission(intent, row), undefined);
  const requests: any[] = [];
  const client = {
    request: async (...args: any[]) => {
      requests.push(args);
      return {};
    },
  } as any;
  await algorithmLearningApi.analyze(client, 'sum-of-two', intent, 'debug', selected);
  assert.equal(requests[0][1].submissionId, 'owned-result');
  assert.equal(requests[0][1].code, intent.code);
  await algorithmLearningApi.analyze(client, 'sum-of-two', intent, 'hint', selected);
  assert.equal(Object.hasOwn(requests[1][1], 'submissionId'), false);
  await algorithmLearningApi.analyze(client, 'sum-of-two', { ...intent, code: 'new' }, 'debug', selected);
  assert.equal(Object.hasOwn(requests[2][1], 'submissionId'), false);
});
test('forum text stays literal, refuses empty/oversized/NUL bodies and publishes only explicit scope', async () => {
  const text = '<script>alert(1)</script>\n代码😀';
  assert.equal(learningText(text, 15000, '正文'), text);
  for (const input of ['  ', 'x\0', 'x'.repeat(15001)])
    assert.throws(() => learningText(input, 15000, '正文'));
  const requests: any[] = [];
  const client = {
    request: async (...args: any[]) => {
      requests.push(args);
      return {};
    },
  } as any;
  await algorithmLearningApi.createPost(client, {
    scope: 'organization',
    kind: 'question',
    title: '问题',
    body: text,
    problemId: 'sum-of-two',
  });
  assert.deepEqual(requests[0], [
    '/mobile/algorithms/forum/posts',
    { scope: 'organization', kind: 'question', title: '问题', body: text, problemId: 'sum-of-two' },
    'POST',
  ]);
});
const cloud: CodeDraft = {
  language: 'python',
  code: 'print("初始")\n',
  revision: 3,
  updatedAt: '2026-11-23T00:00:00Z',
};
const initial = () =>
  initialCodeState({
    problemId: 'sum-of-two',
    starterCode: { cpp: 'cpp', python: 'python', javascript: 'js', java: 'java' },
    draft: cloud,
  });
test('language switching, cloud loading and saving preserve unrelated local language drafts', () => {
  const base = initial();
  assert.equal(base.language, 'python');
  assert.equal(codeIsDirty(base), false);
  const editing = {
    ...base,
    language: 'cpp' as const,
    codes: { ...base.codes, cpp: 'new cpp', python: 'new python' },
  };
  const saved = acceptCodeDraft(editing, { ...cloud, code: 'new python', revision: 4 }, false);
  assert.equal(saved.language, 'cpp');
  assert.equal(saved.codes.cpp, 'new cpp');
  assert.equal(codeIsDirty(saved), true);
  const loaded = acceptCodeDraft(editing, { ...cloud, code: 'cloud v4', revision: 4 }, true);
  assert.equal(loaded.codes.python, 'cloud v4');
  assert.equal(loaded.codes.cpp, 'new cpp');
  assert.equal(loaded.language, 'python');
  assert.equal(codeIsDirty(loaded), true);
  assert.equal(base.codes.python, cloud.code);
});
test('unknown draft saves compare the entire intent and consecutive revision without replay', () => {
  const intent = { language: 'python' as const, code: 'print("新😀")\n' };
  assert.equal(reconcileCodeDraft(cloud, intent, { ...cloud, ...intent, revision: 4 }), 'applied');
  assert.equal(reconcileCodeDraft(cloud, intent, cloud), 'unchanged');
  assert.equal(reconcileCodeDraft(null, intent, null), 'unchanged');
  assert.equal(reconcileCodeDraft(null, intent, { ...cloud, ...intent, revision: 1 }), 'applied');
  for (const current of [
    null,
    { ...cloud, ...intent, revision: 5 },
    { ...cloud, ...intent, revision: 4, language: 'cpp' as const },
    { ...cloud, revision: 4 },
    { ...cloud, ...intent },
  ])
    assert.equal(reconcileCodeDraft(cloud, intent, current), 'conflict');
});
test('native code and stdin retain tabs Unicode and empty draft while enforcing wire byte bounds', () => {
  const code = '\tprint("你好😀")\r\n';
  assert.equal(validateAlgorithmCode(code, true), code);
  assert.equal(validateAlgorithmCode(''), '');
  assert.throws(() => validateAlgorithmCode('  ', true));
  assert.equal(validateAlgorithmCode('中'.repeat(16000)).length, 16000);
  for (const code of ['a'.repeat(16001), 'a\0b']) assert.throws(() => validateAlgorithmCode(code));
  assert.equal(validateAlgorithmStdin('😀'.repeat(8000)).length, 16000);
  assert.throws(() => validateAlgorithmStdin('中'.repeat(10667)));
  assert.throws(() => validateAlgorithmStdin('a\0'));
});
test('unknown judge request can only be manually retried after lease and refreshed first page has no running record', () => {
  const empty: CodeHistory = { items: [], total: 0, page: 1, pageSize: 10 };
  assert.equal(canRetryUnknownExecution(1000, 95999, empty), false);
  assert.equal(canRetryUnknownExecution(1000, 96000, empty), true);
  assert.equal(canRetryUnknownExecution(1000, 100000, null), false);
  assert.equal(canRetryUnknownExecution(1000, 100000, { ...empty, page: 2 }), false);
  assert.equal(
    canRetryUnknownExecution(1000, 100000, { ...empty, items: [{ status: 'running' } as any] }),
    false,
  );
});
test('successful run is never labeled as solving a problem and custom input is explicit', () => {
  assert.equal(submissionKind({ mode: 'run', customInput: true }), '自定义运行');
  assert.equal(submissionKind({ mode: 'run', customInput: false }), '样例运行');
  assert.equal(submissionKind({ mode: 'submit', customInput: false }), '正式提交');
  assert.equal(submissionVerdict({ mode: 'run', status: 'accepted' }), '运行完成（不计为通过题目）');
  assert.equal(submissionVerdict({ mode: 'submit', status: 'accepted' }), '通过');
});

function mobileDb() {
  let current = true,
    permissions = true,
    feature = true,
    writes = 0,
    revokeAfterLock = false;
  const tx: any = {
    $queryRaw: async () => {
      if (revokeAfterLock) current = false;
      return [];
    },
    mobileCredential: { findUnique: async () => (current ? { sessionId: 'session' } : null) },
    session: {
      findUnique: async () => ({
        id: 'session',
        userId: 'student',
        clientType: 'MOBILE',
        role: 'STUDENT',
        authVersion: 1,
        expiresAt: new Date(Date.now() + 60000),
      }),
    },
    user: {
      findUnique: async () => ({
        id: 'student',
        organizationId: 'org',
        active: true,
        authVersion: 1,
        accountMode: 'ORGANIZATION',
        roles: [
          {
            roleId: 'STUDENT',
            role: {
              id: 'STUDENT',
              permissions: permissions
                ? [{ permissionId: 'learning.use', permission: { sensitive: false } }]
                : [],
            },
          },
        ],
      }),
    },
    organization: { findUnique: async () => ({ id: 'org', kind: 'INSTITUTION', active: true }) },
    sensitiveGrant: { findMany: async () => [] },
    systemSetting: { findUnique: async () => ({ value: { practice: feature } }) },
    algorithmDraft: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        writes++;
        return { ...data, updatedAt: new Date() };
      },
    },
    $transaction: async (work: any) => work(tx),
  };
  const actor: any = {
    id: 'student',
    organizationId: 'org',
    role: 'STUDENT',
    permissions: ['learning.use'],
    sessionId: 'session',
    clientType: 'MOBILE',
  };
  const service = new AlgorithmsService(tx, new AuthService(tx), {} as any, {} as any);
  return {
    tx,
    actor,
    service,
    writes: () => writes,
    revoke: () => {
      current = false;
    },
    queuedRevoke: () => {
      revokeAfterLock = true;
    },
    disable: () => {
      feature = false;
    },
    removePermission: () => {
      permissions = false;
    },
  };
}
test('mobile draft save uses mobile credentials and rechecks queued revocation on the transaction connection before writing', async () => {
  const f = mobileDb();
  const result = await f.service.saveDraft(f.actor, 'sum-of-two', {
    language: 'python',
    code: 'print(3)',
    revision: 0,
  });
  assert.equal(result!.revision, 1);
  assert.equal(f.writes(), 1);
  for (const mode of ['revoke', 'queuedRevoke', 'disable', 'removePermission'] as const) {
    const denied = mobileDb();
    denied[mode]();
    await assert.rejects(
      denied.service.saveDraft(denied.actor, 'sum-of-two', {
        language: 'python',
        code: 'print(3)',
        revision: 0,
      }),
      ForbiddenException,
    );
    assert.equal(denied.writes(), 0);
  }
});
