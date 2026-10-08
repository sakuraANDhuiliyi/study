import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { assertRuntimeDatabaseRole } from './database-security';
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    if (process.env.NODE_ENV === 'production') await assertRuntimeDatabaseRole(this);
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
