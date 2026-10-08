import { PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';

export function runtimeRoleConfiguration(environment = process.env) {
  const name = environment.APP_DATABASE_USER || 'lms_app';
  const password = environment.APP_DATABASE_PASSWORD;
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(name) || name.startsWith('pg_'))
    throw new Error('APP_DATABASE_USER must be a simple non-system PostgreSQL role name');
  if (!password || !/^[A-Za-z0-9_-]{16,128}$/.test(password))
    throw new Error(
      'Set a distinct APP_DATABASE_PASSWORD of 16-128 URL-safe letters, digits, underscore or hyphen',
    );
  if (!environment.DATABASE_URL) throw new Error('Migration DATABASE_URL is required');
  const migration = new URL(environment.DATABASE_URL);
  if (decodeURIComponent(migration.username) === name || decodeURIComponent(migration.password) === password)
    throw new Error('Runtime and migration roles must use distinct names and passwords');
  return { name, password };
}
export async function provisionRuntimeRole(db, environment = process.env) {
  const { name, password } = runtimeRoleConfiguration(environment);
  const identifier = `"${name}"`;
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('runtime-role-provision'))`;
      const rows =
        await tx.$queryRaw`SELECT oid, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = ${name}`;
      if (rows.length) {
        const role = rows[0];
        const [unsafe] = await tx.$queryRaw`SELECT
        EXISTS (SELECT 1 FROM pg_auth_members WHERE member = ${role.oid}::oid) AS membership,
        EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relowner = ${role.oid}::oid) AS ownership`;
        if (
          role.rolsuper ||
          role.rolcreatedb ||
          role.rolcreaterole ||
          role.rolreplication ||
          role.rolbypassrls ||
          unsafe.membership ||
          unsafe.ownership
        )
          throw new Error(
            'Existing runtime role has unsafe privileges or ownership; choose a fresh restricted role',
          );
      }
      // Both values have strict allowlists above. Never log these statements or upstream errors.
      await tx.$executeRawUnsafe(
        `${rows.length ? 'ALTER' : 'CREATE'} ROLE ${identifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
      );
      const [database] = await tx.$queryRaw`SELECT current_database() AS name`;
      const databaseIdentifier = `"${database.name.replaceAll('"', '""')}"`;
      await tx.$executeRawUnsafe(`REVOKE ALL ON DATABASE ${databaseIdentifier} FROM ${identifier}`);
      await tx.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${identifier}`);
      await tx.$executeRawUnsafe('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
      await tx.$executeRawUnsafe(`REVOKE ALL ON SCHEMA public FROM ${identifier}`);
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${identifier}`);
      await tx.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${identifier}`);
      await tx.$executeRawUnsafe(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${identifier}`);
      const tables =
        await tx.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
      for (const table of tables) {
        const tableIdentifier = `"${table.tablename.replaceAll('"', '""')}"`;
        await tx.$executeRawUnsafe(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${tableIdentifier} TO ${identifier}`,
        );
      }
      await tx.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${identifier}`);
    },
    { timeout: 30000 },
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = new PrismaClient();
  try {
    await provisionRuntimeRole(db);
    console.log('Restricted runtime database role provisioned.');
  } catch {
    console.error('Runtime database provisioning failed; verify distinct credentials and role privileges.');
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
