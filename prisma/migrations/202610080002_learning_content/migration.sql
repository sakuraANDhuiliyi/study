ALTER TABLE "Lesson" ADD COLUMN "attachmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Lesson" ADD COLUMN "relatedTasks" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "PracticeSession" ADD COLUMN "flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PracticeSession" ADD COLUMN "currentPosition" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PracticeSession" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_progress_nonnegative" CHECK ("currentPosition" >= 0 AND "revision" >= 0);
CREATE INDEX "Lesson_attachmentIds_gin" ON "Lesson" USING GIN ("attachmentIds");
