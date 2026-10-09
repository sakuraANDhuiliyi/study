ALTER TABLE "AiStudyOperation" DROP CONSTRAINT "AiStudyOperation_kind_check";
ALTER TABLE "AiStudyOperation" ADD CONSTRAINT "AiStudyOperation_kind_check"
  CHECK ("kind" IN ('analysis','search','download','authoring','programming'));

CREATE TABLE "ProgrammingProject" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "title" TEXT NOT NULL CHECK (octet_length("title") BETWEEN 1 AND 640),
  "templateId" TEXT NOT NULL CHECK (octet_length("templateId") BETWEEN 1 AND 100),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "files" JSONB NOT NULL CHECK (jsonb_typeof("files") = 'array' AND jsonb_array_length("files") BETWEEN 1 AND 24 AND octet_length("files"::text) <= 393216),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "ProgrammingProject_owner_history_idx" ON "ProgrammingProject"("organizationId","userId","updatedAt","id");
CREATE INDEX "ProgrammingProject_userId_idx" ON "ProgrammingProject"("userId");

CREATE TABLE "ProgrammingVersion" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "ProgrammingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "number" INTEGER NOT NULL CHECK ("number" BETWEEN 1 AND 30),
  "title" TEXT NOT NULL CHECK (octet_length("title") BETWEEN 1 AND 640),
  "note" TEXT NOT NULL CHECK (octet_length("note") <= 2000),
  "files" JSONB NOT NULL CHECK (jsonb_typeof("files") = 'array' AND jsonb_array_length("files") BETWEEN 1 AND 24 AND octet_length("files"::text) <= 393216),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ProgrammingVersion_projectId_number_key" ON "ProgrammingVersion"("projectId","number");
CREATE INDEX "ProgrammingVersion_owner_project_idx" ON "ProgrammingVersion"("organizationId","userId","projectId","createdAt","id");
CREATE INDEX "ProgrammingVersion_userId_idx" ON "ProgrammingVersion"("userId");

CREATE TABLE "ProgrammingAiDraft" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "ProgrammingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "operationId" TEXT NOT NULL REFERENCES "AiStudyOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "baseRevision" INTEGER NOT NULL CHECK ("baseRevision" >= 0),
  "prompt" TEXT NOT NULL CHECK (octet_length("prompt") BETWEEN 1 AND 12000),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','ready','failed','applied')),
  "summary" TEXT NOT NULL DEFAULT '' CHECK (octet_length("summary") <= 8000),
  "plan" JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof("plan") = 'array' AND jsonb_array_length("plan") <= 8 AND octet_length("plan"::text) <= 96000),
  "teaching" JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof("teaching") = 'array' AND jsonb_array_length("teaching") <= 8 AND octet_length("teaching"::text) <= 96000),
  "files" JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof("files") = 'array' AND jsonb_array_length("files") <= 24 AND octet_length("files"::text) <= 393216),
  "model" TEXT NOT NULL,
  "error" TEXT,
  "appliedVersionId" TEXT REFERENCES "ProgrammingVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "appliedProjectSnapshot" JSONB CHECK ("appliedProjectSnapshot" IS NULL OR (jsonb_typeof("appliedProjectSnapshot") = 'object' AND octet_length("appliedProjectSnapshot"::text) <= 395264)),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CHECK ("status" <> 'applied' OR ("appliedVersionId" IS NOT NULL AND "appliedProjectSnapshot" IS NOT NULL AND jsonb_array_length("files") >= 1))
);
CREATE UNIQUE INDEX "ProgrammingAiDraft_operationId_key" ON "ProgrammingAiDraft"("operationId");
CREATE INDEX "ProgrammingAiDraft_owner_project_idx" ON "ProgrammingAiDraft"("organizationId","userId","projectId","createdAt","id");
CREATE INDEX "ProgrammingAiDraft_userId_status_idx" ON "ProgrammingAiDraft"("userId","status");
CREATE INDEX "ProgrammingAiDraft_appliedVersionId_idx" ON "ProgrammingAiDraft"("appliedVersionId");
