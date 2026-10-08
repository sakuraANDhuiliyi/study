import { Prisma } from '@prisma/client';

export async function assertRuntimeDatabaseRole(db: { $queryRaw<T>(query: Prisma.Sql): Promise<T> }) {
  const [role] = await db.$queryRaw<{ elevated: boolean; ddl: boolean; ownsTables: boolean }[]>(Prisma.sql`
    SELECT (
      r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR
      EXISTS (SELECT 1 FROM pg_roles privileged WHERE
        (privileged.rolsuper OR privileged.rolcreatedb OR privileged.rolcreaterole OR privileged.rolreplication OR privileged.rolbypassrls
          OR privileged.rolname IN ('pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program', 'pg_read_all_data', 'pg_write_all_data'))
        AND pg_has_role(current_user, privileged.oid, 'MEMBER'))
    ) AS elevated,
    (has_database_privilege(current_user, current_database(), 'CREATE')
      OR has_schema_privilege(current_user, 'public', 'CREATE')) AS ddl,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
      AND pg_has_role(current_user, c.relowner, 'MEMBER')) AS "ownsTables"
    FROM pg_roles r WHERE r.rolname = current_user`);
  if (!role || role.elevated || role.ddl || role.ownsTables)
    throw new Error(
      'Production requires a separate runtime database role without elevated privileges, DDL permissions or table ownership',
    );
}
