CREATE TABLE "AcademicGoal" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "moduleId" TEXT NOT NULL CHECK (char_length("moduleId") BETWEEN 1 AND 100),
  "title" TEXT NOT NULL CHECK (char_length("title") BETWEEN 1 AND 160),
  "targetCount" INTEGER NOT NULL CHECK ("targetCount" BETWEEN 1 AND 1000),
  "dueDate" DATE CHECK ("dueDate" IS NULL OR "dueDate" BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  "archived" BOOLEAN NOT NULL DEFAULT FALSE,
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "AcademicGoal_owner_history_idx" ON "AcademicGoal"("organizationId","userId","archived","createdAt","id");
CREATE INDEX "AcademicGoal_userId_idx" ON "AcademicGoal"("userId");
