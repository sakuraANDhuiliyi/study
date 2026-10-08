CREATE TABLE "AlgorithmLearningState" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "problemId" TEXT NOT NULL,
  "favorite" BOOLEAN NOT NULL DEFAULT FALSE,
  "reviewStatus" TEXT NOT NULL DEFAULT 'none' CHECK ("reviewStatus" IN ('none','review','mastered')),
  "note" TEXT NOT NULL DEFAULT '' CHECK (char_length("note") <= 12000 AND octet_length("note") <= 36000),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "AlgorithmLearningState_owner_problem_key" ON "AlgorithmLearningState"("organizationId","userId","problemId");
CREATE INDEX "AlgorithmLearningState_userId_idx" ON "AlgorithmLearningState"("userId");
