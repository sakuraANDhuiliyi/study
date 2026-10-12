import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Actor } from '../auth/auth.guard';
import type { SchedulerSnapshot } from '../common/scheduler-status';
import * as schema from './assessment.schemas';
import { AssignmentsService } from './assignments.service';
import { ExamAttemptsService } from './exam-attempts.service';
import { ExamDeadlineService } from './exam-deadline.service';
import { ExamGradingService } from './exam-grading.service';
import { ExamsService } from './exams.service';
import { GradeAppealsService } from './grade-appeals.service';
import { PracticeService } from './practice.service';
import { QuestionBankService } from './question-bank.service';

/** Stable entry point for HTTP controllers and administration; policies live in domain services. */
@Injectable()
export class AssessmentService {
  constructor(
    private readonly deadlinesService: ExamDeadlineService,
    private readonly questionsService: QuestionBankService,
    private readonly assignmentsService: AssignmentsService,
    private readonly practiceService: PracticeService,
    private readonly examsService: ExamsService,
    private readonly attemptsService: ExamAttemptsService,
    private readonly gradingService: ExamGradingService,
    private readonly appealsService: GradeAppealsService,
  ) {}
  schedulerSnapshot(): SchedulerSnapshot {
    return this.deadlinesService.schedulerSnapshot();
  }
  async questions(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    return this.questionsService.questions(actor, query);
  }
  async exportQuestions(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    return this.questionsService.exportQuestions(actor, query);
  }
  async questionTemplate(actor: Actor, courseId: string) {
    return this.questionsService.questionTemplate(actor, courseId);
  }
  async question(actor: Actor, id: string) {
    return this.questionsService.question(actor, id);
  }
  async createQuestion(actor: Actor, input: schema.QuestionInput) {
    return this.questionsService.createQuestion(actor, input);
  }
  async updateQuestion(actor: Actor, id: string, input: z.infer<typeof schema.questionPatchSchema>) {
    return this.questionsService.updateQuestion(actor, id, input);
  }
  async questionVersions(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    return this.questionsService.questionVersions(actor, id, query);
  }
  async copyQuestion(actor: Actor, id: string) {
    return this.questionsService.copyQuestion(actor, id);
  }
  async importQuestions(actor: Actor, rows: unknown[], commit: boolean) {
    return this.questionsService.importQuestions(actor, rows, commit);
  }
  async papers(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    return this.questionsService.papers(actor, query);
  }
  async createPaper(actor: Actor, input: z.infer<typeof schema.paperSchema>) {
    return this.questionsService.createPaper(actor, input);
  }
  async assignments(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    return this.assignmentsService.assignments(actor, query);
  }
  async createAssignment(actor: Actor, input: z.infer<typeof schema.assignmentSchema>) {
    return this.assignmentsService.createAssignment(actor, input);
  }
  async assignment(actor: Actor, id: string) {
    return this.assignmentsService.assignment(actor, id);
  }
  async updateAssignment(actor: Actor, id: string, input: z.infer<typeof schema.assignmentPatchSchema>) {
    return this.assignmentsService.updateAssignment(actor, id, input);
  }
  async publishAssignment(actor: Actor, id: string) {
    return this.assignmentsService.publishAssignment(actor, id);
  }
  async saveAssignmentDraft(actor: Actor, id: string, input: z.infer<typeof schema.draftSchema>) {
    return this.assignmentsService.saveAssignmentDraft(actor, id, input);
  }
  async submitAssignment(actor: Actor, id: string, input: z.infer<typeof schema.submissionSchema>) {
    return this.assignmentsService.submitAssignment(actor, id, input);
  }
  async submissions(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    return this.assignmentsService.submissions(actor, id, query);
  }
  async assignmentRoster(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    return this.assignmentsService.assignmentRoster(actor, id, query);
  }
  async gradeSubmission(actor: Actor, id: string, input: z.infer<typeof schema.gradeSchema>) {
    return this.assignmentsService.gradeSubmission(actor, id, input);
  }
  async releaseAssignment(actor: Actor, id: string) {
    return this.assignmentsService.releaseAssignment(actor, id);
  }
  async assignmentException(actor: Actor, id: string, input: z.infer<typeof schema.exceptionSchema>) {
    return this.assignmentsService.assignmentException(actor, id, input);
  }
  async returnSubmission(actor: Actor, id: string, reason: string) {
    return this.assignmentsService.returnSubmission(actor, id, reason);
  }
  async createPractice(actor: Actor, input: z.infer<typeof schema.practiceSchema>) {
    return this.practiceService.createPractice(actor, input);
  }
  async practices(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    return this.practiceService.practices(actor, query);
  }
  async practice(actor: Actor, id: string) {
    return this.practiceService.practice(actor, id);
  }
  async savePracticeProgress(actor: Actor, id: string, input: z.infer<typeof schema.practiceProgressSchema>) {
    return this.practiceService.savePracticeProgress(actor, id, input);
  }
  async answerPractice(actor: Actor, id: string, input: z.infer<typeof schema.answerSchema>) {
    return this.practiceService.answerPractice(actor, id, input);
  }
  async questionCollection(
    actor: Actor,
    type: 'mistakes' | 'favorites',
    query: z.infer<typeof schema.listSchema>,
  ) {
    return this.practiceService.questionCollection(actor, type, query);
  }
  async favorite(actor: Actor, id: string, favorite: boolean) {
    return this.practiceService.favorite(actor, id, favorite);
  }
  async masterMistake(actor: Actor, id: string, mastered: boolean) {
    return this.practiceService.masterMistake(actor, id, mastered);
  }
  async exams(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    return this.examsService.exams(actor, query);
  }
  async createExam(actor: Actor, input: z.infer<typeof schema.examSchema>) {
    return this.examsService.createExam(actor, input);
  }
  async exam(actor: Actor, id: string) {
    return this.examsService.exam(actor, id);
  }
  async updateExam(actor: Actor, id: string, input: z.infer<typeof schema.examPatchSchema>) {
    return this.examsService.updateExam(actor, id, input);
  }
  async publishExam(actor: Actor, id: string) {
    return this.examsService.publishExam(actor, id);
  }
  async cancelExam(actor: Actor, id: string, reason: string) {
    return this.examsService.cancelExam(actor, id, reason);
  }
  async startExam(actor: Actor, id: string) {
    return this.attemptsService.startExam(actor, id);
  }
  async attempt(actor: Actor, id: string) {
    return this.attemptsService.attempt(actor, id);
  }
  async saveAnswers(actor: Actor, id: string, input: z.infer<typeof schema.saveSchema>) {
    return this.attemptsService.saveAnswers(actor, id, input);
  }
  async submitExam(actor: Actor, id: string, key: string) {
    return this.attemptsService.submitExam(actor, id, key);
  }
  async sweepDueAttempts() {
    return this.deadlinesService.sweepDueAttempts();
  }
  async examAttempts(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    return this.gradingService.examAttempts(actor, id, query);
  }
  async examRoster(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    return this.gradingService.examRoster(actor, id, query);
  }
  async examItemAnalysis(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    return this.gradingService.examItemAnalysis(actor, id, query);
  }
  async examQuestionAnswers(
    actor: Actor,
    id: string,
    questionVersionId: string,
    query: z.infer<typeof schema.listSchema>,
  ) {
    return this.gradingService.examQuestionAnswers(actor, id, questionVersionId, query);
  }
  async gradeAttempt(actor: Actor, id: string, input: z.infer<typeof schema.examGradeSchema>) {
    return this.gradingService.gradeAttempt(actor, id, input);
  }
  async releaseExam(actor: Actor, id: string) {
    return this.gradingService.releaseExam(actor, id);
  }
  async extendExam(actor: Actor, id: string, input: z.infer<typeof schema.extensionSchema>) {
    return this.examsService.extendExam(actor, id, input);
  }
  async eligibility(actor: Actor, id: string, input: z.infer<typeof schema.eligibilitySchema>) {
    return this.examsService.eligibility(actor, id, input);
  }
  async appeal(actor: Actor, id: string, reason: string) {
    return this.appealsService.appeal(actor, id, reason);
  }
  async appeals(actor: Actor, query: z.infer<typeof schema.listSchema>) {
    return this.appealsService.appeals(actor, query);
  }
  async resolveAppeal(actor: Actor, id: string, input: z.infer<typeof schema.resolveSchema>) {
    return this.appealsService.resolveAppeal(actor, id, input);
  }
  async gradeHistory(actor: Actor, id: string, query: z.infer<typeof schema.listSchema>) {
    return this.appealsService.gradeHistory(actor, id, query);
  }
}
