import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard, Actor, CurrentActor } from '../auth/auth.guard';
import { AssessmentService } from './assessment.service';
import * as s from './assessment.schemas';

@ApiTags('题库、作业、练习、考试与成绩')
@ApiCookieAuth()
@UseGuards(AuthGuard)
@Controller()
export class AssessmentController {
  constructor(private readonly service: AssessmentService) {}
  @Get('questions') @ApiOperation({ summary: 'question.manage：分页查询授权题库' }) questions(
    @CurrentActor() a: Actor,
    @Query() q: unknown,
  ) {
    return this.service.questions(a, s.listSchema.parse(q));
  }
  @Post('questions') createQuestion(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.service.createQuestion(a, s.questionSchema.parse(b));
  }
  @Post('questions/import')
  @ApiOperation({ summary: '题库 JSON 导入：commit=false 验证预览，commit=true 完整验证后写入' })
  importQuestions(@CurrentActor() a: Actor, @Body() b: unknown) {
    const input = z
      .object({ rows: z.array(z.unknown()).min(1).max(500), commit: z.boolean().default(false) })
      .parse(b);
    return this.service.importQuestions(a, input.rows, input.commit);
  }
  @Get('questions/export') exportQuestions(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.service.exportQuestions(a, s.listSchema.parse(q));
  }
  @Get('questions/template') template(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.service.questionTemplate(
      a,
      z.object({ courseId: z.string().min(1).max(100) }).parse(q).courseId,
    );
  }
  @Get('questions/:id') question(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.question(a, id);
  }
  @Patch('questions/:id') updateQuestion(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.updateQuestion(a, id, s.questionPatchSchema.parse(b));
  }
  @Get('questions/:id/versions') versions(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.service.questionVersions(a, id, s.listSchema.parse(q));
  }
  @Post('questions/:id/copy') copy(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.copyQuestion(a, id);
  }
  @Put('questions/:id/favorite') favorite(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.favorite(a, id, z.object({ favorite: z.boolean() }).parse(b).favorite);
  }
  @Get('papers') papers(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.service.papers(a, s.listSchema.parse(q));
  }
  @Post('papers') createPaper(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.service.createPaper(a, s.paperSchema.parse(b));
  }

  @Get('assignments') assignments(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.service.assignments(a, s.listSchema.parse(q));
  }
  @Post('assignments') createAssignment(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.service.createAssignment(a, s.assignmentSchema.parse(b));
  }
  @Get('assignments/:id') assignment(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.assignment(a, id);
  }
  @Patch('assignments/:id') updateAssignment(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.updateAssignment(a, id, s.assignmentPatchSchema.parse(b));
  }
  @Post('assignments/:id/publish') publishAssignment(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.publishAssignment(a, id);
  }
  @Put('assignments/:id/draft') saveAssignment(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.saveAssignmentDraft(a, id, s.draftSchema.parse(b));
  }
  @Post('assignments/:id/submit') submitAssignment(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.submitAssignment(a, id, s.submissionSchema.parse(b));
  }
  @Get('assignments/:id/submissions') submissions(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.service.submissions(a, id, s.listSchema.parse(q));
  }
  @Get('assignments/:id/roster') assignmentRoster(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.service.assignmentRoster(a, id, s.listSchema.parse(q));
  }
  @Post('assignments/:id/release') releaseAssignment(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.releaseAssignment(a, id);
  }
  @Post('assignments/:id/exceptions') exception(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.assignmentException(a, id, s.exceptionSchema.parse(b));
  }
  @Put('submissions/:id/grade') gradeSubmission(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.gradeSubmission(a, id, s.gradeSchema.parse(b));
  }
  @Post('submissions/:id/return') returnSubmission(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.returnSubmission(a, id, s.returnSchema.parse(b).reason);
  }

  @Get('practice') practices(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.service.practices(a, s.listSchema.parse(q));
  }
  @Post('practice') createPractice(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.service.createPractice(a, s.practiceSchema.parse(b));
  }
  @Get('practice/:id') practice(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.practice(a, id);
  }
  @Put('practice/:id/progress') savePracticeProgress(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.savePracticeProgress(a, id, s.practiceProgressSchema.parse(b));
  }
  @Post('practice/:id/answer') answerPractice(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.answerPractice(a, id, s.answerSchema.parse(b));
  }
  @Get('mistakes') mistakes(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.service.questionCollection(a, 'mistakes', s.listSchema.parse(q));
  }
  @Patch('mistakes/:id') mastered(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.service.masterMistake(a, id, z.object({ mastered: z.boolean() }).parse(b).mastered);
  }
  @Get('favorites') favorites(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.service.questionCollection(a, 'favorites', s.listSchema.parse(q));
  }

  @Get('exams') exams(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.service.exams(a, s.listSchema.parse(q));
  }
  @Post('exams') createExam(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.service.createExam(a, s.examSchema.parse(b));
  }
  @Get('exams/:id') exam(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.exam(a, id);
  }
  @Patch('exams/:id') updateExam(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.service.updateExam(a, id, s.examPatchSchema.parse(b));
  }
  @Post('exams/:id/publish') publishExam(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.publishExam(a, id);
  }
  @Post('exams/:id/cancel') cancelExam(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.cancelExam(a, id, s.returnSchema.parse(b).reason);
  }
  @Post('exams/:id/start')
  @ApiOperation({ summary: '开始/恢复考试；服务器计算个人 deadlineAt 并冻结随机顺序' })
  startExam(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.startExam(a, id);
  }
  @Get('exams/:id/attempts') attempts(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.service.examAttempts(a, id, s.listSchema.parse(q));
  }
  @Get('exams/:id/roster') examRoster(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.service.examRoster(a, id, s.listSchema.parse(q));
  }
  @Get('exams/:id/item-analysis')
  @ApiOperation({ summary: '教师考试题目分析：每人最近一次有效交卷，分页聚合，无个人答卷信息' })
  examItemAnalysis(@CurrentActor() a: Actor, @Param('id') id: string, @Query() q: unknown) {
    return this.service.examItemAnalysis(a, id, s.listSchema.parse(q));
  }
  @Get('exams/:id/questions/:questionVersionId/answers') examQuestionAnswers(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Param('questionVersionId') questionVersionId: string,
    @Query() q: unknown,
  ) {
    return this.service.examQuestionAnswers(a, id, questionVersionId, s.listSchema.parse(q));
  }
  @Post('exams/:id/release') releaseExam(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.releaseExam(a, id);
  }
  @Post('exams/:id/extensions') extend(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.extendExam(a, id, s.extensionSchema.parse(b));
  }
  @Put('exams/:id/eligibility') eligibility(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.eligibility(a, id, s.eligibilitySchema.parse(b));
  }
  @Get('attempts/:id') attempt(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.service.attempt(a, id);
  }
  @Put('attempts/:id/answers')
  @ApiOperation({ summary: 'CAS 自动保存；revision 冲突返回 409，过期请求拒绝并服务端交卷' })
  saveAnswers(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.service.saveAnswers(a, id, s.saveSchema.parse(b));
  }
  @Post('attempts/:id/submit') submitExam(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.submitExam(a, id, s.submitExamSchema.parse(b).idempotencyKey);
  }
  @Put('attempts/:id/grade') gradeAttempt(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.gradeAttempt(a, id, s.examGradeSchema.parse(b));
  }
  @Post('attempts/:id/appeals') appeal(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.appeal(a, id, s.appealSchema.parse(b).reason);
  }
  @Get('attempts/:id/revisions') revisions(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.service.gradeHistory(a, id, s.listSchema.parse(q));
  }
  @Get('appeals') appeals(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.service.appeals(a, s.listSchema.parse(q));
  }
  @Post('appeals/:id/resolve') resolve(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.resolveAppeal(a, id, s.resolveSchema.parse(b));
  }
}
