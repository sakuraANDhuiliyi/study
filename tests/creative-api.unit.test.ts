import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creativeListQuery,
  creativeFavoriteInput,
  creativeProjectInput,
  creativeRevisionInput,
} from '../apps/api/src/programming/creative.schemas';
import { ProgrammingGateway } from '../apps/api/src/programming/programming.gateway';
import type { AiGateway } from '../apps/api/src/ai-study/ai.gateway';

test('creative input schemas keep collection, pagination and source revision bounded and reject actor/file injection', () => {
  assert.deepEqual(creativeListQuery.parse({}), {
    q: '',
    category: '',
    collection: 'all',
    edition: 'all',
    page: 1,
    pageSize: 12,
  });
  for (const query of [
    { page: 0 },
    { pageSize: 25 },
    { q: 'a'.repeat(101) },
    { collection: 'other' },
    { edition: 'unknown' },
    { userId: 'victim' },
    { organizationId: 'foreign' },
  ])
    assert.equal(creativeListQuery.safeParse(query).success, false);
  assert.equal(creativeFavoriteInput.safeParse({ saved: true, userId: 'victim' }).success, false);
  assert.equal(creativeFavoriteInput.safeParse({ saved: 'true' }).success, false);
  assert(creativeRevisionInput.safeParse({ revision: 'a'.repeat(64) }).success);
  for (const input of [
    { revision: 'old' },
    { revision: 'a'.repeat(64), files: [] },
    { revision: 'a'.repeat(64), source: 'https://untrusted.invalid' },
  ])
    assert.equal(creativeRevisionInput.safeParse(input).success, false);
  assert.equal(creativeProjectInput.safeParse({ title: '  ', revision: 'a'.repeat(64) }).success, false);
  assert.equal(
    creativeProjectInput.safeParse({ title: 'UI study', revision: 'a'.repeat(64), templateId: 'other' })
      .success,
    false,
  );
});

test('AI preserves original NOTICE byte-for-byte without asking the model to reproduce copyright text', async () => {
  const notice = 'Copyright (c) Upstream\nPermission notice must remain.\n';
  let received: any;
  const gateway = new ProgrammingGateway({
    completeJson: async (system: string, data: unknown) => {
      received = data;
      assert(system.includes('NOTICE.txt'));
      return {
        summary: '调整颜色',
        plan: ['更新样式'],
        teaching: ['样式与内容分离'],
        files: [
          { path: 'index.html', content: '<h1>Updated UI</h1>' },
          { path: 'notice.txt', content: 'Model attempt to change attribution' },
        ],
      };
    },
  } as unknown as AiGateway);
  const result = await gateway.generate({
    title: 'Licensed UI',
    prompt: '调整颜色',
    files: [
      { path: 'index.html', content: '<h1>Original UI</h1>' },
      { path: 'NOTICE.txt', content: notice },
    ],
  });
  assert.deepEqual(Object.keys(received), ['title', 'prompt', 'files']);
  assert.equal(received.files.length, 1);
  assert(!JSON.stringify(received).includes(notice));
  assert.deepEqual(
    result.files.find((file) => file.path === 'NOTICE.txt'),
    { path: 'NOTICE.txt', content: notice },
  );
  assert.equal(result.files.length, 2);
  assert.equal(result.files[0].content, '<h1>Updated UI</h1>');
});

test('preserved NOTICE still obeys the complete-project file limit; no silent truncation', async () => {
  const candidate = [
    { path: 'index.html', content: '<h1>UI</h1>' },
    ...Array.from({ length: 23 }, (_, index) => ({ path: `part-${index}.js`, content: '/* component */' })),
  ];
  const gateway = new ProgrammingGateway({
    completeJson: async () => ({
      summary: '组件',
      plan: ['组件化'],
      teaching: ['保持入口'],
      files: candidate,
    }),
  } as unknown as AiGateway);
  await assert.rejects(
    gateway.generate({
      title: 'UI',
      prompt: '组件化',
      files: [
        { path: 'index.html', content: '<h1>UI</h1>' },
        { path: 'NOTICE.txt', content: 'License' },
      ],
    }),
  );
});
