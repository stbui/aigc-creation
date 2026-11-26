/**
 * PostgreSQL 主源 schema → SQLite 派生 schema 的唯一边界。
 *
 * 双方言方案里，`prisma/schema.prisma` 是唯一手写事实源；SQLite 版只换
 * datasource provider 与 generator.output，其余逐字一致。这个转换被两处复用：
 *   · `scripts/sync-sqlite-schema.mjs` —— 生成 schema.sqlite.prisma 与迁移基线
 *   · `scripts/verify-prisma.mjs`        —— 校验派生文件没有手改漂移
 * 若各写一份转换逻辑，sync 与 verify 会各自漂移，闸口就失去意义。
 */

/** SQLite 派生文件固定的头注（sync 写入、verify 逐字比对） */
export const SQLITE_HEADER = `// Prisma schema for huojue backend — SQLite 方言。
//
// 本文件是 schema.prisma（PostgreSQL 主源）的**派生**：只把 datasource provider
// 换成 sqlite，其余逐字一致。不要直接编辑本文件 —— 改 schema.prisma 后执行
//   npm run prisma:sync-sqlite
// 重新生成本文件与 SQLite 迁移基线；verify:prisma 会校验两者未漂移。
//
// 说明: capability / status / kind 一律用 String 存储, 取值范围由 DTO / service 层
// 白名单强制约束。Prisma 7 虽允许在 SQLite schema 声明 enum, 但落库只有 TEXT、
// 没有 CHECK, 数据库层仍不校验取值; 本仓统一用 String + 白名单。

`;

/**
 * 由 PG 主源派生 SQLite schema 文本。
 *
 * 只做三件事：换头注、换 generator.output、换 datasource.provider。
 * 任何模型 / 字段差异都应回到 schema.prisma 修改，不能在派生文件里打补丁。
 */
export function deriveSqliteSchema(pgSource) {
  const marker = 'generator client {';
  const start = pgSource.indexOf(marker);
  if (start === -1) {
    throw new Error(`schema.prisma 缺少 "${marker}"，无法派生 SQLite 版本`);
  }
  let body = pgSource.slice(start);

  const outputPattern = /(generator client \{[\s\S]*?output\s*=\s*)"\.\.\/src\/generated\/prisma"/;
  if (!outputPattern.test(body)) {
    throw new Error('schema.prisma 的 generator client 缺少 output = "../src/generated/prisma"');
  }
  body = body.replace(outputPattern, '$1"../src/generated/prisma-sqlite"');

  const providerPattern = /^(\s*provider\s*=\s*)"postgresql"/m;
  if (!providerPattern.test(body)) {
    throw new Error('schema.prisma 的 datasource 缺少 provider = "postgresql"');
  }
  body = body.replace(providerPattern, '$1"sqlite"');

  return SQLITE_HEADER + body;
}
