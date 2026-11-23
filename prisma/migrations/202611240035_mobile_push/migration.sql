CREATE TABLE "MobilePushDevice" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sessionId" TEXT NOT NULL UNIQUE REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "role" TEXT NOT NULL CHECK ("role" = 'STUDENT'),
  "accountMode" TEXT NOT NULL CHECK ("accountMode" IN ('PERSONAL','ORGANIZATION')),
  "tokenHash" TEXT NOT NULL UNIQUE CHECK (char_length("tokenHash") = 64),
  "tokenCiphertext" TEXT NOT NULL CHECK (octet_length("tokenCiphertext") <= 1024),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "MobilePushDevice_organizationId_userId_active_idx" ON "MobilePushDevice"("organizationId","userId","active");
CREATE TABLE "MobilePushDelivery" (
  "id" TEXT PRIMARY KEY,
  "deviceId" TEXT NOT NULL REFERENCES "MobilePushDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "notificationId" TEXT NOT NULL REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','SENDING','TICKET','CHECKING','DELIVERED','FAILED','SKIPPED','UNKNOWN')),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" BETWEEN 0 AND 5),
  "receiptAttempts" INTEGER NOT NULL DEFAULT 0 CHECK ("receiptAttempts" BETWEEN 0 AND 12),
  "ticketId" TEXT CHECK (char_length("ticketId") <= 100),
  "claimId" TEXT,
  "lastErrorCode" TEXT CHECK (char_length("lastErrorCode") <= 80),
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  UNIQUE("deviceId","notificationId")
);
CREATE INDEX "MobilePushDelivery_status_nextAttemptAt_idx" ON "MobilePushDelivery"("status","nextAttemptAt");
CREATE INDEX "MobilePushDelivery_organizationId_userId_idx" ON "MobilePushDelivery"("organizationId","userId");
