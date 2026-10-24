import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentActor } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { algorithmProblems, getAlgorithmProblem } from '../algorithms/algorithms.catalog';
import { getAlgorithmEditorial } from '../algorithms/algorithms.editorials';
import { algorithmLearningInput } from '../algorithms/algorithms.schemas';
import {
  algorithmLearningDto,
  algorithmPage,
  algorithmSummaries,
  saveAlgorithmLearning,
} from '../algorithms/algorithms.student';
import { mobileAlgorithmQuery } from './mobile-algorithms.schemas';
const problemId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
@Controller('mobile/algorithms')
@UseGuards(AuthGuard)
export class MobileAlgorithmsController {
  constructor(private db: PrismaService) {}
  private async current(tx: Prisma.TransactionClient, a: Actor) {
    const auth = new AuthService(tx as PrismaService);
    const current = a.sessionId ? await auth.resolveMobileSessionId(a.sessionId) : null;
    if (
      !current ||
      current.id !== a.id ||
      current.organizationId !== a.organizationId ||
      current.role !== a.role
    )
      throw new UnauthorizedException('会话或身份已变化，请重新登录');
    auth.require(current, 'learning.use');
    await auth.checkFeature(current, '/api/algorithms');
    return current;
  }
  private async scope<T>(a: Actor, run: (tx: Prisma.TransactionClient, current: Actor) => Promise<T>) {
    if (a.clientType !== 'MOBILE' || a.role !== 'STUDENT') throw new ForbiddenException('请使用学生手机会话');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`algorithms:${a.organizationId}:${a.id}`}))`;
      const actor = await this.current(tx, a);
      const result = await run(tx, actor);
      await this.current(tx, a);
      return result;
    });
  }
  private catalog(value: string) {
    const p = getAlgorithmProblem(problemId.parse(value));
    if (!p) throw new NotFoundException('算法题不存在');
    return p;
  }
  private async summaries(tx: Prisma.TransactionClient, a: Actor) {
    const where = { organizationId: a.organizationId, userId: a.id };
    const [submitted, states] = await Promise.all([
      tx.algorithmSubmission.groupBy({
        where: { ...where, mode: 'submit', customInput: false },
        by: ['problemId', 'status'],
      }),
      tx.algorithmLearningState.findMany({
        where,
        select: { problemId: true, favorite: true, reviewStatus: true },
      }),
    ]);
    return algorithmSummaries(submitted, states);
  }
  @Get('problems') list(@CurrentActor() a: Actor, @Query() input: unknown) {
    const q = mobileAlgorithmQuery.parse(input);
    return this.scope(a, async (tx, current) => algorithmPage(await this.summaries(tx, current), q));
  }
  @Get('problems/:id') read(@CurrentActor() a: Actor, @Param('id') id: string) {
    const p = this.catalog(id);
    return this.scope(a, async (tx, current) => {
      const state = await tx.algorithmLearningState.findFirst({
        where: { organizationId: current.organizationId, userId: current.id, problemId: p.id },
      });
      const at = algorithmProblems.findIndex((x) => x.id === p.id);
      return {
        id: p.id,
        number: p.number,
        title: p.title,
        difficulty: p.difficulty,
        tags: p.tags,
        description: p.description,
        inputFormat: p.inputFormat,
        outputFormat: p.outputFormat,
        constraints: p.constraints,
        examples: p.examples,
        timeLimitMs: p.timeLimitMs,
        memoryLimitMb: p.memoryLimitMb,
        learningState: algorithmLearningDto(state),
        editorialAvailable: Boolean(getAlgorithmEditorial(p.id)),
        navigation: {
          previousProblemId: algorithmProblems[at - 1]?.id ?? null,
          nextProblemId: algorithmProblems[at + 1]?.id ?? null,
        },
      };
    });
  }
  @Get('problems/:id/editorial') editorial(@CurrentActor() a: Actor, @Param('id') id: string) {
    const p = this.catalog(id);
    return this.scope(a, async (tx, current) => {
      const editorial = getAlgorithmEditorial(p.id);
      if (!editorial) throw new NotFoundException('本题题解尚未发布');
      const summaries = await this.summaries(tx, current);
      return {
        editorial,
        relatedProblems: editorial.relatedProblemIds
          .filter((id) => id !== p.id)
          .map((id) => summaries.find((p) => p.id === id))
          .filter((p) => p !== undefined),
      };
    });
  }
  @Get('problems/:id/learning') learning(@CurrentActor() a: Actor, @Param('id') id: string) {
    const p = this.catalog(id);
    return this.scope(a, async (tx, current) =>
      algorithmLearningDto(
        await tx.algorithmLearningState.findFirst({
          where: { organizationId: current.organizationId, userId: current.id, problemId: p.id },
        }),
      ),
    );
  }
  @Patch('problems/:id/learning') save(
    @CurrentActor() a: Actor,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    const p = this.catalog(id),
      body = algorithmLearningInput.parse(input);
    return this.scope(a, (tx, current) => saveAlgorithmLearning(tx, current, p.id, body));
  }
}
