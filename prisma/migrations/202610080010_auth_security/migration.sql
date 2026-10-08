CREATE TABLE "AuthAttemptWindow" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AuthAttemptWindow_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "AuthAttemptWindow_count_check" CHECK ("count" >= 0)
);
CREATE INDEX "AuthAttemptWindow_expiresAt_idx" ON "AuthAttemptWindow"("expiresAt");

CREATE TABLE "PasswordRecovery" (
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "pendingUntil" TIMESTAMPTZ(3),
  "requestedAuthVersion" INTEGER,
  "requestedBy" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordRecovery_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "PasswordRecovery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "PasswordRecovery_codeHash_key" ON "PasswordRecovery"("codeHash");
