-- A removed file continues to consume quota until physical deletion succeeds.
CREATE TABLE "PendingFileDeletion" (
  "storageKey" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "size" INTEGER NOT NULL CHECK ("size" > 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PendingFileDeletion_organizationId_ownerId_idx" ON "PendingFileDeletion"("organizationId", "ownerId");
CREATE INDEX "PendingFileDeletion_createdAt_idx" ON "PendingFileDeletion"("createdAt");
