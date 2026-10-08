import { HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PrismaService } from '../common/prisma.service';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** PostgreSQL's row lock makes reservation atomic across concurrent requests and replicas. */
async function reserve(db: PrismaService, key: string, limit: number) {
  const [window] = await db.$queryRaw<{ count: number; expiresAt: Date }[]>`
    INSERT INTO "AuthAttemptWindow" ("key", "count", "expiresAt")
    VALUES (${key}, 1, CURRENT_TIMESTAMP + INTERVAL '15 minutes')
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "AuthAttemptWindow"."expiresAt" <= CURRENT_TIMESTAMP
        THEN 1 ELSE LEAST("AuthAttemptWindow"."count" + 1, ${limit + 1}) END,
      "expiresAt" = CASE WHEN "AuthAttemptWindow"."expiresAt" <= CURRENT_TIMESTAMP
        THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE "AuthAttemptWindow"."expiresAt" END
    RETURNING "count", "expiresAt"
  `;
  return { key, ...window };
}

export async function reserveAuthAttempt(db: PrismaService, ip: string, account: string, scope = 'login') {
  // Consume the IP budget first so a throttled caller cannot insert unlimited account keys.
  const ipWindow = await reserve(db, `${scope}:ip:${digest(ip)}`, 50);
  if (ipWindow.count > 50) throw new HttpException('请求次数过多，请 15 分钟后再试', 429);
  const accountWindow = await reserve(db, `${scope}:account:${digest(account.toLowerCase())}`, 8);
  if (accountWindow.count > 8) throw new HttpException('请求次数过多，请 15 分钟后再试', 429);
  if (ipWindow.count === 1)
    await db.$executeRaw`
      DELETE FROM "AuthAttemptWindow" WHERE "key" IN (
        SELECT "key" FROM "AuthAttemptWindow" WHERE "expiresAt" <= CURRENT_TIMESTAMP LIMIT 1000
      )
      AND "expiresAt" <= CURRENT_TIMESTAMP
    `;
  return { ipWindow, accountWindow };
}

/** Return only this successful request's reservation, preserving concurrent failures. */
export async function releaseAuthAttempt(
  db: PrismaService,
  reservation: Awaited<ReturnType<typeof reserveAuthAttempt>>,
) {
  const { ipWindow, accountWindow } = reservation;
  await db.$executeRaw`
    UPDATE "AuthAttemptWindow" SET "count" = GREATEST(0, "count" - 1)
    WHERE ("key" = ${ipWindow.key} AND "expiresAt" = ${ipWindow.expiresAt})
       OR ("key" = ${accountWindow.key} AND "expiresAt" = ${accountWindow.expiresAt})
  `;
}
