ALTER TABLE "Session" ADD COLUMN "clientType" TEXT NOT NULL DEFAULT 'WEB';
ALTER TABLE "Session" ADD CONSTRAINT "Session_clientType_check" CHECK ("clientType" IN ('WEB','MOBILE'));
CREATE TABLE "MobileCredential" (
  "sessionId" TEXT PRIMARY KEY REFERENCES "Session"("id") ON DELETE CASCADE,
  "accessHash" TEXT NOT NULL UNIQUE CHECK ("accessHash" ~ '^[a-f0-9]{64}$'),
  "accessExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "refreshHash" TEXT NOT NULL UNIQUE CHECK ("refreshHash" ~ '^[a-f0-9]{64}$'),
  "deviceName" TEXT NOT NULL CHECK (char_length("deviceName") BETWEEN 1 AND 60),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MobileCredential_accessExpiresAt_idx" ON "MobileCredential"("accessExpiresAt");
CREATE TABLE "MobileRefreshUse" (
  "hash" TEXT PRIMARY KEY CHECK ("hash" ~ '^[a-f0-9]{64}$'),
  "sessionId" TEXT NOT NULL REFERENCES "Session"("id") ON DELETE CASCADE,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "MobileRefreshUse_sessionId_idx" ON "MobileRefreshUse"("sessionId");
CREATE INDEX "MobileRefreshUse_expiresAt_idx" ON "MobileRefreshUse"("expiresAt");
