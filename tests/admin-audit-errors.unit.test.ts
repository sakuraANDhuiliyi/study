import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { auditUserRestrictError } from './helpers/audit-errors';

const namedMessage = 'Foreign key constraint violated on the constraint: `AuditLog_userId_fkey`';
const restrict =
  'update or delete on table "User" violates RESTRICT setting of foreign key constraint "AuditLog_userId_fkey" on table "AuditLog"';
const known = (message: string, meta?: Record<string, unknown>, code = 'P2003') =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: '6.19.0', meta });
const unknown = (message: string) =>
  new Prisma.PrismaClientUnknownRequestError(message, { clientVersion: '6.19.0' });

test('PG17 specific P2003 constraint accepts field_name, constraint metadata or the actual CI message', () => {
  for (const error of [
    known('Foreign key rejection', { field_name: 'AuditLog_userId_fkey (index)' }),
    known('Foreign key rejection', { constraint: 'AuditLog_userId_fkey' }),
    known(`Invalid db.user.delete invocation\n${namedMessage}`, { modelName: 'User' }),
  ])
    assert.equal(auditUserRestrictError(error), true);
});

test('PG18 specific RESTRICT accepts actual SQLSTATE23001 with plain or connector-escaped quotes', () => {
  for (const message of [restrict, restrict.replaceAll('"', '\\"')])
    assert.equal(
      auditUserRestrictError(unknown(`PostgresError { code: "23001", message: ${message} }`)),
      true,
    );
});

test('Wrong FK/code, generic text and network failures cannot satisfy the audit preservation fixture', () => {
  for (const error of [
    known('Foreign key rejection', { field_name: 'Assignment_userId_fkey (index)' }),
    known(namedMessage, { constraint: 'Assignment_userId_fkey' }),
    known('Foreign key rejection', { constraint: 'AuditLog_userId_fkey_other' }),
    known(namedMessage, { constraint: 'AuditLog_userId_fkey' }, 'P2010'),
    known('Foreign key constraint violated on the constraint: `Assignment_userId_fkey`'),
    known(`Query context mentions AuditLog_userId_fkey; unrelated constraint failed`),
    unknown(`PostgresError { code: "23503", message: ${restrict} }`),
    unknown(
      `PostgresError { code: "23001", message: ${restrict.replaceAll('AuditLog_userId_fkey', 'Assignment_userId_fkey')} }`,
    ),
    unknown(`PostgresError { code: "23001", message: AuditLog_userId_fkey failed }`),
    new Error(`Network connection failed: ${namedMessage}`),
    { code: 'P2003', meta: { constraint: 'AuditLog_userId_fkey' }, message: namedMessage },
    null,
  ])
    assert.equal(auditUserRestrictError(error), false);
});
