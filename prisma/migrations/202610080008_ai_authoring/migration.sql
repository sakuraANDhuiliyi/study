ALTER TABLE "AiStudyOperation" DROP CONSTRAINT "AiStudyOperation_kind_check";
ALTER TABLE "AiStudyOperation" ADD CONSTRAINT "AiStudyOperation_kind_check"
  CHECK ("kind" IN ('analysis','search','download','authoring'));

CREATE TABLE "AiAuthoringDraft" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "courseId" TEXT NOT NULL REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "chapterId" TEXT REFERENCES "Chapter"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "operationId" TEXT NOT NULL REFERENCES "AiStudyOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "mode" TEXT NOT NULL CHECK ("mode" IN ('questions','paper')),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','ready','failed','saved')),
  "title" TEXT NOT NULL CHECK (octet_length("title") BETWEEN 1 AND 800),
  "input" JSONB NOT NULL CHECK (jsonb_typeof("input") = 'object'),
  "questions" JSONB NOT NULL CHECK (jsonb_typeof("questions") = 'array' AND jsonb_array_length("questions") <= 10),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "error" TEXT,
  "model" TEXT NOT NULL,
  "savedQuestionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "savedPaperId" TEXT REFERENCES "Paper"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CHECK ("status" <> 'saved' OR (cardinality("savedQuestionIds") BETWEEN 1 AND 10 AND ("mode" <> 'paper' OR "savedPaperId" IS NOT NULL)))
);
CREATE UNIQUE INDEX "AiAuthoringDraft_operationId_key" ON "AiAuthoringDraft"("operationId");
CREATE INDEX "AiAuthoringDraft_organizationId_userId_createdAt_id_idx" ON "AiAuthoringDraft"("organizationId","userId","createdAt","id");
CREATE INDEX "AiAuthoringDraft_userId_status_idx" ON "AiAuthoringDraft"("userId","status");
CREATE INDEX "AiAuthoringDraft_courseId_idx" ON "AiAuthoringDraft"("courseId");
CREATE INDEX "AiAuthoringDraft_chapterId_idx" ON "AiAuthoringDraft"("chapterId");
CREATE INDEX "AiAuthoringDraft_savedPaperId_idx" ON "AiAuthoringDraft"("savedPaperId");
