/** Native dependency graph stays separate from the website's React version. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../apps/mobile/', import.meta.url));
const output = resolve(root, '.data/verification');
mkdirSync(output, { recursive: true });
const env = {
  ...process.env,
  CI: '1',
  EXPO_NO_TELEMETRY: '1',
  EXPO_PUBLIC_API_ORIGIN: 'https://study.huiliyi.cn',
};
for (const key of Object.keys(env))
  if (key.startsWith('EXPO_PUBLIC_') && key !== 'EXPO_PUBLIC_API_ORIGIN') delete env[key];
const results = [];
for (const script of ['typecheck', 'check:sdk', 'test:build-security', 'audit:build', 'export:android']) {
  const result = spawnSync('npm', ['run', script], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const text = (result.stdout || '') + (result.stderr || '');
  writeFileSync(resolve(output, script.replaceAll(':', '-') + '.log'), text, { mode: 0o600 });
  if (result.error || result.status !== 0) {
    console.error(`FAIL Android ${script}; inspect apps/mobile/.data/verification`);
    process.exit(1);
  }
  results.push(script);
}
const security = readFileSync(resolve(output, 'test-build-security.log'), 'utf8');
const count = (name) => Number(security.match(new RegExp(`# ${name} (\\d+)`))?.[1] || 0);
const audit = JSON.parse(readFileSync(resolve(root, '.data/dependency-audit.json'), 'utf8')).summary;
const metadata = JSON.parse(readFileSync(resolve(root, '.data/export-android/metadata.json'), 'utf8'));
const bundle = metadata.fileMetadata?.android?.bundle;
if (
  count('tests') !== 4 ||
  count('pass') !== 4 ||
  count('fail') ||
  count('skipped') ||
  count('cancelled') ||
  count('todo') ||
  audit.unmitigated.length ||
  !bundle ||
  !existsSync(resolve(root, '.data/export-android', bundle))
)
  throw new Error('Android verification incomplete');
const report = {
  checks: results.length,
  tests: count('tests'),
  pass: count('pass'),
  fail: 0,
  skipped: 0,
  cancelled: 0,
  todo: 0,
  bundle: true,
  audit,
};
writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report));
