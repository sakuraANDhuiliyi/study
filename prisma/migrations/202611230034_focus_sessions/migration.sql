CREATE TABLE "FocusSession" (
    "id" TEXT PRIMARY KEY,
    "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "title" VARCHAR(120) NOT NULL CHECK (length(btrim("title")) > 0),
    "category" TEXT CHECK ("category" IN ('课程学习','算法练习','作业实验','复习整理','自由专注')),
    "mode" TEXT NOT NULL CHECK ("mode" IN ('FOCUS','SHORT_BREAK','LONG_BREAK')),
    "plannedMinutes" INTEGER NOT NULL CHECK ("plannedMinutes" BETWEEN 1 AND 180),
    "actualSeconds" INTEGER NOT NULL CHECK ("actualSeconds" BETWEEN 1 AND 14400),
    "status" TEXT NOT NULL CHECK ("status" IN ('COMPLETED','ABANDONED')),
    "reflection" VARCHAR(500),
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (extract(epoch FROM ("endedAt" - "startedAt")) >= "actualSeconds")
);

CREATE UNIQUE INDEX "FocusSession_owner_start_key"
    ON "FocusSession" ("organizationId", "userId", "startedAt");
CREATE INDEX "FocusSession_owner_history_idx"
    ON "FocusSession" ("organizationId", "userId", "endedAt" DESC, "id");
