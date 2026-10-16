-- CreateTable
CREATE TABLE "LiveClass" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "roomName" TEXT NOT NULL,
    "maxParticipants" INTEGER NOT NULL DEFAULT 32,
    "startedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "cleanupPending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LiveClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveMember" (
    "id" TEXT NOT NULL,
    "liveClassId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" BOOLEAN NOT NULL DEFAULT false,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "handRaised" BOOLEAN NOT NULL DEFAULT false,
    "chatMuted" BOOLEAN NOT NULL DEFAULT false,
    "syncPending" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(3),
    "attendanceSeconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LiveMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveMessage" (
    "id" TEXT NOT NULL,
    "liveClassId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveClass_roomName_key" ON "LiveClass"("roomName");

-- CreateIndex
CREATE INDEX "LiveClass_organizationId_courseId_scheduledAt_id_idx" ON "LiveClass"("organizationId", "courseId", "scheduledAt", "id");

-- CreateIndex
CREATE INDEX "LiveClass_cleanupPending_idx" ON "LiveClass"("cleanupPending");

-- CreateIndex
CREATE INDEX "LiveMember_liveClassId_state_heartbeatAt_idx" ON "LiveMember"("liveClassId", "state", "heartbeatAt");

-- CreateIndex
CREATE INDEX "LiveMember_userId_idx" ON "LiveMember"("userId");
CREATE INDEX "LiveMember_syncPending_idx" ON "LiveMember"("syncPending");

-- CreateIndex
CREATE UNIQUE INDEX "LiveMember_liveClassId_userId_key" ON "LiveMember"("liveClassId", "userId");

-- CreateIndex
CREATE INDEX "LiveMessage_liveClassId_createdAt_id_idx" ON "LiveMessage"("liveClassId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LiveMessage_liveClassId_userId_clientId_key" ON "LiveMessage"("liveClassId", "userId", "clientId");


ALTER TABLE "LiveClass" ADD CONSTRAINT "LiveClass_status_check" CHECK ("status" IN ('SCHEDULED','LIVE','ENDED'));
ALTER TABLE "LiveClass" ADD CONSTRAINT "LiveClass_capacity_check" CHECK ("maxParticipants" BETWEEN 2 AND 100 AND "revision">=0 AND octet_length("title") BETWEEN 1 AND 480);
ALTER TABLE "LiveMember" ADD CONSTRAINT "LiveMember_state_check" CHECK ("state" IN ('ACTIVE','LEFT','BLOCKED') AND "attendanceSeconds">=0 AND "revision">=0);
ALTER TABLE "LiveMessage" ADD CONSTRAINT "LiveMessage_text_check" CHECK (octet_length("text") BETWEEN 1 AND 4000);
CREATE UNIQUE INDEX "LiveClass_one_live_per_course" ON "LiveClass"("courseId") WHERE "status"='LIVE';
ALTER TABLE "LiveClass" ADD FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveClass" ADD FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveClass" ADD FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveMember" ADD FOREIGN KEY ("liveClassId") REFERENCES "LiveClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveMember" ADD FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveMessage" ADD FOREIGN KEY ("liveClassId") REFERENCES "LiveClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveMessage" ADD FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "LiveMessage_userId_idx" ON "LiveMessage"("userId");
