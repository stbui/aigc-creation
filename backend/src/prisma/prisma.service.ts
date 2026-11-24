import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

// Prisma 7 breaking change: datasource url 不再写在 schema.prisma,
// 必须通过 driver adapter 传给 PrismaClient 构造函数。
// 使用 Prisma 官方 SQLite driver adapter（底层为 better-sqlite3）。
// 详见 https://pris.ly/d/prisma7-client-config
//
// 库路径来自配置层的 DATABASE_URL (db.url), 不再硬编码 'file:./dev.db':
// 「三环境各连各的库」是环境隔离的前提, 硬编码等于把开发库钉成唯一真相。
// 兜底值 'file:./dev.db' 与迁移前逐字一致 —— 未配置 DATABASE_URL 时行为完全不变。
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    super({
      adapter: new PrismaBetterSqlite3({ url: config.get<string>('db.url') ?? 'file:./dev.db' }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
