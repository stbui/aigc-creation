/**
 * 站内消息模板种子 (B4)。
 *
 * 幂等: 按 code upsert，**只补新增模板，不覆盖已改过的文案** ——
 * 运营在后台调过的措辞被一次 seed 冲掉，是很难被发现的回归
 * （通知消失了没人报障，只是"怎么又变回去了"）。
 *
 * 模板缺失时代码里有内置兜底文案，所以这份种子不是必需的，
 * 它的作用是让后台「模板管理」一进去就有东西可改。
 *
 * 运行: npm run seed:messages
 */
import { PrismaClient } from '@prisma/client';
import { NodeSQLiteDriverAdapterFactory } from '../dist/prisma/node-sqlite-adapter';
const { resolveDbUrl } = require('./db-url');

const prisma = new PrismaClient({
  adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
});

const TEMPLATES = [
  {
    code: 'payment_success',
    channel: 'inapp',
    subject: '支付成功',
    body: '订单 {orderNo} 已支付 ¥{amount}，{credits} 积分已到账。',
  },
  {
    code: 'credit_granted',
    channel: 'inapp',
    subject: '积分到账',
    body: '本次获得 {credits} 积分。',
  },
  {
    code: 'task_failed',
    channel: 'inapp',
    subject: '生成失败，积分已退回',
    body: '任务「{capability}」执行失败（{reason}），{credits} 积分已原额退回。',
  },
  {
    code: 'membership_expired',
    channel: 'inapp',
    subject: '会员已到期',
    body: '你的会员已于 {date} 到期。续费后可继续享受会员权益。',
  },
  {
    code: 'ticket_reply',
    channel: 'inapp',
    subject: '工单有新回复',
    body: '工单 {ticketNo} 已由客服回复。',
  },
];

async function main(): Promise<void> {
  let created = 0;
  let kept = 0;

  for (const t of TEMPLATES) {
    const existing = await prisma.messageTemplate.findUnique({ where: { code: t.code } });
    if (existing) {
      kept += 1;
      continue;
    }
    await prisma.messageTemplate.create({ data: { ...t, enabled: true } });
    created += 1;
  }

  console.log(`[seed:messages] 新增 ${created} 条, 已存在保留 ${kept} 条`);
}

main()
  .catch((e) => {
    console.error('[seed:messages] 失败:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
