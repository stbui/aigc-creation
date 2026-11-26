import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7: Migrate/CLI 的连接信息从 schema.prisma 的 datasource.url
// 迁移到 prisma.config.ts。
//
// 双方言: 本地（development / test）默认 SQLite, production 默认 PostgreSQL;
// DATABASE_URL 显式给出时按其协议覆盖默认 —— `file:` 前缀走 SQLite 方言
// （schema.sqlite.prisma + migrations-sqlite/），否则走 PG 方言
// （schema.prisma + migrations/）。两套目录的事实源是 schema.prisma 与
// prisma/migrations，SQLite 侧由 `npm run prisma:sync-sqlite` 派生。
//
// ⚠ 本文件由 jiti 直接加载, **不经过 Nest**, 故拿不到 ConfigService。
// 这里直接调用与 Nest 侧同一份 env-files 模块, 保证两边读到的档位逐字一致 ——
// 若各写一套选择逻辑, 就会出现「Nest 连 test.db、prisma migrate deploy 打
// dev.db」这种最难查的库错位。
import { loadEnvFiles } from './src/config/env-files';

loadEnvFiles(process.env.NODE_ENV, process.cwd());

const DEV_DATABASE_URL = 'file:./dev.db';

const url = process.env.DATABASE_URL?.trim() || DEV_DATABASE_URL;
const isSqlite = url.startsWith('file:');

// migrate diff 对比迁移目录时需要影子库（Prisma 7 不再接受 CLI 传 shadow url）。
//   · SQLite —— 本地临时文件即可, 不需要额外服务;
//   · PostgreSQL —— 必须显式给 SHADOW_DATABASE_URL（指向可写的独立空库）,
//     未设置时 verify:prisma 会跳过 PG 迁移对比并明确提示, 而不是拿生产库当影子库。
const shadowDatabaseUrl = isSqlite
  ? `file:${resolve(process.cwd(), 'prisma', '.shadow-verify.db')}`
  : process.env.SHADOW_DATABASE_URL?.trim() || undefined;

export default defineConfig({
  schema: isSqlite ? 'prisma/schema.sqlite.prisma' : 'prisma/schema.prisma',
  migrations: {
    path: isSqlite ? 'prisma/migrations-sqlite' : 'prisma/migrations',
  },
  datasource: {
    url,
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
});
