import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

if (process.env.NODE_ENV === 'production') throw new Error('Development verification only');
if (!process.env.DATABASE_URL || !process.env.DEV_SEED_PASSWORD)
  throw new Error('DATABASE_URL and DEV_SEED_PASSWORD are required');
const source = new PrismaClient();
const name = `zhixue_clean_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/' + name;
const port = Number(process.env.CLEAN_VERIFY_PORT) || 3031;
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  DATABASE_URL: url.href,
  NODE_ENV: 'development',
  APP_ORIGIN: origin,
  COOKIE_SECURE: 'false',
  PORT: String(port),
  BIND_HOST: '127.0.0.1',
  UPLOAD_DIR: resolve('.data/clean-verify-uploads'),
};
let db;
let server;
let created = false;
try {
  await source.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  execFileSync(resolve('node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', 'prisma'], {
    env,
    stdio: 'pipe',
  });
  db = new PrismaClient({ datasourceUrl: url.href });
  const counts = async () => ({
    users: await db.user.count(),
    courses: await db.course.count(),
    questions: await db.question.count(),
    assignments: await db.assignment.count(),
    exams: await db.exam.count(),
    messages: await db.message.count(),
  });
  execFileSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], { env, stdio: 'pipe' });
  const first = await counts();
  execFileSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], { env, stdio: 'pipe' });
  const second = await counts();
  // Re-running an initializer must not restore a revoked authorization.
  await db.rolePermission.delete({
    where: { roleId_permissionId: { roleId: 'TEACHER', permissionId: 'data.export' } },
  });
  execFileSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], { env, stdio: 'pipe' });
  if (await db.rolePermission.count({ where: { roleId: 'TEACHER', permissionId: 'data.export' } }))
    throw new Error('Seed restored a revoked permission');
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/bootstrap.ts'], {
    env: {
      ...env,
      NODE_ENV: 'production',
      BOOTSTRAP_USERNAME: 'verified-bootstrap-admin',
      BOOTSTRAP_PASSWORD: randomBytes(24).toString('hex'),
      BOOTSTRAP_ORGANIZATION_ID: 'org-bootstrap-verification',
    },
    stdio: 'pipe',
  });
  const initialized = await db.user.findUnique({
    where: { username: 'verified-bootstrap-admin' },
    include: { roles: true },
  });
  if (!initialized?.roles.some((role) => role.roleId === 'SUPER_ADMIN'))
    throw new Error('Controlled bootstrap failed');
  if (await db.rolePermission.count({ where: { roleId: 'TEACHER', permissionId: 'data.export' } }))
    throw new Error('Bootstrap restored a revoked permission');
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('Seed is not repeatable');
  server = spawn(process.execPath, ['apps/api/dist/main.js'], { env, stdio: 'ignore' });
  let healthy = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error('Clean application startup failed');
    try {
      const health = await fetch(origin + '/api/health');
      if (health.ok) {
        healthy = true;
        break;
      }
    } catch {
      /* Wait for the application to bind its local port. */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!healthy) throw new Error('Clean application health check timed out');
  const logins = [];
  for (const username of ['student', 'teacher', 'admin', 'superadmin']) {
    const result = await fetch(origin + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ username, password: process.env.DEV_SEED_PASSWORD }),
    });
    if (!result.ok) throw new Error(`Clean login failed for ${username}`);
    const body = await result.json();
    if (!body.csrfToken || !result.headers.get('set-cookie')?.includes('HttpOnly'))
      throw new Error('Cookie/CSRF initialization failed');
    logins.push(username);
  }
  const result = {
    verifiedAt: new Date().toISOString(),
    emptyDatabaseMigration: true,
    repeatableSeed: true,
    preservesRevokedPermissions: true,
    controlledProductionBootstrap: true,
    health: true,
    roleLogins: logins,
    counts: second,
    note: 'Fresh disposable PostgreSQL database using installed locked dependencies and compiled API. Docker and fresh dependency download are separate checks.',
  };
  mkdirSync('.data', { recursive: true });
  writeFileSync('.data/clean-start-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill('SIGTERM');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  if (db) await db.$disconnect();
  if (created) await source.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  await source.$disconnect();
}
