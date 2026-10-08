CREATE TABLE "AiStudyReport" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','ready','failed')),
  "reflection" TEXT NOT NULL DEFAULT '' CHECK (octet_length("reflection") <= 8000),
  "mistakes" JSONB NOT NULL,
  "analysis" JSONB,
  "search" JSONB,
  "error" TEXT,
  "searchError" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "AiStudyReport_organizationId_userId_createdAt_id_idx" ON "AiStudyReport"("organizationId","userId","createdAt","id");
CREATE INDEX "AiStudyReport_userId_idx" ON "AiStudyReport"("userId");

CREATE TABLE "AiStudyReportSource" (
  "reportId" TEXT NOT NULL REFERENCES "AiStudyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "mistakeId" TEXT NOT NULL REFERENCES "MistakeRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "courseId" TEXT NOT NULL REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "questionId" TEXT NOT NULL REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "questionVersionId" TEXT NOT NULL REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "practiceAnswerId" TEXT NOT NULL REFERENCES "PracticeAnswer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AiStudyReportSource_pkey" PRIMARY KEY ("reportId","mistakeId")
);
CREATE INDEX "AiStudyReportSource_mistakeId_idx" ON "AiStudyReportSource"("mistakeId");
CREATE INDEX "AiStudyReportSource_courseId_idx" ON "AiStudyReportSource"("courseId");
CREATE INDEX "AiStudyReportSource_questionId_idx" ON "AiStudyReportSource"("questionId");
CREATE INDEX "AiStudyReportSource_questionVersionId_idx" ON "AiStudyReportSource"("questionVersionId");
CREATE INDEX "AiStudyReportSource_practiceAnswerId_idx" ON "AiStudyReportSource"("practiceAnswerId");

CREATE TABLE "AiStudyOperation" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reportId" TEXT REFERENCES "AiStudyReport"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('analysis','search','download')),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','completed','failed')),
  "leaseExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "errorCode" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3)
);
CREATE INDEX "AiStudyOperation_organizationId_userId_createdAt_idx" ON "AiStudyOperation"("organizationId","userId","createdAt");
CREATE INDEX "AiStudyOperation_userId_status_leaseExpiresAt_idx" ON "AiStudyOperation"("userId","status","leaseExpiresAt");
CREATE INDEX "AiStudyOperation_reportId_idx" ON "AiStudyOperation"("reportId");
-- Every reservation holds a per-user advisory lock. This index is a second DB-level guard.
CREATE UNIQUE INDEX "AiStudyOperation_one_pending_per_user" ON "AiStudyOperation"("organizationId","userId") WHERE "status" = 'pending';
