/**
 * 营销中心种子 (M11 · B-64~B-67)。
 *
 * 幂等: 券按 code upsert, 活动按 (name + type) 查重后更新, 规则单行 upsert。
 * 时间窗用**相对当前时间**计算, 而不是硬编码绝对日期 ——
 * 硬编码的日期一旦过期, 整批活动数据就永久失效, 且没人会发现。
 *
 * 运行: npm run seed:marketing  (需先 npm run build —— adapter 从 dist/ 导入)
 */
import { PrismaClient } from '@prisma/client';
import { NodeSQLiteDriverAdapterFactory } from '../dist/prisma/node-sqlite-adapter';
// 库路径与后端服务同源 (按 NODE_ENV 读 DATABASE_URL), 否则 seed 会写错库
const { resolveDbUrl } = require('./db-url');

const prisma = new PrismaClient({
  adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
});

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();

async function seedCoupons(): Promise<void> {
  const coupons = [
    {
      code: 'WELCOME20',
      name: '新人满减券',
      type: 'full_cut',
      // 满 50 减 20 —— 门槛(5000) 必须 >= 面额(2000), 否则校验拒绝
      value: 2000,
      thresholdCents: 5000,
      scope: 'all',
      totalCount: 1000,
      perUserLimit: 1,
      validFrom: new Date(now - DAY),
      validTo: new Date(now + 30 * DAY),
      status: 'on',
    },
    {
      code: 'VIP850',
      name: '会员 8.5 折',
      type: 'discount',
      // 万分比: 8500 = 85折。必须 < 10000, 否则等于不打折
      value: 8500,
      thresholdCents: 0,
      scope: 'all',
      totalCount: 0, // 不限量
      perUserLimit: 3,
      validFrom: new Date(now - DAY),
      validTo: new Date(now + 90 * DAY),
      status: 'on',
    },
    {
      code: 'SAVE50',
      name: '固定额减免 5 元',
      type: 'fixed',
      value: 500,
      thresholdCents: 0,
      scope: 'all',
      totalCount: 200,
      perUserLimit: 1,
      validFrom: new Date(now - DAY),
      validTo: new Date(now + 7 * DAY),
      status: 'on',
    },
  ];

  for (const c of coupons) {
    const exists = await prisma.coupon.findUnique({ where: { code: c.code } });
    if (exists) {
      // 只刷新时间窗与开关, 保留 usedCount —— 种子重复执行不该重置已核销统计
      await prisma.coupon.update({
        where: { code: c.code },
        data: { validFrom: c.validFrom, validTo: c.validTo, status: c.status },
      });
      console.log(`[seed] 优惠券已存在, 仅刷新有效期: ${c.code} (已核销 ${exists.usedCount})`);
      continue;
    }
    await prisma.coupon.create({
      data: {
        code: c.code,
        name: c.name,
        type: c.type,
        value: c.value,
        thresholdCents: c.thresholdCents,
        scope: c.scope,
        productIds: '[]',
        totalCount: c.totalCount,
        perUserLimit: c.perUserLimit,
        validFrom: c.validFrom,
        validTo: c.validTo,
        status: c.status,
      },
    });
    console.log(`[seed] 已创建优惠券: ${c.code} (${c.name})`);
  }
}

async function seedCampaigns(): Promise<void> {
  // 限时价需绑定真实商品, 商品不存在则活动无法生效 (productId 匹配不上)
  const product = await prisma.product.findUnique({
    where: { sku: 'CREDITS_STARTER' },
    select: { id: true, priceCents: true },
  });

  const campaigns: Array<{
    name: string;
    type: string;
    payload: Record<string, unknown>;
    startAt: Date;
    endAt: Date;
    status: string;
  }> = [
    {
      name: '弹窗促销位示例',
      type: 'popup',
      // PromoBar 读取此活动; ctaUrl 限站内相对路径 (后端校验拒绝外链)
      payload: {
        title: '新人首单立减',
        body: '限时活动, 数量有限',
        ctaText: '去使用',
        ctaUrl: '/packages',
      },
      startAt: new Date(now - HOUR),
      endAt: new Date(now + 14 * DAY),
      status: 'active',
    },
    {
      name: '未开始的限时活动示例',
      type: 'popup',
      // 刻意留一个未生效活动: 后台列表的 effective='scheduled' 才有真实样本可看
      payload: { title: '即将开始', body: '敬请期待', ctaText: '知道了', ctaUrl: '/packages' },
      startAt: new Date(now + 7 * DAY),
      endAt: new Date(now + 14 * DAY),
      status: 'active',
    },
  ];

  if (product) {
    // 活动价必须低于原价: 校验层会夹到原价, 但配错等于"名为优惠实为涨价"
    const promoPrice = Math.max(1, Math.floor(product.priceCents * 0.7));
    campaigns.push({
      name: '入门积分包限时价',
      type: 'limited_price',
      payload: { productId: product.id, priceCents: promoPrice },
      startAt: new Date(now - HOUR),
      endAt: new Date(now + 7 * DAY),
      status: 'active',
    });
    console.log(
      `[seed] 限时价活动已配置: 入门积分包 ${product.priceCents / 100} 元 → ${promoPrice / 100} 元`,
    );
  } else {
    console.warn('[seed] 未找到 CREDITS_STARTER 商品, 跳过限时价活动 (需先跑 seed:commerce)');
  }

  for (const c of campaigns) {
    const exists = await prisma.campaign.findFirst({
      where: { name: c.name, type: c.type },
    });
    if (exists) {
      // 刷新时间窗与内容: 相对时间会让旧种子过期, 重复执行时重新拉长
      await prisma.campaign.update({
        where: { id: exists.id },
        data: {
          payload: JSON.stringify(c.payload),
          startAt: c.startAt,
          endAt: c.endAt,
          status: c.status,
        },
      });
      console.log(`[seed] 活动已存在, 已刷新时间窗: ${c.name}`);
      continue;
    }
    await prisma.campaign.create({
      data: {
        name: c.name,
        type: c.type,
        payload: JSON.stringify(c.payload),
        startAt: c.startAt,
        endAt: c.endAt,
        status: c.status,
        audience: '{}',
      },
    });
    console.log(`[seed] 已创建活动: ${c.name} (${c.type})`);
  }
}

async function seedRules(): Promise<void> {
  // 邀请规则: 单行配置, id='default'
  const inviteExists = await prisma.inviteRewardRule.findUnique({ where: { id: 'default' } });
  if (inviteExists) {
    console.log('[seed] 邀请奖励规则已存在, 跳过');
  } else {
    await prisma.inviteRewardRule.create({
      data: {
        id: 'default',
        inviterCredits: 200,
        inviteeCredits: 100,
        triggerOn: 'first_pay',
        valid: true,
      },
    });
    console.log('[seed] 已配置邀请奖励: 邀请人 200 / 被邀请人 100 (首次付费触发)');
  }

  const checkinExists = await prisma.checkinRule.findUnique({ where: { id: 'default' } });
  if (checkinExists) {
    console.log('[seed] 签到规则已存在, 跳过');
  } else {
    await prisma.checkinRule.create({
      data: {
        id: 'default',
        baseCredits: 5,
        // 连签加成: 第 3/7/15 天额外奖励
        bonusRules: JSON.stringify([
          { day: 3, bonus: 10 },
          { day: 7, bonus: 30 },
          { day: 15, bonus: 80 },
        ]),
        maxStreak: 0,
        dailyCap: 0,
        enabled: true,
      },
    });
    console.log('[seed] 已配置签到规则: 基础 5 积分, 第 3/7/15 天加成');
  }
}

async function main(): Promise<void> {
  try {
    await seedCoupons();
    await seedCampaigns();
    await seedRules();
    console.log('[seed] 营销中心种子完成');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed:marketing] 失败:', err);
  process.exit(1);
});