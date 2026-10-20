/**
 * 幂等 seed:  provision 前端登录页「填充演示账号」按钮所需的账号。
 *
 * 前端 constants.ts DEMO_CREDENTIALS 硬编码了 admin@demo.com / demo1234,
 * 若数据库没有该账号, 用户点按钮后必然登录失败, 故提供此脚本。
 *
 * 运行: npm run seed
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { NodeSQLiteDriverAdapterFactory } from '../src/prisma/node-sqlite-adapter';
// 库路径与后端服务同源 (按 NODE_ENV 读 DATABASE_URL), 否则 seed 会写错库
const { resolveDbUrl } = require('./db-url');

const DEMO_EMAIL = 'admin@demo.com';
const DEMO_PASSWORD = 'demo1234';
const DEMO_NAME = '演示账号';

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
  });

  try {
    const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
    if (existing) {
      console.log(`[seed] 演示账号已存在, 跳过: ${DEMO_EMAIL}`);
    } else {
      const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
      await prisma.user.create({
        data: { email: DEMO_EMAIL, passwordHash, name: DEMO_NAME },
      });
      console.log(`[seed] 已创建演示账号: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed] 失败:', err);
  process.exit(1);
});
