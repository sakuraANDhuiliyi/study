ALTER TABLE "Organization"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'INSTITUTION',
  ADD COLUMN "joinEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "inviteCode" TEXT,
  ADD CONSTRAINT "Organization_kind_check" CHECK ("kind" IN ('INSTITUTION', 'PERSONAL')),
  ADD CONSTRAINT "Organization_personal_join_check" CHECK ("kind" <> 'PERSONAL' OR (NOT "joinEnabled" AND "inviteCode" IS NULL));
CREATE UNIQUE INDEX "Organization_inviteCode_key" ON "Organization"("inviteCode");
CREATE INDEX "Organization_kind_createdAt_id_idx" ON "Organization"("kind","createdAt","id");

ALTER TABLE "User"
  ADD COLUMN "accountMode" TEXT NOT NULL DEFAULT 'ORGANIZATION',
  ADD COLUMN "personalOrganizationId" TEXT,
  ADD COLUMN "majorId" TEXT,
  ADD COLUMN "personalMajorId" TEXT,
  ADD CONSTRAINT "User_accountMode_check" CHECK ("accountMode" IN ('ORGANIZATION', 'PERSONAL')),
  ADD CONSTRAINT "User_personal_space_check" CHECK ("accountMode" <> 'PERSONAL' OR ("personalOrganizationId" IS NOT NULL AND "organizationId" = "personalOrganizationId")),
  ADD CONSTRAINT "User_personalOrganizationId_fkey" FOREIGN KEY ("personalOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "User_personalOrganizationId_key" ON "User"("personalOrganizationId");

CREATE TABLE "OrganizationJoinRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "majorId" TEXT,
  "note" TEXT NOT NULL DEFAULT '',
  "reviewedBy" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "OrganizationJoinRequest_status_check" CHECK ("status" IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  CONSTRAINT "OrganizationJoinRequest_note_check" CHECK (char_length("note") <= 500 AND octet_length("note") <= 1500)
);
CREATE INDEX "OrganizationJoinRequest_organizationId_status_createdAt_id_idx" ON "OrganizationJoinRequest"("organizationId","status","createdAt","id");
CREATE INDEX "OrganizationJoinRequest_userId_createdAt_id_idx" ON "OrganizationJoinRequest"("userId","createdAt","id");
CREATE UNIQUE INDEX "OrganizationJoinRequest_pending_user_key" ON "OrganizationJoinRequest"("userId") WHERE "status" = 'PENDING';
