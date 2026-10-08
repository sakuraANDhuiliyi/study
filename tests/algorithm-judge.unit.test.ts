import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  JudgeGateway,
  normalizeJudgeOutput,
  type JudgeExecutionRequest,
} from '../apps/api/src/algorithms/judge.gateway';
import { algorithmSubmissionInput } from '../apps/api/src/algorithms/algorithms.schemas';

const token = '12345678-1234-4123-8123-123456789012';
const configDirectory = mkdtempSync(join(tmpdir(), 'judge-fixture-'));
const configPath = join(configDirectory, 'config.yaml');
writeFileSync(configPath, '{}\n');
after(() => rmSync(configDirectory, { recursive: true, force: true }));
const encode = (value: string) => Buffer.from(value).toString('base64');
const request = (changes: Partial<JudgeExecutionRequest> = {}): JudgeExecutionRequest => ({
  language: 'python',
  code: 'print(sum(map(int, input().split())))',
  cases: [{ input: '2 3\n', output: '5\n', hidden: false }],
  timeLimitMs: 1000,
  memoryLimitMb: 128,
  ...changes,
});
const reply = (changes: Record<string, unknown> = {}) => ({
  status: { id: 3, description: 'Accepted' },
  stdout: encode('5\n'),
  stderr: null,
  compile_output: null,
  time: '0.012',
  memory: 1024,
  exit_code: 0,
  exit_signal: null,
  ...changes,
});
async function withEnvironment<T>(env: Record<string, string | undefined>, run: () => Promise<T> | T) {
  env = { AI_CONFIG_PATH: configPath, ALGORITHM_JUDGE_ENABLED: undefined, ...env };
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
async function server<T>(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (url: string) => Promise<T>,
) {
  const app = createServer(handler);
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address() as { port: number };
  try {
    return await withEnvironment(
      {
        NODE_ENV: 'test',
        ALGORITHM_JUDGE_URL: `http://127.0.0.1:${port}`,
        ALGORITHM_JUDGE_TOKEN: 'fixture-private-token',
        ALGORITHM_JUDGE_TIMEOUT_MS: '1000',
        ALGORITHM_JUDGE_POLL_MS: '10',
        ALGORITHM_JUDGE_LANGUAGE_IDS: undefined,
      },
      () => run(`http://127.0.0.1:${port}`),
    );
  } finally {
    app.closeAllConnections();
    await new Promise<void>((resolve, reject) => app.close((error) => (error ? reject(error) : resolve())));
  }
}
function respond(res: ServerResponse, value: unknown) {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString());
}
function fixture(value: unknown) {
  return (req: IncomingMessage, res: ServerResponse) => {
    respond(res, req.method === 'POST' ? { token } : value);
  };
}

test('未配置和无效配置均不可用，公开状态不含端点和凭证', async () => {
  await withEnvironment({ ALGORITHM_JUDGE_URL: undefined }, async () => {
    const gateway = new JudgeGateway();
    assert.equal(gateway.status().available, false);
    assert.deepEqual(
      gateway.status().languages.map((item) => item.id),
      ['cpp', 'python', 'javascript', 'java'],
    );
    assert.equal((await gateway.execute(request())).status, 'system_error');
  });
  for (const url of [
    'http://judge.example.test',
    'https://user:fixture-private-token@judge.example.test',
    'https://judge.example.test?token=fixture-private-token',
    'file:///etc/passwd',
  ]) {
    await withEnvironment({ ALGORITHM_JUDGE_URL: url }, () => {
      const state = new JudgeGateway().status();
      assert.equal(state.available, false);
      assert.doesNotMatch(JSON.stringify(state), /fixture-private-token|judge\.example|etc\/passwd/);
    });
  }
  await withEnvironment({ ALGORITHM_JUDGE_URL: 'http://127.0.0.1:2358', NODE_ENV: 'production' }, () =>
    assert.equal(new JudgeGateway().status().available, false),
  );
});

test('安全异步提交、服务端语言覆盖、Base64及本地比较输出', async () => {
  let captured: any;
  let polls = 0;
  await server(
    (req, res) => {
      assert.equal(req.headers['x-auth-token'], 'fixture-private-token');
      assert.ok(!req.url?.includes('fixture-private-token'));
      if (req.method === 'POST') {
        assert.equal(req.url, '/submissions?base64_encoded=true&wait=false');
        void body(req).then((value) => {
          captured = value;
          respond(res, { token });
        });
      } else {
        assert.match(req.url!, /base64_encoded=true&fields=/);
        respond(res, ++polls === 1 ? { status: { id: 2 } } : reply({ stdout: encode('5 \t\r\n\r\n') }));
      }
    },
    async () =>
      withEnvironment({ ALGORITHM_JUDGE_LANGUAGE_IDS: '{"python":92}' }, async () => {
        const gateway = new JudgeGateway();
        assert.equal(gateway.status().available, true);
        const result = await gateway.execute(request());
        assert.equal(result.status, 'accepted');
        assert.equal(result.passed, 1);
        assert.equal(result.runtimeMs, 12);
        assert.equal(result.memoryKb, 1024);
        assert.equal(result.results[0].index, 1);
        assert.equal(result.results[0].expectedOutput, '5\n');
        assert.equal(Buffer.from(captured.source_code, 'base64').toString(), request().code);
        assert.equal(Buffer.from(captured.stdin, 'base64').toString(), '2 3\n');
        assert.equal(captured.expected_output, undefined);
        assert.equal(captured.language_id, 92);
        assert.equal(captured.enable_network, false);
        assert.equal(captured.cpu_time_limit, 1);
        assert.equal(captured.memory_limit, 128 * 1024);
        assert.equal(captured.max_processes_and_or_threads, 60);
        assert.equal(captured.max_file_size, 1024);
        for (const forbidden of [
          'callback_url',
          'additional_files',
          'compiler_options',
          'command_line_arguments',
        ])
          assert.equal(captured[forbidden], undefined);
      }),
  );
  assert.equal(polls, 2);
});

test('比较仅忽略行尾空格及末尾空行，保留前导与内部空白', () => {
  assert.equal(normalizeJudgeOutput('1 \r\n2\t\r\n\n'), '1\n2');
  assert.notEqual(normalizeJudgeOutput(' 1 2'), normalizeJudgeOutput('1  2'));
});

test('错误答案、编译错误、运行错误、超时、内存错误和自定义运行分别处理', async () => {
  for (const [upstream, expected] of [
    [reply({ stdout: encode('6') }), 'wrong_answer'],
    [
      reply({ status: { id: 6 }, compile_output: encode('main.cpp: missing ;'), exit_code: null }),
      'compile_error',
    ],
    [reply({ status: { id: 11 }, stderr: encode('ValueError'), exit_code: 1 }), 'runtime_error'],
    [reply({ status: { id: 5 }, time: '1.005', exit_code: null }), 'time_limit'],
    [reply({ status: { id: 7 }, memory: 128 * 1024, exit_code: null }), 'memory_limit'],
    [reply({ status: { id: 13 } }), 'system_error'],
    [reply({ status: { id: 14 } }), 'system_error'],
  ] as const) {
    await server(fixture(upstream), async () => {
      const result = await new JudgeGateway().execute(request());
      assert.equal(result.status, expected);
      assert.equal(result.passed, 0);
      if (expected === 'compile_error') assert.equal(result.compileOutput, 'main.cpp: missing ;');
    });
  }
  await server(fixture(reply({ stdout: encode('any output') })), async () => {
    const result = await new JudgeGateway().execute(request({ cases: [{ input: 'custom', hidden: false }] }));
    assert.equal(result.status, 'accepted');
    assert.equal(result.results[0].expectedOutput, undefined);
    assert.equal(result.results[0].stdout, 'any output');
  });
});

test('隐藏用例清除输入、预期输出、stdout、stderr和整个提交的编译诊断', async () => {
  const secret = 'hidden-case-sensitive';
  let issued = 0;
  await server(
    (req, res) => {
      if (req.method === 'POST') {
        issued++;
        respond(res, { token: issued === 1 ? token : '22345678-1234-4123-8123-123456789012' });
      } else {
        respond(
          res,
          reply({ stdout: encode(secret), stderr: encode(secret), compile_output: encode(secret) }),
        );
      }
    },
    async () => {
      const result = await new JudgeGateway().execute(
        request({
          cases: [
            { input: secret, output: secret, hidden: true },
            { input: secret, output: secret, hidden: true },
          ],
        }),
      );
      assert.equal(result.status, 'accepted');
      assert.equal(result.compileOutput, '');
      assert.equal(result.results.length, 2);
      assert.doesNotMatch(JSON.stringify(result), /hidden-case-sensitive/);
      assert.deepEqual(Object.keys(result.results[0]).sort(), [
        'hidden',
        'index',
        'memoryKb',
        'runtimeMs',
        'status',
      ]);
    },
  );
});

test('编译失败停止创建后续用例，取消在途轮询并为整组用例返回编译失败', async () => {
  let submissions = 0;
  await server(
    (req, res) => {
      if (req.method === 'POST') {
        const id = ++submissions;
        respond(res, { token: id === 1 ? token : '22345678-1234-4123-8123-123456789012' });
      } else if (req.url?.includes(token)) {
        respond(res, reply({ status: { id: 6 }, compile_output: encode('syntax error'), exit_code: null }));
      } else {
        // This response deliberately never finishes; compile failure must cancel it locally.
        res.writeHead(200);
        res.write('{');
      }
    },
    async () => {
      const start = Date.now();
      const result = await new JudgeGateway().execute(
        request({
          cases: Array.from({ length: 8 }, (_, index) => ({
            input: String(index),
            output: '5',
            hidden: index > 0,
          })),
        }),
      );
      assert.equal(result.status, 'compile_error');
      assert.equal(result.compileOutput, '');
      assert.match(result.error, /运行样例/);
      assert.equal(result.results.length, 8);
      assert.equal(
        result.results.every((item, index) => item.status === 'compile_error' && item.index === index + 1),
        true,
      );
      assert.ok(submissions <= 2);
      assert.ok(Date.now() - start < 800);
    },
  );
});

test('普通输出与编译日志不泄漏配置中的服务地址或密钥', async () => {
  let base = '';
  await server(
    (req, res) => {
      respond(
        res,
        req.method === 'POST'
          ? { token }
          : reply({
              stdout: encode(`fixture-private-token ${base}`),
              stderr: encode(`fixture-private-token ${base}`),
              compile_output: encode(`fixture-private-token ${base}`),
            }),
      );
    },
    async (url) => {
      base = url;
      const result = await new JudgeGateway().execute(request({ cases: [{ input: '', hidden: false }] }));
      assert.equal(result.status, 'accepted');
      assert.doesNotMatch(JSON.stringify(result), /fixture-private-token|127\.0\.0\.1/);
    },
  );
});

test('密钥与服务地址被控制字符或终端转义分隔时仍然脱敏', async () => {
  let diagnostics = '';
  await server(
    (req, res) =>
      respond(
        res,
        req.method === 'POST'
          ? { token }
          : reply({
              stdout: encode(diagnostics),
              stderr: encode(diagnostics),
              compile_output: encode(diagnostics),
            }),
      ),
    async (url) => {
      diagnostics = `fixture-\x00private-token ${url.replace('127', '1\x1b[31m27')} fixture-\x1b[0mprivate-token`;
      const result = await new JudgeGateway().execute(request({ cases: [{ input: '', hidden: false }] }));
      assert.equal(result.status, 'accepted');
      assert.doesNotMatch(JSON.stringify(result), /fixture-private-token|127\.0\.0\.1/);
      assert.match(result.results[0].stdout || '', /已隐藏/);
    },
  );
});

test('无效/恶意上游状态和Base64不能伪造通过，拒绝路径注入token', async () => {
  for (const value of [
    { status: { id: 3 } },
    reply({ status: { id: 99 } }),
    reply({ time: '-1' }),
    reply({ stdout: 'not valid base64!!' }),
    reply({ stdout: '/w==' }),
    reply({ memory: -1 }),
    reply({ exit_code: 1 }),
    reply({ callback_url: 'https://malicious.test' }),
    reply({ stdout: encode('x'.repeat(1_048_577)) }),
    reply({ stderr: encode('x'.repeat(65_537)) }),
  ]) {
    await server(fixture(value), async () => {
      const result = await new JudgeGateway().execute(request());
      assert.equal(result.status, 'system_error');
      assert.equal(result.passed, 0);
      assert.deepEqual(result.results, []);
    });
  }
  let hits = 0;
  await server(
    (_req, res) => {
      hits++;
      respond(res, { token: '../secret?token=fixture-private-token' });
    },
    async () => {
      assert.equal((await new JudgeGateway().execute(request())).status, 'system_error');
    },
  );
  assert.equal(hits, 1);
});

test('认证错误、重定向、巨大响应及流式超量均失败且不泄漏上游信息', async () => {
  for (const handler of [
    (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(401);
      res.end('fixture-private-token http://private.internal');
    },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(302, { location: 'http://127.0.0.1:1/private' });
      res.end();
    },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { 'content-length': 2_097_153 });
      res.end('oversized');
    },
    (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200);
      res.write('x'.repeat(1_100_000));
      res.end('x'.repeat(1_100_000));
    },
  ]) {
    await server(handler, async () => {
      const result = await new JudgeGateway().execute(request());
      assert.equal(result.status, 'system_error');
      assert.doesNotMatch(JSON.stringify(result), /fixture-private-token|private\.internal|127\.0\.0\.1/);
    });
  }
});

test('等待队列与停滞响应共用总超时，取消后释放并发槽位', async () => {
  for (const stuckBody of [false, true]) {
    await server(
      (req, res) => {
        if (req.method === 'POST') respond(res, { token });
        else if (stuckBody) {
          res.writeHead(200);
          res.write('{');
        } else respond(res, { status: { id: 1 } });
      },
      async () =>
        withEnvironment({ ALGORITHM_JUDGE_TIMEOUT_MS: '100' }, async () => {
          const gateway = new JudgeGateway();
          for (let attempt = 0; attempt < 5; attempt++) {
            const start = Date.now();
            const result = await gateway.execute(request());
            assert.equal(result.status, 'system_error');
            assert.match(result.error, /超时/);
            assert.ok(Date.now() - start < 1500);
          }
        }),
    );
  }
});

test('无效输入不触发请求，服务地址/回调/超大源码不能通过学生参数注入', async () => {
  let hits = 0;
  await server(
    (_req, res) => {
      hits++;
      respond(res, { token });
    },
    async () => {
      for (const invalid of [
        { ...request(), callback_url: 'https://malicious.test' },
        { ...request(), code: 'x'.repeat(65_537) },
        { ...request(), cases: [] },
        { ...request(), language: 'bash' },
        { ...request(), timeLimitMs: 100_000 },
        { ...request(), memoryLimitMb: 4096 },
        { ...request(), cases: [{ input: 'x'.repeat(4_194_305), hidden: true }] },
        { ...request(), cases: [{ input: '', output: 'x'.repeat(1_048_577), hidden: true }] },
        {
          ...request(),
          cases: Array.from({ length: 5 }, () => ({ input: 'x'.repeat(4_194_304), hidden: true })),
        },
      ])
        assert.equal(
          (await new JudgeGateway().execute(invalid as JudgeExecutionRequest)).status,
          'system_error',
        );
    },
  );
  assert.equal(hits, 0);
});

test('可信隐藏用例支持4MiB输入和1MiB输出，学生输入与源码仍有独立严格上限', async () => {
  const stdin = 'x'.repeat(4_194_304),
    stdout = '5'.repeat(1_048_576);
  let capturedInputBytes = 0;
  await server(
    (req, res) => {
      if (req.method === 'POST') {
        void body(req).then((value) => {
          capturedInputBytes = Buffer.from(value.stdin, 'base64').byteLength;
          assert.equal(Buffer.from(value.source_code, 'base64').byteLength, 65_536);
          assert.equal(value.max_file_size, 1024);
          respond(res, { token });
        });
      } else respond(res, reply({ stdout: encode(stdout) }));
    },
    async () => {
      const result = await new JudgeGateway().execute(
        request({
          code: 'print(5)\n' + ' '.repeat(65_536 - 9),
          cases: [{ input: stdin, output: stdout, hidden: true }],
        }),
      );
      assert.equal(result.status, 'accepted');
      assert.equal(capturedInputBytes, 4_194_304);
      assert.equal(result.results[0].stdout, undefined);
      assert.ok(JSON.stringify(result).length < 1000);
    },
  );
  assert.equal(
    algorithmSubmissionInput.safeParse({
      language: 'python',
      code: 'print(5)',
      mode: 'run',
      stdin: '界'.repeat(11_000),
    }).success,
    false,
  );
});

test('大用例预算下每个网关仍最多四次执行，第五次不创建远端作业', async () => {
  let submissions = 0;
  await server(
    (req, res) => {
      if (req.method === 'POST') {
        submissions++;
        respond(res, { token });
      } else respond(res, { status: { id: 1 } });
    },
    async () =>
      withEnvironment({ ALGORITHM_JUDGE_TIMEOUT_MS: '100' }, async () => {
        const gateway = new JudgeGateway();
        const pending = Array.from({ length: 4 }, () => gateway.execute(request()));
        const rejected = await gateway.execute(request());
        assert.equal(rejected.status, 'system_error');
        assert.match(rejected.error, /请求过多/);
        assert.ok((await Promise.all(pending)).every((item) => item.status === 'system_error'));
        assert.equal(submissions, 4);
      }),
  );
});
