-- Personal plans preserve selected catalog IDs in the student's chosen order.
CREATE TABLE "AlgorithmTrainingPlan" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "problemIds" TEXT[] NOT NULL,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AlgorithmTrainingPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AlgorithmTrainingPlan_problem_count_check" CHECK (cardinality("problemIds") BETWEEN 1 AND 50),
  CONSTRAINT "AlgorithmTrainingPlan_revision_check" CHECK ("revision" >= 0)
);

CREATE INDEX "AlgorithmTrainingPlan_owner_list_idx"
  ON "AlgorithmTrainingPlan"("organizationId", "userId", "archived", "createdAt", "id");
CREATE INDEX "AlgorithmTrainingPlan_userId_idx" ON "AlgorithmTrainingPlan"("userId");
