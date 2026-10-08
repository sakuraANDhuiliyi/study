import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import type { Session } from '@prisma/client';
import type { Actor } from './auth.guard';
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
@Injectable()
export class AuthService {
  constructor(private readonly db: PrismaService) {}
  require(actor: Actor, permission: string) {
    if (!actor.permissions.includes(permission)) throw new ForbiddenException('没有执行此操作的权限');
  }
  async checkFeature(actor: Actor, path: string) {
    const setting = await this.db.systemSetting.findUnique({
      where: { organizationId_key: { organizationId: actor.organizationId, key: 'features' } },
    });
    const flags = setting?.value as { practice?: boolean; communication?: boolean } | undefined;
    if (
      (flags?.practice === false &&
        (/^\/api\/(practice|mistakes|favorites|ai-study|algorithms)(\/|$)/i.test(path) ||
          /^\/api\/questions\/[^/]+\/favorite\/?$/i.test(path))) ||
      (flags?.communication === false &&
        /^\/api\/(discussions|conversations|communication)(\/|$)/i.test(path))
    )
      throw new ForbiddenException('机构已关闭此功能');
  }
  async resolveSession(token?: string): Promise<Actor | null> {
    if (!token || token.length > 200) return null;
    const session = await this.db.session.findUnique({ where: { tokenHash: tokenHash(token) } });
    return this.actorForSession(session);
  }
  async resolveSessionId(id: string): Promise<Actor | null> {
    return this.actorForSession(await this.db.session.findUnique({ where: { id } }));
  }
  private async actorForSession(session: Session | null): Promise<Actor | null> {
    if (!session || session.expiresAt <= new Date()) return null;
    const user = await this.db.user.findUnique({
      where: { id: session.userId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });
    if (!user?.active || user.authVersion !== session.authVersion) return null;
    const org = await this.db.organization.findUnique({ where: { id: user.organizationId } });
    if (!org?.active) return null;
    if (
      user.accountMode === 'PERSONAL' &&
      (org.kind !== 'PERSONAL' || user.personalOrganizationId !== org.id || session.role !== 'STUDENT')
    )
      return null;
    if (user.accountMode === 'ORGANIZATION' && org.kind !== 'INSTITUTION') return null;
    const role = user.roles.find((r) => r.roleId === session.role)?.role;
    if (!role) return null;
    const grants = await this.db.sensitiveGrant.findMany({
      where: { userId: user.id, organizationId: user.organizationId, expiresAt: { gt: new Date() } },
    });
    const permissions = role.permissions.filter((p) => !p.permission.sensitive).map((p) => p.permissionId);
    // Sensitive grants cannot be inherited through a role template.
    for (const grant of grants)
      if (role.permissions.some((p) => p.permissionId === grant.permissionId))
        permissions.push(grant.permissionId);
    return {
      id: user.id,
      name: user.name,
      organizationId: user.organizationId,
      accountMode: user.accountMode,
      majorId: user.majorId,
      role: role.id,
      permissions,
      sessionId: session.id,
      csrfToken: session.csrfToken,
    };
  }
  async courseIds(actor: Actor): Promise<string[]> {
    if (actor.role === 'STUDENT') {
      this.require(actor, 'course.read');
      const memberships = await this.db.enrollment.findMany({
        where: { userId: actor.id, active: true },
        select: { courseId: true },
      });
      return (
        await this.db.course.findMany({
          where: {
            id: { in: memberships.map((x) => x.courseId) },
            organizationId: actor.organizationId,
            status: { in: ['PUBLISHED', 'ARCHIVED'] },
          },
          select: { id: true },
        })
      ).map((x) => x.id);
    }
    if (actor.role === 'TEACHER') {
      this.require(actor, 'course.read');
      const assignments = await this.db.teachingAssignment.findMany({
        where: { userId: actor.id, active: true },
        select: { courseId: true },
      });
      return (
        await this.db.course.findMany({
          where: { id: { in: assignments.map((x) => x.courseId) }, organizationId: actor.organizationId },
          select: { id: true },
        })
      ).map((x) => x.id);
    }
    this.require(actor, 'course.admin');
    return (
      await this.db.course.findMany({ where: { organizationId: actor.organizationId }, select: { id: true } })
    ).map((x) => x.id);
  }
  async course(actor: Actor, id: string, write = false) {
    const course = await this.db.course.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!course) throw new NotFoundException('课程不存在');
    if (actor.role === 'STUDENT') {
      this.require(actor, 'course.read');
      if (
        write ||
        !['PUBLISHED', 'ARCHIVED'].includes(course.status) ||
        !(await this.db.enrollment.findFirst({ where: { courseId: id, userId: actor.id, active: true } }))
      )
        throw new ForbiddenException('当前没有此课程的访问资格');
    } else if (actor.role === 'TEACHER') {
      this.require(actor, write ? 'course.manage' : 'course.read');
      if (
        !(await this.db.teachingAssignment.findFirst({
          where: { courseId: id, userId: actor.id, active: true },
        }))
      )
        throw new ForbiddenException('未获授权的授课课程');
    } else this.require(actor, 'course.admin');
    if (write && course.status === 'ARCHIVED') throw new ForbiddenException('归档课程不可修改');
    return course;
  }
}
