/**
 * 站内消息模板种子 (B4)。
 *
 * 幂等: 按 (code, channel) upsert，**只补新增模板，不覆盖已改过的文案** ——
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
    code: 'email_verification',
    channel: 'email',
    subject: '【货觉AI】邮箱验证码',
    body: [
      '你的货觉AI邮箱验证码是：{{code}}',
      '',
      '验证码 {{expiresMinutes}} 分钟内有效，仅可使用一次。',
      '如果不是你本人操作，请忽略本邮件。',
      '',
      '—— 货觉AI 团队',
    ].join('\n'),
  },
  {
    code: 'password_reset',
    channel: 'email',
    subject: '【货觉AI】重置密码',
    body: [
      '{{name}}，你好：',
      '',
      '我们收到了重置货觉AI账号密码的请求。请在 {{expiresMinutes}} 分钟内打开下面的链接设置新密码：',
      '',
      '{{resetUrl}}',
      '',
      '如果不是你本人操作，请忽略本邮件，你的密码不会被修改。',
      '请求来源 IP：{{ip}}',
      '',
      '—— 货觉AI 团队',
    ].join('\n'),
  },
  {
    code: 'welcome',
    channel: 'inapp',
    subject: '欢迎加入货觉AI',
    body: '{name}，欢迎加入货觉AI。你可以从创建作品、生成图片或查看会员权益开始。',
  },
  {
    code: 'welcome',
    channel: 'email',
    subject: '欢迎加入货觉AI',
    body: '{name}，欢迎加入货觉AI。\n\n你可以从创建作品、生成图片或查看会员权益开始。',
  },
  {
    code: 'payment_success',
    channel: 'inapp',
    subject: '支付成功',
    body: '订单 {orderNo} 已支付 ¥{amount}，{credits} 积分已到账。',
  },
  {
    code: 'payment_success',
    channel: 'email',
    subject: '支付成功 · 订单 {orderNo}',
    body: '订单 {orderNo} 已支付 ¥{amount}，{credits} 积分已到账。',
  },
  {
    code: 'credit_granted',
    channel: 'inapp',
    subject: '积分到账',
    body: '本次获得 {credits} 积分。',
  },
  {
    code: 'credit_granted',
    channel: 'email',
    subject: '积分到账',
    body: '本次获得 {credits} 积分。',
  },
  {
    code: 'task_failed',
    channel: 'inapp',
    subject: '生成失败',
    body: '任务「{capability}」执行失败（{reason}），积分处理结果请查看任务账单。',
  },
  {
    code: 'task_failed',
    channel: 'email',
    subject: '生成失败 · {capability}',
    body: '任务「{capability}」执行失败（{reason}）。\n\n积分处理结果请查看任务账单。',
  },
  {
    code: 'membership_expired',
    channel: 'inapp',
    subject: '会员已到期',
    body: '你的会员已于 {date} 到期。续费后可继续享受会员权益。',
  },
  {
    code: 'membership_expired',
    channel: 'email',
    subject: '会员已到期',
    body: '你的会员已于 {date} 到期。续费后可继续享受会员权益。',
  },
  {
    code: 'ticket_reply',
    channel: 'inapp',
    subject: '工单有新回复',
    body: '工单 {ticketNo} 已由客服回复。',
  },
  {
    code: 'ticket_reply',
    channel: 'email',
    subject: '工单 {ticketNo} 有新回复',
    body: '工单 {ticketNo} 已由客服回复，请登录货觉AI查看详情。',
  },
  {
    code: 'broadcast',
    channel: 'inapp',
    subject: '{title}',
    body: '{body}',
  },
  {
    code: 'broadcast',
    channel: 'email',
    subject: '【货觉AI】{title}',
    body: '{body}\n\n—— 货觉AI 团队',
  },
];

async function main(): Promise<void> {
  let created = 0;
  let kept = 0;

  for (const t of TEMPLATES) {
    const existing = await prisma.messageTemplate.findUnique({
      where: { code_channel: { code: t.code, channel: t.channel } },
    });
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
