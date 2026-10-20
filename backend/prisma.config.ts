import { defineConfig } from 'prisma/config';

// Prisma 7: Migrate/CLI 的连接信息从 schema.prisma 的 datasource.url
// 迁移到 prisma.config.ts。
//
// 库文件由环境变量 DATABASE_URL 决定, 三环境各连各的库:
//   development -> file:./dev.db
//   test        -> file:./test.db
//   production  -> 由 .env.production / 容器环境注入
//
// ⚠ 本文件由 jiti 直接加载, **不经过 Nest**, 故拿不到 ConfigService。
// 这里直接调用与 Nest 侧同一份 env-files 模块, 保证两边读到的档位逐字一致 ——
// 若各写一套选择逻辑, 就会出现「Nest 连test.db、prisma db push 打dev.db」
// 这种最难查的库错位。
import { loadEnvFiles } from './src/config/env-files';

loadEnvFiles(process.env.NODE_ENV, process.cwd());

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL || 'file:./dev.db',
  },
});