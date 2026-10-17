const { spawnSync } = require('node:child_process');
const { writeFileSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { check } = require('./harden-build.cjs');
const root = resolve(__dirname, '..');
const hardening = check();
const result = spawnSync('npm', ['audit', '--workspaces=false', '--json'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 120000,
  maxBuffer: 10 * 1024 * 1024,
});
if (result.error) throw new Error('Mobile dependency audit unavailable');
let audit;
try {
  audit = JSON.parse(result.stdout);
} catch {
  throw new Error('Invalid dependency audit response');
}
if (!audit.metadata?.vulnerabilities || audit.error) throw new Error('Mobile dependency audit incomplete');
const allowed = new Set(hardening.backportedAdvisories);
const unmitigated = [];
for (const [name, item] of Object.entries(audit.vulnerabilities || {}))
  for (const via of item.via || []) {
    if (typeof via === 'string') continue;
    const id = String(via.url || '')
      .split('/')
      .at(-1);
    if (!allowed.has(id)) unmitigated.push({ name, id, severity: via.severity });
  }
const summary = {
  rawVulnerabilities: audit.metadata.vulnerabilities,
  backportedAdvisories: hardening.backportedAdvisories,
  patchedFilesVerified: hardening.patchedFilesVerified,
  unmitigated,
};
mkdirSync(resolve(root, '.data'), { recursive: true });
writeFileSync(resolve(root, '.data/dependency-audit.json'), JSON.stringify({ summary, audit }, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify(summary));
if (unmitigated.length) process.exitCode = 1;
