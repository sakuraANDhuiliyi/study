import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mobileProgrammingRouteAllowed,
  mobileProgrammingQuery,
  mobileCreativeQuery,
} from '../apps/api/src/mobile/mobile-programming.policy';
import {
  parseProjectBackup,
  sourceBytes,
  validateProjectFiles,
  programmingApi,
} from '../apps/mobile/src/programming-model';
import { programmingUpdateInput } from '../apps/api/src/programming/programming.schemas';
import type { MobileClient } from '../apps/mobile/src/client';

test('native programming exposes explicit file-project routes without execution, previews or device-agent access', () => {
  for (const [path, method] of [
    ['status', 'GET'],
    ['templates', 'GET'],
    ['projects', 'GET'],
    ['projects', 'POST'],
    ['projects/import', 'POST'],
    ['projects/p1', 'PATCH'],
    ['projects/p1', 'DELETE'],
    ['projects/p1/backup', 'GET'],
    ['projects/p1/export', 'GET'],
    ['projects/p1/versions/v1', 'GET'],
    ['projects/p1/restore', 'POST'],
    ['projects/p1/ai-drafts/d1', 'GET'],
    ['projects/p1/ai-drafts/d1/apply', 'POST'],
    ['creative', 'GET'],
    ['creative/idea/favorite', 'PUT'],
    ['creative/idea/projects', 'POST'],
    ['creative/idea/export', 'GET'],
  ])
    assert.equal(mobileProgrammingRouteAllowed('/api/mobile/programming/' + path, method), true);
  for (const [path, method] of [
    ['projects/p1/preview', 'POST'],
    ['creative/idea/preview', 'POST'],
    ['projects/p1/execute', 'POST'],
    ['projects/p1/export/other', 'GET'],
    ['projects/p1/backup/other', 'GET'],
    ['projects/p1/versions/v1', 'DELETE'],
    ['android-agent/status', 'GET'],
    ['projects/%2e%2e', 'GET'],
  ])
    assert.equal(mobileProgrammingRouteAllowed('/api/mobile/programming/' + path, method), false);
});
test('native pagination rejects duplicate values, booleans, unknown scope and unbounded requests', () => {
  assert.deepEqual(mobileProgrammingQuery.parse({ page: '2', pageSize: '12' }), { page: 2, pageSize: 12 });
  for (const query of [{ page: true }, { page: ['1', '2'] }, { pageSize: 21 }, { organizationId: 'foreign' }])
    assert.equal(mobileProgrammingQuery.safeParse(query).success, false);
  assert.equal(
    mobileCreativeQuery.safeParse({ collection: 'saved', q: '空间', pageSize: '24' }).success,
    true,
  );
  assert.equal(mobileCreativeQuery.safeParse({ collection: 'saved', userId: 'other' }).success, false);
});
test('native UTF-8 source limits agree for ASCII, Chinese, astral and lone surrogate input', () => {
  for (const value of ['abc', '学习', '🌱', '\ud800', '学🌱a'.repeat(100)])
    assert.equal(sourceBytes(value), Buffer.byteLength(value));
  assert.doesNotThrow(() => validateProjectFiles([{ path: 'index.html', content: '学'.repeat(21845) }]));
  for (const files of [
    [{ path: 'index.html', content: '学'.repeat(21846) }],
    [{ path: '../index.html', content: '' }],
    [
      { path: 'index.html', content: '' },
      { path: 'INDEX.HTML', content: '' },
    ],
    [{ path: 'index.html', content: '\0' }],
    [],
  ])
    assert.throws(() => validateProjectFiles(files));
  assert.throws(() => validateProjectFiles([null] as any));
});
test('portable backup parser preserves source bytes and rejects authority/history metadata', () => {
  const bundle = {
    format: 'zhixue-programming',
    version: 1,
    title: 'Project',
    templateId: 'starter',
    files: [{ path: 'index.html', content: '<script>literal_only()</script>\n' }],
  };
  assert.deepEqual(parseProjectBackup(bundle), bundle);
  for (const patch of [
    { userId: 'other' },
    { revision: 10 },
    { format: 'zip' },
    { version: 2 },
    { files: [{ path: 'index.html', content: 'x'.repeat(65537) }] },
  ])
    assert.throws(() => parseProjectBackup({ ...bundle, ...patch }));
  assert.equal(
    programmingUpdateInput.safeParse({
      revision: 0,
      title: 'Project',
      files: bundle.files,
      templateId: 'imported',
    }).success,
    false,
  );
});
test('native save and reviewed AI application carry the captured revision and only the selected source', async () => {
  const calls: unknown[] = [];
  const client = {
    request: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve({});
    },
  } as unknown as MobileClient;
  await programmingApi.save(client, {
    id: 'project/one',
    revision: 7,
    title: ' Name ',
    files: [{ path: 'index.html', content: 'literal' }],
  });
  await programmingApi.apply(client, 'p1', 'draft/one', 7);
  await programmingApi.restore(client, 'p1', 7, 'version1');
  assert.deepEqual(calls, [
    [
      '/mobile/programming/projects/project%2Fone',
      { revision: 7, title: 'Name', files: [{ path: 'index.html', content: 'literal' }] },
      'PATCH',
    ],
    ['/mobile/programming/projects/p1/ai-drafts/draft%2Fone/apply', { revision: 7 }, 'POST'],
    ['/mobile/programming/projects/p1/restore', { revision: 7, versionId: 'version1' }, 'POST'],
  ]);
});
