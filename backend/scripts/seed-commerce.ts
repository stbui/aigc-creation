/**
 * 交易域种子 (M6/M7)。
 *
 * 幂等: 按 sku upsert, 重复执行只更新不重复插入。
 * 商品价格用**整数分** —— 与 PRD §5 口径一致, 浮点会产生分位误差。
 */
import { PrismaClient } from '@prisma/client';
import { NodeSQLiteDriverAdapterFactory } from '../dist/prisma/node-sqlite-adapter';
// 库路径与后端服务同源 (按 NODE_ENV 读 DATABASE_URL), 否则 seed 会写错库
const { resolveDbUrl } = require('./db-url');

const prisma = new PrismaClient({
  adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
});

interface Seed {
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  originalPriceCents: number | null;
  credits: number;
  creditsValidDays: number;
  sortOrder: number;
}

/**
 * 积分加油包：三段结构与价格对齐参考站 SeeAny `/vip`（见 docs/packages-design.md）。
 *
 *   - 限时抢购包：永久积分，活动价（原价划线）
 *   - 短期高能包：31 天有效，单价最低，适合当月高频生成
 *   - 长期通用包：永久有效、永不清零，适合沉淀资产
 *
 * 排序按「抢购 → 短期 → 长期」与参考站一致；新用户体验包排最前（免费档）。
 * 旧的 CREDITS_STARTER / STANDARD / PRO 已下架，见 main() 末尾的 offline 处理。
 */
const PRODUCTS: Seed[] = [
  {
    sku: 'CREDITS_TRIAL',
    name: '新用户体验包',
    description: '仅新客首单可用',
    priceCents: 0,
    originalPriceCents: null,
    credits: 100,
    creditsValidDays: 0,
    sortOrder: 0,
  },
  // ── 限时抢购包（永久积分） ──────────────────────────────────────────
  {
    sku: 'PACK_PROMO_5555',
    name: '双11 抢购包 5,555',
    description: '活动限时, 售完即止',
    priceCents: 11100,
    originalPriceCents: 13900,
    credits: 5555,
    creditsValidDays: 0,
    sortOrder: 1,
  },
  {
    sku: 'PACK_PROMO_66666',
    name: '双11 抢购包 66,666',
    description: '活动限时, 售完即止',
    priceCents: 111100,
    originalPriceCents: 166700,
    credits: 66666,
    creditsValidDays: 0,
    sortOrder: 2,
  },
  // ── 短期高能包（31 天） ────────────────────────────────────────────
  {
    sku: 'PACK_31D_2000',
    name: '短期高能包 2,000',
    description: '适合当月高频生成',
    priceCents: 3900,
    originalPriceCents: null,
    credits: 2000,
    creditsValidDays: 31,
    sortOrder: 11,
  },
  {
    sku: 'PACK_31D_4200',
    name: '短期高能包 4,200',
    description: '适合当月高频生成',
    priceCents: 7100,
    originalPriceCents: 7900,
    credits: 4200,
    creditsValidDays: 31,
    sortOrder: 12,
  },
  {
    sku: 'PACK_31D_9000',
    name: '短期高能包 9,000',
    description: '适合当月高频生成',
    priceCents: 14900,
    originalPriceCents: 15900,
    credits: 9000,
    creditsValidDays: 31,
    sortOrder: 13,
  },
  {
    sku: 'PACK_31D_19000',
    name: '短期高能包 19,000',
    description: '适合当月高频生成',
    priceCents: 30900,
    originalPriceCents: 32900,
    credits: 19000,
    creditsValidDays: 31,
    sortOrder: 14,
  },
  {
    sku: 'PACK_31D_40000',
    name: '短期高能包 40,000',
    description: '适合当月高频生成',
    priceCents: 65900,
    originalPriceCents: 68900,
    credits: 40000,
    creditsValidDays: 31,
    sortOrder: 15,
  },
  {
    sku: 'PACK_31D_100000',
    name: '短期高能包 100,000',
    description: '适合当月高频生成',
    priceCents: 159900,
    originalPriceCents: 169900,
    credits: 100000,
    creditsValidDays: 31,
    sortOrder: 16,
  },
  // ── 长期通用包（永久） ─────────────────────────────────────────────
  {
    sku: 'PACK_PERM_2000',
    name: '长期通用包 2,000',
    description: '永不清零, 可跨月沉淀',
    priceCents: 4500,
    originalPriceCents: 5000,
    credits: 2000,
    creditsValidDays: 0,
    sortOrder: 21,
  },
  {
    sku: 'PACK_PERM_4500',
    name: '长期通用包 4,500',
    description: '永不清零, 可跨月沉淀',
    priceCents: 9000,
    originalPriceCents: 10000,
    credits: 4500,
    creditsValidDays: 0,
    sortOrder: 22,
  },
  {
    sku: 'PACK_PERM_9000',
    name: '长期通用包 9,000',
    description: '永不清零, 可跨月沉淀',
    priceCents: 18500,
    originalPriceCents: 20000,
    credits: 9000,
    creditsValidDays: 0,
    sortOrder: 23,
  },
  {
    sku: 'PACK_PERM_24000',
    name: '长期通用包 24,000',
    description: '永不清零, 可跨月沉淀',
    priceCents: 47000,
    originalPriceCents: 50000,
    credits: 24000,
    creditsValidDays: 0,
    sortOrder: 24,
  },
  {
    sku: 'PACK_PERM_48000',
    name: '长期通用包 48,000',
    description: '永不清零, 可跨月沉淀',
    priceCents: 90000,
    originalPriceCents: 100000,
    credits: 48000,
    creditsValidDays: 0,
    sortOrder: 25,
  },
  {
    sku: 'PACK_PERM_100000',
    name: '长期通用包 100,000',
    description: '永不清零, 可跨月沉淀',
    priceCents: 180000,
    originalPriceCents: 200000,
    credits: 100000,
    creditsValidDays: 0,
    sortOrder: 26,
  },
];

/** 旧版积分包：保留行（历史订单仍引用），但 C 端不再展示与售卖。 */
const RETIRED_SKUS = ['CREDITS_STARTER', 'CREDITS_STANDARD', 'CREDITS_PRO'];

async function main() {
  for (const p of PRODUCTS) {
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: {
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        originalPriceCents: p.originalPriceCents,
        credits: p.credits,
        creditsValidDays: p.creditsValidDays,
        // 种子里的商品即「应在售」: 重复执行把误下架的商品重新上架
        status: 'active',
        sortOrder: p.sortOrder,
      },
      create: {
        sku: p.sku,
        name: p.name,
        description: p.description,
        type: 'credits',
        priceCents: p.priceCents,
        originalPriceCents: p.originalPriceCents,
        credits: p.credits,
        creditsValidDays: p.creditsValidDays,
        grantType: 'immediate',
        status: 'active',
        sortOrder: p.sortOrder,
      },
    });
    console.log(`[seed] 商品已同步: ${p.sku} (${p.credits} 积分 / ${p.priceCents / 100} 元)`);
  }

  // 旧积分包下架: 不删除行 —— 历史订单与已购积分批次仍引用它们
  const retired = await prisma.product.updateMany({
    where: { sku: { in: RETIRED_SKUS }, status: 'active' },
    data: { status: 'offline' },
  });
  if (retired.count > 0) {
    console.log(`[seed] 已下架旧积分包: ${RETIRED_SKUS.join(' / ')} (${retired.count} 条)`);
  }

  // 冒烟脚本自建的商品若被中断, 清理逻辑来不及跑, 行会留在库里并出现在 C 端商城。
  // 种子代表「应在售的商品集合」, 顺手把这些夹具关掉。
  const smoke = await prisma.product.updateMany({
    where: { sku: { startsWith: 'SMOKE-' }, status: 'active' },
    data: { status: 'offline' },
  });
  if (smoke.count > 0) {
    console.log(`[seed] 已下架冒烟残留商品: ${smoke.count} 条`);
  }
}

main()
  .catch((e) => {
    console.error('[seed] 失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
