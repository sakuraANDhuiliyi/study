CREATE TABLE "LessonNote" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "lessonId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "LessonNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LessonNote_body_length" CHECK (char_length("body") BETWEEN 1 AND 10000),
  CONSTRAINT "LessonNote_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "LessonNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonNote_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonNote_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LessonNote_userId_lessonId_key" ON "LessonNote"("userId", "lessonId");
CREATE INDEX "LessonNote_organizationId_userId_pinned_updatedAt_id_idx" ON "LessonNote"("organizationId", "userId", "pinned", "updatedAt", "id");
CREATE INDEX "LessonNote_courseId_userId_idx" ON "LessonNote"("courseId", "userId");
CREATE INDEX "LessonNote_lessonId_idx" ON "LessonNote"("lessonId");
