import { Module, Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from './common/prisma.service';
import { AuthService } from './auth/auth.service';
import { Actor, AuthGuard, CurrentActor } from './auth/auth.guard';
import { AuthController } from './auth/auth.controller';
import { AuditService } from './common/audit.service';
import { JobsService } from './common/jobs.service';
import { CoursesController } from './courses/courses.controller';
import { AdminController } from './admin/admin.controller';
import { AnalyticsController } from './analytics/analytics.controller';
import { AssessmentController } from './assessment/assessment.controller';
import { AssessmentService } from './assessment/assessment.service';
import {
  CommunicationController,
  NotificationController,
  AttachmentsController,
} from './communication/communication.controller';
import { CommunicationService } from './communication/communication.service';
import { CommunicationGateway } from './communication/communication.gateway';
import { LocalPrivateStorage } from './communication/storage';
import { PlannerController } from './planner/planner.controller';
import { NotesController } from './notes/notes.controller';
import { AiStudyController } from './ai-study/ai-study.controller';
import { AiStudyService } from './ai-study/ai-study.service';
import { AiConfiguration } from './ai-study/ai.config';
import { AiGateway } from './ai-study/ai.gateway';
import { AiAuthoringController } from './ai-authoring/ai-authoring.controller';
import { AiAuthoringService } from './ai-authoring/ai-authoring.service';
import { AiAuthoringGateway } from './ai-authoring/ai-authoring.gateway';
@Controller('health')
class HealthController {
  constructor(private db: PrismaService) {}
  @Get() async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: 'ok', service: 'zhixue-lms', time: new Date().toISOString() };
  }
}
@Controller('platform')
class PlatformController {
  constructor(private db: PrismaService) {}
  @Get() async platform() {
    const org = await this.db.organization.findFirst({
      where: {
        active: true,
        ...(process.env.PUBLIC_ORGANIZATION_ID ? { id: process.env.PUBLIC_ORGANIZATION_ID } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!org) return { name: '知学', logoUrl: null };
    const settings = await this.db.systemSetting.findMany({
      where: { organizationId: org.id, key: { in: ['platformName', 'logoUrl'] } },
    });
    return {
      name: settings.find((s) => s.key === 'platformName')?.value || org.name,
      logoUrl: settings.find((s) => s.key === 'logoUrl')?.value || null,
    };
  }
}
@UseGuards(AuthGuard)
@Controller('catalog')
class CatalogController {
  constructor(private db: PrismaService) {}
  @Get() async catalog(@CurrentActor() actor: Actor) {
    const configured = await this.db.systemSetting.findUnique({
      where: { organizationId_key: { organizationId: actor.organizationId, key: 'dataDictionary' } },
    });
    if (configured) return configured.value;
    const [courses, classes] = await Promise.all([
      this.db.course.findMany({
        where: { organizationId: actor.organizationId },
        distinct: ['category'],
        select: { category: true },
        orderBy: { category: 'asc' },
        take: 100,
      }),
      this.db.class.findMany({
        where: { organizationId: actor.organizationId },
        distinct: ['grade'],
        select: { grade: true },
        orderBy: { grade: 'asc' },
        take: 100,
      }),
    ]);
    return { courseCategories: courses.map((c) => c.category), grades: classes.map((c) => c.grade) };
  }
}
@Module({
  controllers: [
    HealthController,
    PlatformController,
    CatalogController,
    AuthController,
    CoursesController,
    AdminController,
    AnalyticsController,
    AssessmentController,
    CommunicationController,
    NotificationController,
    AttachmentsController,
    PlannerController,
    NotesController,
    AiStudyController,
    AiAuthoringController,
  ],
  providers: [
    PrismaService,
    AuthService,
    AuthGuard,
    AuditService,
    JobsService,
    AssessmentService,
    CommunicationService,
    CommunicationGateway,
    LocalPrivateStorage,
    AiConfiguration,
    AiGateway,
    AiStudyService,
    AiAuthoringService,
    AiAuthoringGateway,
  ],
})
export class AppModule {}
