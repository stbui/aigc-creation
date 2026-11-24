/**
 * .js 运维脚本获取 Prisma Client 的唯一入口。
 *
 * Prisma 7 的 `prisma-client` 生成器输出 TypeScript 源码（src/generated/prisma），
 * 由 tsc 编译进 dist 供 Nest 运行；普通 node 脚本不能直接 require TS，这里复用
 * 脚本侧已有的 ts-node（transpile-only）转译同一份生成代码，避免退回旧生成器
 * 或维护第二份 client。
 *
 * 新增 .js 脚本时用 `require('./prisma-client')`，不要直接依赖 '@prisma/client'。
 */
require('ts-node/register/transpile-only');

module.exports = require('../src/generated/prisma/client.ts');