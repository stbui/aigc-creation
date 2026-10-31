/**
 * 会员套餐种子。
 *
 * 档位、月配额与价格对齐参考站 SeeAny `/vip`（见 docs/packages-design.md）：
 * 免费 + 标准 / 进阶 / 专业 / 尊享 / 旗舰 / 至尊六档付费，月配额 2,000–100,000。
 *
 * 代码位（code）沿用既有值：basic / pro / studio 是历史档位，改名而非改码，
 * 避免已购会员与存量订单失去套餐关联。新增 advanced / flagship / supreme。
 *
 * 加油包折扣参考站未给出具体数值，沿用「越高档折扣越低」的既有口径：
 * 标准与进阶无折扣，专业 95 折，尊享及以上 9 折。
 *
 * 参考站另有签到双倍、积分滚存、子账号等权益，当前数据模型（perks 仅
 * fastChannel / maxConcurrent / addonDiscountBps）无法表达，未在此落地。
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
    description: '注册即得，基础功能全部可用，不限并发',
    priceCents: 0,
    durationDays: 0, // 永久
    monthlyCredits: 0,
    // ⚠ 必须与 DEFAULT_PERKS 完全一致 —— free 档给多任何一项都是白送
    perks: { fastChannel: false, maxConcurrent: 0, addonDiscountBps: 10000 },
    sortOrder: 0,
  },
  {
    code: 'basic',
    name: 'VIP 标准版',
    description: '入门试用, 每月到账 2,000 积分',
    priceCents: 3900,
    durationDays: 30,
    monthlyCredits: 2000,
    perks: { fastChannel: true, maxConcurrent: 10, addonDiscountBps: 10000 },
    sortOrder: 1,
  },
  {
    code: 'advanced',
    name: 'VIP 进阶版',
    description: '首购推荐, 每月到账 4,200 积分',
    priceCents: 7900,
    durationDays: 30,
    monthlyCredits: 4200,
    perks: { fastChannel: true, maxConcurrent: 15, addonDiscountBps: 10000 },
    sortOrder: 2,
  },
  {
    code: 'pro',
    name: 'VIP 专业版',
    description: '最热门, 每月到账 9,000 积分',
    priceCents: 15900,
    durationDays: 30,
    monthlyCredits: 9000,
    perks: { fastChannel: true, maxConcurrent: 30, addonDiscountBps: 9500 },
    sortOrder: 3,
  },
  {
    code: 'studio',
    name: 'VIP 尊享版',
    description: '团队使用, 每月到账 19,000 积分',
    priceCents: 32900,
    durationDays: 30,
    monthlyCredits: 19000,
    perks: { fastChannel: true, maxConcurrent: 50, addonDiscountBps: 9000 },
    sortOrder: 4,
  },
  {
    code: 'flagship',
    name: 'VIP 旗舰版',
    description: '超高算力, 每月到账 40,000 积分',
    priceCents: 69900,
    durationDays: 30,
    monthlyCredits: 40000,
    perks: { fastChannel: true, maxConcurrent: 100, addonDiscountBps: 9000 },
    sortOrder: 5,
  },
  {
    code: 'supreme',
    name: 'VIP 至尊版',
    description: '企业使用, 每月到账 100,000 积分',
    priceCents: 169900,
    durationDays: 30,
    monthlyCredits: 100000,
    perks: { fastChannel: true, maxConcurrent: 200, addonDiscountBps: 9000 },
    sortOrder: 6,
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

  // 冒烟脚本自建的套餐若被中断, 清理逻辑来不及跑, 行会留在库里并出现在 C 端商城。
  // 种子代表「应在售的套餐集合」, 顺手把这些夹具关掉。
  const smoke = await prisma.membershipPlan.updateMany({
    where: { code: { startsWith: 'smoke-' }, status: 'active' },
    data: { status: 'offline' },
  });
  if (smoke.count > 0) {
    console.log(`[seed] 已下架冒烟残留套餐: ${smoke.count} 条`);
  }
}

main()
  .catch((e) => {
    console.error('[seed] 失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
