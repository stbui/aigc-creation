import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { CSV_EXPORT_MAX_ROWS, toCsv } from '../common/csv';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * 工单服务。
 *
 * C 端与后台共用同一份状态机与同一套查询 —— 两边各自实现一套时,
 * 最先漂移的一定是「什么状态能回什么状态」, 表现为「客服点了关闭,
 * 用户还能回复」「用户回复了, 客服界面不变成待处理」这类互相打架的行为。
 *
 * ## 状态机
 *
 * ```
 *   open ──客服回复/认领──▶ processing ──▶ resolved ──▶ closed
 *    ▲                         │              │            │
 *    └────── 用户回复 ─────────┘              │            │
 *    └────────────────── 用户/客服重新打开 ────┘            │
 *    └────────────────── 后台重新打开 ──────────────────────┘
 * ```
 *
 * 两条刻意的规则:
 *   1. **用户回复已解决(resolved)的工单会重新变 open** —— 「解决了」是客服的判断,
 *      用户再开口说明没解决。不让它自动回退, 工单会在 resolved 里越堆越多,
 *      而用户在界面上看不到任何回应。
 *   2. **closed 之后用户不能再回复**, 只能新建。closed 表示会话结束,
 *      继续往里塞消息会让同一个工单横跨多个问题, 事后无法按工单统计。
 *      后台仍可重新打开 —— 用户说「问题还在」时, 客服需要接回原上下文。
 */

export const TICKET_TYPES = ['bug', 'complaint', 'consultation', 'invoice', 'other'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_STATUSES = ['open', 'processing', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  bug: '功能异常',
  complaint: '投诉',
  consultation: '咨询',
  invoice: '发票问题',
  other: '其他',
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

/** 允许流转的目标状态。未列出的组合一律拒绝 (兜底默认拒) */
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['processing', 'resolved', 'closed'],
  processing: ['resolved', 'closed', 'open'],
  resolved: ['closed', 'open'],
  closed: ['open'],
};

export interface CreateTicketInput {
  type: TicketType;
  subject: string;
  content: string;
  priority?: TicketPriority;
  orderId?: string;
  assetId?: string;
}

export interface TicketListQuery {
  status?: string;
  type?: string;
  priority?: string;
  assigneeId?: string;
  /** 工单号 / 标题 / 正文模糊匹配 */
  q?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  // ── C 端 ──────────────────────────────────────────────────────────

  async create(userId: string, input: CreateTicketInput) {
    // 关联的订单 / 素材必须属于本人: 否则用户可以把别人的订单号挂到自己工单上,
    // 客服在处理页就会看到与工单无关的他人订单
    if (input.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: input.orderId },
        select: { userId: true },
      });
      if (!order || order.userId !== userId) {
        throw new AppError(40400, '关联的订单不存在', 404);
      }
    }
    if (input.assetId) {
      const asset = await this.prisma.asset.findUnique({
        where: { id: input.assetId },
        select: { ownerId: true },
      });
      if (!asset || asset.ownerId !== userId) {
        throw new AppError(40400, '关联的素材不存在', 404);
      }
    }

    const subject = input.subject.trim().slice(0, 80);
    const content = input.content.trim().slice(0, 2000);
    if (!subject || !content) {
      throw new AppError(40001, '标题与描述都不能为空', 400);
    }

    const ticket = await this.prisma.ticket.create({
      data: {
        ticketNo: await this.nextTicketNo(),
        userId,
        type: input.type,
        subject,
        content,
        priority: input.priority ?? 'normal',
        orderId: input.orderId ?? null,
        assetId: input.assetId ?? null,
        status: 'open',
      },
    });
    return this.shape(ticket);
  }

  async listMine(userId: string, query: { status?: string; limit?: number; offset?: number }) {
    const where = { userId, ...(query.status ? { status: query.status } : {}) };
    const take = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
    const skip = Math.max(Number(query.offset) || 0, 0);
    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { _count: { select: { replies: true } } },
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return {
      items: items.map((t) => ({ ...this.shape(t), replyCount: t._count.replies })),
      total,
    };
  }

  async detailMine(userId: string, id: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, userId },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
    });
    // 用 findFirst + userId 而不是 findUnique 后再比对: 越权访问返回 404 而非 403,
    // 不泄露「这个 id 存在」这一事实
    if (!ticket) throw new AppError(40400, '工单不存在', 404);
    return this.shape(ticket, true);
  }

  async replyAsUser(userId: string, id: string, content: string) {
    const ticket = await this.prisma.ticket.findFirst({ where: { id, userId } });
    if (!ticket) throw new AppError(40400, '工单不存在', 404);
    if (ticket.status === 'closed') {
      throw new AppError(40001, '工单已关闭，如需继续请新建工单', 400);
    }

    const text = content.trim().slice(0, 2000);
    if (!text) throw new AppError(40001, '回复内容不能为空', 400);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    await this.prisma.ticketReply.create({
      data: {
        ticketId: id,
        authorType: 'user',
        authorId: userId,
        authorName: user?.name ?? '用户',
        content: text,
      },
    });

    /*
     * 用户回复后回到 open 而不是留在 resolved: 客服的「已解决」只是其判断,
     * 用户再开口就说明问题还在。留在 resolved 会让工单在列表里看起来
     * 已经处理完, 用户却永远等不到回应。
     */
    await this.prisma.ticket.update({
      where: { id },
      data: {
        ...(ticket.status === 'resolved' ? { status: 'open', resolvedAt: null } : {}),
        updatedAt: new Date(),
      },
    });

    return this.detailMine(userId, id);
  }

  async closeAsUser(userId: string, id: string) {
    const ticket = await this.prisma.ticket.findFirst({ where: { id, userId } });
    if (!ticket) throw new AppError(40400, '工单不存在', 404);
    if (ticket.status === 'closed') return this.shape(ticket);
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { status: 'closed', closedAt: new Date() },
    });
    return this.shape(updated);
  }

  // ── 后台 ──────────────────────────────────────────────────────────

  async adminList(query: TicketListQuery) {
    const take = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const skip = Math.max(Number(query.offset) || 0, 0);
    const where = this.adminWhere(query);

    const [items, total, byStatus] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: {
          user: { select: { id: true, email: true, name: true } },
          _count: { select: { replies: true } },
        },
      }),
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    return {
      items: items.map((t) => ({
        ...this.shape(t),
        userEmail: t.user.email,
        userName: t.user.name,
        userId: t.user.id,
        replyCount: t._count.replies,
      })),
      total,
      counts: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    };
  }

  /**
   * 导出工单 (CSV)。
   *
   * 与列表共用同一个 where 构造器: 分别写两份筛选条件时,
   * 「列表里筛出来的」和「导出出去的」迟早不是同一批数据, 而导出通常就是
   * 为了核对列表上看到的数字。
   *
   * 上限 5000 行: 再大应走数据备份, 而不是让一个同步请求跑几十秒。
   */
  async exportCsv(query: TicketListQuery): Promise<string> {
    const rows = await this.prisma.ticket.findMany({
      where: this.adminWhere(query),
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: CSV_EXPORT_MAX_ROWS,
      include: { user: { select: { email: true } } },
    });
    return toCsv(
      [
        { label: '工单号', value: (t) => t.ticketNo },
        { label: '用户', value: (t) => t.user?.email ?? '' },
        { label: '类型', value: (t) => TICKET_TYPE_LABELS[t.type as TicketType] ?? t.type },
        { label: '标题', value: (t) => t.subject },
        { label: '状态', value: (t) => TICKET_STATUS_LABELS[t.status as TicketStatus] ?? t.status },
        { label: '优先级', value: (t) => t.priority },
        { label: '描述', value: (t) => t.content },
        { label: '关联订单', value: (t) => t.orderId ?? '' },
        { label: '创建时间', value: (t) => t.createdAt },
        { label: '解决时间', value: (t) => t.resolvedAt ?? '' },
      ],
      rows,
    );
  }

  async adminDetail(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, name: true, status: true } },
        replies: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new AppError(40400, '工单不存在', 404);

    /*
     * 关联订单/素材只做**只读摘要**。财务动作（退款、补发积分）必须回订单模块,
     * 因为那里有退款时间窗、可退上限、积分回收一整套规则 —— 在工单页
     * 再实现一套「顺手退个款」的捷径, 两套规则迟早不一致。
     */
    const [order, asset] = await Promise.all([
      ticket.orderId
        ? this.prisma.order.findUnique({
            where: { id: ticket.orderId },
            select: {
              id: true,
              orderNo: true,
              status: true,
              totalCents: true,
              paidCents: true,
              refundedCents: true,
              createdAt: true,
            },
          })
        : null,
      ticket.assetId
        ? this.prisma.asset.findUnique({
            where: { id: ticket.assetId },
            select: { id: true, sourceUrl: true, width: true, height: true, createdAt: true },
          })
        : null,
    ]);

    return { ...this.shape(ticket, true), user: ticket.user, related: { order, asset } };
  }

  async adminReply(id: string, actor: { id: string; email: string }, content: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new AppError(40400, '工单不存在', 404);

    const text = content.trim().slice(0, 2000);
    if (!text) throw new AppError(40001, '回复内容不能为空', 400);

    await this.prisma.ticketReply.create({
      data: {
        ticketId: id,
        authorType: 'admin',
        authorId: actor.id,
        authorName: actor.email,
        content: text,
      },
    });

    /*
     * 客服回复即视为受理: open → processing。
     * 若工单已 closed, 回复会把它重新打开 (processing) —— 用户说「问题还在」
     * 时, 客服需要接回原上下文, 而不是要求用户另开一张单再讲一遍。
     */
    const nextStatus: TicketStatus =
      ticket.status === 'open' || ticket.status === 'closed' ? 'processing' : (ticket.status as TicketStatus);
    await this.prisma.ticket.update({
      where: { id },
      data: {
        status: nextStatus,
        ...(nextStatus === 'processing' ? { closedAt: null, resolvedAt: null } : {}),
        // 未指派时由回复者认领: 「谁回的」与「谁负责」分开记录, 事后会互相矛盾
        ...(ticket.assigneeId ? {} : { assigneeId: actor.id }),
        updatedAt: new Date(),
      },
    });

    void this.notifications.notify({
      userId: ticket.userId,
      type: 'ticket_reply',
      vars: { ticketNo: ticket.ticketNo },
      fallbackTitle: '工单有新回复',
      fallbackBody: `工单 ${ticket.ticketNo} 已由客服回复。`,
      link: '/tickets',
    });

    return this.adminDetail(id);
  }

  async adminUpdate(
    id: string,
    dto: { status?: string; priority?: string; assigneeId?: string | null },
    actor: { id: string },
  ) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new AppError(40400, '工单不存在', 404);

    const data: Record<string, unknown> = {};

    if (dto.status && dto.status !== ticket.status) {
      const from = ticket.status as TicketStatus;
      const to = dto.status as TicketStatus;
      if (!TRANSITIONS[from]?.includes(to)) {
        throw new AppError(
          40001,
          `工单不能从「${TICKET_STATUS_LABELS[from] ?? from}」直接变为「${TICKET_STATUS_LABELS[to] ?? to}」`,
          400,
        );
      }
      data.status = to;
      if (to === 'resolved') data.resolvedAt = new Date();
      if (to === 'closed') data.closedAt = new Date();
      if (to === 'open' || to === 'processing') {
        data.resolvedAt = null;
        data.closedAt = null;
      }
    }

    if (dto.priority && dto.priority !== ticket.priority) data.priority = dto.priority;

    // assigneeId 传 null 表示取消指派; 传字符串表示指派给某人
    if (dto.assigneeId !== undefined && dto.assigneeId !== ticket.assigneeId) {
      if (dto.assigneeId === null) {
        data.assigneeId = null;
      } else {
        const assignee = await this.prisma.user.findUnique({
          where: { id: dto.assigneeId },
          select: { role: true, status: true },
        });
        if (!assignee || assignee.role === 'user' || assignee.status !== 'active') {
          throw new AppError(40001, '只能指派给启用中的后台账号', 400);
        }
        data.assigneeId = dto.assigneeId;
        // 指派即受理: 否则「已指派」的工单仍停在 open, 看板统计失真
        if (ticket.status === 'open') data.status = 'processing';
      }
    }

    if (Object.keys(data).length === 0) return this.adminDetail(id);

    await this.prisma.ticket.update({ where: { id }, data });
    this.logger.log(
      `工单 ${ticket.ticketNo} 由 ${actor.id} 更新: ${JSON.stringify(Object.keys(data))}`,
    );
    return this.adminDetail(id);
  }

  /** 侧栏/看板用的各状态计数（与列表 counts 同源） */
  async stats() {
    const rows = await this.prisma.ticket.groupBy({ by: ['status'], _count: { _all: true } });
    const counts = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    return {
      open: counts.open ?? 0,
      processing: counts.processing ?? 0,
      resolved: counts.resolved ?? 0,
      closed: counts.closed ?? 0,
      pending: (counts.open ?? 0) + (counts.processing ?? 0),
    };
  }

  // ── 内部 ──────────────────────────────────────────────────────────

  /** 后台筛选条件。列表 / 导出 / 计数共用，避免三处各写一份 */
  private adminWhere(query: TicketListQuery): Record<string, unknown> {
    const q = query.q?.trim();
    return {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assigneeId === 'unassigned'
        ? { assigneeId: null }
        : query.assigneeId
          ? { assigneeId: query.assigneeId }
          : {}),
      ...(q
        ? {
            OR: [
              { ticketNo: { contains: q } },
              { subject: { contains: q } },
              { content: { contains: q } },
            ],
          }
        : {}),
    };
  }

  /** 工单号: T + 日期 + 6 位 base36。碰撞重试三次后放弃并报错 */
  private async nextTicketNo(): Promise<string> {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
    for (let i = 0; i < 3; i += 1) {
      const rand = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '0');
      const ticketNo = `T${day}${rand}`;
      const exists = await this.prisma.ticket.findUnique({ where: { ticketNo }, select: { id: true } });
      if (!exists) return ticketNo;
    }
    throw new AppError(50001, '工单号生成失败，请重试', 500);
  }

  /** 统一对外形状: 不把 assigneeId 之外的内部字段原样抛出 */
  private shape(ticket: Record<string, any>, withReplies = false) {
    const base: Record<string, unknown> = {
      id: ticket.id,
      ticketNo: ticket.ticketNo,
      type: ticket.type,
      typeLabel: TICKET_TYPE_LABELS[ticket.type as TicketType] ?? ticket.type,
      subject: ticket.subject,
      content: ticket.content,
      status: ticket.status,
      statusLabel: TICKET_STATUS_LABELS[ticket.status as TicketStatus] ?? ticket.status,
      priority: ticket.priority,
      orderId: ticket.orderId ?? null,
      assetId: ticket.assetId ?? null,
      assigneeId: ticket.assigneeId ?? null,
      resolvedAt: ticket.resolvedAt ?? null,
      closedAt: ticket.closedAt ?? null,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    };
    if (withReplies) base.replies = ticket.replies ?? [];
    return base;
  }
}
