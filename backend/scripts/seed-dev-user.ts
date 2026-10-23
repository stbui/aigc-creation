/**
 * 幂等 provision 一个**开发/联调用的普通账号**（不是演示账号）。
 *
 * 2026-10-22 起前端不再硬编码任何账号密码（登录页没有「填充演示账号」按钮），
 * 因此这里也不再有固定凭据 —— 账号完全由部署者通过环境变量决定：
 *
 *   SEED_USER_EMAIL=dev@company.com SEED_USER_PASSWORD='…' npm run seed
 *   SEED_USER_EMAIL=dev@company.com npm run seed        ← 密码随机生成并只打印一次
 *   npm run seed                                        ← 未设置邮箱, 什么都不做 (exit 0)
 *
 * 为什么要保留这个脚本而不是删掉：
 *   `seed:all` / `start.sh` / 各冒烟脚本都依赖「库里至少有一个能登录的普通账号」这条
 *   前提。删掉等于让本地环境只剩注册一条路，而注册还要走验证码/限流。
 *   改成环境驱动后：默认什么都不建（生产跑 seed:all 也不会凭空出现账号），
 *   想预置时一条命令即可。
 *
 * 密码策略与 seed-admin.ts 一致：20 位随机、含大小写与数字、不含易混淆字符，
 * 明文只在本次运行输出一次，不写库、不落盘、不入前端。
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { NodeSQLiteDriverAdapterFactory } from '../src/prisma/node-sqlite-adapter';
// 库路径与后端服务同源 (按 NODE_ENV 读 DATABASE_URL), 否则 seed 会写错库
const { resolveDbUrl } = require('./db-url');

const EMAIL = (process.env.SEED_USER_EMAIL || '').trim();
const PASSWORD = process.env.SEED_USER_PASSWORD || '';
const NAME = process.env.SEED_USER_NAME || '开发账号';
/** 可选初始积分：默认 0 —— 不再有「演示账号自带 100 积分」这种隐式行为 */
const CREDITS = Number(process.env.SEED_USER_CREDITS || 0);

const PASSWORD_LENGTH = 20;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function generatePassword(): string {
  let out = '';
  for (let i = 0; i < PASSWORD_LENGTH; i += 1) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  const hasUpper = /[A-Z]/.test(out);
  const hasLower = /[a-z]/.test(out);
  const hasDigit = /[0-9]/.test(out);
  if (hasUpper && hasLower && hasDigit) return out;
  return generatePassword();
}

async function main(): Promise<void> {
  if (!EMAIL) {
    console.log('[seed] 未设置 SEED_USER_EMAIL, 跳过开发账号 provision。');
    console.log('  如需预置：SEED_USER_EMAIL=dev@example.com npm run seed');
    return;
  }

  const prisma = new PrismaClient({
    adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
  });

  try {
    let user = await prisma.user.findUnique({ where: { email: EMAIL } });

    if (user) {
      console.log(`[seed] 账号已存在, 不重置密码: ${EMAIL}`);
    } else {
      const plain = PASSWORD || generatePassword();
      const passwordHash = await bcrypt.hash(plain, 10);
      user = await prisma.user.create({
        data: { email: EMAIL, passwordHash, name: NAME },
      });
      console.log('');
      console.log('='.repeat(60));
      console.log('  开发账号已创建');
      console.log('='.repeat(60));
      console.log(`  邮箱: ${EMAIL}`);
      if (PASSWORD) {
        console.log('  密码: （来自 SEED_USER_PASSWORD）');
      } else {
        console.log(`  密码: ${plain}`);
        console.log('');
        console.log('  ⚠ 此密码仅显示这一次, 关闭后无法再次查看。');
      }
      console.log('='.repeat(60));
      console.log('');
    }

    /*
     * 初始积分是**显式配置**而非默认赠送：SEED_USER_CREDITS>0 时才发，
     * 且只在没有批次时发一次（用户花完后重跑不会无限续杯）。
     */
    if (CREDITS > 0) {
      const lotCount = await prisma.creditLot.count({ where: { userId: user.id } });
      if (lotCount === 0) {
        const lot = await prisma.creditLot.create({
          data: {
            userId: user.id,
            source: 'grant',
            totalCredits: CREDITS,
            remainingCredits: CREDITS,
            expireAt: null,
          },
        });
        await prisma.creditLedger.create({
          data: {
            userId: user.id,
            type: 'grant',
            amount: CREDITS,
            balanceAfter: CREDITS,
            lotId: lot.id,
            reason: '开发账号初始积分（SEED_USER_CREDITS）',
          },
        });
        console.log(`[seed] 已发放初始积分: ${CREDITS}（永久有效）`);
      } else {
        console.log('[seed] 账号已有积分批次, 跳过发放');
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed] 失败:', err);
  process.exit(1);
});
