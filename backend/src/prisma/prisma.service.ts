import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import {
  createPrismaClient,
  DEV_DATABASE_URL,
  isSqliteUrl,
} from './create-prisma-client';

/**
 * 数据库服务 —— 类型面与注入令牌都是 Prisma client。
 *
 * 类与接口合并：`PrismaService` 的实例由 PrismaModule 的工厂按方言构造,
 * 这里不提供构造函数（永远不要 new 它；脚本/集成测试请直接调
 * `createPrismaClient`）。接口把生成 client 的完整 API 面（模型 delegate、
 * `$transaction` / `$queryRaw` 等）赋给 PrismaService 类型, 业务代码在双方言
 * 下都有真实类型。令牌值就是 PG PrismaClient 类对象, `@Injectable()` 类仅作
 * 类型标注与 Nest 扫描锚点。
 *
 * 方言选择与 client 构造在 `create-prisma-client.ts`（零 Nest 依赖, 脚本共用）,
 * 这里只负责把它接入 Nest 的依赖图。
 */
export type PrismaService = PrismaClient;

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const PrismaService = PrismaClient;

// 保持旧导入路径可用：业务代码与脚本历史上从 prisma.service 取这几个符号。
export { createPrismaClient, DEV_DATABASE_URL, isSqliteUrl };

/**
 * 连接生命周期挂到 Nest 模块图：启动即连（库不可达要在装配期失败,
 * 而不是第一个请求），关闭时释放连接池。
 */
@Injectable()
export class PrismaLifecycle implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
