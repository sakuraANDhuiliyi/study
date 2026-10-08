CREATE TABLE "AlgorithmDraft" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "problemId" TEXT NOT NULL,
  "language" TEXT NOT NULL CHECK ("language" IN ('cpp','python','javascript','java')),
  "code" TEXT NOT NULL CHECK (octet_length("code") <= 48000),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "AlgorithmDraft_organizationId_userId_problemId_key" ON "AlgorithmDraft"("organizationId","userId","problemId");
CREATE INDEX "AlgorithmDraft_userId_idx" ON "AlgorithmDraft"("userId");

CREATE TABLE "AlgorithmSubmission" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "problemId" TEXT NOT NULL,
  "language" TEXT NOT NULL CHECK ("language" IN ('cpp','python','javascript','java')),
  "code" TEXT NOT NULL CHECK (octet_length("code") <= 48000),
  "mode" TEXT NOT NULL CHECK ("mode" IN ('run','submit')),
  "customInput" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" TEXT NOT NULL DEFAULT 'running' CHECK ("status" IN ('running','accepted','wrong_answer','compile_error','runtime_error','time_limit','memory_limit','system_error')),
  "passed" INTEGER NOT NULL DEFAULT 0 CHECK ("passed" >= 0),
  "total" INTEGER NOT NULL DEFAULT 0 CHECK ("total" >= "passed"),
  "runtimeMs" INTEGER,
  "memoryKb" INTEGER,
  "compileOutput" TEXT,
  "error" TEXT,
  "results" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "AlgorithmSubmission_owner_problem_history_idx" ON "AlgorithmSubmission"("organizationId","userId","problemId","createdAt","id");
CREATE INDEX "AlgorithmSubmission_organizationId_userId_mode_status_idx" ON "AlgorithmSubmission"("organizationId","userId","mode","status");
CREATE INDEX "AlgorithmSubmission_userId_idx" ON "AlgorithmSubmission"("userId");

CREATE TABLE "AlgorithmAnalysis" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "problemId" TEXT NOT NULL,
  "language" TEXT NOT NULL CHECK ("language" IN ('cpp','python','javascript','java')),
  "code" TEXT NOT NULL CHECK (octet_length("code") <= 48000),
  "mode" TEXT NOT NULL CHECK ("mode" IN ('hint','explain','debug')),
  "submissionId" TEXT REFERENCES "AlgorithmSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','ready','failed')),
  "content" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "AlgorithmAnalysis_owner_problem_history_idx" ON "AlgorithmAnalysis"("organizationId","userId","problemId","createdAt","id");
CREATE INDEX "AlgorithmAnalysis_userId_idx" ON "AlgorithmAnalysis"("userId");

CREATE TABLE "AlgorithmOperation" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('judge','analysis')),
  "submissionId" TEXT REFERENCES "AlgorithmSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "analysisId" TEXT REFERENCES "AlgorithmAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','completed','failed')),
  "leaseExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3)
);
CREATE INDEX "AlgorithmOperation_organizationId_userId_kind_createdAt_idx" ON "AlgorithmOperation"("organizationId","userId","kind","createdAt");
CREATE INDEX "AlgorithmOperation_owner_status_lease_idx" ON "AlgorithmOperation"("organizationId","userId","status","leaseExpiresAt");
CREATE UNIQUE INDEX "AlgorithmOperation_one_pending_per_user_kind" ON "AlgorithmOperation"("organizationId","userId","kind") WHERE "status" = 'pending';
