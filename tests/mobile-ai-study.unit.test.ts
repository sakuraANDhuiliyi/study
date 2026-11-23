import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileAiStudyRouteAllowed as allowed } from '../apps/api/src/mobile/mobile-ai-study.policy';
import { mobileAiReportQuery } from '../apps/api/src/mobile/mobile-ai-study.schemas';
import { createAiReportInput } from '../apps/api/src/ai-study/ai-study.schemas';
import { MobileClient, mobileDownloadFilename, type MobileSession } from '../apps/mobile/src/client';
import { aiAnswerText, aiCitationText, aiSourceUrl, type AiReport } from '../apps/mobile/src/ai-study-model';
const origin = 'https://study.example.test';
const session: MobileSession = {
  accessToken: 'ma1_' + 'a'.repeat(43),
  refreshToken: 'mr1_' + 'b'.repeat(64),
  accessExpiresAt: new Date(Date.now() + 900000).toISOString(),
  sessionExpiresAt: new Date(Date.now() + 3600000).toISOString(),
  user: {
    id: 'me',
    username: 'student',
    name: '学生',
    role: 'STUDENT',
    roles: ['STUDENT'],
    permissions: ['learning.use'],
    organizationId: 'own',
    accountMode: 'ORGANIZATION',
  },
};
function client(fetcher: typeof fetch) {
  let raw: string | null = null;
  const c = new MobileClient(
    origin,
    {
      get: async () => raw,
      set: async (v) => {
        raw = v;
      },
      remove: async () => {
        raw = null;
      },
    },
    () => {},
    async (url, options) =>
      String(url).endsWith('/login')
        ? new Response(JSON.stringify(session), { status: 201 })
        : fetcher(url, options),
  );
  return { c, saved: () => raw };
}
const file = (body = 'abc', headers: Record<string, string> = {}) =>
  new Response(body, {
    headers: {
      'content-length': String(new TextEncoder().encode(body).byteLength),
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': "attachment; filename*=UTF-8''%E5%A4%8D%E7%9B%98.md",
      ...headers,
    },
  });
test('native AI routes are precise and do not grant provider configuration or arbitrary source URLs', () => {
  for (const [method, paths] of Object.entries({
    GET: ['status', 'reports', 'reports/abc', 'reports/abc/export'],
    POST: ['reports', 'reports/abc/search', 'reports/abc/sources/source-1/download'],
    DELETE: ['reports/abc'],
  }))
    for (const path of paths) assert.ok(allowed('/api/mobile/ai-study/' + path, method));
  for (const path of [
    '/api/ai-study/reports',
    '/api/mobile/ai-study/config',
    '/api/mobile/ai-study/reports/abc/search/extra',
    '/api/mobile/ai-study/reports/abc/sources/%2f/download',
    '/api/mobile/ai-study/reports/',
  ])
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) assert.equal(allowed(path, method), false);
  for (const query of [{ page: true }, { page: ['1'] }, { pageSize: 21 }, { userId: 'other' }])
    assert.equal(mobileAiReportQuery.safeParse(query).success, false);
  for (const input of [
    { mistakeIds: [] },
    { mistakeIds: ['a', 'a'] },
    { mistakeIds: ['a'], organizationId: 'other' },
    { mistakeIds: ['a'], reflection: 'x'.repeat(2001) },
  ])
    assert.equal(createAiReportInput.safeParse(input).success, false);
});
test('native report text distinguishes no answer from false and only displays valid source citations', () => {
  assert.equal(aiAnswerText(null), '未作答');
  assert.equal(aiAnswerText(false), '错误');
  assert.equal(aiAnswerText(0), '0');
  assert.equal(aiSourceUrl('javascript:alert(1)'), null);
  assert.equal(aiSourceUrl('https://user:pass@example.com/'), null);
  assert.equal(aiSourceUrl('https://example.org/a'), 'https://example.org/a');
  const search = {
    summary: '原文证据与推理',
    citations: [
      { start: 0, end: 4, sourceId: 'a' },
      { start: -1, end: 3, sourceId: 'a' },
      { start: 3, end: 50, sourceId: 'a' },
      { start: 0, end: 4, sourceId: 'b' },
    ],
  } as NonNullable<AiReport['search']>;
  assert.deepEqual(aiCitationText(search, 'a'), ['原文证据']);
});
test('binary metadata keeps legacy bytes behavior, bounded length, bearer-only headers and safe names', async () => {
  const seen: RequestInit[] = [];
  const { c } = client(async (_url, options) => {
    seen.push(options!);
    return file();
  });
  await c.login('student', 'password');
  const raw = await c.request<Uint8Array>('/mobile/ai-study/reports/abc/export?format=md', undefined, 'GET', {
    binary: true,
  });
  assert.deepEqual([...raw], [97, 98, 99]);
  const output = await c.download('/mobile/ai-study/reports/abc/export?format=md', { maxBytes: 100 });
  assert.deepEqual([...output.bytes], [97, 98, 99]);
  assert.equal(output.filename, '复盘.md');
  assert.equal(output.contentType, 'text/markdown');
  assert.equal(seen[1].credentials, 'omit');
  assert.equal(seen[1].redirect, 'error');
  assert.equal((seen[1].headers as Record<string, string>).authorization, 'Bearer ' + session.accessToken);
  await assert.rejects(c.download('/mobile/ai-study/reports/abc/export?format=md', { maxBytes: 2 }));
  assert.throws(() => c.download('/mobile/ai-study/reports/abc/export', { maxBytes: -1 }));
  for (const header of [
    'attachment; filename="../../private.md"',
    "attachment; filename*=UTF-8''..%2Fsecret%00.md",
    'attachment; filename=".."',
  ])
    assert.ok(
      !/[\/\\\0]/.test(mobileDownloadFilename(header)) && !mobileDownloadFilename(header).startsWith('.'),
    );
});
test('truncated downloads and missing lengths cannot be treated as successful files', async () => {
  for (const headers of [
    { 'content-length': '9' },
    { 'content-length': '-1' },
    { 'content-length': '52428801' },
  ]) {
    const { c } = client(async () => file('abc', headers));
    await c.login('s', 'p');
    await assert.rejects(c.download('/mobile/ai-study/reports/x/export'));
  }
  const { c } = client(async () => new Response('abc'));
  await c.login('s', 'p');
  await assert.rejects(c.download('/mobile/ai-study/reports/x/export'));
});
test('binary requests still clear expired sessions and reject a response after logout', async () => {
  const first = client(
    async () => new Response(JSON.stringify({ error: { message: 'expired' } }), { status: 401 }),
  );
  await first.c.login('s', 'p');
  let cleared = 0;
  first.c.onSessionInvalidated(() => {
    cleared++;
  });
  await assert.rejects(first.c.download('/mobile/ai-study/reports/x/export'));
  assert.equal(first.saved(), null);
  assert.equal(cleared, 1);
  let release!: (value: Response) => void;
  const pending = new Promise<Response>((r) => {
    release = r;
  });
  const second = client(async () => pending);
  await second.c.login('s', 'p');
  const download = second.c.download('/mobile/ai-study/reports/x/export');
  await second.c.clear();
  release(file());
  await assert.rejects(download, (e) => (e as { status: number }).status === 409);
});
