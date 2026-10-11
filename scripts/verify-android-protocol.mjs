import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const python = process.env.ANDROID_AGENT_PYTHON || resolve('.data/android-venv/bin/python');
const child = spawn(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_lms_bridge.py'], {
  cwd: resolve('services/android-agent'),
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (b) => (output = (output + b).slice(-20000)));
child.on('error', () => {
  console.error('Android protocol Python runtime unavailable. Run npm run android:setup first.');
  process.exitCode = 1;
});
child.on('close', (code) => {
  const match = /Ran (\d+) tests?/.exec(output);
  const count = Number(match?.[1] || 0);
  if (code !== 0 || count < 3 || !/\bOK\b/.test(output) || /skipped=/.test(output)) {
    console.error(output);
    process.exitCode = 1;
  } else console.log(`# tests ${count}\n# pass ${count}\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0`);
});
