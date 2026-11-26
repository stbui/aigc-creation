/**
 * .js 运维脚本获取 Prisma Client 的唯一入口。
 *
 * Prisma 7 的 `prisma-client` 生成器输出 TypeScript 源码（src/generated/prisma），
 * 由 tsc 编译进 dist 供 Nest 运行；普通 node 脚本不能直接 require TS，这里复用
 * 脚本侧已有的 ts-node（transpile-only）转译同一份生成代码，避免退回旧生成器
 * 或维护第二份 client。
 *
 * 双方言（2026-11）：client 必须按 `DATABASE_URL` 协议选择 —— `file:` 走
 * SQLite 生成物 + better-sqlite3 adapter, 其余走 PG 生成物 + pg adapter。
 * 选择逻辑在 `src/prisma/create-prisma-client.ts`（与 Nest 侧同一份）。这里的
 * `PrismaClient` 是兼容旧写法的薄包装：忽略调用方传入的 adapter 选项, 统一按
 * `resolveDbUrl()` 构造正确方言的实例。
 *
 * 新增 .js 脚本时用 `require('./prisma-client')`，不要直接依赖 '@prisma/client'。
 */
require('ts-node/register/transpile-only');

const generated = require('../src/generated/prisma/client.ts');
const { createPrismaClient } = require('../src/prisma/create-prisma-client.ts');
const { resolveDbUrl } = require('./db-url');

/**
 * 兼容包装：`new PrismaClient({ adapter: ... })` 的调用方无需改动。
 * 返回真实方言 client（JS 允许构造函数返回对象）。
 */
class PrismaClient {
  constructor() {
    return createPrismaClient(resolveDbUrl());
  }
}

module.exports = {
  ...generated,
  PrismaClient,
  createPrismaClient,
  resolveDbUrl,
};
