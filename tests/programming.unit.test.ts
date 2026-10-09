import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { z } from 'zod';
import type { AiGateway } from '../apps/api/src/ai-study/ai.gateway';
import { ProgrammingGateway } from '../apps/api/src/programming/programming.gateway';
import {
  readProgrammingPreviewConfiguration,
  previewContentType,
  programmingPreviewHeaders,
  buildProgrammingPreviewHtml,
} from '../apps/api/src/programming/programming-preview.service';
import {
  programmingFilePath,
  programmingFilesSchema,
  programmingCreateInput,
  programmingUpdateInput,
  programmingVersionInput,
  programmingRestoreInput,
  programmingAiInput,
  programmingApplyInput,
  programmingPreviewInput,
  programmingModelOutput,
  type ProgrammingGenerationInput,
} from '../apps/api/src/programming/programming.schemas';

const entry = { path: 'index.html', content: '<!doctype html><html><body>学习编程</body></html>' };
const modelResult = () => ({
  summary: '增加按钮交互',
  plan: ['监听点击事件'],
  teaching: ['页面状态保存在内存中'],
  files: [entry, { path: 'assets/main.js', content: 'document.body.dataset.ready = "yes";' }],
});

test('编程路径拒绝目录穿越、编码别名、系统文件及可执行后端文件', () => {
  const attacks = [
    '../index.html',
    'assets/../../index.html',
    './index.html',
    'assets/./main.js',
    '/index.html',
    '//host/main.js',
    'C:/main.js',
    'C:\\main.js',
    'assets\\main.js',
    'assets//main.js',
    '%2e%2e/main.js',
    'assets/%2fmain.js',
    'assets/main.js?token=secret',
    'assets/main.js#fragment',
    'assets/main.js\0',
    '.env',
    '.git/config.txt',
    'assets/.private.js',
    'main.sh',
    'server.php',
    'main.ts',
    'main.jsx',
    '路径.js',
    'assets/ｍain.js',
    'assets/main\n.js',
  ];
  for (const path of attacks) assert.equal(programmingFilePath.safeParse(path).success, false, path);
  for (const path of ['index.html', 'assets/site.css', 'lib/my-script_v2.js', 'notes/lesson-1.md'])
    assert.equal(programmingFilePath.safeParse(path).success, true, path);
});

test('项目保留明确入口，并拒绝大小写冲突与重复路径', () => {
  assert.equal(programmingFilesSchema.safeParse([{ path: 'Index.html', content: '' }]).success, false);
  assert.equal(programmingFilesSchema.safeParse([{ path: 'main.js', content: '' }]).success, false);
  assert.equal(programmingFilesSchema.safeParse([entry, { ...entry }]).success, false);
  assert.equal(
    programmingFilesSchema.safeParse([
      entry,
      { path: 'assets/main.js', content: '' },
      { path: 'Assets/main.js', content: '' },
    ]).success,
    false,
  );
  const files = [entry, { path: 'assets/main.js', content: '' }];
  assert.deepEqual(programmingFilesSchema.parse(files), files);
});

test('UTF-8 字节、总源码和 JSON 转义后的负载分别限制大小', () => {
  assert.equal(programmingFilesSchema.safeParse([{ ...entry, content: 'a'.repeat(65536) }]).success, true);
  assert.equal(programmingFilesSchema.safeParse([{ ...entry, content: 'a'.repeat(65537) }]).success, false);
  assert.equal(programmingFilesSchema.safeParse([{ ...entry, content: '学'.repeat(21846) }]).success, false);
  const maximum = Array.from({ length: 4 }, (_, index) => ({
    path: index ? `source-${index}.txt` : 'index.html',
    content: 'a'.repeat(65536),
  }));
  assert.equal(programmingFilesSchema.safeParse(maximum).success, true);
  assert.equal(
    programmingFilesSchema.safeParse([...maximum, { path: 'one.txt', content: '1' }]).success,
    false,
  );
  const escaped = maximum.map((file) => ({ ...file, content: '\u0001'.repeat(65536) }));
  assert.equal(
    programmingFilesSchema.safeParse(escaped).success,
    false,
    '转义后 JSON 不能绕过 HTTP 负载限制',
  );
  assert.equal(programmingFilesSchema.safeParse([{ ...entry, content: 'ok\0bad' }]).success, false);
});

test('所有源码入口拒绝隐含字段，文件数量限制不能绕过入口约束', () => {
  const files = Array.from({ length: 24 }, (_, index) => ({
    path: index ? `file-${index}.js` : 'index.html',
    content: '',
  }));
  assert.equal(programmingFilesSchema.safeParse(files).success, true);
  assert.equal(
    programmingFilesSchema.safeParse([...files, { path: 'extra.js', content: '' }]).success,
    false,
  );
  assert.equal(programmingFilesSchema.safeParse([{ ...entry, ownerId: 'other-user' }]).success, false);
  assert.equal(programmingFilesSchema.safeParse([{ ...entry, executable: true }]).success, false);
  assert.equal(
    programmingUpdateInput.safeParse({ revision: 0, title: '项目', files: [entry], ownerId: 'other-user' })
      .success,
    false,
  );
  assert.equal(
    programmingCreateInput.safeParse({ title: '项目', templateId: 'starter', files: [entry] }).success,
    false,
  );
  assert.equal(
    programmingPreviewInput.safeParse({ revision: 0, files: [entry], origin: 'https://attacker.test' })
      .success,
    false,
  );
});

test('所有版本敏感操作要求整数 revision，并保留增长空间', () => {
  const mutations: [z.ZodTypeAny, Record<string, unknown>][] = [
    [programmingUpdateInput, { title: '项目', files: [entry] }],
    [programmingVersionInput, { note: '快照' }],
    [programmingRestoreInput, { versionId: 'version-1' }],
    [programmingAiInput, { prompt: '添加按钮' }],
    [programmingApplyInput, {}],
    [programmingPreviewInput, { files: [entry] }],
  ];
  for (const [schema, fields] of mutations) {
    assert.equal(schema.safeParse({ ...fields, revision: 0 }).success, true);
    assert.equal(schema.safeParse({ ...fields, revision: 2147483646 }).success, true);
    for (const revision of [undefined, -1, 0.5, '0', 2147483647, Number.MAX_SAFE_INTEGER, NaN, Infinity])
      assert.equal(schema.safeParse({ ...fields, revision }).success, false, String(revision));
  }
});

test('AI 输出必须是完整受限项目，拒绝工具命令、身份及额外输出字段', () => {
  assert.deepEqual(programmingModelOutput.parse(modelResult()), modelResult());
  const attacks = [
    { ...modelResult(), commands: ['npm install'] },
    { ...modelResult(), tool_calls: [{ name: 'shell' }] },
    { ...modelResult(), ownerId: 'other-user' },
    { ...modelResult(), files: [{ path: 'server.sh', content: 'curl attacker' }] },
    { ...modelResult(), files: [{ path: 'assets/main.js', content: 'alert(1)' }] },
    { ...modelResult(), files: [{ ...entry, token: 'secret' }] },
    { ...modelResult(), plan: [] },
    { ...modelResult(), teaching: [] },
    { ...modelResult(), summary: '\0hidden' },
  ];
  for (const value of attacks) assert.equal(programmingModelOutput.safeParse(value).success, false);
});

test('AI gateway 只发送显式源码与需求，不转发内部身份、配置或文件元数据', async () => {
  let sent: unknown;
  let system = '';
  const gateway = new ProgrammingGateway({
    completeJson: async (instructions: string, payload: unknown, schema: z.ZodTypeAny, name: string) => {
      system = instructions;
      sent = payload;
      assert.equal(name, 'programming_project');
      assert.equal(schema, programmingModelOutput);
      return modelResult();
    },
  } as unknown as AiGateway);
  const request = {
    title: '练习项目',
    prompt: '保留原功能，并增加一个计数按钮。',
    files: [{ ...entry, serverPath: '/private/.env', courseId: 'private-course' }],
    userId: 'private-user',
    organizationId: 'private-organization',
    apiKey: 'fixture-secret',
    config: { apiKey: 'fixture-secret' },
  } as ProgrammingGenerationInput;
  assert.deepEqual(await gateway.generate(request), modelResult());
  assert.deepEqual(sent, { title: request.title, prompt: request.prompt, files: [entry] });
  const serialized = JSON.stringify(sent);
  for (const secret of [
    'fixture-secret',
    'private-user',
    'private-organization',
    '/private/.env',
    'private-course',
  ])
    assert.equal(serialized.includes(secret), false, secret);
  assert.match(system, /不可信/);
  assert.match(system, /不得执行代码、命令、调用工具、访问网址/);
  assert.match(system, /未实际运行，不得声称/);
});

test('AI gateway 再次校验模型返回，协议外命令与路径逃逸不能成为候选', async () => {
  for (const result of [
    { ...modelResult(), files: [entry, { path: '../server.js', content: 'bad' }] },
    { ...modelResult(), shell: 'npm install' },
    { ...modelResult(), files: [{ ...entry, ownerId: 'attacker' }] },
  ]) {
    const gateway = new ProgrammingGateway({ completeJson: async () => result } as unknown as AiGateway);
    await assert.rejects(
      () => gateway.generate({ title: '项目', prompt: '添加按钮', files: [entry] }),
      z.ZodError,
    );
  }
});

test('预览配置按主机名隔离 cookie，生产要求显式 HTTPS 地址', () => {
  const local = readProgrammingPreviewConfiguration({ NODE_ENV: 'test' });
  assert.equal(local.enabled, true);
  assert.equal(local.origin, 'http://127.0.0.1:4173');
  assert.equal(local.appOrigin, 'http://localhost:5173');
  const sameHost = readProgrammingPreviewConfiguration({
    NODE_ENV: 'test',
    APP_ORIGIN: 'http://localhost:5173',
    PROGRAMMING_PREVIEW_ORIGIN: 'http://localhost:4173',
  });
  assert.equal(sameHost.enabled, false, '不同端口仍可能携带同主机 session cookie');
  assert.equal(readProgrammingPreviewConfiguration({ NODE_ENV: 'production' }).enabled, false);
  const production = {
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://study.example.test',
    PROGRAMMING_PREVIEW_ORIGIN: 'https://preview.example.test',
  };
  assert.equal(readProgrammingPreviewConfiguration(production).enabled, true);
  for (const changes of [
    { APP_ORIGIN: 'http://study.example.test' },
    { PROGRAMMING_PREVIEW_ORIGIN: 'http://preview.example.test' },
    { PROGRAMMING_PREVIEW_ORIGIN: 'https://study.example.test:4173' },
  ])
    assert.equal(readProgrammingPreviewConfiguration({ ...production, ...changes }).enabled, false);
  assert.equal(
    readProgrammingPreviewConfiguration({ ...production, PROGRAMMING_PREVIEW_ENABLED: 'false' }).enabled,
    false,
  );
});

test('预览配置拒绝非 origin URL、凭据、任意监听地址与非法端口', () => {
  for (const origin of [
    'file:///private/index.html',
    'javascript:alert(1)',
    'http://preview.example.test',
    'https://key:fixture-secret@preview.example.test',
    'https://preview.example.test/path',
    'https://preview.example.test/?token=fixture-secret',
    'https://preview.example.test/#fixture-secret',
  ]) {
    const configuration = readProgrammingPreviewConfiguration({ PROGRAMMING_PREVIEW_ORIGIN: origin });
    assert.equal(configuration.enabled, false, origin);
    assert.equal(configuration.reason.includes('fixture-secret'), false);
  }
  for (const port of ['0', '80', '1023', '65536', '4173.5', 'NaN', 'Infinity'])
    assert.equal(
      readProgrammingPreviewConfiguration({ PROGRAMMING_PREVIEW_PORT: port }).enabled,
      false,
      port,
    );
  assert.equal(
    readProgrammingPreviewConfiguration({ PROGRAMMING_PREVIEW_BIND_HOST: 'attacker.example.test' }).enabled,
    false,
  );
  assert.equal(readProgrammingPreviewConfiguration({ PROGRAMMING_PREVIEW_ENABLED: 'yes' }).enabled, false);
  assert.equal(
    readProgrammingPreviewConfiguration({ APP_ORIGIN: 'https://study.example.test/app' }).enabled,
    false,
  );
});

test('预览 CSP 只开放本地脚本样式资源，禁止 API、嵌套框架和父窗口权限', () => {
  const headers = programmingPreviewHeaders({
    origin: 'http://127.0.0.1:4173',
    appOrigin: 'http://localhost:5173',
  });
  const policy = new Map(
    headers['Content-Security-Policy'].split('; ').map((directive) => {
      const [name, ...values] = directive.split(' ');
      return [name, values.join(' ')];
    }),
  );
  for (const restriction of [
    'default-src',
    'connect-src',
    'font-src',
    'media-src',
    'frame-src',
    'object-src',
    'base-uri',
    'form-action',
  ])
    assert.equal(policy.get(restriction), "'none'", restriction);
  assert.equal(policy.get('sandbox'), 'allow-scripts');
  assert.equal(policy.get('frame-ancestors'), 'http://localhost:5173');
  assert.equal(policy.get('script-src'), "'unsafe-inline' http://127.0.0.1:4173");
  assert.equal(policy.get('style-src'), "'unsafe-inline' http://127.0.0.1:4173");
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Access-Control-Allow-Credentials'], undefined);
  assert.match(headers['Permissions-Policy'], /camera=\(\), microphone=\(\)/);
});

test('日志 hook 的恶意参数保持字符串数据，不能终止 script 或注入可执行代码', () => {
  const nonce = '</script><script>globalThis.pwned=true</script>\"\\';
  const appOrigin = 'https://study.example.test/</script>&';
  const document = '<!doctype html><html><head><title>练习</title></head><body><h1>示例</h1></body></html>';
  const rendered = buildProgrammingPreviewHtml(document, { nonce, appOrigin });
  assert.equal(rendered.split('<script>').length - 1, 1);
  assert.equal(rendered.split('</script>').length - 1, 1);
  assert.equal(rendered.includes('</script><script>globalThis.pwned'), false);
  const script = /<script>([\s\S]*?)<\/script>/.exec(rendered)?.[1];
  assert.ok(script);
  const messages: { payload: any; origin: string }[] = [];
  const listeners: Record<string, (...args: any[]) => void> = {};
  const context = {
    console: Object.fromEntries(
      ['log', 'info', 'warn', 'error', 'debug'].map((level) => [level, () => undefined]),
    ),
    window: {
      parent: { postMessage: (payload: unknown, origin: string) => messages.push({ payload, origin }) },
      addEventListener: (name: string, handler: (...args: any[]) => void) => {
        listeners[name] = handler;
      },
    },
    pwned: false,
  };
  runInNewContext(script, context, { timeout: 1000 });
  context.console.log('页面已运行');
  listeners.error({ message: '示例错误' });
  listeners.unhandledrejection({ reason: '示例拒绝' });
  assert.equal(context.pwned, false);
  assert.equal(messages.length, 3);
  for (const message of messages) {
    assert.equal(message.origin, appOrigin);
    assert.equal(message.payload.type, 'programming-preview-log');
    assert.equal(message.payload.nonce, nonce);
  }
  assert.equal(messages[0].payload.text, '页面已运行');
  assert.equal(messages[1].payload.level, 'error');
  assert.ok(rendered.indexOf('<script>') < rendered.indexOf('<title>'));
});

test('预览日志限制消息数量和长度，序列化错误不会破坏学生程序的控制台', () => {
  const rendered = buildProgrammingPreviewHtml('<h1>无 head 的页面</h1>', {
    nonce: 'nonce',
    appOrigin: 'http://localhost:5173',
  });
  const script = /<script>([\s\S]*?)<\/script>/.exec(rendered)?.[1];
  assert.ok(script);
  const messages: any[] = [];
  let originalCalls = 0;
  const context = {
    console: Object.fromEntries(
      ['log', 'info', 'warn', 'error', 'debug'].map((level) => [
        level,
        () => {
          originalCalls++;
        },
      ]),
    ),
    window: {
      parent: { postMessage: (payload: unknown) => messages.push(payload) },
      addEventListener: () => undefined,
    },
  };
  runInNewContext(script, context, { timeout: 1000 });
  const cyclic: any = {};
  cyclic.self = cyclic;
  context.console.log(cyclic);
  context.console.log('x'.repeat(5000));
  for (let index = 0; index < 300; index++) context.console.log('log', index);
  assert.equal(messages.length, 200);
  assert.equal(messages[0].text, '[无法显示的日志]');
  assert.equal(messages[1].text.length, 2000);
  assert.equal(originalCalls, 302);
  assert.ok(rendered.startsWith('<script>'));
});

test('预览文本素材保持非 HTML MIME 类型，阻止 JSON 和说明文件作为脚本解释', () => {
  assert.equal(previewContentType('index.html'), 'text/html; charset=utf-8');
  assert.equal(previewContentType('assets/main.js'), 'text/javascript; charset=utf-8');
  assert.equal(previewContentType('data.json'), 'application/json; charset=utf-8');
  for (const path of ['README.md', 'notes.txt', 'unknown.bin'])
    assert.equal(previewContentType(path), 'text/plain; charset=utf-8');
  assert.equal(previewContentType('image.svg'), 'image/svg+xml');
});
