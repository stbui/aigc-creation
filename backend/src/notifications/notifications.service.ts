import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 站内消息。
 *
 * 与邮件/短信并行的通道，不是替代：邮件会进垃圾箱、短信有成本，
 * 而「支付成功」「任务失败已退款」「会员即将到期」这类与钱相关的通知
 * 必须在站内能随时查到 —— 客服工单里最高频的一句是「我没收到通知」。
 *
 * 三条设计约束：
 *
 * 1. **通知失败不阻断主流程**。写通知是副作用，不是事务的一部分；
 *    数据库抖动时不能因为一条通知让支付回调失败（那会让渠道一直重试）。
 *    因此 `notify()` 吞异常只记日志。
 * 2. **模板表可不完整**。模板缺失时用代码内置兜底文案，
 *    「后台没配模板」不能让支付成功的通知消失。
 * 3. **变量替换走白名单**。`{orderNo}` 这类占位符只从调用方给的 vars 取，
 *    不接受任意表达式 —— 模板是后台可编辑内容，等于半个用户输入。
 */

export interface NotifyInput {
  userId: string;
  type: string;
  /** 模板 code（与 type 可不同：一类事件可用于多条文案） */
  templateCode?: string;
  /** 模板变量，仅替换 `{name}` 形式的占位符 */
  vars?: Record<string, string | number>;
  /** 兜底标题/正文（模板缺失时使用） */
  fallbackTitle: string;
  fallbackBody?: string;
  /** 站内相对路径 */
  link?: string;
}

/** 内置兜底文案。key = type */
const FALLBACK: Record<string, { title: string; body: string; link?: string }> = {
  payment_success: { title: '支付成功', body: '订单 {orderNo} 已支付，积分已到账。', link: '/orders' },
  credit_granted: { title: '积分到账', body: '本次获得 {credits} 积分。', link: '/credits' },
  task_failed: {
    title: '生成失败，积分已退回',
    body: '任务「{capability}」执行失败，{credits} 积分已原额退回。',
    link: '/works',
  },
  membership_expired: { title: '会员已到期', body: '你的会员已于 {date} 到期。', link: '/packages' },
  ticket_reply: { title: '工单有新回复', body: '工单 {ticketNo} 已由客服回复。', link: '/tickets' },
  broadcast: { title: '平台公告', body: '', link: '/' },
};

/** 把 `{name}` 替换成 vars 里的值；未提供的占位符原样保留（便于发现漏传） */
export function renderTemplate(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (m, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? m : String(v);
  });
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 写一条站内消息。
   *
   * **永不抛异常**。调用点遍布支付回调、任务执行、调度任务，
   * 任何一处因为它失败而回滚，都比"少一条通知"严重得多。
   */
  async notify(input: NotifyInput): Promise<void> {
    try {
      const code = input.templateCode ?? input.type;
      const tpl = await this.prisma.messageTemplate.findFirst({
        where: { code, channel: 'inapp', enabled: true },
      });
      const vars = input.vars ?? {};
      const fallback = FALLBACK[input.type];

      const title = renderTemplate(tpl?.subject || input.fallbackTitle || fallback?.title || '通知', vars);
      const rawBody = tpl?.body || input.fallbackBody || fallback?.body || '';
      const body = renderTemplate(rawBody, vars);

      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: title.slice(0, 120),
          body: body ? body.slice(0, 2000) : null,
          link: input.link ?? fallback?.link ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`站内通知写入失败 (${input.type} → ${input.userId}): ${(e as Error).message}`);
    }
  }

  /** C 端：我的消息（默认最近 30 条，可按未读过滤） */
  async list(userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    const rows = await this.prisma.notification.findMany({
      where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const unread = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { items: rows, unread };
  }

  /** 标记单条已读（只能标自己的） */
  async markRead(userId: string, id: string) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!n) return { id, read: false };
    if (!n.readAt) {
      await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    }
    const unread = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { id, read: true, unread };
  }

  /** 全部标为已读 */
  async markAllRead(userId: string) {
    const r = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: r.count, unread: 0 };
  }

  /**
   * 后台：全站广播。
   *
   * 用 `createMany` 一次性写入；用户量大时分批（SQLite 单条 INSERT 上限
   * 受变量数限制，1000 一批足够安全）。
   */
  async broadcast(title: string, body: string, link?: string) {
    const users = await this.prisma.user.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    const chunks: string[][] = [];
    for (let i = 0; i < users.length; i += 500) {
      chunks.push(users.slice(i, i + 500).map((u) => u.id));
    }
    let sent = 0;
    for (const ids of chunks) {
      const r = await this.prisma.notification.createMany({
        data: ids.map((userId) => ({
          userId,
          type: 'broadcast',
          title: title.slice(0, 120),
          body: body.slice(0, 2000),
          link: link ?? null,
        })),
      });
      sent += r.count;
    }
    return { sent, users: users.length };
  }

  /** 后台：模板列表 */
  async templates() {
    return this.prisma.messageTemplate.findMany({ orderBy: [{ channel: 'asc' }, { code: 'asc' }] });
  }

  /** 后台：新建或按 code 更新模板 */
  async upsertTemplate(input: {
    code: string;
    channel: string;
    subject?: string;
    body: string;
    enabled?: boolean;
  }) {
    return this.prisma.messageTemplate.upsert({
      where: { code: input.code },
      update: {
        channel: input.channel,
        subject: input.subject ?? null,
        body: input.body,
        enabled: input.enabled ?? true,
      },
      create: {
        code: input.code,
        channel: input.channel,
        subject: input.subject ?? null,
        body: input.body,
        enabled: input.enabled ?? true,
      },
    });
  }
}
