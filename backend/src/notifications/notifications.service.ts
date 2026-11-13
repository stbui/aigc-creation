import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { MessageTemplate } from '@prisma/client';
import { EmailService } from '../channels/email/email.service';
import { maskEmail } from '../channels/channel.types';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../common/settings.service';

/**
 * 站内消息与业务邮件。
 *
 * 两个通道必须彼此隔离：
 *   · 邮件会进垃圾箱、短信有成本，支付成功、积分退回、工单回复等消息仍要在
 *     站内随时可查；
 *   · 邮件服务商抖动、凭据过期或网络超时，不能阻断注册、支付、任务结算。
 *
 * 因此 `notify()` 分别捕获站内与邮件异常。模板表也不是必配项：邮件模板缺失
 * 时回落到站内模板，再回落到调用方文案与代码内置文案。
 */

export type EmailEvent =
  | 'welcome'
  | 'payment_success'
  | 'credit_granted'
  | 'ticket_reply'
  | 'task_failed'
  | 'membership_expired'
  | 'broadcast';

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
  /** 站内相对路径；邮件中会转换为绝对地址 */
  link?: string;
  /** 需要同步发送业务邮件时指定事件；不传则只写站内消息 */
  emailEvent?: EmailEvent;
}

export interface BroadcastResult {
  sent: number;
  users: number;
  emailSent: number;
  emailFailed: number;
  emailSkipped: number;
}

/** 内置兜底文案。key = type */
const FALLBACK: Record<string, { title: string; body: string; link?: string }> = {
  welcome: {
    title: '欢迎加入货觉AI',
    body: '{name}，欢迎加入货觉AI。你可以从创建作品、生成图片或查看会员权益开始。',
    link: '/',
  },
  payment_success: {
    title: '支付成功',
    body: '订单 {orderNo} 已支付，积分已到账。',
    link: '/orders',
  },
  credit_granted: {
    title: '积分到账',
    body: '本次获得 {credits} 积分。',
    link: '/credits',
  },
  task_failed: {
    title: '生成失败',
    body: '任务「{capability}」执行失败，积分处理结果请查看任务账单。',
    link: '/works',
  },
  membership_expired: {
    title: '会员已到期',
    body: '你的会员已于 {date} 到期。',
    link: '/packages',
  },
  ticket_reply: {
    title: '工单有新回复',
    body: '工单 {ticketNo} 已由客服回复。',
    link: '/tickets',
  },
  broadcast: { title: '平台公告', body: '', link: '/' },
};

const EMAIL_EVENT_SETTINGS: Record<EmailEvent, string> = {
  welcome: 'email.events.welcome',
  payment_success: 'email.events.paymentSuccess',
  credit_granted: 'email.events.creditGranted',
  ticket_reply: 'email.events.ticketReply',
  task_failed: 'email.events.taskFailed',
  membership_expired: 'email.events.membershipExpired',
  broadcast: 'email.events.broadcast',
};

/** 把 `{name}` 替换成 vars 里的值；未提供的占位符原样保留（便于发现漏传） */
export function renderTemplate(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? match : String(value);
  });
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * 写一条站内消息，并在指定 `emailEvent` 时同步发送业务邮件。
   *
   * **永不抛异常**。调用点遍布支付回调、任务执行、调度任务，任何一处因为它
   * 失败而回滚，都比少一条通知严重得多。
   */
  async notify(input: NotifyInput): Promise<void> {
    const code = input.templateCode ?? input.type;
    const templates = await this.loadTemplates(code);

    try {
      await this.writeInApp(input, templates.inapp);
    } catch (error) {
      this.logger.warn(
        `站内通知写入失败 (${input.type} → ${input.userId}): ${(error as Error).message}`,
      );
    }

    if (!input.emailEvent) return;
    try {
      await this.sendEmail(input, templates);
    } catch (error) {
      this.logger.warn(`业务邮件发送失败 (${input.type}): ${(error as Error).message}`);
    }
  }

  private async writeInApp(input: NotifyInput, template?: MessageTemplate): Promise<void> {
    const vars = input.vars ?? {};
    const fallback = FALLBACK[input.type];
    const title = renderTemplate(
      template?.subject || input.fallbackTitle || fallback?.title || '通知',
      vars,
    );
    const body = renderTemplate(
      template?.body || input.fallbackBody || fallback?.body || '',
      vars,
    );

    await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: title.slice(0, 120),
        body: body ? body.slice(0, 2000) : null,
        link: input.link ?? fallback?.link ?? null,
      },
    });
  }

  private async sendEmail(
    input: NotifyInput,
    templates: { inapp?: MessageTemplate; email?: MessageTemplate },
  ): Promise<void> {
    if (!input.emailEvent) return;

    const [emailEnabled, eventEnabled] = await Promise.all([
      this.settings.getBoolean('email.enabled'),
      this.settings.getBoolean(EMAIL_EVENT_SETTINGS[input.emailEvent]),
    ]);
    if (!emailEnabled || !eventEnabled) return;

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true, status: true },
    });
    if (!user || user.status !== 'active' || !user.email?.trim()) return;

    const vars = input.vars ?? {};
    const fallback = FALLBACK[input.type];
    const subject = renderTemplate(
      templates.email?.subject ||
        templates.inapp?.subject ||
        input.fallbackTitle ||
        fallback?.title ||
        '通知',
      vars,
    );
    const rawBody = renderTemplate(
      templates.email?.body ||
        templates.inapp?.body ||
        input.fallbackBody ||
        fallback?.body ||
        subject,
      vars,
    );
    const link = this.absoluteLink(input.link ?? fallback?.link);
    const text = link ? `${rawBody}\n\n查看详情：\n${link}` : rawBody;

    const result = await this.email.sendNotificationEmail({
      to: user.email,
      subject,
      text,
    });
    if (!result.delivered) {
      this.logger.warn(
        `业务邮件未真实投递 (${input.type} → ${maskEmail(user.email)}): ${result.error ?? result.provider}`,
      );
    }
  }

  private async loadTemplates(
    code: string,
  ): Promise<{ inapp?: MessageTemplate; email?: MessageTemplate }> {
    try {
      const rows = await this.prisma.messageTemplate.findMany({
        where: { code, channel: { in: ['inapp', 'email'] }, enabled: true },
      });
      return {
        inapp: rows.find((row) => row.channel === 'inapp'),
        email: rows.find((row) => row.channel === 'email'),
      };
    } catch (error) {
      // 模板读取失败时继续用调用方文案与内置兜底，不能因此丢掉通知。
      this.logger.warn(`消息模板读取失败 (${code}): ${(error as Error).message}`);
      return {};
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
    const notification = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!notification) return { id, read: false };
    if (!notification.readAt) {
      await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    }
    const unread = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { id, read: true, unread };
  }

  /** 全部标为已读 */
  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count, unread: 0 };
  }

  /**
   * 后台：全站广播。
   *
   * 站内消息按 500 人一批写入；邮件逐人发送，绝不能把多个收件人塞进一封邮件
   * （既泄露地址，也会让退订与退信归因失真）。两个通道分别容错。
   */
  async broadcast(
    title: string,
    body: string,
    link?: string,
    sendEmail = false,
  ): Promise<BroadcastResult> {
    const users = await this.prisma.user.findMany({
      where: { status: 'active' },
      select: { id: true, email: true, name: true },
    });

    let sent = 0;
    for (let i = 0; i < users.length; i += 500) {
      const chunk = users.slice(i, i + 500);
      try {
        const result = await this.prisma.notification.createMany({
          data: chunk.map((user) => ({
            userId: user.id,
            type: 'broadcast',
            title: title.slice(0, 120),
            body: body.slice(0, 2000),
            link: link ?? null,
          })),
        });
        sent += result.count;
      } catch (error) {
        this.logger.warn(`站内广播写入失败，批次 ${i / 500 + 1}: ${(error as Error).message}`);
      }
    }

    const result: BroadcastResult = {
      sent,
      users: users.length,
      emailSent: 0,
      emailFailed: 0,
      emailSkipped: 0,
    };
    if (!sendEmail) return result;

    const [emailEnabled, eventEnabled, template] = await Promise.all([
      this.settings.getBoolean('email.enabled'),
      this.settings.getBoolean(EMAIL_EVENT_SETTINGS.broadcast),
      this.prisma.messageTemplate
        .findFirst({ where: { code: 'broadcast', channel: 'email', enabled: true } })
        .catch(() => null),
    ]);
    if (!emailEnabled || !eventEnabled) {
      result.emailSkipped = users.length;
      return result;
    }

    const absoluteLink = this.absoluteLink(link);
    for (const user of users) {
      if (!user.email?.trim()) {
        result.emailSkipped += 1;
        continue;
      }
      try {
        const vars = { title, body, name: user.name || '用户' };
        const subject = renderTemplate(template?.subject || title, vars);
        const renderedBody = renderTemplate(template?.body || body, vars);
        const text = absoluteLink
          ? `${renderedBody}\n\n查看详情：\n${absoluteLink}`
          : renderedBody;
        const delivery = await this.email.sendNotificationEmail({
          to: user.email,
          subject,
          text,
        });
        if (delivery.delivered) {
          result.emailSent += 1;
        } else {
          result.emailFailed += 1;
        }
      } catch (error) {
        result.emailFailed += 1;
        this.logger.warn(
          `广播邮件发送失败 (${maskEmail(user.email)}): ${(error as Error).message}`,
        );
      }
    }
    return result;
  }

  /** 后台：模板列表 */
  async templates() {
    return this.prisma.messageTemplate.findMany({
      orderBy: [{ channel: 'asc' }, { code: 'asc' }],
    });
  }

  /** 后台：按 code + channel 新建或更新模板；同一编码可为站内与邮件各存一份 */
  async upsertTemplate(input: {
    code: string;
    channel: string;
    subject?: string;
    body: string;
    enabled?: boolean;
  }) {
    if (
      input.channel === 'email' &&
      input.code === 'email_verification' &&
      !input.body.includes('{{code}}')
    ) {
      throw new BadRequestException(
        '邮箱验证码模板正文必须保留 {{code}} 变量，否则用户无法看到验证码',
      );
    }
    if (
      input.channel === 'email' &&
      input.code === 'password_reset' &&
      !input.body.includes('{{resetUrl}}')
    ) {
      throw new BadRequestException(
        '找回密码模板正文必须保留 {{resetUrl}} 变量，否则用户无法打开重置链接',
      );
    }

    const codeChannel = { code: input.code, channel: input.channel };
    return this.prisma.messageTemplate.upsert({
      where: { code_channel: codeChannel },
      update: {
        subject: input.subject ?? null,
        body: input.body,
        enabled: input.enabled ?? true,
      },
      create: {
        ...codeChannel,
        subject: input.subject ?? null,
        body: input.body,
        enabled: input.enabled ?? true,
      },
    });
  }

  private absoluteLink(link?: string | null): string | null {
    const value = String(link ?? '').trim();
    if (!value) return null;
    try {
      return new URL(value).toString();
    } catch {
      const base = (process.env.WEB_BASE_URL || 'http://localhost:5100').replace(/\/+$/, '');
      return `${base}${value.startsWith('/') ? value : `/${value}`}`;
    }
  }
}
