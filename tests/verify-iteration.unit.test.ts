import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireVerificationLock,
  buildStages,
  discoverTests,
  evaluateStageResult,
  parseOptions,
  redactOutput,
  runStages,
  safeSummary,
  stageEnvironment,
  validateEnvironment,
  validateRuntime,
} from '../scripts/verify-iteration.mjs';

test('iteration CLI defaults to all four reference languages and validates explicit selectors', () => {
  const options = parseOptions([]);
  assert.deepEqual(options, { profile: 'full', apiPort: 3002, previewPort: 3003, help: false });
  assert.equal(parseOptions(['--profile', 'ci']).profile, 'ci');
  assert.equal(parseOptions(['--api-port=3102', '--preview-port', '3103']).apiPort, 3102);
  for (const args of [
    ['--profile=quick'],
    ['--profile=full=ignored'],
    ['--profile'],
    ['--skip-browser'],
    ['--api-port=3003'],
    ['--api-port=3032'],
    ['--api-port=4183'],
    ['--api-port=3038'],
    ['--preview-port=3039'],
    ['--preview-port=4175'],
    ['--api-port=4179'],
    ['--preview-port=-1'],
    ['--preview-port=3.5'],
  ])
    assert.throws(() => parseOptions(args));
});

test('iteration uses supported LTS runtimes and rejects Node below the project minimum', () => {
  for (const version of ['22.11.0', '22.22.0', '24.0.0', 'v24.19.0'])
    assert.doesNotThrow(() => validateRuntime(version));
  for (const version of ['20.19.0', '22.0.0', '22.10.9', '23.0.0', '25.0.0', 'not-a-version'])
    assert.throws(() => validateRuntime(version));
});

test('iteration rejects production, remote/nonreview DB and alternative DB without disclosing credentials', () => {
  const env = {
    DATABASE_URL: 'postgresql://user:PRIVATE_DB_VALUE@127.0.0.1:55432/project_review',
    DEV_SEED_PASSWORD: 'PRIVATE_SEED_VALUE',
    NODE_ENV: 'test',
  };
  assert.doesNotThrow(() => validateEnvironment(env));
  for (const overrides of [
    { NODE_ENV: 'production' },
    { DATABASE_URL: 'postgresql://user:PRIVATE_DB_VALUE@database.example/project_review' },
    { DATABASE_URL: 'postgresql://user:PRIVATE_DB_VALUE@127.0.0.1/production' },
    { DATABASE_URL: 'bad PRIVATE_DB_VALUE' },
    { DEV_SEED_PASSWORD: '' },
    { ACADEMICS_TEST_ADMIN_DATABASE_URL: 'postgresql://user:PRIVATE_DB_VALUE@127.0.0.1/other_review' },
    { ACADEMICS_ADMISSION_TEST_DATABASE_URL: 'postgresql://user:PRIVATE_DB_VALUE@127.0.0.1/other_review' },
    { LEARNING_ACTIONS_TEST_ADMIN_DATABASE_URL: 'postgresql://user:PRIVATE_DB_VALUE@127.0.0.1/other_review' },
    {
      LEARNING_OVERVIEW_TEST_ADMIN_DATABASE_URL: 'postgresql://user:PRIVATE_DB_VALUE@127.0.0.1/other_review',
    },
    {
      ALGORITHM_TRAINING_TEST_ADMIN_DATABASE_URL: 'postgresql://user:PRIVATE_DB_VALUE@127.0.0.1/other_review',
    },
  ]) {
    assert.throws(
      () => validateEnvironment({ ...env, ...overrides }),
      (error: Error) => {
        assert.doesNotMatch(error.message, /PRIVATE_|postgresql:\/\//);
        return true;
      },
    );
  }
});

test('iteration discovers every current/future integration and keeps all mandatory phases', () => {
  const tests = discoverTests([
    'z.unit.test.ts',
    'a.integration.ts',
    'academics-goals.integration.ts',
    'auth.security.integration.ts',
    'e2e.test.ts',
    'README.md',
    'x;bad.integration.ts',
  ]);
  assert.deepEqual(tests.units, ['z.unit.test.ts']);
  assert.deepEqual(tests.integrations, [
    'a.integration.ts',
    'academics-goals.integration.ts',
    'auth.security.integration.ts',
  ]);
  const full = buildStages(parseOptions([]), tests);
  for (const id of [
    'generate',
    'migrate',
    'seed',
    'typecheck',
    'lint',
    'unit',
    'build',
    'audit',
    'trusted-references',
    'creative-expression-browser',
    'servers',
    'e2e',
    'clean-start',
    'performance',
    'browser',
  ])
    assert.ok(
      full.some((stage: any) => stage.id === id),
      id,
    );
  assert.equal(full.filter((stage: any) => stage.id.startsWith('integration:')).length, 3);
  assert.ok(
    full
      .find((stage: any) => stage.id === 'trusted-references')
      .args.includes('--languages=python,javascript,cpp,java'),
  );
  assert.ok(
    buildStages(parseOptions(['--profile=ci']), tests)
      .find((stage: any) => stage.id === 'trusted-references')
      .args.includes('--languages=python,javascript'),
  );
  assert.ok(full.find((stage: any) => stage.id === 'e2e').args.includes('tests/e2e.test.ts'));
});

test('iteration never promotes a failed, skipped or incomplete check to passing', async () => {
  const stages = [
    { id: 'build', depends: [] },
    { id: 'audit', depends: [] },
    { id: 'servers', depends: ['build'] },
    { id: 'browser', depends: ['servers'] },
    { id: 'lint', depends: [] },
  ];
  const calls: string[] = [];
  const report: any = { stages: [] };
  assert.equal(
    await runStages(
      stages,
      async (stage: any) => {
        calls.push(stage.id);
        return { exitCode: stage.id === 'build' ? 1 : 0 };
      },
      report,
    ),
    false,
  );
  assert.deepEqual(calls, ['build', 'audit', 'lint']);
  assert.equal(report.stages.find((stage: any) => stage.id === 'browser').status, 'blocked');
  for (const output of [
    '# tests 0\n# pass 0',
    '# tests 5\n# pass 4\n# skipped 1',
    '# tests 5\n# pass 4\n# todo 1',
  ])
    assert.equal(evaluateStageResult('unit', { exitCode: 0 }, output).exitCode, 1);
  assert.equal(evaluateStageResult('e2e', { exitCode: 1 }, '# tests 1\n# fail 1').exitCode, 1);
  assert.equal(evaluateStageResult('unit', { exitCode: 0 }, '# tests 1\n# pass 0\n# fail 1').exitCode, 1);
  assert.equal(
    evaluateStageResult('integration:ok.integration.ts', { exitCode: 0 }, '# tests 5\n# pass 5\n# skipped 0')
      .exitCode,
    0,
  );
});

test('iteration requires complete expression rendering and rejects missing checks or unexpected network activity', () => {
  const valid = { checksPassed: 10, expressionsPassed: 32, externalRequests: 0, pageErrors: 0 };
  assert.equal(
    evaluateStageResult('creative-expression-browser', { exitCode: 0 }, JSON.stringify(valid)).exitCode,
    0,
  );
  for (const report of [
    undefined,
    {},
    { ...valid, checksPassed: 0 },
    { ...valid, expressionsPassed: 31 },
    { ...valid, externalRequests: 1 },
    { ...valid, pageErrors: 1 },
  ])
    assert.equal(
      evaluateStageResult(
        'creative-expression-browser',
        { exitCode: 0 },
        report ? JSON.stringify(report) : 'No report',
      ).exitCode,
      1,
    );
});

test('iteration builds a production Vite bundle while keeping fixtures and servers in test mode', () => {
  const env = { ...process.env, NODE_ENV: 'test' };
  const buildEnv = stageEnvironment('build', env);
  assert.equal(buildEnv.NODE_ENV, 'production');
  assert.equal(env.NODE_ENV, 'test');
  const stages = buildStages(parseOptions([]), { units: ['example.unit.test.ts'], integrations: [] });
  for (const stage of stages.filter((item: any) => item.id !== 'build')) {
    assert.equal(stageEnvironment(stage.id, env).NODE_ENV, 'test', stage.id);
  }
  // Resolve the installed Vite compiler's real production flags in a separate
  // process; this does not build assets or mutate the unit runner's environment.
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { resolveConfig } from 'vite';
       const config = await resolveConfig({ configFile: false, envFile: false }, 'build', 'production', 'production');
       process.stdout.write(JSON.stringify({ nodeEnv: process.env.NODE_ENV, production: config.isProduction, prod: config.env.PROD, dev: config.env.DEV }));`,
    ],
    { env: buildEnv, encoding: 'utf8', timeout: 15000 },
  );
  assert.deepEqual(JSON.parse(output), { nodeEnv: 'production', production: true, prod: true, dev: false });
  assert.equal(env.NODE_ENV, 'test');
});

test('failure logs redact configured and unknown credential URLs plus authentication fields', () => {
  const env = {
    DATABASE_URL: 'postgresql://review:db%24password@localhost/review',
    DEV_SEED_PASSWORD: 'fixture\"secret',
    API_KEY: 'known-private-key',
  };
  const text = `${env.DATABASE_URL}\ndb$password\nfixture\\\"secret\nknown-private-key\nhttps://unknown:PRIVATE@provider.example/path\nCookie: lms_session=PRIVATE_COOKIE\n{"inviteCode":"PRIVATE_INVITE","password":"PRIVATE_PASSWORD","code":409}\nSafe compile error on file.ts:10\n`;
  const clean = redactOutput(text, env);
  assert.doesNotMatch(clean, /PRIVATE|db\$password|fixture|known-private-key|postgresql:\/\//);
  assert.match(clean, /Safe compile error on file\.ts:10/);
});

test('atomic iteration lock rejects overlap, recovers dead owners and only removes its own token', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'iteration-lock-test-'));
  const file = join(directory, 'lock');
  try {
    const release = await acquireVerificationLock(file);
    await assert.rejects(acquireVerificationLock(file), /already running/);
    const own = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(own.pid, process.pid);
    await release();
    await assert.rejects(readFile(file), { code: 'ENOENT' });
    await writeFile(file, JSON.stringify({ pid: 987654, token: 'a'.repeat(48) }));
    const recovered = await acquireVerificationLock(file, () => false);
    assert.notEqual(JSON.parse(await readFile(file, 'utf8')).token, 'a'.repeat(48));
    await writeFile(file, JSON.stringify({ pid: process.pid, token: 'b'.repeat(48) }));
    await recovered();
    assert.equal(JSON.parse(await readFile(file, 'utf8')).token, 'b'.repeat(48));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('performance HTTP errors fail even when the benchmark process exits zero', () => {
  for (const output of [
    JSON.stringify({ requests: 100, errors: 1 }),
    JSON.stringify({ requests: 0, errors: 0 }),
    '{}',
    'not-json',
  ])
    assert.equal(evaluateStageResult('performance', { exitCode: 0 }, output).exitCode, 1);
  assert.equal(
    evaluateStageResult(
      'performance',
      { exitCode: 0 },
      JSON.stringify({ requests: 100, errors: 0, concurrency: 10 }),
    ).exitCode,
    0,
  );
  assert.equal(evaluateStageResult('audit', { exitCode: 0 }, 'registry unavailable').exitCode, 1);
  assert.equal(
    evaluateStageResult(
      'trusted-references',
      { exitCode: 0 },
      JSON.stringify({ programsPassed: 72, casesPassed: 400, failures: ['a failed case'] }),
    ).exitCode,
    1,
  );
});

test('machine summaries only retain allowlisted counters, never raw subprocess payloads', () => {
  const raw = 'password=PRIVATE_VALUE cookie=lms_session=PRIVATE_COOKIE\n# tests 8\n# pass 8\n# fail 0\n';
  assert.deepEqual(safeSummary('unit', raw), { tests: 8, pass: 8, fail: 0 });
  const audit = safeSummary(
    'audit',
    JSON.stringify({
      password: 'PRIVATE_VALUE',
      metadata: { vulnerabilities: { low: 2, high: 0, total: 2, token: 'PRIVATE_VALUE' } },
    }),
  );
  assert.doesNotMatch(JSON.stringify(audit), /PRIVATE|password|cookie|token/);
  const refs = safeSummary(
    'trusted-references',
    'PASS fixed program\n' +
      JSON.stringify({
        programsPassed: 72,
        casesPassed: 1234,
        languages: ['python'],
        failures: ['PRIVATE_DIAGNOSTIC'],
      }),
  );
  assert.equal(refs.failures, 1);
  assert.doesNotMatch(JSON.stringify(refs), /PRIVATE/);
});
