import 'dotenv/config';
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch, totalmem } from 'node:os';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
const concurrency = Number(process.env.PERF_CONCURRENCY) || 10,
  requests = Number(process.env.PERF_REQUESTS) || 100;
const login = await fetch(base + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: process.env.PERF_USERNAME || 'student',
    password: process.env.DEV_SEED_PASSWORD,
  }),
});
if (!login.ok) throw new Error('Performance login failed');
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
const samples = [];
let index = 0,
  errors = 0;
const start = performance.now();
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (index++ < requests) {
      const t = performance.now();
      try {
        const res = await fetch(base + '/api/courses', { headers: { cookie } });
        await res.arrayBuffer();
        if (!res.ok) errors++;
      } catch {
        errors++;
      }
      samples.push(performance.now() - t);
    }
  }),
);
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      environment: {
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0].model,
        cores: cpus().length,
        memoryGB: Math.round(totalmem() / 2 ** 30),
        node: process.version,
      },
      endpoint: 'GET /api/courses (authenticated)',
      concurrency,
      requests,
      errors,
      elapsedMs: Math.round(performance.now() - start),
      latencyMs: {
        p50: Math.round(samples[Math.floor(samples.length * 0.5)]),
        p95: Math.round(samples[Math.floor(samples.length * 0.95)]),
        max: Math.round(samples.at(-1)),
      },
      note: 'Local measurement only. Does not claim production capacity or distributed exam load.',
    },
    null,
    2,
  ),
);
