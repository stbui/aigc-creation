import { PrismaClient } from '../generated/prisma/client';
import { PrismaClient as SqlitePrismaClient } from '../generated/prisma-sqlite/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

// Prisma 7 breaking change: datasource url 不再写在 schema.prisma,
// 必须通过 driver adapter 传给 PrismaClient 构造函数。
// 详见 https://pris.ly/d/prisma7-client-config
//
// 双方言（2026-11）：本地 development / test 用 SQLite, production 用
// PostgreSQL。Prisma 7 的生成 client 在构造期校验 adapter 方言与 schema
// provider 一致（PG client + SQLite adapter 直接抛错）, provider 数组也不再
// 被 schema 支持 —— 所以两方言各持一份生成物, 按 DATABASE_URL 协议选择：
//   · `file:` 前缀 → src/generated/prisma-sqlite + better-sqlite3
//   · 其他（postgresql://…）→ src/generated/prisma + @prisma/adapter-pg
// 两份生成物出自同一份 schema.prisma（SQLite 版是它的派生, 见
// prisma/schema.sqlite.prisma 头注）, 模型与字段完全同构；业务类型统一以
// PG client 为准。SQLite 侧缺失的仅是本仓未使用的 PG-only 面
// （createMany.skipDuplicates / QueryMode / 隔离级别）, 不构成类型空洞。
//
// ⚠ 本文件刻意**不依赖 Nest**：运维脚本与集成测试没有 Nest 容器也要复用
// 同一条选择逻辑, 否则「服务连 A 库、seed 写 B 库」的错位又会回来。
// Nest 侧由 prisma.module.ts 的工厂调用, 并把 PrismaService 的类型/令牌
// 再导出（见 prisma.service.ts）。

/** 默认值与 env.validation.ts / prisma.config.ts 的开发兜底逐字一致。 */
export const DEV_DATABASE_URL = 'file:./dev.db';

/** 按连接串协议判断方言：`file:` = SQLite, 其余 = PostgreSQL。 */
export function isSqliteUrl(url: string | undefined | null): boolean {
  return (url ?? '').trim().toLowerCase().startsWith('file:');
}

/**
 * 按协议构造正确方言的真实 client。
 *
 * Nest 内不要直接调它 —— PrismaModule 的工厂按同一规则提供 PrismaService。
 * 脚本与集成测试请用本函数, 与服务共用同一条选择逻辑。
 */
export function createPrismaClient(url: string): PrismaClient {
  if (isSqliteUrl(url)) {
    const client = new SqlitePrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
    // 见上注：两方言 client 的模型 delegate 同构, 桥接为业务侧 PG 类型。
    return client as unknown as PrismaClient;
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
