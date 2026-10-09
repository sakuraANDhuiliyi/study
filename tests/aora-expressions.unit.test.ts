import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { creativeItems } from '../apps/api/src/programming/creative.catalog';
import { parseProgrammingBackup } from '../apps/api/src/programming/programming.backup';
import { ProgrammingGateway } from '../apps/api/src/programming/programming.gateway';
import type { AiGateway } from '../apps/api/src/ai-study/ai.gateway';
import type { ProgrammingGenerationInput } from '../apps/api/src/programming/programming.schemas';

const upstreamHashes = {
  'vendor/rings.js': '7fd196046650b8273d87c9b85a899554d90f35c62d676eea1c681630e721ec20',
  'vendor/emotions.js': 'c938eb9601ba4b37c67e78fa0e4c1294d1882b498111600b83a8ebfe2aeb8d77',
  'vendor/ball.js': '4d7928b66e19da61f0aceaa161d6b2e1c7a83bb49c83cd449e80844deb70a587',
  'vendor/engine.js': '6c48deb09e097f50655b546c84b5bda066a741520d8e5e2c064c6a7e813b1756',
  'LICENSE.txt': 'cd25a8e1b00d05b2bb29d3a626599526db960b5bf3ba94fd726565b9bec7f8ea',
  'NOTICE.md': '549d6607c9dd13c9add2fa5faeccca488bd78cf30cac2b0b4d3dbcd8b45b721d',
};

test('Aora ships the exact reviewed engine and original restricted license, with no MIT substitution', () => {
  const item = creativeItems.find((item) => item.id === 'aora-expression-lab');
  assert.ok(item);
  assert.equal(item.source.repository, 'https://github.com/sam70361/aora-bot');
  assert.equal(item.source.commit, 'e3b6148c818da4a8e1966f2bc89cdb3cee473b73');
  assert.equal(item.source.license, 'Emotion Ball Community License');
  const notice = item.files.find((file) => file.path === 'NOTICE.txt')!.content;
  for (const [path, hash] of Object.entries(upstreamHashes)) {
    const file = item.files.find((file) => file.path === path);
    assert.ok(file, path);
    assert.equal(createHash('sha256').update(file.content).digest('hex'), hash, path);
    if (path.endsWith('.txt') || path === 'NOTICE.md') assert.ok(notice.includes(file.content), path);
    if (path.endsWith('.js')) {
      assert.doesNotMatch(
        file.content,
        /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\blocalStorage\b|\bdocument\.cookie\b|\beval\s*\(/,
      );
    }
  }
});

test('Aora JSON backup round trips retain source and reject removed or edited aggregate notices', () => {
  const item = creativeItems.find((item) => item.id === 'aora-expression-lab')!;
  const bundle = {
    format: 'zhixue-programming',
    version: 1,
    title: item.title,
    templateId: `creative:${item.id}`,
    files: item.files,
  };
  assert.deepEqual(parseProgrammingBackup(bundle), bundle);
  for (const files of [
    item.files.filter((file) => file.path !== 'NOTICE.txt'),
    item.files.map((file) => (file.path === 'NOTICE.txt' ? { ...file, content: 'MIT License' } : file)),
  ])
    assert.throws(() => parseProgrammingBackup({ ...bundle, files }));
});

test('Aora UI generation keeps current engine and license bytes without sending them or trusting model replacements', async () => {
  const item = creativeItems.find((item) => item.id === 'aora-expression-lab')!;
  const files = item.files.map((file) =>
    file.path === 'vendor/engine.js'
      ? { ...file, content: file.content + '\n// Student local engine experiment\n' }
      : file,
  );
  const retained = files.filter(
    (file) => !['README.md', 'app.js', 'index.html', 'style.css'].includes(file.path),
  );
  const gateway = new ProgrammingGateway({
    completeJson: async (instructions: string, request: ProgrammingGenerationInput) => {
      assert.match(instructions, /最多 16 个/);
      assert.deepEqual(request.files.map((file) => file.path).sort(), [
        'README.md',
        'app.js',
        'index.html',
        'style.css',
      ]);
      for (const file of retained)
        assert.ok(!JSON.stringify(request).includes(JSON.stringify(file.content).slice(1, -1)));
      return {
        summary: '改变布局',
        plan: ['调整结构'],
        teaching: ['引擎与界面分层'],
        files: [
          { path: 'index.html', content: '<h1>Updated layout</h1>' },
          { path: 'vendor/ENGINE.js', content: '/* untrusted replacement */' },
          { path: 'LICENSE.txt', content: 'MIT License' },
          { path: 'NOTICE.md', content: 'Removed restriction' },
          { path: 'NOTICE.txt', content: 'Removed attribution' },
        ],
      };
    },
  } as unknown as AiGateway);
  const output = await gateway.generate({ title: item.title, prompt: '改变布局', files });
  assert.equal(output.files[0].content, '<h1>Updated layout</h1>');
  for (const file of retained)
    assert.deepEqual(
      output.files.find((candidate) => candidate.path === file.path),
      file,
    );
  assert.equal(output.files.length, retained.length + 1);
});

test('catalog preservation leaves custom helpers editable and neither revives missing engines nor locks ordinary vendor files', async () => {
  const item = creativeItems.find((item) => item.id === 'aora-expression-lab')!;
  const files = [
    ...item.files.filter((file) => file.path !== 'vendor/ball.js'),
    { path: 'vendor/student-helper.js', content: 'const studentHelper = 1;' },
  ];
  const gateway = new ProgrammingGateway({
    completeJson: async (_instructions: string, request: ProgrammingGenerationInput) => {
      assert.ok(request.files.some((file) => file.path === 'vendor/student-helper.js'));
      assert.ok(!request.files.some((file) => file.path === 'vendor/engine.js'));
      return {
        summary: '编辑辅助函数',
        plan: ['保留本地依赖'],
        teaching: ['独立辅助模块'],
        files: request.files,
      };
    },
  } as unknown as AiGateway);
  const output = await gateway.generate({ title: item.title, prompt: '保留界面', files });
  assert.ok(!output.files.some((file) => file.path === 'vendor/ball.js'));
  assert.ok(output.files.some((file) => file.path === 'vendor/student-helper.js'));
  for (const notice of [undefined, 'Independent project notice']) {
    const ordinary = new ProgrammingGateway({
      completeJson: async (_instructions: string, request: ProgrammingGenerationInput) => {
        assert.ok(request.files.some((file) => file.path === 'vendor/engine.js'));
        return { summary: '编辑自有引擎', plan: ['修改'], teaching: ['自有源码'], files: request.files };
      },
    } as unknown as AiGateway);
    await ordinary.generate({
      title: 'Independent project',
      prompt: '修改引擎',
      files: [
        { path: 'index.html', content: '<h1>Independent</h1>' },
        { path: 'vendor/engine.js', content: 'const ownEngine = true;' },
        ...(notice ? [{ path: 'NOTICE.txt', content: notice }] : []),
      ],
    });
  }
});

test('Aora candidates that exceed the complete project budget after reattaching libraries are rejected', async () => {
  const item = creativeItems.find((item) => item.id === 'aora-expression-lab')!;
  for (const files of [
    [
      { path: 'index.html', content: '<h1>UI</h1>' },
      ...Array.from({ length: 16 }, (_, index) => ({ path: `part-${index}.js`, content: '/* part */' })),
    ],
    [
      { path: 'index.html', content: '<h1>UI</h1>' },
      { path: 'large-1.txt', content: 'a'.repeat(65536) },
      { path: 'large-2.txt', content: 'b'.repeat(65536) },
    ],
  ]) {
    const gateway = new ProgrammingGateway({
      completeJson: async () => ({ summary: '布局', plan: ['更新'], teaching: ['容量'], files }),
    } as unknown as AiGateway);
    await assert.rejects(gateway.generate({ title: item.title, prompt: '修改布局', files: item.files }));
  }
});
