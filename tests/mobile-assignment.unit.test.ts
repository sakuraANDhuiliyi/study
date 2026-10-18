import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  referenceRows,
  assignmentWindow,
  answered,
  answerMap,
  answerRows,
  richParts,
  safeFileName,
  money,
  type AssignmentDetail,
} from '../apps/mobile/src/assignment-model';
import { MobileClient, MobileApiError, type MobileSession } from '../apps/mobile/src/client';
import {
  pendingSubmission,
  rememberSubmission,
  forgetSubmission,
  type SubmissionBody,
} from '../apps/mobile/src/submission-ledger';
import { mobileRouteAllowed } from '../apps/api/src/auth/auth.guard';
const at = Date.parse('2026-10-18T12:00:00Z');
const detail = (patch: Partial<AssignmentDetail> = {}) =>
  ({
    opensAt: new Date(at - 1000).toISOString(),
    dueAt: new Date(at + 1000).toISOString(),
    allowLate: false,
    maxAttempts: 1,
    mySubmissions: [],
    exception: null,
    ...patch,
  }) as AssignmentDetail;
const session = (letter = 'a'): MobileSession => ({
  accessToken: 'ma1_' + letter.repeat(43),
  refreshToken: 'mr1_' + letter.repeat(64),
  accessExpiresAt: new Date(Date.now() + 900000).toISOString(),
  sessionExpiresAt: new Date(Date.now() + 3600000).toISOString(),
  user: {
    id: letter,
    username: letter,
    name: letter,
    role: 'STUDENT',
    roles: ['STUDENT'],
    permissions: [],
    organizationId: 'o',
    accountMode: 'ORGANIZATION',
  },
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const storage = () => ({ get: async () => null, set: async (_v: string) => {}, remove: async () => {} });
const client = (fetcher: typeof fetch = async () => response(session())) =>
  new MobileClient('https://study.example.com', storage(), () => {}, fetcher);
test('assignment bearer routes are confined to student assignment operations', () => {
  for (const [path, method] of [
    ['/api/mobile/assignments', 'GET'],
    ['/api/mobile/assignments/a', 'GET'],
    ['/api/mobile/assignments/a/draft', 'PUT'],
    ['/api/mobile/assignments/a/submit', 'POST'],
    ['/api/mobile/assignments/a/files', 'POST'],
    ['/api/mobile/assignments/a/files/f', 'GET'],
  ])
    assert.ok(mobileRouteAllowed(path, method));
  for (const [path, method] of [
    ['/api/mobile/assignments/a', 'DELETE'],
    ['/api/mobile/assignments/a/grade', 'POST'],
    ['/api/mobile/assignments/a/files/f', 'DELETE'],
    ['/api/assignments/a', 'GET'],
    ['/api/attachments/f/download', 'GET'],
    ['/api/mobile/assignments/a/files/f/extra', 'GET'],
    ['/api/mobile/assignments/a/roster', 'GET'],
  ])
    assert.equal(mobileRouteAllowed(path, method), false);
});
test('personal windows honor opening, deadline, exemptions and maximum submitted version', () => {
  assert.ok(assignmentWindow(detail(), at).canWrite);
  assert.equal(assignmentWindow(detail(), at + 1001).canWrite, false);
  assert.ok(assignmentWindow(detail({ allowLate: true }), at + 1001).canWrite);
  assert.equal(assignmentWindow(detail(), at - 1001).canWrite, false);
  const exception = {
    exempt: false,
    allowUntil: new Date(at + 10000).toISOString(),
    extraAttempts: 1,
    reason: 'extension',
  };
  assert.ok(
    assignmentWindow(detail({ exception, mySubmissions: [{ version: 1 } as any] }), at + 2000).canWrite,
  );
  assert.equal(
    assignmentWindow(detail({ exception, mySubmissions: [{ version: 2 } as any] }), at).canWrite,
    false,
  );
  assert.equal(assignmentWindow(detail({ exception: { ...exception, exempt: true } }), at).canWrite, false);
  assert.equal(
    assignmentWindow(
      detail({ exception: { ...exception, allowUntil: new Date(at - 5000).toISOString() } }),
      at,
    ).effectiveDue,
    at + 1000,
  );
});
test('answers preserve false, composite and prototype-shaped identifiers without pollution', () => {
  for (const v of [false, true, ['one'], { child: false }]) assert.ok(answered(v));
  for (const v of [undefined, null, '  ', [' '], { child: '' }]) assert.equal(answered(v), false);
  const rows = [
    { questionVersionId: '__proto__', value: false },
    { questionVersionId: 'constructor', value: ['a', 'b'] },
  ];
  assert.deepEqual(answerRows(answerMap(rows)), rows);
  assert.equal(({} as any).polluted, undefined);
  assert.equal(money(125), '1.25');
  assert.equal(money(null), '待发布');
});
test('native rich content never executes markup or forwards credentials to images', () => {
  const parts = richParts(
    '<script>secret()</script><style>hidden</style><p>&lt;script&gt;&#x1f600;&#0;</p><img src="http://insecure/a" alt="A"><img src="https://user:pass@evil.test/a"><img src="https://safe.test/a?x=1&amp;y=2">',
  );
  assert.ok(!JSON.stringify(parts).includes('secret()'));
  assert.ok(!JSON.stringify(parts).includes('hidden'));
  assert.deepEqual(
    parts.filter((p) => p.kind === 'image').map((p) => p.value),
    ['https://safe.test/a?x=1&y=2'],
  );
  assert.ok(parts[0].value.includes('<script>😀�'));
  for (const name of ['../../private.txt', '..\\file.txt', '\u0000name:\n.txt', '']) {
    const safe = safeFileName(name);
    assert.ok(safe.length > 0 && safe.length <= 100);
    assert.doesNotMatch(safe, /[\\/\x00-\x1f:*?"<>|]/);
    assert.ok(!safe.startsWith('.'));
  }
});
test('unconfirmed submissions preserve immutable payloads, cap memory and clear on identity changes', async () => {
  const c = client();
  await c.login('a', 'never-store');
  const body: SubmissionBody = {
    answers: [{ questionVersionId: 'q', value: ['a'] }],
    attachmentIds: ['f'],
    idempotencyKey: 'fixed-key',
    expectedDraftRevision: 2,
    expectedSubmissionVersion: 1,
  };
  rememberSubmission(c, 'a', body);
  (body.answers[0].value as string[]).push('changed');
  body.attachmentIds.push('another');
  assert.deepEqual(pendingSubmission(c, 'a')!.body.answers[0].value, ['a']);
  assert.deepEqual(pendingSubmission(c, 'a')!.body.attachmentIds, ['f']);
  for (let n = 1; n < 10; n++) rememberSubmission(c, String(n), body);
  assert.throws(() => rememberSubmission(c, 'overflow', body));
  forgetSubmission(c, '1');
  rememberSubmission(c, 'overflow', body);
  await c.login('a', 'never-store');
  assert.equal(pendingSubmission(c, 'a'), null);
  rememberSubmission(c, 'a', body);
  await c.clear();
  assert.equal(pendingSubmission(c, 'a'), null);
});
test('multipart uploads preserve OS boundaries and never replay a network-uncertain operation', async () => {
  let uploads = 0;
  const form = new FormData();
  form.append('file', new Blob(['test']), 'answer.txt');
  const c = client(async (url, init) => {
    if (String(url).endsWith('/login')) return response(session());
    uploads++;
    assert.equal(init!.body, form);
    assert.equal((init!.headers as any)['content-type'], undefined);
    assert.match((init!.headers as any).authorization, /^Bearer ma1_/);
    assert.equal(init!.credentials, 'omit');
    assert.equal(init!.redirect, 'error');
    throw new Error('network lost');
  });
  await c.login('a', 'x');
  await assert.rejects(
    c.uploadAssignmentFile('a', form),
    (e: unknown) => e instanceof MobileApiError && e.status === 0,
  );
  assert.equal(uploads, 1);
});
test('private downloads enforce byte limits and known lengths', async () => {
  let value = new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } });
  const c = client(async (url, init) => {
    if (String(url).endsWith('/login')) return response(session());
    assert.equal((init!.headers as any).accept, 'application/octet-stream');
    assert.equal(init!.redirect, 'error');
    return value;
  });
  await c.login('a', 'x');
  assert.deepEqual([...(await c.downloadAssignmentFile('a', 'f'))], [1, 2, 3]);
  for (const length of [undefined, '52428801', '-1', '1.5', '2']) {
    value = new Response(new Uint8Array([1, 2, 3]), {
      headers: length === undefined ? {} : { 'content-length': length },
    });
    await assert.rejects(c.downloadAssignmentFile('a', 'f'));
  }
});
test('a private transfer cannot deliver a prior identity response after logout', async () => {
  let resolve!: (r: Response) => void;
  const delayed = new Promise<Response>((r) => {
    resolve = r;
  });
  const c = client(async (url) => (String(url).endsWith('/login') ? response(session()) : delayed));
  await c.login('a', 'x');
  const work = c.downloadAssignmentFile('a', 'f');
  await new Promise((r) => setTimeout(r, 0));
  await c.clear();
  resolve(new Response(new Uint8Array([1]), { headers: { 'content-length': '1' } }));
  await assert.rejects(work);
});

test('composite published references include child answers and unpublished children stay absent', () => {
  const base: any = {
    id: 'composite',
    type: 'composite',
    stem: 'parent',
    answer: {},
    children: [
      { id: 'child', type: 'boolean', stem: 'child', answer: false, explanation: 'published', children: [] },
      { id: 'hidden', type: 'short', stem: 'hidden', children: [] },
    ],
  };
  assert.deepEqual(referenceRows(base), [
    { label: '评分参考 · 子题 1', answer: false, explanation: 'published', stem: 'child' },
  ]);
  delete base.children[0].answer;
  assert.deepEqual(referenceRows(base), []);
});

test('file errors during the post-read permission check become a safe 404 instead of an unhandled stream error', async () => {
  const { Readable } = await import('node:stream');
  const { recheckPrivateStream } = await import('../apps/api/src/mobile/private-stream');
  const stream = new Readable({ read() {} });
  const work = recheckPrivateStream(stream, async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
  setTimeout(() => stream.destroy(new Error('sensitive private storage path')), 1);
  await assert.rejects(work, (e: any) => e.getStatus() === 404 && !e.message.includes('sensitive'));
  assert.ok(stream.destroyed);
});

test('file transfer waits for asynchronous copy before checking the private file size', async () => {
  const { prepareAssignmentUpload } = await import('../apps/mobile/src/assignment-upload');
  let release!: () => void;
  const copying = new Promise<void>((r) => {
    release = r;
  });
  let reads = 0;
  const work = prepareAssignmentUpload(
    () => copying,
    async () => {
      reads++;
      return 2;
    },
    () => true,
    10,
  );
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(reads, 0);
  release();
  await work;
  assert.equal(reads, 1);
});
test('a login change during file copy or validation prevents a cross-account upload', async () => {
  const { prepareAssignmentUpload } = await import('../apps/mobile/src/assignment-upload');
  let active = true,
    reads = 0;
  await assert.rejects(
    prepareAssignmentUpload(
      async () => {
        active = false;
      },
      async () => {
        reads++;
        return 1;
      },
      () => active,
      10,
    ),
  );
  assert.equal(reads, 0);
  active = true;
  await assert.rejects(
    prepareAssignmentUpload(
      async () => {},
      async () => {
        active = false;
        return 1;
      },
      () => active,
      10,
    ),
  );
});
test('copied file byte lengths must still fit the accepted upload budget', async () => {
  const { prepareAssignmentUpload } = await import('../apps/mobile/src/assignment-upload');
  for (const size of [0, 11, -1, NaN, 1.5, 50 * 1024 * 1024 + 1])
    await assert.rejects(
      prepareAssignmentUpload(
        async () => {},
        async () => size,
        () => true,
        10,
      ),
    );
});
