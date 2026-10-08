// After `prisma migrate diff --from-empty --to-schema-datamodel prisma --script`,
// append module-boundary foreign keys omitted from Prisma navigation properties.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const file = process.argv[2];
if (!file) throw new Error('Pass the generated initial migration SQL file');
let sql = readFileSync(file, 'utf8');
const refs = {
  organizationId: 'Organization',
  userId: 'User',
  teacherId: 'User',
  creatorId: 'User',
  graderId: 'User',
  actorId: 'User',
  approvedBy: 'User',
  resolvedBy: 'User',
  ownerId: 'User',
  reporterId: 'User',
  senderId: 'User',
  blockedUserId: 'User',
  grantedBy: 'User',
  authorId: 'User',
  createdBy: 'User',
  courseId: 'Course',
  classId: 'Class',
  termId: 'AcademicTerm',
  chapterId: 'Chapter',
  lessonId: 'Lesson',
  permissionId: 'Permission',
  roleId: 'Role',
  questionId: 'Question',
  questionVersionId: 'QuestionVersion',
  assignmentId: 'Assignment',
  submissionId: 'AssignmentSubmission',
  examId: 'Exam',
  attemptId: 'ExamAttempt',
  appealId: 'GradeAppeal',
  postId: 'DiscussionPost',
  quoteReplyId: 'DiscussionReply',
  conversationId: 'Conversation',
  messageId: 'Message',
  attachmentId: 'Attachment',
  exportJobId: 'BackgroundJob',
};
let extra = '\n-- Cross-module references: scalar IDs in Prisma, relational integrity in PostgreSQL.\n';
for (const name of readdirSync('prisma').filter((x) => x.endsWith('.prisma'))) {
  const source = readFileSync('prisma/' + name, 'utf8');
  for (const [, model, body] of source.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    for (const [field, target] of Object.entries(refs)) {
      if (
        !new RegExp('^\\s*' + field + '\\s+String\\??\\s*$|^\\s*' + field + '\\s+String\\??\\s+@', 'm').test(
          body,
        )
      )
        continue;
      const constraint = `${model}_${field}_fkey`;
      if (!sql.includes('"' + constraint + '"'))
        extra += `ALTER TABLE "${model}" ADD CONSTRAINT "${constraint}" FOREIGN KEY ("${field}") REFERENCES "${target}"("id") ON DELETE RESTRICT ON UPDATE CASCADE;\n`;
      extra += `CREATE INDEX IF NOT EXISTS "${model}_${field}_reference_idx" ON "${model}"("${field}");\n`;
    }
  }
}
extra +=
  "\nALTER TABLE \"Course\" ADD CONSTRAINT \"Course_status_check\" CHECK (\"status\" IN ('DRAFT','PUBLISHED','UNPUBLISHED','ARCHIVED'));\n";
extra +=
  'ALTER TABLE "Exam" ADD CONSTRAINT "Exam_time_check" CHECK ("endsAt" > "startsAt" AND "entryClosesAt" >= "startsAt" AND "entryClosesAt" <= "endsAt" AND "durationMinutes" > 0 AND "passCents" >= 0 AND "passCents" <= "totalCents");\n';
extra +=
  'ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_time_check" CHECK ("dueAt" > "opensAt" AND "totalCents" > 0 AND "maxAttempts" > 0);\n';
extra +=
  'ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_score_check" CHECK ("scoreCents" > 0);\n';
extra +=
  'CREATE UNIQUE INDEX "ExamAttempt_one_in_progress" ON "ExamAttempt" ("examId","userId") WHERE "status"=\'in_progress\';\n';
writeFileSync(file, sql + extra);
console.log('Added database integrity constraints and reference indexes.');
