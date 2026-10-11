import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import YAML from 'yaml';
async function run(command, args) {
  const child = spawn(command, args, { stdio: 'inherit' });
  await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? done() : reject(Error('Android dependency setup failed'))));
  });
}
const root = resolve('.data/android-agent');
await mkdir(root, { recursive: true });
const python = process.env.ANDROID_SETUP_PYTHON || 'python3';
await run(python, ['-m', 'venv', resolve('.data/android-venv')]);
const runtime = resolve('.data/android-venv/bin/python');
await run(runtime, [
  '-m',
  'pip',
  'install',
  '--require-hashes',
  '-r',
  'services/android-agent/requirements.lock',
]);
const configPath = resolve('.data/android-agent/config.yaml');
try {
  await access(configPath);
} catch {
  const settings = YAML.parse(await readFile('config.yaml', 'utf8'));
  const ai = settings.ai || {};
  await writeFile(
    configPath,
    YAML.stringify({
      provider: 'deepseek',
      model: ai.model || 'deepseek-flash',
      api_key: ai.apiKey || '',
      base_url: ai.baseUrl || 'https://api.deepseek.com',
      auto_build_after_edit: true,
      terminal_enabled: false,
      registration_enabled: false,
      admin_ui_enabled: false,
    }),
    { mode: 0o600 },
  );
}
console.log('Android dependencies and private configuration ready. AI was not called.');
