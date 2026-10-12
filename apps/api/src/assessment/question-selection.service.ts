import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, type QuestionVersion } from '@prisma/client';
import { Actor } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';
import { AssessmentContext } from './assessment-context';
import { Tx, unique } from './assessment-values';

@Injectable()
export class QuestionSelectionService {
  constructor(private readonly context: AssessmentContext) {}

  async assertNoUnreleasedExam(questionIds: string[], database: Tx | PrismaService = this.context.db) {
    if (
      await database.examPaperItem.count({
        where: {
          questionId: { in: questionIds },
          snapshot: {
            exam: {
              status: { not: 'cancelled' },
              OR: [{ answerReleaseAt: null }, { answerReleaseAt: { gt: new Date() } }],
            },
          },
        },
      })
    )
      throw new ConflictException('题目已用于尚未公开答案的考试，不能开放练习或发布到作业');
  }

  async versionSelection(actor: Actor, courseId: string, ids: string[]) {
    if (!ids.length || unique(ids).length !== ids.length)
      throw new BadRequestException('须选择题目且不能重复');
    const versions = await this.context.db.questionVersion.findMany({
      where: {
        id: { in: ids },
        question: {
          organizationId: actor.organizationId,
          courseId,
          active: true,
          OR: [{ creatorId: actor.id }, { scope: 'shared' }],
        },
      },
      include: { question: true },
    });
    if (versions.length !== ids.length)
      throw new ForbiddenException('题目不可用、不是本课程或没有题库访问权限');
    if (unique(versions.map((v) => v.questionId)).length !== versions.length)
      throw new BadRequestException('不能选择同一道题目的多个版本');
    return ids.map((id) => versions.find((version) => version.id === id)!);
  }

  async sampleVersions(
    actor: Actor,
    courseId: string,
    filters: {
      count: number;
      type?: string;
      difficulty?: number;
      knowledgePoint?: string;
      chapterId?: string;
      questionIds?: string[];
      practiceEnabled?: boolean;
      owned?: boolean;
      mode?: 'random' | 'mistakes' | 'favorites';
    },
  ): Promise<QuestionVersion[]> {
    // Apply current-version criteria and sample in PostgreSQL; never load an entire question bank.
    const clauses = [
      Prisma.sql`q."organizationId" = ${actor.organizationId}`,
      Prisma.sql`q."courseId" = ${courseId}`,
      Prisma.sql`q."active" = TRUE`,
    ];
    if (filters.practiceEnabled !== undefined)
      clauses.push(Prisma.sql`q."practiceEnabled" = ${filters.practiceEnabled}`);
    if (filters.owned) clauses.push(Prisma.sql`(q."creatorId" = ${actor.id} OR q."scope" = 'shared')`);
    if (filters.type) clauses.push(Prisma.sql`v."type" = ${filters.type}`);
    if (filters.difficulty) clauses.push(Prisma.sql`v."difficulty" = ${filters.difficulty}`);
    if (filters.knowledgePoint)
      clauses.push(Prisma.sql`${filters.knowledgePoint} = ANY(v."knowledgePoints")`);
    if (filters.chapterId) clauses.push(Prisma.sql`q."chapterId" = ${filters.chapterId}`);
    if (filters.questionIds)
      clauses.push(
        filters.questionIds.length
          ? Prisma.sql`q."id" IN (${Prisma.join(filters.questionIds)})`
          : Prisma.sql`FALSE`,
      );
    if (filters.mode === 'mistakes')
      clauses.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "MistakeRecord" m WHERE m."questionId" = q."id" AND m."userId" = ${actor.id} AND m."mastered" = FALSE)`,
      );
    if (filters.mode === 'favorites')
      clauses.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "QuestionFavorite" f WHERE f."questionId" = q."id" AND f."userId" = ${actor.id})`,
      );
    return this.context.db.$queryRaw<QuestionVersion[]>(
      Prisma.sql`SELECT v.* FROM "Question" q JOIN "QuestionVersion" v ON v."questionId" = q."id" AND v."version" = q."currentVersion" WHERE ${Prisma.join(clauses, ' AND ')} ORDER BY random() LIMIT ${filters.count}`,
    );
  }
}
