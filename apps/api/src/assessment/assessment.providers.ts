import { AssessmentContext } from './assessment-context';
import { AssessmentService } from './assessment.service';
import { AssignmentsService } from './assignments.service';
import { ExamAccessService } from './exam-access.service';
import { ExamAttemptsService } from './exam-attempts.service';
import { ExamDeadlineService } from './exam-deadline.service';
import { ExamGradingService } from './exam-grading.service';
import { ExamsService } from './exams.service';
import { GradeAppealsService } from './grade-appeals.service';
import { PracticeService } from './practice.service';
import { QuestionBankService } from './question-bank.service';
import { QuestionSelectionService } from './question-selection.service';

// Register once: the deadline worker and every request share the same attempt service.
export const assessmentProviders = [
  AssessmentContext,
  QuestionSelectionService,
  QuestionBankService,
  AssignmentsService,
  PracticeService,
  ExamAccessService,
  ExamsService,
  ExamAttemptsService,
  ExamDeadlineService,
  ExamGradingService,
  GradeAppealsService,
  AssessmentService,
];
