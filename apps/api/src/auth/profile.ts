import { UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma.service';
import type { Actor } from './auth.guard';
import { majorSummarySelect } from '../accounts/accounts.service';
export async function authProfile(db: PrismaService, actor: Actor) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: {
      id: true,
      name: true,
      username: true,
      organizationId: true,
      accountMode: true,
      majorId: true,
      personalOrganizationId: true,
      roles: { select: { roleId: true } },
    },
  });
  const major = user.majorId
    ? await db.academicsMajor.findFirst({
        where: {
          id: user.majorId,
          OR: [{ organizationId: null }, { organizationId: user.organizationId }],
        },
        select: majorSummarySelect,
      })
    : null;
  if (user.organizationId !== actor.organizationId)
    throw new UnauthorizedException('账号归属已变化，请重新登录');
  const { personalOrganizationId, ...publicUser } = user;
  return {
    user: {
      ...publicUser,
      major,
      canReturnToPersonal:
        user.accountMode === 'ORGANIZATION' &&
        !!personalOrganizationId &&
        user.roles.length === 1 &&
        user.roles[0].roleId === 'STUDENT',
      roles: user.roles
        .filter((x) => user.accountMode !== 'PERSONAL' || x.roleId === 'STUDENT')
        .map((x) => x.roleId),
      role: actor.role,
      permissions: actor.permissions,
    },
    csrfToken: actor.csrfToken,
  };
}
