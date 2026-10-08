import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  copyFileSync,
  statSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { AiConfiguration, parseAiConfiguration } from '../apps/api/src/ai-study/ai.config';
import { readJudgeConfiguration } from '../apps/api/src/algorithms/judge.config';
import { JudgeGateway } from '../apps/api/src/algorithms/judge.gateway';
import { diagnoseJudge0 } from '../apps/api/src/algorithms/judge.diagnostics';

const environmentKeys = [
  'AI_CONFIG_PATH',
  'NODE_ENV',
  'ALGORITHM_JUDGE_URL',
  'ALGORITHM_JUDGE_TOKEN',
  'ALGORITHM_JUDGE_ENABLED',
  'ALGORITHM_JUDGE_TIMEOUT_MS',
  'ALGORITHM_JUDGE_POLL_MS',
  'ALGORITHM_JUDGE_LANGUAGE_IDS',
];
async function fixture(run: (path: string) => Promise<void> | void) {
  const saved = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const directory = mkdtempSync(join(tmpdir(), 'judge-config-'));
  const path = join(directory, 'config.yaml');
  for (const key of environmentKeys) delete process.env[key];
  process.env.AI_CONFIG_PATH = path;
  process.env.NODE_ENV = 'test';
  writeFileSync(
    path,
    stringify({
      judge0: {
        baseUrl: 'https://fixture-judge.invalid',
        apiKey: 'fixture-only-secret',
        languageIds: { cpp: 76 },
      },
      ai: { apiKey: 'fixture-only-ai-secret' },
    }),
  );
  try {
    await run(path);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}
const privateText = /fixture-only-secret|fixture-only-ai-secret|fixture-judge\.invalid|replacement-secret/;
test('Judge0与AI共享严格YAML schema，配置字段保留默认值并拒绝任意键、别名和重复键', async () => {
  await fixture((path) => {
    const config = readJudgeConfiguration();
    assert.equal(config.token, 'fixture-only-secret');
    assert.equal(config.timeoutMs, 45000);
    assert.equal(config.pollMs, 250);
    assert.deepEqual(config.languageIds, { cpp: 76, python: 71, javascript: 63, java: 62 });
    assert.equal(new AiConfiguration().read().judge0.baseUrl, 'https://fixture-judge.invalid');
    assert.equal(new AiConfiguration().status().analysis.available, true);
    for (const raw of [
      'judge0: {unknown: secret}',
      'judge0: {languageIds: {ruby: 1}}',
      'unknown: {}',
      'judge0: {enabled: "true"}',
      'judge0: {timeoutMs: 60001}',
      'judge0: {pollMs: 0}',
      'judge0: {apiKey: 123}',
      'judge0: {apiKey: "abc\\nxyz"}',
      'judge0: {baseUrl: "https://u:secret@judge.invalid"}',
      'judge0: {baseUrl: "https://judge.invalid/?secret=x"}',
      'judge0: {baseUrl: "http://192.168.1.2:2358"}',
      'judge0: {languageIds: {python: -1}}',
      'judge0: {}\njudge0: {}',
      'judge0: &shared {}\nai: *shared',
    ]) {
      assert.throws(() => parseAiConfiguration(raw));
      writeFileSync(path, raw);
      assert.equal(new JudgeGateway().status().available, false);
      assert.equal(new AiConfiguration().status().analysis.available, false);
    }
  });
});
test('环境变量逐字段覆盖YAML，语言局部覆盖不丢失其他YAML值，空token可覆盖', async () => {
  await fixture(() => {
    process.env.ALGORITHM_JUDGE_URL = 'https://override.invalid/prefix/';
    process.env.ALGORITHM_JUDGE_TOKEN = '';
    process.env.ALGORITHM_JUDGE_TIMEOUT_MS = '12345';
    process.env.ALGORITHM_JUDGE_POLL_MS = '30';
    process.env.ALGORITHM_JUDGE_LANGUAGE_IDS = '{"python":92}';
    const config = readJudgeConfiguration();
    assert.equal(config.url, 'https://override.invalid/prefix');
    assert.equal(config.token, '');
    assert.equal(config.timeoutMs, 12345);
    assert.equal(config.pollMs, 30);
    assert.deepEqual(config.languageIds, { cpp: 76, python: 92, javascript: 63, java: 62 });
    for (const [key, value] of [
      ['ALGORITHM_JUDGE_TIMEOUT_MS', '45e3'],
      ['ALGORITHM_JUDGE_POLL_MS', '2001'],
      ['ALGORITHM_JUDGE_ENABLED', 'yes'],
      ['ALGORITHM_JUDGE_LANGUAGE_IDS', '{"ruby":1}'],
      ['ALGORITHM_JUDGE_TOKEN', 'line\nbreak'],
    ]) {
      const old = process.env[key];
      process.env[key] = value;
      assert.throws(readJudgeConfiguration);
      process.env[key] = old;
      if (old === undefined) delete process.env[key];
    }
  });
});
test('仅缺失YAML时兼容旧env部署，有无效文件不忽略；生产禁用HTTP', async () => {
  await fixture((path) => {
    unlinkSync(path);
    assert.throws(readJudgeConfiguration);
    process.env.ALGORITHM_JUDGE_URL = 'http://127.0.0.1:2358';
    assert.equal(readJudgeConfiguration().url, 'http://127.0.0.1:2358');
    process.env.NODE_ENV = 'production';
    assert.throws(readJudgeConfiguration);
    process.env.ALGORITHM_JUDGE_URL = 'https://fixture-judge.invalid';
    assert.equal(new JudgeGateway().status().available, true);
    writeFileSync(path, 'judge0: { typo: fixture-only-secret }');
    assert.equal(new JudgeGateway().status().available, false);
    writeFileSync(path, ' '.repeat(65537));
    assert.throws(readJudgeConfiguration);
  });
});
test('同一网关无需重启读取URL、token、语言ID和开关变化，公开状态与错误不含秘密', async () => {
  await fixture(async (path) => {
    const saved = globalThis.fetch;
    const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    globalThis.fetch = async (url, options) => {
      calls.push({
        url: String(url),
        headers: new Headers(options?.headers),
        body: options?.body ? JSON.parse(String(options.body)) : {},
      });
      return Response.json(
        options?.method === 'POST'
          ? { token: '12345678-1234-4123-8123-123456789012' }
          : { status: { id: 3 }, stdout: Buffer.from('5\n').toString('base64'), exit_code: 0 },
      );
    };
    try {
      const gateway = new JudgeGateway();
      const input = {
        language: 'cpp' as const,
        code: 'trusted fixture',
        cases: [{ input: '2 3\n', output: '5\n', hidden: true }],
        timeLimitMs: 1000,
        memoryLimitMb: 128,
      };
      assert.equal((await gateway.execute(input)).status, 'accepted');
      assert.equal(calls[0].headers.get('X-Auth-Token'), 'fixture-only-secret');
      assert.equal(calls[0].body.language_id, 76);
      writeFileSync(
        path,
        stringify({
          judge0: {
            baseUrl: 'https://replacement.invalid',
            apiKey: 'replacement-secret',
            languageIds: { cpp: 54 },
          },
        }),
      );
      assert.equal((await gateway.execute(input)).status, 'accepted');
      assert.ok(calls[2].url.startsWith('https://replacement.invalid/'));
      assert.equal(calls[2].headers.get('X-Auth-Token'), 'replacement-secret');
      assert.equal(calls[2].body.language_id, 54);
      assert.ok(calls.every((call) => !call.url.includes('secret')));
      assert.doesNotMatch(JSON.stringify(gateway.status()), privateText);
      writeFileSync(path, 'judge0: {enabled: false}\n');
      assert.equal(gateway.status().available, false);
      assert.equal((await gateway.execute(input)).status, 'system_error');
      assert.equal(calls.length, 4);
      writeFileSync(path, 'judge0: {apiKey: fixture-only-secret, baseUrl: [fixture-judge.invalid,}\n');
      assert.doesNotMatch(JSON.stringify(await gateway.execute(input)), privateText);
      assert.doesNotMatch(JSON.stringify(new AiConfiguration().status()), privateText);
      assert.doesNotMatch(JSON.stringify(await diagnoseJudge0()), privateText);
    } finally {
      globalThis.fetch = saved;
    }
  });
});

const metadata = {
  about: { version: '1.13.1', maintainer: 'fixture-only-secret' },
  languages: [
    { id: 76, name: 'C++ (GCC)' },
    { id: 71, name: 'Python (3.8)' },
    { id: 63, name: 'JavaScript (Node)' },
    { id: 62, name: 'Java (OpenJDK)' },
  ],
  config_info: {
    enable_network: false,
    allow_enable_network: false,
    enable_callbacks: false,
    enable_additional_files: false,
    enable_compiler_options: false,
    enable_command_line_arguments: false,
    enable_per_process_and_thread_memory_limit: false,
    enable_per_process_and_thread_time_limit: false,
    max_cpu_time_limit: 10,
    max_wall_time_limit: 20,
    max_memory_limit: 524288,
    max_stack_limit: 128000,
    max_max_processes_and_or_threads: 60,
    max_max_file_size: 4096,
    max_number_of_runs: 1,
    max_queue_size: 32,
  },
  workers: [{ queue: 'default', size: 0, available: 2, idle: 2, working: 0, paused: 0 }],
};
test('诊断先只读检查，再经原网关执行固定四语言烟测；header和原始上游文本不外泄', async () => {
  await fixture(async () => {
    const saved = globalThis.fetch;
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = async (url, options) => {
      assert.equal(new Headers(options?.headers).get('X-Auth-Token'), 'fixture-only-secret');
      assert.equal(options?.redirect, 'error');
      const path = new URL(String(url)).pathname.slice(1);
      if (options?.method === 'POST') {
        bodies.push(JSON.parse(String(options.body)));
        return Response.json({ token: '12345678-1234-4123-8123-123456789012' });
      }
      if (path.startsWith('submissions/'))
        return Response.json({
          status: { id: 3 },
          stdout: Buffer.from('4000000000\n').toString('base64'),
          stderr: Buffer.from('fixture-only-secret').toString('base64'),
          exit_code: 0,
        });
      return Response.json(metadata[path as keyof typeof metadata]);
    };
    try {
      assert.ok((await diagnoseJudge0()).every((check) => check.ok));
      assert.equal(bodies.length, 0);
      const checks = await diagnoseJudge0({ smoke: true });
      assert.ok(checks.every((check) => check.ok));
      assert.equal(checks.filter((check) => check.name.endsWith('烟测')).length, 4);
      assert.deepEqual(
        bodies.map((body) => body.language_id),
        [76, 71, 63, 62],
      );
      assert.ok(
        bodies.every(
          (body) =>
            body.enable_network === false && !('callback_url' in body) && !('expected_output' in body),
        ),
      );
      assert.doesNotMatch(JSON.stringify(checks), privateText);
    } finally {
      globalThis.fetch = saved;
    }
  });
});
test('诊断拒绝旧版本、允许联网、没有worker或畸形响应；失败前置检查绝不创建作业', async () => {
  await fixture(async () => {
    const saved = globalThis.fetch;
    try {
      for (const change of [
        { about: { version: '1.13.0' } },
        { config_info: { ...metadata.config_info, allow_enable_network: true } },
        { workers: [] },
        { languages: 'fixture-only-secret' },
        { config_info: { ...metadata.config_info, max_memory_limit: 256000 } },
      ]) {
        const data = { ...metadata, ...change };
        globalThis.fetch = async (url, options) => {
          assert.notEqual(options?.method, 'POST');
          return Response.json(data[new URL(String(url)).pathname.slice(1) as keyof typeof data]);
        };
        const checks = await diagnoseJudge0({ smoke: true });
        assert.ok(checks.some((check) => !check.ok));
        assert.doesNotMatch(JSON.stringify(checks), privateText);
      }
      globalThis.fetch = async () =>
        new Response('fixture-only-secret fixture-judge.invalid', { status: 401 });
      const denied = await diagnoseJudge0({ smoke: true });
      assert.ok(denied.some((check) => !check.ok));
      assert.doesNotMatch(JSON.stringify(denied), privateText);
      globalThis.fetch = async () => new Response('x'.repeat(2 * 1048576 + 1));
      assert.ok((await diagnoseJudge0()).some((check) => !check.ok));
    } finally {
      globalThis.fetch = saved;
    }
  });
});
test('配置示例与私有部署文件排除规则齐全，Judge0模板固定安全版本并禁网', () => {
  const example = parseAiConfiguration(readFileSync('config.example.yaml', 'utf8'));
  assert.equal(example.judge0.baseUrl, '');
  assert.equal(example.judge0.apiKey, '');
  const dockerignore = readFileSync('.dockerignore', 'utf8');
  assert.ok(dockerignore.split('\n').includes('deploy/judge0/judge0.conf'));
  const config = readFileSync('deploy/judge0/judge0.conf.example', 'utf8');
  assert.match(config, /^ALLOW_ENABLE_NETWORK=false$/m);
  assert.match(config, /^ENABLE_NETWORK=false$/m);
  assert.match(config, /^MAX_QUEUE_SIZE=32$/m);
  const compose = readFileSync('deploy/judge0/compose.yaml', 'utf8');
  assert.match(compose, /judge0\/judge0:1\.13\.1/);
  assert.match(compose, /127\.0\.0\.1:2358:2358/);
  assert.match(compose, /internal: true/);
  assert.doesNotMatch(compose, /docker\.sock|host:/);
});

test('部署初始化只生成隔离凭证文件且拒绝覆盖，命令输出与非法参数不泄漏凭证', () => {
  const directory = mkdtempSync(join(tmpdir(), 'judge-deploy-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    mkdirSync(join(directory, 'deploy/judge0'), { recursive: true });
    copyFileSync('scripts/judge0-selfhost.mjs', join(directory, 'scripts/judge0-selfhost.mjs'));
    copyFileSync('deploy/judge0/judge0.conf.example', join(directory, 'deploy/judge0/judge0.conf.example'));
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [join(directory, 'scripts/judge0-selfhost.mjs'), ...args], {
        encoding: 'utf8',
        timeout: 5000,
      });
    const first = run('--init');
    assert.equal(first.status, 0);
    const path = join(directory, 'deploy/judge0/judge0.conf');
    const before = readFileSync(path, 'utf8');
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const secrets = [
      ...before.matchAll(
        /^(?:AUTHN_TOKEN|AUTHZ_TOKEN|REDIS_PASSWORD|POSTGRES_PASSWORD|SECRET_KEY_BASE)=([a-f0-9]{64})$/gm,
      ),
    ].map((match) => match[1]);
    assert.equal(new Set(secrets).size, 5);
    const second = run('--init');
    assert.equal(second.status, 1);
    assert.equal(readFileSync(path, 'utf8'), before);
    const invalid = run('--token=fixture-only-secret');
    assert.equal(invalid.status, 2);
    const output = [first, second, invalid].map((result) => result.stdout + result.stderr).join('\n');
    assert.ok(secrets.every((secret) => !output.includes(secret)));
    assert.doesNotMatch(output, privateText);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
