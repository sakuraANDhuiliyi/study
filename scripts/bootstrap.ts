import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../apps/api/src/auth/password';
import { permissionDefinitions, roleDefinitions } from '../prisma/permissions';
const db = new PrismaClient();
async function main() {
  const username = process.env.BOOTSTRAP_USERNAME?.toLowerCase(),
    password = process.env.BOOTSTRAP_PASSWORD;
  if (!username || !password || password.length < 16)
    throw new Error(
      'Set BOOTSTRAP_USERNAME and BOOTSTRAP_PASSWORD (at least 16 characters) in a secure environment.',
    );
  if (await db.user.findUnique({ where: { username } }))
    throw new Error('Account already exists. Bootstrap never overwrites an account.');
  await db.$transaction(async (tx) => {
    for (const [id, name, sensitive] of permissionDefinitions)
      await tx.permission.upsert({
        where: { id },
        create: { id, name, sensitive },
        update: { name, sensitive },
      });
    for (const [id, r] of Object.entries(roleDefinitions)) {
      const existingRole = await tx.role.findUnique({ where: { id } });
      await tx.role.upsert({
        where: { id },
        create: { id, name: r.name, description: r.description },
        update: {},
      });
      for (const permissionId of existingRole ? [] : r.permissions)
        await tx.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: id, permissionId } },
          create: { roleId: id, permissionId },
          update: {},
        });
    }
    const organizationId = process.env.BOOTSTRAP_ORGANIZATION_ID || 'org-main';
    await tx.organization.upsert({
      where: { id: organizationId },
      create: { id: organizationId, name: process.env.BOOTSTRAP_ORGANIZATION_NAME || '我的学校' },
      update: {},
    });
    const user = await tx.user.create({
      data: {
        organizationId,
        username,
        name: '平台管理员',
        passwordHash: hashPassword(password),
        roles: { create: { roleId: 'SUPER_ADMIN' } },
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId,
        userId: user.id,
        action: 'platform.bootstrap',
        resourceType: 'User',
        resourceId: user.id,
        details: { mode: 'controlled-environment' },
      },
    });
  });
  console.log('Production administrator created. Clear bootstrap environment variables now.');
}
main()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
