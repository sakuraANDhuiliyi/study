import { PrismaService } from '../apps/api/src/common/prisma.service';
import { AuthService } from '../apps/api/src/auth/auth.service';
import { AuditService } from '../apps/api/src/common/audit.service';
import { AssessmentContext } from '../apps/api/src/assessment/assessment-context';
import { QuestionSelectionService } from '../apps/api/src/assessment/question-selection.service';
import { QuestionBankService } from '../apps/api/src/assessment/question-bank.service';
import { AssignmentsService } from '../apps/api/src/assessment/assignments.service';
import { PracticeService } from '../apps/api/src/assessment/practice.service';
import { ExamAccessService } from '../apps/api/src/assessment/exam-access.service';
import { ExamsService } from '../apps/api/src/assessment/exams.service';
import { ExamAttemptsService } from '../apps/api/src/assessment/exam-attempts.service';
import { ExamDeadlineService } from '../apps/api/src/assessment/exam-deadline.service';
import { ExamGradingService } from '../apps/api/src/assessment/exam-grading.service';
import { GradeAppealsService } from '../apps/api/src/assessment/grade-appeals.service';
import { AssessmentService } from '../apps/api/src/assessment/assessment.service';

/** Match the production provider graph while allowing isolated persistence/auth doubles. */
export function assessmentServices(db: unknown, auth: unknown = {}, audit: unknown = {}) {
  const context = new AssessmentContext(db as PrismaService, auth as AuthService, audit as AuditService);
  const selection = new QuestionSelectionService(context);
  const questions = new QuestionBankService(context, selection);
  const assignments = new AssignmentsService(context, selection);
  const practice = new PracticeService(context, selection);
  const access = new ExamAccessService(context);
  const exams = new ExamsService(context, selection, access);
  const attempts = new ExamAttemptsService(context, access);
  const deadlines = new ExamDeadlineService(context, attempts);
  const grading = new ExamGradingService(context, access, attempts, deadlines);
  const appeals = new GradeAppealsService(context, access);
  const service = new AssessmentService(
    deadlines,
    questions,
    assignments,
    practice,
    exams,
    attempts,
    grading,
    appeals,
  );
  return {
    service,
    context,
    selection,
    questions,
    assignments,
    practice,
    access,
    exams,
    attempts,
    deadlines,
    grading,
    appeals,
  };
}
