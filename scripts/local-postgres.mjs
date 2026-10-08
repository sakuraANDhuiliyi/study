import 'dotenv/config';
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
if (process.env.NODE_ENV === 'production')
  throw new Error(
    'Embedded local database is development-only; use managed or Docker PostgreSQL in production.',
  );
const url = new URL(process.env.DATABASE_URL || 'postgresql://lms:lms_local_only@127.0.0.1:55432/zhixue');
if (!['localhost', '127.0.0.1'].includes(url.hostname))
  throw new Error('Local database requires localhost DATABASE_URL');
const databaseDir = resolve('.data/postgres');
mkdirSync(databaseDir, { recursive: true });
const pg = new EmbeddedPostgres({
  databaseDir,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  port: Number(url.port) || 55432,
  persistent: true,
  authMethod: 'scram-sha-256',
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {},
  onError: (message) => {
    if (String(message).includes('FATAL'))
      console.error('PostgreSQL failed. Check local directory and port.');
  },
});
if (!existsSync(resolve(databaseDir, 'PG_VERSION'))) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
const name = url.pathname.slice(1);
if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(name)) throw new Error('Invalid database name');
const result = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
if (!result.rows.length) await pg.createDatabase(name);
await client.end();
console.log(
  `PostgreSQL ready on 127.0.0.1:${url.port}; database ${name}; persistent directory .data/postgres`,
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
setInterval(() => {}, 60000);
