ALTER TABLE "UploadOperation" ADD COLUMN "cleanupAttemptedAt" TIMESTAMPTZ(3);
ALTER TABLE "PendingFileDeletion" ADD COLUMN "retryAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
DROP INDEX "PendingFileDeletion_createdAt_idx";
CREATE INDEX "PendingFileDeletion_retryAt_idx" ON "PendingFileDeletion"("retryAt");
