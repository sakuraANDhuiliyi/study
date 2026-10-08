CREATE TABLE "PersonalTask" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "dueAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PersonalTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PersonalTask_title_check" CHECK (char_length("title") BETWEEN 1 AND 160),
  CONSTRAINT "PersonalTask_description_check" CHECK (char_length("description") <= 10000),
  CONSTRAINT "PersonalTask_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "PersonalTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PersonalTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PersonalTask_organizationId_userId_dueAt_id_idx" ON "PersonalTask"("organizationId","userId","dueAt","id");
CREATE INDEX "PersonalTask_userId_idx" ON "PersonalTask"("userId");
