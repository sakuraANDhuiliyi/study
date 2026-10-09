import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creativeFavoriteInput,
  creativeListQuery,
  creativeProjectInput,
  creativeRevisionInput,
} from '../apps/api/src/programming/creative.schemas';
import { ProgrammingGateway } from '../apps/api/src/programming/programming.gateway';
import type { AiGateway } from '../apps/api/src/ai-study/ai.gateway';
const sourceNotice = 'Complete original copyright notice and permission text.\nKeep this byte for byte.';
const original = [
  { path: 'index.html', content: '<html><body>UI study</body></html>' },
  { path: 'NOTICE.txt', content: sourceNotice },
];
const response = (files: unknown[]) => ({
  summary: 'UI说明',
  plan: ['显示说明'],
  teaching: ['保留归属'],
  files,
});
test('creative mutation schemas accept only reviewed SHA256 revision and explicit bounded title', () => {
  assert.deepEqual(creativeProjectInput.parse({ title: '  My UI  ', revision: 'a'.repeat(64) }), {
    title: 'My UI',
    revision: 'a'.repeat(64),
  });
  for (const revision of ['a'.repeat(40), 'A'.repeat(64), '0'.repeat(63), '../index', null])
    assert.equal(creativeRevisionInput.safeParse({ revision }).success, false);
  for (const extra of [
    { files: original },
    { organizationId: 'foreign' },
    { templateId: 'starter' },
    { sourceRepository: 'https://evil.invalid' },
  ])
    assert.equal(
      creativeProjectInput.safeParse({ title: 'UI', revision: 'a'.repeat(64), ...extra }).success,
      false,
    );
  assert.equal(creativeProjectInput.safeParse({ title: '\0x', revision: 'a'.repeat(64) }).success, false);
});
test('creative list/favorite schemas bound query sizes and reject source/identity spoofing', () => {
  assert.deepEqual(creativeListQuery.parse({}), {
    q: '',
    category: '',
    collection: 'all',
    edition: 'all',
    page: 1,
    pageSize: 12,
  });
  for (const query of [
    { pageSize: 25 },
    { page: 0 },
    { collection: 'other' },
    { q: 'x'.repeat(101) },
    { category: 'x'.repeat(65) },
    { userId: 'another' },
  ])
    assert.equal(creativeListQuery.safeParse(query).success, false);
  assert.equal(creativeFavoriteInput.safeParse({ saved: 'true' }).success, false);
  assert.equal(creativeFavoriteInput.safeParse({ saved: true, organizationId: 'foreign' }).success, false);
});
test('programming gateway withholds full NOTICE and restores it after model attempts alternate-case replacement', async () => {
  let request: any,
    system = '';
  const gateway = new ProgrammingGateway({
    completeJson: async (s: string, input: unknown) => {
      system = s;
      request = input;
      return response([
        { path: 'index.html', content: '<html>candidate</html>' },
        { path: 'Notice.txt', content: 'DELETE UPSTREAM COPYRIGHT' },
      ]);
    },
  } as unknown as AiGateway);
  const result = await gateway.generate({
    title: 'UI project',
    prompt: 'retain learning design',
    files: original,
  });
  assert.deepEqual(request.files, [original[0]]);
  assert.ok(!JSON.stringify(request).includes(sourceNotice));
  assert.ok(system.includes('最多 23 个'));
  assert.deepEqual(result.files, [{ path: 'index.html', content: '<html>candidate</html>' }, original[1]]);
  assert.equal(original[1].content, sourceNotice);
});
test('programming gateway rejects malicious paths before preserving any notice', async () => {
  const gateway = new ProgrammingGateway({
    completeJson: async () =>
      response([
        { path: 'index.html', content: 'valid' },
        { path: '../NOTICE.txt', content: 'escape' },
      ]),
  } as unknown as AiGateway);
  await assert.rejects(gateway.generate({ title: 'UI', prompt: 'bad files', files: original }));
});
test('programming gateway rechecks project capacity after original attribution is reattached', async () => {
  const files = Array.from({ length: 24 }, (_, i) => ({
    path: i ? 'ui-' + i + '.txt' : 'index.html',
    content: 'local file',
  }));
  const gateway = new ProgrammingGateway({
    completeJson: async () => response(files),
  } as unknown as AiGateway);
  await assert.rejects(
    gateway.generate({ title: 'UI', prompt: '24 files with source notice', files: original }),
  );
});
test('programming gateway normal projects keep complete 24-file capacity without provenance injection', async () => {
  const files = Array.from({ length: 24 }, (_, i) => ({
    path: i ? 'ui-' + i + '.txt' : 'index.html',
    content: 'local file',
  }));
  const gateway = new ProgrammingGateway({
    completeJson: async () => response(files),
  } as unknown as AiGateway);
  const result = await gateway.generate({
    title: 'Original UI',
    prompt: 'local template',
    files: [original[0]],
  });
  assert.equal(result.files.length, 24);
  assert.ok(!result.files.some((f) => f.path === 'NOTICE.txt'));
});
