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

const PRODUCTS: Seed[] = [
  {
    sku: 'CREDITS_STARTER',
    name: '入门积分包',
    description: '500 积分, 永久有效。适合先试用再决定',
    priceCents: 990,
    originalPriceCents: 1990,
    credits: 500,
    creditsValidDays: 0,
    sortOrder: 1,
  },
  {
    sku: 'CREDITS_STANDARD',
    name: '标准积分包',
    description: '3000 积分, 一年内有效。单次成本更低',
    priceCents: 4900,
    originalPriceCents: 6900,
    credits: 3000,
    creditsValidDays: 365,
    sortOrder: 2,
  },
  {
    sku: 'CREDITS_PRO',
    name: '专业积分包',
    description: '12000 积分, 一年内有效。适合高频创作',
    priceCents: 16900,
    originalPriceCents: 24900,
    credits: 12000,
    creditsValidDays: 365,
    sortOrder: 3,
  },
  {
    sku: 'CREDITS_TRIAL',
    name: '新用户体验包',
    description: '100 体验积分, 永久有效。仅用于新客首单',
    priceCents: 0,
    originalPriceCents: null,
    credits: 100,
    creditsValidDays: 0,
    sortOrder: 0,
  },
];

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
}

main()
  .catch((e) => {
    console.error('[seed] 失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
