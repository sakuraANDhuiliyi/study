-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "chapterId" TEXT,
    "creatorId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'private',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "practiceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "everPracticeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionVersion" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "stem" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "answer" JSONB NOT NULL,
    "explanation" TEXT NOT NULL DEFAULT '',
    "rules" JSONB NOT NULL,
    "scoreCents" INTEGER NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 2,
    "knowledgePoints" TEXT[],
    "tags" TEXT[],
    "children" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paper" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Paper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperItem" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "PaperItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "opensAt" TIMESTAMPTZ(3) NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "allowLate" BOOLEAN NOT NULL DEFAULT false,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "totalCents" INTEGER NOT NULL,
    "attachmentIds" TEXT[],
    "releaseAt" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentAudience" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AssignmentAudience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentItem" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "AssignmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentDraft" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "attachmentIds" TEXT[],
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AssignmentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentSubmission" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "attachmentIds" TEXT[],
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "late" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "gradingStatus" TEXT NOT NULL DEFAULT 'pending',
    "scoreCents" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "feedback" TEXT NOT NULL DEFAULT '',
    "releasedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AssignmentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentFeedback" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "graderId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "totalCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentException" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "allowUntil" TIMESTAMPTZ(3),
    "extraAttempts" INTEGER NOT NULL DEFAULT 0,
    "exempt" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PracticeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeAnswer" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "scoreCents" INTEGER,
    "correct" BOOLEAN,
    "answeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MistakeRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "wrongCount" INTEGER NOT NULL DEFAULT 1,
    "mastered" BOOLEAN NOT NULL DEFAULT false,
    "lastAnsweredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MistakeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "entryClosesAt" TIMESTAMPTZ(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT false,
    "shuffleOptions" BOOLEAN NOT NULL DEFAULT false,
    "allowBacktrack" BOOLEAN NOT NULL DEFAULT true,
    "passCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "graderIds" TEXT[],
    "scoreReleaseAt" TIMESTAMPTZ(3),
    "answerReleaseAt" TIMESTAMPTZ(3),
    "explanationReleaseAt" TIMESTAMPTZ(3),
    "appealDeadline" TIMESTAMPTZ(3),
    "gradesReleasedAt" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAudience" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,

    CONSTRAINT "ExamAudience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPaperSnapshot" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamPaperSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPaperItem" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "content" JSONB NOT NULL,

    CONSTRAINT "ExamPaperItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAttempt" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "gradingStatus" TEXT NOT NULL DEFAULT 'pending',
    "releaseStatus" TEXT NOT NULL DEFAULT 'hidden',
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMPTZ(3) NOT NULL,
    "submittedAt" TIMESTAMPTZ(3),
    "submissionKey" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "gradingRevision" INTEGER NOT NULL DEFAULT 0,
    "scoreCents" INTEGER,
    "questionOrder" JSONB NOT NULL,
    "optionOrder" JSONB NOT NULL,
    "flags" TEXT[],
    "currentPosition" INTEGER NOT NULL DEFAULT 0,
    "lastSavedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ExamAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "scoreCents" INTEGER,
    "graded" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ExamAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradingRecord" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "graderId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeRevision" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "oldScoreCents" INTEGER NOT NULL,
    "newScoreCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "appealId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeAppeal" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamExtension" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "deadlineAt" TIMESTAMPTZ(3) NOT NULL,
    "extraAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamExtension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentJobRun" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AssessmentJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "studentNo" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "authVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "SensitiveGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SensitiveGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "authVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicTerm" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AcademicTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Class" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "termId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassMember" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "cover" TEXT,
    "category" TEXT NOT NULL DEFAULT '通识课程',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "teacherId" TEXT NOT NULL,
    "termId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingAssignment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TeachingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseClass" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "CourseClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "resourceUrl" TEXT,
    "attachmentId" TEXT,
    "opensAt" TIMESTAMPTZ(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "positionSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LearningProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionPost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkType" TEXT,
    "linkId" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "solved" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DiscussionPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionReply" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quoteReplyId" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "directKey" TEXT,
    "classId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMember" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clientId" TEXT NOT NULL,
    "retractedAt" TIMESTAMPTZ(3),
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageReadCursor" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "messageCreatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MessageReadCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "courseId" TEXT,
    "classId" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationBlock" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "blockedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationMute" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT,
    "classId" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationMute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "courseId" TEXT,
    "conversationId" TEXT,
    "assignmentId" TEXT,
    "exportJobId" TEXT,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Question_organizationId_courseId_active_idx" ON "Question"("organizationId", "courseId", "active");

-- CreateIndex
CREATE INDEX "Question_creatorId_idx" ON "Question"("creatorId");

-- CreateIndex
CREATE INDEX "QuestionVersion_type_difficulty_idx" ON "QuestionVersion"("type", "difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_questionId_version_key" ON "QuestionVersion"("questionId", "version");

-- CreateIndex
CREATE INDEX "Paper_organizationId_courseId_createdAt_idx" ON "Paper"("organizationId", "courseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaperItem_paperId_questionVersionId_key" ON "PaperItem"("paperId", "questionVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperItem_paperId_position_key" ON "PaperItem"("paperId", "position");

-- CreateIndex
CREATE INDEX "Assignment_organizationId_courseId_status_dueAt_idx" ON "Assignment"("organizationId", "courseId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "AssignmentAudience_userId_idx" ON "AssignmentAudience"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentAudience_assignmentId_userId_key" ON "AssignmentAudience"("assignmentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentItem_assignmentId_questionVersionId_key" ON "AssignmentItem"("assignmentId", "questionVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentItem_assignmentId_position_key" ON "AssignmentItem"("assignmentId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentDraft_assignmentId_userId_key" ON "AssignmentDraft"("assignmentId", "userId");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_assignmentId_gradingStatus_submittedAt_idx" ON "AssignmentSubmission"("assignmentId", "gradingStatus", "submittedAt");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_userId_submittedAt_idx" ON "AssignmentSubmission"("userId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_assignmentId_userId_version_key" ON "AssignmentSubmission"("assignmentId", "userId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_assignmentId_userId_idempotencyKey_key" ON "AssignmentSubmission"("assignmentId", "userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentFeedback_submissionId_revision_key" ON "AssignmentFeedback"("submissionId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentException_assignmentId_userId_key" ON "AssignmentException"("assignmentId", "userId");

-- CreateIndex
CREATE INDEX "PracticeSession_userId_createdAt_idx" ON "PracticeSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PracticeAnswer_questionId_idx" ON "PracticeAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeAnswer_sessionId_questionVersionId_key" ON "PracticeAnswer"("sessionId", "questionVersionId");

-- CreateIndex
CREATE INDEX "MistakeRecord_userId_courseId_lastAnsweredAt_idx" ON "MistakeRecord"("userId", "courseId", "lastAnsweredAt");

-- CreateIndex
CREATE UNIQUE INDEX "MistakeRecord_userId_questionId_key" ON "MistakeRecord"("userId", "questionId");

-- CreateIndex
CREATE INDEX "QuestionFavorite_userId_courseId_createdAt_idx" ON "QuestionFavorite"("userId", "courseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionFavorite_userId_questionId_key" ON "QuestionFavorite"("userId", "questionId");

-- CreateIndex
CREATE INDEX "Exam_organizationId_courseId_status_startsAt_idx" ON "Exam"("organizationId", "courseId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "ExamAudience_userId_idx" ON "ExamAudience"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAudience_examId_userId_key" ON "ExamAudience"("examId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaperSnapshot_examId_key" ON "ExamPaperSnapshot"("examId");

-- CreateIndex
CREATE INDEX "ExamPaperItem_questionId_idx" ON "ExamPaperItem"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaperItem_snapshotId_questionVersionId_key" ON "ExamPaperItem"("snapshotId", "questionVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaperItem_snapshotId_position_key" ON "ExamPaperItem"("snapshotId", "position");

-- CreateIndex
CREATE INDEX "ExamAttempt_status_deadlineAt_idx" ON "ExamAttempt"("status", "deadlineAt");

-- CreateIndex
CREATE INDEX "ExamAttempt_userId_startedAt_idx" ON "ExamAttempt"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "ExamAttempt_examId_gradingStatus_idx" ON "ExamAttempt"("examId", "gradingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAttempt_examId_userId_number_key" ON "ExamAttempt"("examId", "userId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAnswer_attemptId_questionVersionId_key" ON "ExamAnswer"("attemptId", "questionVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "GradingRecord_attemptId_revision_key" ON "GradingRecord"("attemptId", "revision");

-- CreateIndex
CREATE INDEX "GradeRevision_attemptId_createdAt_idx" ON "GradeRevision"("attemptId", "createdAt");

-- CreateIndex
CREATE INDEX "GradeAppeal_status_createdAt_idx" ON "GradeAppeal"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GradeAppeal_attemptId_userId_key" ON "GradeAppeal"("attemptId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamExtension_examId_userId_key" ON "ExamExtension"("examId", "userId");

-- CreateIndex
CREATE INDEX "AssessmentJobRun_type_startedAt_idx" ON "AssessmentJobRun"("type", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_organizationId_active_createdAt_id_idx" ON "User"("organizationId", "active", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "User_organizationId_studentNo_key" ON "User"("organizationId", "studentNo");

-- CreateIndex
CREATE UNIQUE INDEX "SensitiveGrant_userId_permissionId_key" ON "SensitiveGrant"("userId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicTerm_organizationId_name_key" ON "AcademicTerm"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Class_organizationId_name_key" ON "Class"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ClassMember_userId_active_idx" ON "ClassMember"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ClassMember_classId_userId_key" ON "ClassMember"("classId", "userId");

-- CreateIndex
CREATE INDEX "Course_organizationId_status_createdAt_id_idx" ON "Course"("organizationId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "TeachingAssignment_userId_active_idx" ON "TeachingAssignment"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingAssignment_courseId_userId_key" ON "TeachingAssignment"("courseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseClass_courseId_classId_key" ON "CourseClass"("courseId", "classId");

-- CreateIndex
CREATE INDEX "Enrollment_userId_active_idx" ON "Enrollment"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_courseId_userId_key" ON "Enrollment"("courseId", "userId");

-- CreateIndex
CREATE INDEX "Chapter_courseId_sortOrder_id_idx" ON "Chapter"("courseId", "sortOrder", "id");

-- CreateIndex
CREATE INDEX "Lesson_courseId_opensAt_idx" ON "Lesson"("courseId", "opensAt");

-- CreateIndex
CREATE INDEX "Lesson_chapterId_sortOrder_id_idx" ON "Lesson"("chapterId", "sortOrder", "id");

-- CreateIndex
CREATE INDEX "LearningProgress_courseId_userId_idx" ON "LearningProgress"("courseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningProgress_userId_lessonId_key" ON "LearningProgress"("userId", "lessonId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_id_idx" ON "Notification"("userId", "readAt", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_eventKey_key" ON "Notification"("userId", "eventKey");

-- CreateIndex
CREATE INDEX "Announcement_organizationId_createdAt_id_idx" ON "Announcement"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_id_idx" ON "AuditLog"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_organizationId_key_key" ON "SystemSetting"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundJob_eventKey_key" ON "BackgroundJob"("eventKey");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_runAt_idx" ON "BackgroundJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "DiscussionPost_courseId_hidden_pinned_createdAt_id_idx" ON "DiscussionPost"("courseId", "hidden", "pinned", "createdAt", "id");

-- CreateIndex
CREATE INDEX "DiscussionPost_organizationId_authorId_createdAt_idx" ON "DiscussionPost"("organizationId", "authorId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscussionReply_postId_hidden_createdAt_id_idx" ON "DiscussionReply"("postId", "hidden", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_directKey_key" ON "Conversation"("directKey");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_classId_key" ON "Conversation"("classId");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_updatedAt_id_idx" ON "Conversation"("organizationId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "ConversationMember_userId_conversationId_idx" ON "ConversationMember"("userId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMember_conversationId_userId_key" ON "ConversationMember"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_id_idx" ON "Message"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_senderId_clientId_key" ON "Message"("conversationId", "senderId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageReadCursor_conversationId_userId_key" ON "MessageReadCursor"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "ContentReport_organizationId_status_createdAt_id_idx" ON "ContentReport"("organizationId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationBlock_userId_blockedUserId_key" ON "CommunicationBlock"("userId", "blockedUserId");

-- CreateIndex
CREATE INDEX "CommunicationMute_organizationId_userId_expiresAt_idx" ON "CommunicationMute"("organizationId", "userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_exportJobId_key" ON "Attachment"("exportJobId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_organizationId_ownerId_createdAt_idx" ON "Attachment"("organizationId", "ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Attachment_courseId_idx" ON "Attachment"("courseId");

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperItem" ADD CONSTRAINT "PaperItem_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperItem" ADD CONSTRAINT "PaperItem_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentAudience" ADD CONSTRAINT "AssignmentAudience_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentItem" ADD CONSTRAINT "AssignmentItem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentItem" ADD CONSTRAINT "AssignmentItem_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentDraft" ADD CONSTRAINT "AssignmentDraft_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentFeedback" ADD CONSTRAINT "AssignmentFeedback_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentException" ADD CONSTRAINT "AssignmentException_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeAnswer" ADD CONSTRAINT "PracticeAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PracticeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAudience" ADD CONSTRAINT "ExamAudience_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaperSnapshot" ADD CONSTRAINT "ExamPaperSnapshot_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaperItem" ADD CONSTRAINT "ExamPaperItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ExamPaperSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaperItem" ADD CONSTRAINT "ExamPaperItem_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAnswer" ADD CONSTRAINT "ExamAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingRecord" ADD CONSTRAINT "GradingRecord_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeRevision" ADD CONSTRAINT "GradeRevision_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeAppeal" ADD CONSTRAINT "GradeAppeal_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamExtension" ADD CONSTRAINT "ExamExtension_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Cross-module references: scalar IDs in Prisma, relational integrity in PostgreSQL.
ALTER TABLE "Question" ADD CONSTRAINT "Question_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Question_organizationId_reference_idx" ON "Question"("organizationId");
ALTER TABLE "Question" ADD CONSTRAINT "Question_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Question_creatorId_reference_idx" ON "Question"("creatorId");
ALTER TABLE "Question" ADD CONSTRAINT "Question_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Question_courseId_reference_idx" ON "Question"("courseId");
ALTER TABLE "Question" ADD CONSTRAINT "Question_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Question_chapterId_reference_idx" ON "Question"("chapterId");
CREATE INDEX IF NOT EXISTS "QuestionVersion_questionId_reference_idx" ON "QuestionVersion"("questionId");
ALTER TABLE "Paper" ADD CONSTRAINT "Paper_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Paper_organizationId_reference_idx" ON "Paper"("organizationId");
ALTER TABLE "Paper" ADD CONSTRAINT "Paper_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Paper_creatorId_reference_idx" ON "Paper"("creatorId");
ALTER TABLE "Paper" ADD CONSTRAINT "Paper_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Paper_courseId_reference_idx" ON "Paper"("courseId");
CREATE INDEX IF NOT EXISTS "PaperItem_questionVersionId_reference_idx" ON "PaperItem"("questionVersionId");
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Assignment_organizationId_reference_idx" ON "Assignment"("organizationId");
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Assignment_creatorId_reference_idx" ON "Assignment"("creatorId");
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Assignment_courseId_reference_idx" ON "Assignment"("courseId");
ALTER TABLE "AssignmentAudience" ADD CONSTRAINT "AssignmentAudience_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "AssignmentAudience_userId_reference_idx" ON "AssignmentAudience"("userId");
CREATE INDEX IF NOT EXISTS "AssignmentAudience_assignmentId_reference_idx" ON "AssignmentAudience"("assignmentId");
CREATE INDEX IF NOT EXISTS "AssignmentItem_questionVersionId_reference_idx" ON "AssignmentItem"("questionVersionId");
CREATE INDEX IF NOT EXISTS "AssignmentItem_assignmentId_reference_idx" ON "AssignmentItem"("assignmentId");
ALTER TABLE "AssignmentDraft" ADD CONSTRAINT "AssignmentDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "AssignmentDraft_userId_reference_idx" ON "AssignmentDraft"("userId");
CREATE INDEX IF NOT EXISTS "AssignmentDraft_assignmentId_reference_idx" ON "AssignmentDraft"("assignmentId");
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "AssignmentSubmission_userId_reference_idx" ON "AssignmentSubmission"("userId");
CREATE INDEX IF NOT EXISTS "AssignmentSubmission_assignmentId_reference_idx" ON "AssignmentSubmission"("assignmentId");
ALTER TABLE "AssignmentFeedback" ADD CONSTRAINT "AssignmentFeedback_graderId_fkey" FOREIGN KEY ("graderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "AssignmentFeedback_graderId_reference_idx" ON "AssignmentFeedback"("graderId");
CREATE INDEX IF NOT EXISTS "AssignmentFeedback_submissionId_reference_idx" ON "AssignmentFeedback"("submissionId");
ALTER TABLE "AssignmentException" ADD CONSTRAINT "AssignmentException_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "AssignmentException_userId_reference_idx" ON "AssignmentException"("userId");
ALTER TABLE "AssignmentException" ADD CONSTRAINT "AssignmentException_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "AssignmentException_approvedBy_reference_idx" ON "AssignmentException"("approvedBy");
CREATE INDEX IF NOT EXISTS "AssignmentException_assignmentId_reference_idx" ON "AssignmentException"("assignmentId");
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "PracticeSession_organizationId_reference_idx" ON "PracticeSession"("organizationId");
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "PracticeSession_userId_reference_idx" ON "PracticeSession"("userId");
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "PracticeSession_courseId_reference_idx" ON "PracticeSession"("courseId");
ALTER TABLE "PracticeAnswer" ADD CONSTRAINT "PracticeAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "PracticeAnswer_questionId_reference_idx" ON "PracticeAnswer"("questionId");
ALTER TABLE "PracticeAnswer" ADD CONSTRAINT "PracticeAnswer_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "PracticeAnswer_questionVersionId_reference_idx" ON "PracticeAnswer"("questionVersionId");
ALTER TABLE "MistakeRecord" ADD CONSTRAINT "MistakeRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "MistakeRecord_userId_reference_idx" ON "MistakeRecord"("userId");
ALTER TABLE "MistakeRecord" ADD CONSTRAINT "MistakeRecord_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "MistakeRecord_courseId_reference_idx" ON "MistakeRecord"("courseId");
ALTER TABLE "MistakeRecord" ADD CONSTRAINT "MistakeRecord_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "MistakeRecord_questionId_reference_idx" ON "MistakeRecord"("questionId");
ALTER TABLE "QuestionFavorite" ADD CONSTRAINT "QuestionFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "QuestionFavorite_userId_reference_idx" ON "QuestionFavorite"("userId");
ALTER TABLE "QuestionFavorite" ADD CONSTRAINT "QuestionFavorite_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "QuestionFavorite_courseId_reference_idx" ON "QuestionFavorite"("courseId");
ALTER TABLE "QuestionFavorite" ADD CONSTRAINT "QuestionFavorite_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "QuestionFavorite_questionId_reference_idx" ON "QuestionFavorite"("questionId");
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Exam_organizationId_reference_idx" ON "Exam"("organizationId");
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Exam_creatorId_reference_idx" ON "Exam"("creatorId");
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Exam_courseId_reference_idx" ON "Exam"("courseId");
ALTER TABLE "ExamAudience" ADD CONSTRAINT "ExamAudience_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ExamAudience_userId_reference_idx" ON "ExamAudience"("userId");
CREATE INDEX IF NOT EXISTS "ExamAudience_examId_reference_idx" ON "ExamAudience"("examId");
CREATE INDEX IF NOT EXISTS "ExamPaperSnapshot_examId_reference_idx" ON "ExamPaperSnapshot"("examId");
ALTER TABLE "ExamPaperItem" ADD CONSTRAINT "ExamPaperItem_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ExamPaperItem_questionId_reference_idx" ON "ExamPaperItem"("questionId");
CREATE INDEX IF NOT EXISTS "ExamPaperItem_questionVersionId_reference_idx" ON "ExamPaperItem"("questionVersionId");
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ExamAttempt_userId_reference_idx" ON "ExamAttempt"("userId");
CREATE INDEX IF NOT EXISTS "ExamAttempt_examId_reference_idx" ON "ExamAttempt"("examId");
ALTER TABLE "ExamAnswer" ADD CONSTRAINT "ExamAnswer_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ExamAnswer_questionVersionId_reference_idx" ON "ExamAnswer"("questionVersionId");
CREATE INDEX IF NOT EXISTS "ExamAnswer_attemptId_reference_idx" ON "ExamAnswer"("attemptId");
ALTER TABLE "GradingRecord" ADD CONSTRAINT "GradingRecord_graderId_fkey" FOREIGN KEY ("graderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "GradingRecord_graderId_reference_idx" ON "GradingRecord"("graderId");
CREATE INDEX IF NOT EXISTS "GradingRecord_attemptId_reference_idx" ON "GradingRecord"("attemptId");
ALTER TABLE "GradeRevision" ADD CONSTRAINT "GradeRevision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "GradeRevision_actorId_reference_idx" ON "GradeRevision"("actorId");
CREATE INDEX IF NOT EXISTS "GradeRevision_attemptId_reference_idx" ON "GradeRevision"("attemptId");
ALTER TABLE "GradeRevision" ADD CONSTRAINT "GradeRevision_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "GradeAppeal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "GradeRevision_appealId_reference_idx" ON "GradeRevision"("appealId");
ALTER TABLE "GradeAppeal" ADD CONSTRAINT "GradeAppeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "GradeAppeal_userId_reference_idx" ON "GradeAppeal"("userId");
ALTER TABLE "GradeAppeal" ADD CONSTRAINT "GradeAppeal_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "GradeAppeal_resolvedBy_reference_idx" ON "GradeAppeal"("resolvedBy");
CREATE INDEX IF NOT EXISTS "GradeAppeal_attemptId_reference_idx" ON "GradeAppeal"("attemptId");
ALTER TABLE "ExamExtension" ADD CONSTRAINT "ExamExtension_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ExamExtension_userId_reference_idx" ON "ExamExtension"("userId");
ALTER TABLE "ExamExtension" ADD CONSTRAINT "ExamExtension_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ExamExtension_approvedBy_reference_idx" ON "ExamExtension"("approvedBy");
CREATE INDEX IF NOT EXISTS "ExamExtension_examId_reference_idx" ON "ExamExtension"("examId");
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "User_organizationId_reference_idx" ON "User"("organizationId");
CREATE INDEX IF NOT EXISTS "UserRole_userId_reference_idx" ON "UserRole"("userId");
CREATE INDEX IF NOT EXISTS "UserRole_roleId_reference_idx" ON "UserRole"("roleId");
CREATE INDEX IF NOT EXISTS "RolePermission_permissionId_reference_idx" ON "RolePermission"("permissionId");
CREATE INDEX IF NOT EXISTS "RolePermission_roleId_reference_idx" ON "RolePermission"("roleId");
ALTER TABLE "SensitiveGrant" ADD CONSTRAINT "SensitiveGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "SensitiveGrant_organizationId_reference_idx" ON "SensitiveGrant"("organizationId");
ALTER TABLE "SensitiveGrant" ADD CONSTRAINT "SensitiveGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "SensitiveGrant_userId_reference_idx" ON "SensitiveGrant"("userId");
ALTER TABLE "SensitiveGrant" ADD CONSTRAINT "SensitiveGrant_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "SensitiveGrant_grantedBy_reference_idx" ON "SensitiveGrant"("grantedBy");
ALTER TABLE "SensitiveGrant" ADD CONSTRAINT "SensitiveGrant_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "SensitiveGrant_permissionId_reference_idx" ON "SensitiveGrant"("permissionId");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Session_userId_reference_idx" ON "Session"("userId");
ALTER TABLE "AcademicTerm" ADD CONSTRAINT "AcademicTerm_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "AcademicTerm_organizationId_reference_idx" ON "AcademicTerm"("organizationId");
ALTER TABLE "Class" ADD CONSTRAINT "Class_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Class_organizationId_reference_idx" ON "Class"("organizationId");
ALTER TABLE "Class" ADD CONSTRAINT "Class_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Class_termId_reference_idx" ON "Class"("termId");
ALTER TABLE "ClassMember" ADD CONSTRAINT "ClassMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ClassMember_userId_reference_idx" ON "ClassMember"("userId");
ALTER TABLE "ClassMember" ADD CONSTRAINT "ClassMember_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ClassMember_classId_reference_idx" ON "ClassMember"("classId");
ALTER TABLE "Course" ADD CONSTRAINT "Course_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Course_organizationId_reference_idx" ON "Course"("organizationId");
ALTER TABLE "Course" ADD CONSTRAINT "Course_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Course_teacherId_reference_idx" ON "Course"("teacherId");
ALTER TABLE "Course" ADD CONSTRAINT "Course_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Course_termId_reference_idx" ON "Course"("termId");
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "TeachingAssignment_userId_reference_idx" ON "TeachingAssignment"("userId");
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "TeachingAssignment_courseId_reference_idx" ON "TeachingAssignment"("courseId");
ALTER TABLE "CourseClass" ADD CONSTRAINT "CourseClass_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "CourseClass_courseId_reference_idx" ON "CourseClass"("courseId");
ALTER TABLE "CourseClass" ADD CONSTRAINT "CourseClass_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "CourseClass_classId_reference_idx" ON "CourseClass"("classId");
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Enrollment_userId_reference_idx" ON "Enrollment"("userId");
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Enrollment_courseId_reference_idx" ON "Enrollment"("courseId");
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Chapter_courseId_reference_idx" ON "Chapter"("courseId");
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Lesson_courseId_reference_idx" ON "Lesson"("courseId");
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Lesson_chapterId_reference_idx" ON "Lesson"("chapterId");
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Lesson_attachmentId_reference_idx" ON "Lesson"("attachmentId");
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "LearningProgress_userId_reference_idx" ON "LearningProgress"("userId");
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "LearningProgress_courseId_reference_idx" ON "LearningProgress"("courseId");
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "LearningProgress_lessonId_reference_idx" ON "LearningProgress"("lessonId");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Notification_organizationId_reference_idx" ON "Notification"("organizationId");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Notification_userId_reference_idx" ON "Notification"("userId");
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Announcement_organizationId_reference_idx" ON "Announcement"("organizationId");
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Announcement_authorId_reference_idx" ON "Announcement"("authorId");
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Announcement_courseId_reference_idx" ON "Announcement"("courseId");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_reference_idx" ON "AuditLog"("organizationId");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "AuditLog_userId_reference_idx" ON "AuditLog"("userId");
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "SystemSetting_organizationId_reference_idx" ON "SystemSetting"("organizationId");
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "BackgroundJob_organizationId_reference_idx" ON "BackgroundJob"("organizationId");
ALTER TABLE "DiscussionPost" ADD CONSTRAINT "DiscussionPost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "DiscussionPost_organizationId_reference_idx" ON "DiscussionPost"("organizationId");
ALTER TABLE "DiscussionPost" ADD CONSTRAINT "DiscussionPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "DiscussionPost_authorId_reference_idx" ON "DiscussionPost"("authorId");
ALTER TABLE "DiscussionPost" ADD CONSTRAINT "DiscussionPost_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "DiscussionPost_courseId_reference_idx" ON "DiscussionPost"("courseId");
ALTER TABLE "DiscussionReply" ADD CONSTRAINT "DiscussionReply_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "DiscussionReply_organizationId_reference_idx" ON "DiscussionReply"("organizationId");
ALTER TABLE "DiscussionReply" ADD CONSTRAINT "DiscussionReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "DiscussionReply_authorId_reference_idx" ON "DiscussionReply"("authorId");
ALTER TABLE "DiscussionReply" ADD CONSTRAINT "DiscussionReply_postId_fkey" FOREIGN KEY ("postId") REFERENCES "DiscussionPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "DiscussionReply_postId_reference_idx" ON "DiscussionReply"("postId");
ALTER TABLE "DiscussionReply" ADD CONSTRAINT "DiscussionReply_quoteReplyId_fkey" FOREIGN KEY ("quoteReplyId") REFERENCES "DiscussionReply"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "DiscussionReply_quoteReplyId_reference_idx" ON "DiscussionReply"("quoteReplyId");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Conversation_organizationId_reference_idx" ON "Conversation"("organizationId");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Conversation_classId_reference_idx" ON "Conversation"("classId");
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ConversationMember_userId_reference_idx" ON "ConversationMember"("userId");
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ConversationMember_conversationId_reference_idx" ON "ConversationMember"("conversationId");
ALTER TABLE "Message" ADD CONSTRAINT "Message_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Message_organizationId_reference_idx" ON "Message"("organizationId");
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Message_senderId_reference_idx" ON "Message"("senderId");
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Message_conversationId_reference_idx" ON "Message"("conversationId");
ALTER TABLE "MessageReadCursor" ADD CONSTRAINT "MessageReadCursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "MessageReadCursor_userId_reference_idx" ON "MessageReadCursor"("userId");
ALTER TABLE "MessageReadCursor" ADD CONSTRAINT "MessageReadCursor_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "MessageReadCursor_conversationId_reference_idx" ON "MessageReadCursor"("conversationId");
ALTER TABLE "MessageReadCursor" ADD CONSTRAINT "MessageReadCursor_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "MessageReadCursor_messageId_reference_idx" ON "MessageReadCursor"("messageId");
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ContentReport_organizationId_reference_idx" ON "ContentReport"("organizationId");
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ContentReport_resolvedBy_reference_idx" ON "ContentReport"("resolvedBy");
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ContentReport_reporterId_reference_idx" ON "ContentReport"("reporterId");
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ContentReport_courseId_reference_idx" ON "ContentReport"("courseId");
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ContentReport_classId_reference_idx" ON "ContentReport"("classId");
ALTER TABLE "CommunicationBlock" ADD CONSTRAINT "CommunicationBlock_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "CommunicationBlock_organizationId_reference_idx" ON "CommunicationBlock"("organizationId");
ALTER TABLE "CommunicationBlock" ADD CONSTRAINT "CommunicationBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "CommunicationBlock_userId_reference_idx" ON "CommunicationBlock"("userId");
ALTER TABLE "CommunicationBlock" ADD CONSTRAINT "CommunicationBlock_blockedUserId_fkey" FOREIGN KEY ("blockedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "CommunicationBlock_blockedUserId_reference_idx" ON "CommunicationBlock"("blockedUserId");
ALTER TABLE "CommunicationMute" ADD CONSTRAINT "CommunicationMute_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "CommunicationMute_organizationId_reference_idx" ON "CommunicationMute"("organizationId");
ALTER TABLE "CommunicationMute" ADD CONSTRAINT "CommunicationMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "CommunicationMute_userId_reference_idx" ON "CommunicationMute"("userId");
ALTER TABLE "CommunicationMute" ADD CONSTRAINT "CommunicationMute_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "CommunicationMute_createdBy_reference_idx" ON "CommunicationMute"("createdBy");
ALTER TABLE "CommunicationMute" ADD CONSTRAINT "CommunicationMute_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "CommunicationMute_courseId_reference_idx" ON "CommunicationMute"("courseId");
ALTER TABLE "CommunicationMute" ADD CONSTRAINT "CommunicationMute_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "CommunicationMute_classId_reference_idx" ON "CommunicationMute"("classId");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Attachment_organizationId_reference_idx" ON "Attachment"("organizationId");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Attachment_ownerId_reference_idx" ON "Attachment"("ownerId");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Attachment_courseId_reference_idx" ON "Attachment"("courseId");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Attachment_assignmentId_reference_idx" ON "Attachment"("assignmentId");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Attachment_conversationId_reference_idx" ON "Attachment"("conversationId");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_exportJobId_fkey" FOREIGN KEY ("exportJobId") REFERENCES "BackgroundJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Attachment_exportJobId_reference_idx" ON "Attachment"("exportJobId");

ALTER TABLE "Course" ADD CONSTRAINT "Course_status_check" CHECK ("status" IN ('DRAFT','PUBLISHED','UNPUBLISHED','ARCHIVED'));
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_time_check" CHECK ("endsAt" > "startsAt" AND "entryClosesAt" >= "startsAt" AND "entryClosesAt" <= "endsAt" AND "durationMinutes" > 0 AND "passCents" >= 0 AND "passCents" <= "totalCents");
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_time_check" CHECK ("dueAt" > "opensAt" AND "totalCents" > 0 AND "maxAttempts" > 0);
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_score_check" CHECK ("scoreCents" > 0);
CREATE UNIQUE INDEX "ExamAttempt_one_in_progress" ON "ExamAttempt" ("examId","userId") WHERE "status"='in_progress';
