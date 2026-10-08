import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const mode = process.argv[2] || 'backup';
const folder = resolve(process.argv[3] || `.data/backups/${new Date().toISOString().replace(/[:.]/g, '-')}`);
function binary(name) {
  if (process.env.PG_BIN) return join(process.env.PG_BIN, name);
  const packageDir = resolve(`node_modules/@embedded-postgres/${process.platform}-${process.arch}`);
  function search(dir, depth = 0) {
    if (depth > 5 || !existsSync(dir)) return null;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name === name) return join(dir, e.name);
      if (e.isDirectory()) {
        const found = search(join(dir, e.name), depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  return search(packageDir) || name;
}
function requireClient(name) {
  const executable = binary(name);
  try {
    execFileSync(executable, ['--version'], { stdio: 'pipe' });
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error(
        `${name} is missing. Install PostgreSQL client tools at least as new as the server and set PG_BIN to their bin directory, or add them to PATH.`,
      );
    throw error;
  }
  return executable;
}
function pgEnv(url) {
  const u = new URL(url);
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.slice(1),
    ...(u.searchParams.get('sslmode') ? { PGSSLMODE: u.searchParams.get('sslmode') } : {}),
  };
}
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
if (mode === 'backup') {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const pgDump = requireClient('pg_dump');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  execFileSync(
    pgDump,
    ['--format=custom', '--no-owner', '--no-privileges', '--file', join(folder, 'database.dump')],
    { env: pgEnv(process.env.DATABASE_URL), stdio: 'pipe' },
  );
  const uploads = resolve(process.env.UPLOAD_DIR || 'uploads');
  mkdirSync(uploads, { recursive: true });
  execFileSync('tar', ['-czf', join(folder, 'uploads.tar.gz'), '-C', uploads, '.']);
  for (const f of ['database.dump', 'uploads.tar.gz']) chmodSync(join(folder, f), 0o600);
  writeFileSync(
    join(folder, 'manifest.json'),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        files: {
          'database.dump': hash(join(folder, 'database.dump')),
          'uploads.tar.gz': hash(join(folder, 'uploads.tar.gz')),
        },
        note: 'For a consistent production backup, pause writes and workers during database and file capture.',
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log('Backup created: ' + folder);
} else if (mode === 'restore' || mode === 'verify') {
  const pgRestore = requireClient('pg_restore');
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
  for (const [file, sha] of Object.entries(manifest.files))
    if (hash(join(folder, file)) !== sha) throw new Error('Backup checksum mismatch: ' + file);
  if (mode === 'restore') {
    if (
      !process.argv.includes('--confirm') ||
      !process.env.RESTORE_DATABASE_URL ||
      !process.env.RESTORE_UPLOAD_DIR
    )
      throw new Error(
        'Explicit restore requires RESTORE_DATABASE_URL, RESTORE_UPLOAD_DIR and --confirm; use an empty database and directory.',
      );
    const target = new PrismaClient({ datasourceUrl: process.env.RESTORE_DATABASE_URL });
    const tables =
      await target.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`;
    await target.$disconnect();
    if (tables.length)
      throw new Error('Restore target database is not empty. Refusing destructive overwrite.');
    const uploads = resolve(process.env.RESTORE_UPLOAD_DIR);
    if (existsSync(uploads) && readdirSync(uploads).length)
      throw new Error('Restore file directory must be empty');
    mkdirSync(uploads, { recursive: true, mode: 0o700 });
    execFileSync(
      pgRestore,
      [
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        '--dbname',
        new URL(process.env.RESTORE_DATABASE_URL).pathname.slice(1),
        join(folder, 'database.dump'),
      ],
      { env: pgEnv(process.env.RESTORE_DATABASE_URL), stdio: 'pipe' },
    );
    execFileSync('tar', ['-xzf', join(folder, 'uploads.tar.gz'), '-C', uploads]);
    console.log(
      'Database and uploads restored. Point application to restored database and files, then verify /api/health and authorized downloads.',
    );
  } else {
    if (process.env.NODE_ENV === 'production')
      throw new Error('Automated restore verification only runs in development.');
    const source = new PrismaClient();
    const restoreName = 'zhixue_verify_' + Date.now();
    const targetUrl = new URL(process.env.DATABASE_URL);
    targetUrl.pathname = '/' + restoreName;
    let target;
    try {
      await source.$executeRawUnsafe(`CREATE DATABASE "${restoreName}"`);
      execFileSync(
        pgRestore,
        [
          '--exit-on-error',
          '--no-owner',
          '--no-privileges',
          '--dbname',
          restoreName,
          join(folder, 'database.dump'),
        ],
        { env: pgEnv(targetUrl.href), stdio: 'pipe' },
      );
      target = new PrismaClient({ datasourceUrl: targetUrl.href });
      const counts = async (db) => ({
        users: await db.user.count(),
        courses: await db.course.count(),
        assignments: await db.assignmentSubmission.count(),
        attempts: await db.examAttempt.count(),
        messages: await db.message.count(),
        attachments: await db.attachment.count(),
      });
      const a = await counts(source),
        b = await counts(target);
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Source changed or restore counts differ');
      const restoredFiles = join(folder, 'verified-files');
      mkdirSync(restoredFiles, { recursive: true });
      execFileSync('tar', ['-xzf', join(folder, 'uploads.tar.gz'), '-C', restoredFiles]);
      const fileRecords = await target.attachment.findMany();
      for (const file of fileRecords) {
        const path = resolve(restoredFiles, file.storageKey);
        if (!path.startsWith(restoredFiles + '/') || !existsSync(path) || hash(path) !== file.sha256)
          throw new Error('File recovery mismatch: ' + file.id);
      }
      const result = {
        verifiedAt: new Date().toISOString(),
        databaseCounts: b,
        verifiedFiles: fileRecords.length,
        checksums: true,
      };
      writeFileSync(join(folder, 'verification.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result, null, 2));
    } finally {
      if (target) await target.$disconnect();
      await source.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${restoreName}" WITH (FORCE)`);
      await source.$disconnect();
    }
  }
} else throw new Error('Use backup, restore or verify');
