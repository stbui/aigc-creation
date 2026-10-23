/**
 * 会员套餐种子。
 *
 * 权益值直接对齐落地页 LandingPage.tsx 承诺的四档套餐文案, 避免"宣传页写的
 * 和实际给的"再次脱节 —— 那正是这套体系要解决的问题。
 */
import { PrismaClient } from '@prisma/client';
import { NodeSQLiteDriverAdapterFactory } from '../dist/prisma/node-sqlite-adapter';
// 库路径与后端服务同源 (按 NODE_ENV 读 DATABASE_URL)。
// ⚠ 这里曾写死 'file:./dev.db', 于是 `NODE_ENV=test npm run seed:test`
// 会把套餐灌进开发库, 而测试库始终为空 —— 症状是「测试环境套餐列表为空」,
// 看起来像接口问题, 实则是种子写错了库。
const { resolveDbUrl } = require('./db-url');

const prisma = new PrismaClient({
  adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
});

interface PlanSeed {
  code: string;
  name: string;
  description: string;
  priceCents: number;
  durationDays: number;
  monthlyCredits: number;
  perks: Record<string, unknown>;
  sortOrder: number;
}

const PLANS: PlanSeed[] = [
  {
    code: 'free',
    name: '免费用户',
    description: '注册即得, 基础功能全部可用',
    priceCents: 0,
    durationDays: 0, // 永久
    monthlyCredits: 0,
    // ⚠ 必须与 DEFAULT_PERKS 完全一致 —— free 档给多任何一项都是白送
    perks: { fastChannel: false, maxConcurrent: 0, addonDiscountBps: 10000 },
    sortOrder: 0,
  },
  {
    code: 'basic',
    name: '基础会员',
    description: '适合偶尔创作, 解锁快速通道与并发',
    priceCents: 2900,
    durationDays: 30,
    monthlyCredits: 100,
    perks: { fastChannel: true, maxConcurrent: 2, addonDiscountBps: 10000 },
    sortOrder: 1,
  },
  {
    code: 'pro',
    name: '专业会员',
    description: '适合高频创作, 更高并发与加油包折扣',
    priceCents: 9900,
    durationDays: 30,
    monthlyCredits: 400,
    perks: { fastChannel: true, maxConcurrent: 5, addonDiscountBps: 9500 },
    sortOrder: 2,
  },
  {
    code: 'studio',
    name: '工作室会员',
    description: '适合团队与批量生产, 最高并发',
    priceCents: 29900,
    durationDays: 30,
    monthlyCredits: 1500,
    perks: { fastChannel: true, maxConcurrent: 20, addonDiscountBps: 9000 },
    sortOrder: 3,
  },
];

async function main() {
  for (const p of PLANS) {
    const perksJson = JSON.stringify(p.perks);
    await prisma.membershipPlan.upsert({
      where: { code: p.code },
      update: {
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        durationDays: p.durationDays,
        monthlyCredits: p.monthlyCredits,
        perks: perksJson,
        sortOrder: p.sortOrder,
      },
      create: {
        code: p.code,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        durationDays: p.durationDays,
        monthlyCredits: p.monthlyCredits,
        perks: perksJson,
        status: 'active',
        sortOrder: p.sortOrder,
      },
    });
    console.log(
      `[seed] 套餐已同步: ${p.code} (${p.name} ¥${p.priceCents / 100} / ${p.durationDays}天 / 并发${String((p.perks as Record<string, number>).maxConcurrent)})`,
    );
  }
}

main()
  .catch((e) => {
    console.error('[seed] 失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
