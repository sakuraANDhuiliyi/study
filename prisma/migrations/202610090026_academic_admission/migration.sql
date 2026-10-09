CREATE TABLE "AcademicsEvaluationAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ipHash" VARCHAR(64),
    "reservedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AcademicsEvaluationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AcademicsEvaluationAttempt_userId_createdAt_idx" ON "AcademicsEvaluationAttempt"("userId", "createdAt");
CREATE INDEX "AcademicsEvaluationAttempt_ipHash_createdAt_idx" ON "AcademicsEvaluationAttempt"("ipHash", "createdAt");
CREATE INDEX "AcademicsEvaluationAttempt_organizationId_userId_reservedUntil_idx" ON "AcademicsEvaluationAttempt"("organizationId", "userId", "reservedUntil");
CREATE INDEX "AcademicsEvaluationAttempt_createdAt_idx" ON "AcademicsEvaluationAttempt"("createdAt");

-- Keep the preceding 24 hours of saved requests charged during the upgrade.
INSERT INTO "AcademicsEvaluationAttempt" ("id", "organizationId", "userId", "createdAt")
SELECT 'record:' || "id", "organizationId", "userId", "createdAt"
FROM "AcademicsRecord"
WHERE "createdAt" > CURRENT_TIMESTAMP - INTERVAL '24 hours';
