/**
 * Repeatable, fail-closed local/review verification. Run with Node's --env-file,
 * e.g. node --env-file=.data/review.env scripts/verify-iteration.mjs.
 * Never resets the selected database, stops an existing service, or calls live AI/Judge providers.
 * Child output can contain fixture credentials, so the report stores only allowlisted summaries.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const loopback = (host) => ['127.0.0.1', 'localhost', '[::1]'].includes(host);
const programmingPreviewPort = 4183;
const reservedPorts = [
  3031,
  3032,
  3033,
  3034,
  3035,
  3036,
  3037,
  3038,
  3039,
  4175,
  4179,
  programmingPreviewPort,
];

export async function acquireVerificationLock(
  path,
  isAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code !== 'ESRCH';
    }
  },
) {
  const token = randomBytes(24).toString('hex');
  const value = { pid: process.pid, token, startedAt: new Date().toISOString() };
  const claim = async () => {
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
    } finally {
      await handle.close();
    }
  };
  try {
    await claim();
  } catch (error) {
    if (error.code !== 'EEXIST') throw new Error('Unable to create verification lock');
    let existing;
    try {
      existing = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      throw new Error('Verification lock is incomplete; retry after the current runner finishes');
    }
    if (!Number.isInteger(existing.pid) || existing.pid < 1 || !/^[a-f0-9]{48}$/.test(existing.token))
      throw new Error('Verification lock is invalid; inspect the local lock before retrying');
    if (isAlive(existing.pid)) throw new Error(`Verification is already running (PID ${existing.pid})`);
    // Serialize stale-lock recovery, then reread before deleting. A new live owner's
    // lock must never be removed by a second runner that also observed the stale one.
    let recovery;
    try {
      recovery = await open(`${path}.recovery`, 'wx', 0o600);
    } catch {
      throw new Error('Verification lock recovery is in progress; retry shortly');
    }
    try {
      const current = JSON.parse(await readFile(path, 'utf8'));
      if (current.token !== existing.token || current.pid !== existing.pid || isAlive(current.pid))
        throw new Error('Verification lock changed; retry after the active runner finishes');
      await rm(path);
      await claim();
    } finally {
      await recovery.close();
      await rm(`${path}.recovery`, { force: true });
    }
  }
  return async () => {
    try {
      const current = JSON.parse(await readFile(path, 'utf8'));
      if (current.token === token && current.pid === process.pid) await rm(path);
    } catch {
      /* An absent/replaced lock belongs to nobody or another runner. */
    }
  };
}

export function redactOutput(output, env) {
  const secrets = Object.entries(env)
    .filter(([key, value]) => value && /PASSWORD|TOKEN|SECRET|(?:^|_)KEY$|DATABASE_URL/.test(key))
    .map(([, value]) => String(value));
  for (const value of secrets.slice()) {
    try {
      const url = new URL(value);
      if (url.password) secrets.push(url.password, decodeURIComponent(url.password));
    } catch {
      /* Not a URL. */
    }
  }
  let safe = output;
  for (const secret of [...new Set(secrets)].sort((a, b) => b.length - a.length)) {
    safe = safe.split(secret).join('[redacted]');
    safe = safe.split(JSON.stringify(secret).slice(1, -1)).join('[redacted]');
  }
  return safe
    .replace(/[a-z][a-z\d+.-]*:\/\/[^\s/"'<>]+@[^\s"'<>]*/gi, '[credential URL redacted]')
    .replace(
      /((?:authorization|set-cookie|cookie|x-csrf-token|x-auth-token|api[_-]?key|password|inviteCode|recoveryCode)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\r\n,}]+)/gi,
      '$1[redacted]',
    );
}

async function failureLog(id, output, env) {
  const file = join(env.VERIFICATION_OUTPUT_DIR, `${id.replace(/[^\w.-]/g, '-')}.log`);
  // The first line may have been truncated by the bounded capture; omit it rather
  // than retaining the unmatchable suffix of a credential at that boundary.
  const text = output.length >= 524288 ? output.slice(output.indexOf('\n') + 1) : output;
  await writeFile(file, redactOutput(text, env), { mode: 0o600 });
  return file;
}

export function parseOptions(args) {
  const options = { profile: 'full', apiPort: 3002, previewPort: 3003, help: false };
  for (let index = 0; index < args.length; index++) {
    const equal = args[index].indexOf('=');
    const key = equal < 0 ? args[index] : args[index].slice(0, equal);
    const inline = equal < 0 ? undefined : args[index].slice(equal + 1);
    if (key === '--help') {
      options.help = true;
      continue;
    }
    if (!['--profile', '--api-port', '--preview-port'].includes(key))
      throw new Error('Supported options: --profile full|ci, --api-port, --preview-port, --help');
    const value = inline ?? args[++index];
    if (!value || value.startsWith('--')) throw new Error('A verification option is missing its value');
    if (key === '--profile') {
      if (!['full', 'ci'].includes(value)) throw new Error('Profile must be full or ci');
      options.profile = value;
    } else {
      if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535)
        throw new Error('Verification ports must be integers from 1024 through 65535');
      options[key === '--api-port' ? 'apiPort' : 'previewPort'] = Number(value);
    }
  }
  if (options.apiPort === options.previewPort) throw new Error('API and preview ports must be different');
  if ([options.apiPort, options.previewPort].some((port) => reservedPorts.includes(port)))
    throw new Error('Requested port is reserved for an isolated verification fixture');
  return options;
}

export function validateEnvironment(env) {
  if (env.NODE_ENV === 'production') throw new Error('Verification cannot run in production mode');
  let database;
  try {
    database = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('A local review DATABASE_URL is required; pass a private Node --env-file');
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !loopback(database.hostname) ||
    !/review/i.test(decodeURIComponent(database.pathname))
  )
    throw new Error('Verification requires a loopback PostgreSQL database whose name contains review');
  if (!env.DEV_SEED_PASSWORD || env.DEV_SEED_PASSWORD.length < 12)
    throw new Error('DEV_SEED_PASSWORD must be provided privately and contain at least 12 characters');
  // An inherited alternate admin URL would defeat the selected-database guard in an isolated suite.
  for (const key of [
    'ACADEMICS_TEST_ADMIN_DATABASE_URL',
    'ACADEMICS_ADMISSION_TEST_DATABASE_URL',
    'ADMIN_JOBS_TEST_ADMIN_DATABASE_URL',
    'ALGORITHM_TRAINING_TEST_ADMIN_DATABASE_URL',
    'LEARNING_ACTIONS_TEST_ADMIN_DATABASE_URL',
    'LEARNING_OVERVIEW_TEST_ADMIN_DATABASE_URL',
    'LEARNING_ACTION_FILTERS_TEST_ADMIN_DATABASE_URL',
  ])
    if (env[key] && env[key] !== env.DATABASE_URL)
      throw new Error('Alternate test connection must match the selected review database');
}

export function validateRuntime(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  if (![22, 24].includes(major) || !Number.isInteger(minor) || (major === 22 && minor < 11))
    throw new Error('Verification requires Node 22.11+ or Node 24');
}

export function discoverTests(names) {
  return {
    units: names.filter((name) => /^[\w.-]+\.unit\.test\.ts$/.test(name)).sort(),
    integrations: names.filter((name) => /^[\w.-]+\.integration\.ts$/.test(name)).sort(),
  };
}

export function buildStages(options, tests) {
  const node = process.execPath;
  const nodeStep = (id, args, depends = [], timeoutMs = 600_000) => ({
    id,
    command: node,
    args,
    depends,
    timeoutMs,
  });
  const npmStep = (id, args, depends = []) => ({ id, command: 'npm', args, depends, timeoutMs: 600_000 });
  return [
    nodeStep('generate', ['node_modules/prisma/build/index.js', 'generate', '--schema', 'prisma']),
    nodeStep(
      'migrate',
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma'],
      ['generate'],
    ),
    nodeStep('seed', ['--import', 'tsx', 'prisma/seed.ts'], ['migrate']),
    npmStep('typecheck', ['run', 'typecheck'], ['generate']),
    npmStep('lint', ['run', 'lint']),
    nodeStep(
      'unit',
      [
        '--import',
        'tsx',
        '--test',
        '--test-reporter=tap',
        '--test-concurrency=1',
        ...tests.units.map((name) => `tests/${name}`),
      ],
      ['generate'],
    ),
    npmStep('build', ['run', 'build'], ['generate']),
    npmStep('audit', ['audit', '--audit-level=high', '--json']),
    nodeStep(
      'trusted-references',
      [
        'scripts/verify-algorithm-references.mjs',
        `--languages=${options.profile === 'full' ? 'python,javascript,cpp,java' : 'python,javascript'}`,
      ],
      ['generate'],
    ),
    nodeStep(
      'creative-expression-browser',
      ['--import', 'tsx', 'scripts/verify-aora-expressions.mjs'],
      ['generate'],
      120_000,
    ),
    { id: 'servers', kind: 'servers', depends: ['build', 'seed'], timeoutMs: 60_000 },
    nodeStep(
      'e2e',
      ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', 'tests/e2e.test.ts'],
      ['servers'],
    ),
    ...tests.integrations.map((name) =>
      nodeStep(
        `integration:${name}`,
        ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', `tests/${name}`],
        ['servers'],
      ),
    ),
    nodeStep('clean-start', ['scripts/verify-clean-start.mjs'], ['build', 'migrate']),
    nodeStep('performance', ['scripts/performance.mjs'], ['servers']),
    { id: 'browser', kind: 'browser', depends: ['servers'], timeoutMs: 1_200_000 },
  ];
}

export function safeSummary(id, output) {
  if (id === 'creative-expression-browser') {
    try {
      const report = JSON.parse(output.slice(Math.max(0, output.lastIndexOf('\n{') + 1)));
      return {
        checksPassed: report.checksPassed,
        expressionsPassed: report.expressionsPassed,
        externalRequests: report.externalRequests,
        pageErrors: report.pageErrors,
      };
    } catch {
      return { reportAvailable: false };
    }
  }
  if (id === 'performance' || id === 'trusted-references') {
    try {
      const parsed = JSON.parse(output.slice(Math.max(0, output.lastIndexOf('\n{') + 1)));
      if (id === 'performance')
        return {
          requests: parsed.requests,
          errors: parsed.errors,
          concurrency: parsed.concurrency,
          latencyMs: parsed.latencyMs,
        };
      return {
        programsPassed: parsed.programsPassed,
        casesPassed: parsed.casesPassed,
        languages: parsed.languages,
        failures: Array.isArray(parsed.failures) ? parsed.failures.length : null,
      };
    } catch {
      return { reportAvailable: false };
    }
  }
  if (id === 'audit') {
    try {
      const report = JSON.parse(output);
      const counts = report.metadata?.vulnerabilities;
      if (counts)
        return Object.fromEntries(
          ['info', 'low', 'moderate', 'high', 'critical', 'total'].map((key) => [
            key,
            Number(counts[key]) || 0,
          ]),
        );
    } catch {
      /* An unavailable registry is a failed audit, not a clean report. */
    }
    return { reportAvailable: false };
  }
  const counts = {};
  for (const line of output.split('\n')) {
    const match = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/.exec(line);
    if (match) counts[match[1]] = Number(match[2]);
  }
  return counts;
}

export async function runStages(stages, execute, report, onUpdate = async () => {}) {
  for (const stage of stages) {
    const blockedBy = stage.depends.filter(
      (id) => report.stages.find((item) => item.id === id)?.status !== 'passed',
    );
    const entry = {
      id: stage.id,
      status: 'running',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      exitCode: null,
    };
    report.stages.push(entry);
    if (blockedBy.length) {
      Object.assign(entry, { status: 'blocked', blockedBy });
      await onUpdate(entry);
      continue;
    }
    const started = Date.now();
    try {
      const result = await execute(stage);
      Object.assign(entry, result, {
        status: result.exitCode === 0 ? 'passed' : 'failed',
        durationMs: Date.now() - started,
      });
    } catch {
      Object.assign(entry, {
        status: 'failed',
        exitCode: 1,
        reason: 'Stage execution failed',
        durationMs: Date.now() - started,
      });
    }
    await onUpdate(entry);
  }
  report.passed =
    report.stages.length === stages.length && report.stages.every((stage) => stage.status === 'passed');
  return report.passed;
}

async function assertPortsFree(ports) {
  const listeners = [];
  try {
    for (const port of ports) {
      const server = createServer();
      try {
        await new Promise((done, reject) => {
          server.once('error', reject);
          server.listen(port, '127.0.0.1', done);
        });
      } catch {
        throw new Error(`Verification port ${port} is unavailable; no existing service was stopped`);
      }
      listeners.push(server);
    }
  } finally {
    await Promise.all(listeners.map((server) => new Promise((done) => server.close(done))));
  }
}

const children = new Set();
function startProcess(command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      output = (output + chunk.toString()).slice(-524288);
    });
  const closed = new Promise((done) => {
    child.once('error', () => done({ exitCode: 1, reason: 'Process could not start' }));
    child.once('close', (code, signal) =>
      done({
        exitCode: Number.isInteger(code) ? code : 1,
        ...(signal ? { reason: 'Process terminated by signal' } : {}),
      }),
    );
  });
  return { child, closed, output: () => output };
}

async function stopProcess(child) {
  // Only signal a process group created by this script; never identify processes by their port.
  const signal = (value) => {
    try {
      process.platform === 'win32' ? child.kill(value) : process.kill(-child.pid, value);
    } catch {
      /* Already exited. */
    }
  };
  signal('SIGTERM');
  if (child.exitCode === null && child.signalCode === null)
    await Promise.race([new Promise((done) => child.once('close', done)), pause(3000)]);
  signal('SIGKILL');
  children.delete(child);
}

export function stageEnvironment(id, env) {
  // Vite preserves an inherited NODE_ENV even for `vite build`. Keep test mode
  // for fixtures/servers, but compile the same production web bundle we ship.
  return id === 'build' ? { ...env, NODE_ENV: 'production' } : env;
}

async function commandResult(stage, env) {
  const process = startProcess(stage.command, stage.args, stageEnvironment(stage.id, env));
  let timer;
  const result = await Promise.race([
    process.closed,
    new Promise((done) => {
      timer = setTimeout(() => done({ exitCode: 1, reason: 'Stage deadline exceeded' }), stage.timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  await stopProcess(process.child);
  const outcome = evaluateStageResult(stage.id, result, process.output());
  if (outcome.exitCode !== 0) outcome.log = await failureLog(stage.id, process.output(), env);
  return outcome;
}

export function evaluateStageResult(id, result, output) {
  const summary = safeSummary(id, output);
  if (
    id === 'creative-expression-browser' &&
    !(
      summary.checksPassed >= 10 &&
      summary.expressionsPassed === 32 &&
      summary.externalRequests === 0 &&
      summary.pageErrors === 0
    )
  )
    return { ...result, exitCode: 1, reason: 'Expression browser checks are missing or incomplete', summary };
  if (id === 'audit' && summary.reportAvailable === false)
    return { ...result, exitCode: 1, reason: 'Audit report is missing or invalid', summary };
  if (
    id === 'performance' &&
    (!Number.isInteger(summary.requests) || summary.requests < 1 || summary.errors !== 0)
  )
    return {
      ...result,
      exitCode: 1,
      reason: 'Performance requests failed or its report is incomplete',
      summary,
    };
  if (
    id === 'trusted-references' &&
    (!summary.programsPassed || !summary.casesPassed || summary.failures !== 0)
  )
    return { ...result, exitCode: 1, reason: 'Trusted reference verification is incomplete', summary };
  // Do not label a collection with skipped/cancelled/no tests as full verification.
  if (id === 'unit' || id === 'e2e' || id.startsWith('integration:')) {
    if (
      !summary.tests ||
      summary.pass !== summary.tests ||
      summary.fail ||
      summary.skipped ||
      summary.cancelled ||
      summary.todo
    )
      return { ...result, exitCode: 1, reason: 'Test collection was empty, skipped or incomplete', summary };
  }
  return { ...result, summary };
}

async function healthy(process, url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (process.child.exitCode !== null || process.child.signalCode !== null) return false;
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return true;
    } catch {
      /* Await bind. */
    }
    await pause(200);
  }
  return false;
}

export async function main(args = process.argv.slice(2), inputEnv = process.env) {
  let options;
  try {
    options = parseOptions(args);
    if (options.help) {
      console.log(
        'Usage: node --env-file=.data/review.env scripts/verify-iteration.mjs [--profile full|ci] [--api-port 3002] [--preview-port 3003]\nfull validates all four trusted reference languages; ci explicitly validates Python and JavaScript only.\nRequires Node 22/24, local review PostgreSQL, DEV_SEED_PASSWORD, installed dependencies, browser and free verification ports.\nExisting review data and running services are never reset or stopped.',
      );
      return 0;
    }
    validateEnvironment(inputEnv);
    validateRuntime(process.versions.node);
  } catch (error) {
    console.error(JSON.stringify({ passed: false, stage: 'configuration', reason: error.message }));
    return 1;
  }
  const report = {
    version: 1,
    profile: options.profile,
    requestedReferenceLanguages:
      options.profile === 'full' ? ['python', 'javascript', 'cpp', 'java'] : ['python', 'javascript'],
    fullReferenceCoverage: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    passed: false,
    apiPort: options.apiPort,
    previewPort: options.previewPort,
    stages: [],
  };
  await mkdir(join(root, '.data'), { recursive: true });
  const directory = await mkdtemp(join(root, '.data', 'iteration-'));
  const reportPath = join(directory, 'report.json');
  const save = () => writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  let interrupted = false;
  let releaseLock;
  const interrupt = () => {
    interrupted = true;
    void Promise.all([...children].map(stopProcess));
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    releaseLock = await acquireVerificationLock(join(root, '.data', 'iteration-verification.lock'));
    await assertPortsFree([...new Set([options.apiPort, options.previewPort, ...reservedPorts])]);
    const configPath = join(directory, 'providers-disabled.yaml');
    await writeFile(
      configPath,
      'judge0: {enabled: false}\nai: {enabled: false}\nwebSearch: {enabled: false}\n',
      { mode: 0o600 },
    );
    const api = `http://127.0.0.1:${options.apiPort}`;
    const web = `http://localhost:${options.previewPort}`;
    const env = {
      ...inputEnv,
      PATH: `${dirname(process.execPath)}:${inputEnv.PATH || ''}`,
      NODE_ENV: 'test',
      DATABASE_URL: inputEnv.DATABASE_URL,
      ACADEMICS_TEST_ADMIN_DATABASE_URL: inputEnv.DATABASE_URL,
      ACADEMICS_ADMISSION_TEST_DATABASE_URL: inputEnv.DATABASE_URL,
      ADMIN_JOBS_TEST_ADMIN_DATABASE_URL: inputEnv.DATABASE_URL,
      ALGORITHM_TRAINING_TEST_ADMIN_DATABASE_URL: inputEnv.DATABASE_URL,
      LEARNING_ACTIONS_TEST_ADMIN_DATABASE_URL: inputEnv.DATABASE_URL,
      LEARNING_OVERVIEW_TEST_ADMIN_DATABASE_URL: inputEnv.DATABASE_URL,
      LEARNING_ACTION_FILTERS_TEST_ADMIN_DATABASE_URL: inputEnv.DATABASE_URL,
      TEST_BASE_URL: api,
      TEST_API_URL: `${api}/api`,
      WEB_BASE_URL: web,
      APP_ORIGIN: web,
      BIND_HOST: '127.0.0.1',
      COOKIE_SECURE: 'false',
      DISABLE_JOBS: 'true',
      AI_CONFIG_PATH: configPath,
      // Individual programming fixtures own their preview services. Main verification
      // servers must not try to bind the user's existing development preview port.
      PROGRAMMING_PREVIEW_ENABLED: 'false',
      PROGRAMMING_PREVIEW_PORT: String(programmingPreviewPort),
      PROGRAMMING_PREVIEW_ORIGIN: `http://127.0.0.1:${programmingPreviewPort}`,
      UPLOAD_DIR: resolve(root, inputEnv.UPLOAD_DIR || '.data/iteration-uploads'),
      CLEAN_VERIFY_PORT: '3031',
      VERIFICATION_OUTPUT_DIR: directory,
    };
    // Isolated integration fixtures set their own local provider URLs. Removing inherited
    // overrides keeps the normal servers disabled while allowing those intentional fixtures.
    for (const key of Object.keys(env))
      if (/^ALGORITHM_JUDGE_|^(?:OPENAI|ANTHROPIC|DEEPSEEK|GOOGLE|BING|TAVILY)_.*(?:KEY|TOKEN)$/.test(key))
        delete env[key];
    const tests = discoverTests(await readdir(join(root, 'tests')));
    if (!tests.units.length || !tests.integrations.length)
      throw new Error('Required test collections are missing');
    const stages = buildStages(options, tests);
    const browserSummary = join(directory, 'browser-summary.json');
    const reporterPath = join(directory, 'safe-reporter.mjs');
    await writeFile(
      reporterPath,
      `import {writeFileSync} from 'node:fs';\nexport default class { constructor(){this.tests=[];} onTestEnd(test,result){this.tests.push({title:test.title,status:result.status,expectedStatus:test.expectedStatus,durationMs:result.duration});if(result.status!=='passed')console.error(test.title+'\\n'+(result.error?.stack||result.error?.message||result.status));} onEnd(result){writeFileSync(${JSON.stringify(browserSummary)},JSON.stringify({status:result.status,tests:this.tests}),{mode:0o600});} }\n`,
      { mode: 0o600 },
    );
    const browserConfig = join(directory, 'playwright.config.ts');
    await writeFile(
      browserConfig,
      `import base from ${JSON.stringify(join(root, 'playwright.config.ts'))};\nexport default {...base,testDir:${JSON.stringify(join(root, 'tests/browser'))},outputDir:${JSON.stringify(join(directory, 'browser'))},retries:0,forbidOnly:true,reporter:[[${JSON.stringify(reporterPath)}]],use:{...base.use,baseURL:${JSON.stringify(web)},trace:'off',screenshot:'off',video:'off'}};\n`,
      { mode: 0o600 },
    );
    await runStages(
      stages,
      async (stage) => {
        if (interrupted) return { exitCode: 1, reason: 'Verification interrupted' };
        console.log(`[verify] ${stage.id}`);
        if (stage.kind === 'servers') {
          const back = startProcess(process.execPath, ['apps/api/dist/main.js'], {
            ...env,
            PORT: String(options.apiPort),
            // Real E2E verifies automatic exam deadlines without browser polling.
            DISABLE_JOBS: 'false',
            ALGORITHM_JUDGE_ENABLED: 'false',
          });
          if (!(await healthy(back, `${api}/api/health`)))
            return {
              exitCode: 1,
              reason: 'API health check failed',
              log: await failureLog(stage.id, back.output(), env),
            };
          // The compiled app provides the built web assets and production CSP on the same origin.
          const preview = startProcess(process.execPath, ['apps/api/dist/main.js'], {
            ...env,
            PORT: String(options.previewPort),
            ALGORITHM_JUDGE_ENABLED: 'false',
            // Own a separate preview listener so the shipped CSP authorizes the
            // same isolated origin exercised by the mocked iframe contract.
            PROGRAMMING_PREVIEW_ENABLED: 'true',
          });
          if (
            !(await healthy(preview, `${web}/api/health`)) ||
            !(await fetch(web, { signal: AbortSignal.timeout(3000) })).ok
          )
            return {
              exitCode: 1,
              reason: 'Compiled preview health check failed',
              log: await failureLog(stage.id, preview.output(), env),
            };
          const frameProbe = await fetch(env.PROGRAMMING_PREVIEW_ORIGIN, {
            signal: AbortSignal.timeout(3000),
          });
          const framePolicy = frameProbe.headers.get('content-security-policy') || '';
          if (
            frameProbe.status !== 404 ||
            !framePolicy.includes('sandbox allow-scripts') ||
            !framePolicy.includes(`frame-ancestors ${web}`) ||
            frameProbe.headers.get('cache-control') !== 'no-store'
          )
            return { exitCode: 1, reason: 'Isolated programming preview readiness/policy failed' };
          return { exitCode: 0 };
        }
        if (stage.kind === 'browser') {
          const result = await commandResult(
            {
              ...stage,
              command: process.execPath,
              args: [
                'node_modules/@playwright/test/cli.js',
                'test',
                '--config',
                browserConfig,
                '--workers=1',
                '--trace=off',
                '--retries=0',
                '--fail-on-flaky-tests',
              ],
            },
            env,
          );
          let summary;
          try {
            summary = JSON.parse(await readFile(browserSummary, 'utf8'));
          } catch {
            return { ...result, exitCode: 1, reason: 'Browser report is missing' };
          }
          const complete =
            summary.tests?.length > 0 &&
            summary.tests.every((item) => item.status === 'passed' && item.expectedStatus === 'passed');
          return {
            ...result,
            exitCode: result.exitCode === 0 && complete ? 0 : 1,
            summary: {
              total: summary.tests?.length || 0,
              passed: summary.tests?.filter((item) => item.status === 'passed').length || 0,
              skipped: summary.tests?.filter((item) => item.status === 'skipped').length || 0,
              failedOrIncomplete:
                summary.tests
                  ?.filter((item) => item.status !== 'passed' || item.expectedStatus !== 'passed')
                  .map((item) => ({ title: item.title, status: item.status })) || [],
            },
          };
        }
        return commandResult(stage, env);
      },
      report,
      async (entry) => {
        console.log(`[verify] ${entry.id}: ${entry.status}`);
        await save();
      },
    );
  } catch (error) {
    report.stages.push({
      id: 'preflight',
      status: 'failed',
      exitCode: 1,
      reason:
        error instanceof Error &&
        /^(Verification |Required test collections|Unable to create verification lock)/.test(error.message)
          ? error.message
          : 'Verification setup failed; no existing services were stopped',
    });
  } finally {
    await Promise.all([...children].map(stopProcess));
    await releaseLock?.();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    report.finishedAt = new Date().toISOString();
    if (interrupted) report.passed = false;
    const references = report.stages.find((stage) => stage.id === 'trusted-references');
    report.fullReferenceCoverage =
      references?.status === 'passed' &&
      ['python', 'javascript', 'cpp', 'java'].every((language) =>
        references.summary?.languages?.includes(language),
      );
    report.fullPassed = report.passed && report.fullReferenceCoverage;
    report.testCounts = report.stages.reduce(
      (counts, stage) => {
        const summary = stage.summary || {};
        if (stage.id === 'browser') {
          counts.total += summary.total || 0;
          counts.passed += summary.passed || 0;
          counts.failedOrIncomplete +=
            summary.failedOrIncomplete?.filter((item) => item.status !== 'skipped').length || 0;
          counts.skipped += summary.skipped || 0;
        } else if (stage.id === 'unit' || stage.id === 'e2e' || stage.id.startsWith('integration:')) {
          counts.total += summary.tests || 0;
          counts.passed += summary.pass || 0;
          counts.failedOrIncomplete += (summary.fail || 0) + (summary.cancelled || 0);
          counts.skipped += (summary.skipped || 0) + (summary.todo || 0);
        }
        return counts;
      },
      { total: 0, passed: 0, failedOrIncomplete: 0, skipped: 0 },
    );
    await save();
    await Promise.all(
      ['providers-disabled.yaml', 'playwright.config.ts', 'safe-reporter.mjs'].map((name) =>
        rm(join(directory, name), { force: true }),
      ),
    );
  }
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        fullPassed: report.fullPassed,
        profile: options.profile,
        report: reportPath,
        testCounts: report.testCounts,
        stages: report.stages.map(({ id, status, exitCode }) => ({ id, status, exitCode })),
      },
      null,
      2,
    ),
  );
  return report.passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  void main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error(JSON.stringify({ passed: false, stage: 'runner', reason: 'Verification runner failed' }));
      process.exitCode = 1;
    });
