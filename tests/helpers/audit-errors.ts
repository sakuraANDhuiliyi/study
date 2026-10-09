import { Prisma } from '@prisma/client';

const constraint = 'AuditLog_userId_fkey';
const namedConstraint = (value: string) => value === constraint || value === `${constraint} (index)`;

/** Accept this specific FK rejection, never an arbitrary failed fixture delete. */
export function auditUserRestrictError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code !== 'P2003') return false;
    const names = [error.meta?.field_name, error.meta?.constraint].filter(
      (value): value is string => typeof value === 'string' && value.includes('_fkey'),
    );
    // Connector versions expose either metadata key. Explicit conflicting FK
    // metadata must not be overridden by a name mentioned elsewhere in a message.
    if (names.length) return names.every(namedConstraint);
    // PG17 can provide only the precise named-constraint line in Prisma's message.
    return error.message
      .split('\n')
      .some((line) =>
        /^\s*Foreign key constraint violated on the constraint:\s*(?:`AuditLog_userId_fkey`|"AuditLog_userId_fkey"|'AuditLog_userId_fkey'|AuditLog_userId_fkey)\s*\.?\s*$/.test(
          line,
        ),
      );
  }
  if (!(error instanceof Prisma.PrismaClientUnknownRequestError)) return false;
  // PG18 RESTRICT is SQLSTATE 23001, which Prisma can wrap as UnknownRequestError.
  const message = error.message.replaceAll('\\"', '"');
  return (
    /\bcode\s*:\s*"23001"/.test(message) &&
    message.includes(
      'update or delete on table "User" violates RESTRICT setting of foreign key constraint "AuditLog_userId_fkey" on table "AuditLog"',
    )
  );
}
