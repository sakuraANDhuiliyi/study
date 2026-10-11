import { spawn } from 'node:child_process';
const child = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  env: { ...process.env, ANDROID_AGENT_ENABLED: 'true' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
