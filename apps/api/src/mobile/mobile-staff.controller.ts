import {
  Body,
  Controller,
  Delete,
  Put,
  NotFoundException,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, CurrentActor, type Actor } from '../auth/auth.guard';
import { CoursesController } from '../courses/courses.controller';
import { AdminController } from '../admin/admin.controller';
import { AccountsService } from '../accounts/accounts.service';
import { AcademicsService } from '../academics/academics.service';
import { AssessmentService } from '../assessment/assessment.service';
import * as schema from '../assessment/assessment.schemas';
import { GradingQueueService, gradingAllowed, queueQuery } from '../assessment/grading-queue.service';
import { AdminJobsService } from '../admin/jobs.service';

@Injectable()
export class MobileStaffGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const actor = context.switchToHttp().getRequest().actor as Actor;
    if (
      actor.clientType !== 'MOBILE' ||
      actor.accountMode !== 'ORGANIZATION' ||
      !['TEACHER', 'ADMIN', 'SUPER_ADMIN'].includes(actor.role)
    )
      throw new ForbiddenException('请使用机构教职人员手机账号');
    const path = context.switchToHttp().getRequest().path;
    if (
      actor.role === 'TEACHER' &&
      /^\/api\/mobile\/staff\/(users|organizations|classes|terms|catalog|majors|subjects|roles|grants|jobs|join-settings|join-requests)(\/|$)/.test(
        path,
      )
    )
      throw new ForbiddenException('需要管理员身份');
    return true;
  }
}

@Controller('mobile/staff')
@UseGuards(AuthGuard, MobileStaffGuard)
export class MobileStaffController {
  constructor(
    private readonly courses: CoursesController,
    private readonly admin: AdminController,
    private readonly majors: AcademicsService,
    private readonly accounts: AccountsService,
    private readonly assessment: AssessmentService,
    private readonly grading: GradingQueueService,
    private readonly jobs: AdminJobsService,
  ) {}

  @Patch('users/:id') editUser(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.admin.update(
      a,
      id,
      z
        .object({ name: z.string().max(80).optional(), active: z.boolean().optional() })
        .strict()
        .parse(b),
    );
  }
  @Post('users/:id/recovery') recovery(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.admin.recovery(a, id);
  }
  @Post('organizations/:id/admins') organizationAdmin(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.admin.organizationAdmin(a, id, b);
  }
  @Patch('organizations/:id') editOrg(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.admin.organizationEdit(a, id, b);
  }
  @Get('users') users(@CurrentActor() actor: Actor, @Query() q: Record<string, string>) {
    return this.admin.users(actor, q);
  }
  @Post('users') addUser(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.admin.create(actor, body);
  }
  @Patch('users/:id/major') assignMajor(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.update(
      actor,
      id,
      z
        .object({ majorId: z.string().min(1).max(100).nullable() })
        .strict()
        .parse(body),
    );
  }
  @Get('majors') listMajors(@CurrentActor() actor: Actor) {
    return this.majors.adminMajors(actor);
  }
  @Get('classes') classes(@CurrentActor() actor: Actor, @Query() q: Record<string, string>) {
    return this.admin.classes(actor, q);
  }
  @Post('classes') addClass(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.admin.classCreate(actor, body);
  }
  @Get('terms') terms(@CurrentActor() actor: Actor, @Query() q: Record<string, string>) {
    return this.admin.terms(actor, q);
  }
  @Post('terms') addTerm(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.admin.termCreate(actor, body);
  }
  @Get('organizations') orgs(@CurrentActor() actor: Actor, @Query() q: Record<string, string>) {
    return this.admin.organizations(actor, q);
  }
  @Post('organizations') addOrg(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.admin.organization(actor, body);
  }
  @Get('people') people(@CurrentActor() a: Actor, @Query() q: Record<string, string>) {
    return this.admin.people(a, q);
  }
  @Get('catalog') async catalog(@CurrentActor() a: Actor) {
    const [subjects, majors, catalog] = await Promise.all([
      this.majors.adminSubjects(a),
      this.majors.adminMajors(a),
      this.majors.catalog(a),
    ]);
    return { subjects: subjects.items, majors: majors.items, modules: catalog.modules };
  }
  @Post('subjects') subject(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.majors.createSubject(a, b);
  }
  @Post('majors') major(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.majors.createMajor(a, b);
  }
  @Patch('subjects/:id') editSubject(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.majors.patchSubject(a, id, b);
  }
  @Patch('majors/:id') editMajor(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.majors.patchMajor(a, id, b);
  }
  @Get('roles') roles(@CurrentActor() a: Actor) {
    return this.admin.roles(a);
  }
  @Patch('roles/:id') role(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.admin.roleEdit(a, id, b);
  }
  @Get('grants') grants(@CurrentActor() a: Actor, @Query() q: Record<string, string>) {
    return this.admin.grants(a, q);
  }
  @Post('grants') grant(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.admin.grant(a, b);
  }
  @Delete('grants/:id') revoke(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.admin.revoke(a, id, b);
  }
  @Get('classes/:id/members') classMembers(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: Record<string, string>,
  ) {
    return this.admin.classMembers(a, id, q);
  }
  @Post('classes/:id/members') classMember(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.admin.classMember(a, id, b);
  }
  @Post('classes/:id/courses') bindCourse(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.admin.classCourse(a, id, b);
  }
  @Get('join-settings') joinSettings(@CurrentActor() a: Actor) {
    return this.accounts.joinSettings(a);
  }
  @Patch('join-settings') updateJoinSettings(@CurrentActor() a: Actor, @Body() b: unknown) {
    return this.accounts.updateJoinSettings(
      a,
      z.object({ joinEnabled: z.boolean() }).strict().parse(b).joinEnabled,
    );
  }
  @Post('join-settings/rotate') rotate(@CurrentActor() a: Actor, @Body() b: unknown) {
    z.object({}).strict().parse(b);
    return this.accounts.updateJoinSettings(a, undefined, true);
  }
  @Get('courses/:id/members') members(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Query() q: Record<string, string>,
  ) {
    return this.courses.members(a, id, q);
  }
  @Post('courses/:id/members') enroll(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    return this.courses.addMember(a, id, b);
  }
  @Post('assignments/:id/release') releaseAssignment(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.assessment.releaseAssignment(a, id);
  }
  @Post('exams/:id/release') releaseExam(@CurrentActor() a: Actor, @Param('id') id: string) {
    return this.assessment.releaseExam(a, id);
  }
  @Get('jobs') readJobs(@CurrentActor() actor: Actor, @Query() q: unknown) {
    return this.jobs.list(actor, q);
  }
  @Get('join-requests') requests(@CurrentActor() actor: Actor, @Query() q: unknown) {
    return this.accounts.adminRequests(actor, q);
  }
  @Patch('join-requests/:id') review(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.accounts.review(actor, id, b);
  }
  @Post('courses') createCourse(@CurrentActor() actor: Actor, @Body() b: unknown) {
    return this.courses.create(actor, b);
  }
  @Patch('courses/:id/status') status(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.courses.update(
      actor,
      id,
      z
        .object({ status: z.enum(['PUBLISHED', 'UNPUBLISHED']) })
        .strict()
        .parse(b),
    );
  }
  @Post('courses/:id/chapters') addChapter(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.courses.chapter(actor, id, b);
  }
  @Post('chapters/:id/lessons') addLesson(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.courses.lesson(actor, id, b);
  }
  @Get('questions') questions(@CurrentActor() actor: Actor, @Query() q: unknown) {
    return this.assessment.questions(actor, schema.listSchema.parse(q));
  }
  @Post('questions') question(@CurrentActor() actor: Actor, @Body() b: unknown) {
    return this.assessment.createQuestion(actor, schema.questionSchema.parse(b));
  }
  @Get('assignments') assignments(@CurrentActor() actor: Actor, @Query() q: unknown) {
    return this.assessment.assignments(actor, schema.listSchema.parse(q));
  }
  @Post('assignments') assignment(@CurrentActor() actor: Actor, @Body() b: unknown) {
    return this.assessment.createAssignment(actor, schema.assignmentSchema.parse(b));
  }
  @Post('assignments/:id/publish') publishAssignment(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.assessment.publishAssignment(actor, id);
  }
  @Get('exams') exams(@CurrentActor() actor: Actor, @Query() q: unknown) {
    return this.assessment.exams(actor, schema.listSchema.parse(q));
  }
  @Post('exams') exam(@CurrentActor() actor: Actor, @Body() b: unknown) {
    return this.assessment.createExam(actor, schema.examSchema.parse(b));
  }
  @Post('exams/:id/publish') publishExam(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.assessment.publishExam(actor, id);
  }

  private grader(actor: Actor) {
    if (!gradingAllowed(actor)) throw new ForbiddenException('当前身份没有批阅权限');
  }
  @Get('grading') queue(@CurrentActor() a: Actor, @Query() q: unknown) {
    return this.grading.read(a, queueQuery.parse(q));
  }
  @Get('grading/assignments/:id/:submission') async assignmentPaper(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Param('submission') submission: string,
  ) {
    this.grader(a);
    const [assignment, rows] = await Promise.all([
      this.assessment.assignment(a, id),
      this.assessment.submissions(a, id, schema.recordListSchema.parse({ recordId: submission })),
    ]);
    const row = rows.items[0];
    if (!row) throw new NotFoundException('未找到提交');
    return { assignment, submission: row };
  }
  @Get('grading/exams/:id') attempt(@CurrentActor() a: Actor, @Param('id') id: string) {
    this.grader(a);
    return this.assessment.attempt(a, id);
  }
  @Get('grading/appeals/:id') async appeal(@CurrentActor() a: Actor, @Param('id') id: string) {
    this.grader(a);
    const rows = await this.assessment.appeals(a, schema.recordListSchema.parse({ recordId: id }));
    if (!rows.items[0]) throw new NotFoundException('未找到复核申请');
    return rows.items[0];
  }
  @Put('grading/submissions/:id') grade(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    this.grader(a);
    return this.assessment.gradeSubmission(a, id, schema.gradeSchema.parse(b));
  }
  @Put('grading/exams/:id') gradeExam(@CurrentActor() a: Actor, @Param('id') id: string, @Body() b: unknown) {
    this.grader(a);
    return this.assessment.gradeAttempt(a, id, schema.examGradeSchema.parse(b));
  }
  @Post('grading/appeals/:id') resolve(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    this.grader(a);
    return this.assessment.resolveAppeal(a, id, schema.resolveSchema.parse(b));
  }
}
