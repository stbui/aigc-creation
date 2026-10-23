import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreditService } from '../credits/credit.service';
import { OrderService } from '../orders/order.service';
import { AppError } from '../common/app.exception';
import { runBatch } from '../common/batch';
import { buildPage, paginate, type PageQueryDto } from './dto/page-query.dto';
import { centsToYuan, parseCsv, toCsv, type CsvColumn } from '../common/csv';

/** 商品写入字段。sku 只在创建时给 —— 改 sku 会让历史订单快照与商品对不上号 */
export interface ProductCreateInput {
  sku: string;
  name: string;
  description?: string;
  type?: string;
  priceCents: number;
  originalPriceCents?: number | null;
  credits: number;
  creditsValidDays?: number;
  grantType?: 'immediate' | 'manual';
  status?: 'active' | 'offline';
  sortOrder?: number;
}

export interface ProductUpdateInput {
  name?: string;
  description?: string;
  priceCents?: number;
  originalPriceCents?: number | null;
  credits?: number;
  creditsValidDays?: number;
  grantType?: 'immediate' | 'manual';
  status?: 'active' | 'offline';
  sortOrder?: number;
}

export interface OrderListQuery {
  status?: string;
  orderNo?: string;
  email?: string;
  channel?: string;
  /** ISO 日期或 yyyy-mm-dd; 含当天 */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export interface PaymentListQuery {
  status?: string;
  from?: string;
  to?: string;
  pageSize?: number;
}

export interface CreditLedgerQuery {
  type?: string;
  from?: string;
  to?: string;
  limit?: number;
}

const ORDER_STATUSES = [
  'pending',
  'paid',
  'cancelled',
  'refunded',
  'partial_refunded',
] as const;

const LEDGER_TYPES = [
  'purchase',
  'grant',
  'consume',
  'admin_adjust',
  'expire',
  'refund_reclaim',
] as const;

const GRANT_TYPES = ['immediate', 'manual'] as const;
const PRODUCT_STATUSES = ['active', 'offline'] as const;

/** 导出上限: 再大就不该走同步 HTTP 了, 应改异步任务 + 落文件 */
const EXPORT_LIMIT = 10_000;

/**
 * 积分导入行数上限。
 *
 * 与批量操作上限 (100) 刻意不同: 补发场景经常是几百人的活动名单,
 * 逐行人工勾选不现实; 但一次点错影响的人数更多, 所以不走分页而是一次跑完
 * 并逐行留结果, 500 行在单请求耗时与影响面之间取平衡。
 */
const IMPORT_LIMIT = 500;

/**
 * 后台交易域的数据访问层。
 *
 * 为什么从 controller 里抽出来:
 *   此前 commerce.controller 直接 `this.orders['prisma']` 穿透取 Prisma 实例,
 *   商品增改、订单筛选、导出这些逻辑只能写在 controller 里, 既没法被调度/脚本
 *   复用, 也让 controller 变成 300 行的"什么都有"的文件。
 *   现在 controller 只做权限/审计/参数, 查询与规则在本服务。
 *
 * 约定:
 *   · 所有金额是**整数分**, 只有导出 CSV 时转成元 (人要对账的是元)
 *   · 所有时间过滤的 `to` 含当天 —— 运营输入 10-21 期望包含 10-21 全天
 *   · 任何写操作都不在这里写审计, 审计由 controller 的 @AuditAction 负责
 */
@Injectable()
export class AdminCommerceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credit: CreditService,
    private readonly orders: OrderService,
  ) {}

  // ── 商品 ──────────────────────────────────────────────────────────

  async listProducts(status?: string) {
    const where: Record<string, unknown> = {};
    if (status) {
      if (!(PRODUCT_STATUSES as readonly string[]).includes(status)) {
        throw new AppError(40001, `商品状态非法: ${status}`, 400);
      }
      where.status = status;
    }
    const list = await this.prisma.product.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return list.map((p) => this.toProductView(p));
  }

  async createProduct(input: ProductCreateInput) {
    this.assertProductNumbers(input.priceCents, input.credits, input.creditsValidDays);
    const exists = await this.prisma.product.findUnique({ where: { sku: input.sku } });
    if (exists) throw new AppError(40001, `SKU 已存在: ${input.sku}`, 400);

    const product = await this.prisma.product.create({
      data: {
        sku: input.sku.trim(),
        name: input.name.trim(),
        description: input.description ?? '',
        type: input.type ?? 'credits',
        priceCents: input.priceCents,
        originalPriceCents: input.originalPriceCents ?? null,
        credits: input.credits,
        creditsValidDays: input.creditsValidDays ?? 0,
        grantType: input.grantType ?? 'immediate',
        status: input.status ?? 'offline',
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return this.toProductView(product);
  }

  async updateProduct(id: string, input: ProductUpdateInput) {
    const current = await this.prisma.product.findUnique({ where: { id } });
    if (!current) throw new AppError(40400, '商品不存在', 404);

    // 只校验本次要改的数值字段; 未传的沿用库里的值 (它们创建时已校验过)
    this.assertProductNumbers(
      input.priceCents ?? current.priceCents,
      input.credits ?? current.credits,
      input.creditsValidDays ?? current.creditsValidDays,
    );

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
        ...(input.originalPriceCents !== undefined
          ? { originalPriceCents: input.originalPriceCents }
          : {}),
        ...(input.credits !== undefined ? { credits: input.credits } : {}),
        ...(input.creditsValidDays !== undefined
          ? { creditsValidDays: input.creditsValidDays }
          : {}),
        ...(input.grantType !== undefined ? { grantType: input.grantType } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
    return this.toProductView(product);
  }

  /**
   * 商品无物理删除。
   *
   * 历史订单的 OrderItem 存了快照, 删商品不会让订单显示不全, 但后台就再也
   * 查不到"这个 SKU 原来卖多少钱、发多少积分"了 —— 对账需要它。下架即够。
   */
  private assertProductNumbers(priceCents: number, credits: number, validDays = 0): void {
    if (!Number.isInteger(priceCents) || priceCents < 0) {
      throw new AppError(40001, '商品价格必须是非负整数分', 400);
    }
    if (!Number.isInteger(credits) || credits < 0) {
      throw new AppError(40001, '赠送积分必须是非负整数', 400);
    }
    if (!Number.isInteger(validDays) || validDays < 0) {
      throw new AppError(40001, '积分有效期必须是非负整数天', 400);
    }
  }

  private toProductView(p: any) {
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      type: p.type,
      priceCents: p.priceCents,
      originalPriceCents: p.originalPriceCents,
      credits: p.credits,
      creditsValidDays: p.creditsValidDays,
      grantType: p.grantType,
      status: p.status,
      sortOrder: p.sortOrder,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  // ── 订单 ──────────────────────────────────────────────────────────

  private orderWhere(q: OrderListQuery): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (q.status) {
      if (!(ORDER_STATUSES as readonly string[]).includes(q.status)) {
        throw new AppError(40001, `订单状态非法: ${q.status}`, 400);
      }
      where.status = q.status;
    }
    if (q.channel) where.channel = q.channel;
    if (q.orderNo?.trim()) where.orderNo = { contains: q.orderNo.trim() };
    if (q.email?.trim()) where.user = { email: { contains: q.email.trim() } };

    const range = this.dateRange(q.from, q.to);
    if (range) where.createdAt = range;
    return where;
  }

  async listOrders(q: OrderListQuery) {
    const page = buildPage(
      { page: q.page, pageSize: q.pageSize, sort: q.sort } as PageQueryDto,
      ['createdAt', 'paidAt', 'totalCents'],
      'createdAt:desc',
    );
    const where = this.orderWhere(q);

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: page.orderBy,
        include: {
          user: { select: { email: true } },
          items: { select: { id: true } },
          payments: { select: { id: true } },
          membershipPlan: { select: { code: true, name: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return paginate(
      items.map((o: any) => ({
        id: o.id,
        orderNo: o.orderNo,
        userId: o.userId,
        userEmail: o.user?.email ?? '',
        status: o.status,
        channel: o.channel,
        totalCents: o.totalCents,
        discountCents: o.discountCents ?? 0,
        paidCents: o.paidCents > 0 ? o.paidCents : o.totalCents,
        refundedCents: o.refundedCents,
        grantedCredits: o.grantedCredits,
        itemCount: o.items.length,
        paymentCount: o.payments.length,
        membershipPlanCode: o.membershipPlan?.code ?? null,
        membershipPlanName: o.membershipPlan?.name ?? null,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
      })),
      total,
      page,
    );
  }

  /** 订单详情: 用户 / 明细 / 支付 / 退款 / 券与活动 / 会员套餐 一次取全 */
  async orderDetail(id: string) {
    return this.prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, name: true, role: true } },
        items: true,
        payments: { orderBy: { createdAt: 'desc' } },
        refunds: { orderBy: { createdAt: 'desc' } },
        coupon: { select: { code: true, name: true } },
        campaign: { select: { id: true, name: true, type: true } },
        membershipPlan: {
          select: {
            id: true,
            code: true,
            name: true,
            durationDays: true,
            monthlyCredits: true,
          },
        },
      },
    }).then((o) => {
      if (!o) throw new AppError(40400, '订单不存在', 404);
      return o;
    });
  }

  /** 订单导出 (CSV)。金额列同时给分与元, 财务按元核对, 技术按分回查 */
  async exportOrders(q: OrderListQuery): Promise<string> {
    const rows = await this.prisma.order.findMany({
      where: this.orderWhere(q),
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMIT,
      include: {
        user: { select: { email: true } },
        items: { select: { nameSnapshot: true, skuSnapshot: true } },
        membershipPlan: { select: { code: true } },
      },
    });

    const columns: CsvColumn<(typeof rows)[number]>[] = [
      { label: '订单号', value: (o) => o.orderNo },
      { label: '用户邮箱', value: (o) => o.user?.email ?? '' },
      { label: '状态', value: (o) => ORDER_STATUS_LABELS[o.status] ?? o.status },
      { label: '支付渠道', value: (o) => o.channel ?? '' },
      { label: '订单金额(分)', value: (o) => o.totalCents },
      { label: '订单金额(元)', value: (o) => centsToYuan(o.totalCents) },
      { label: '优惠(分)', value: (o) => o.discountCents ?? 0 },
      { label: '实付(分)', value: (o) => (o.paidCents > 0 ? o.paidCents : o.totalCents) },
      { label: '实付(元)', value: (o) => centsToYuan(o.paidCents > 0 ? o.paidCents : o.totalCents) },
      { label: '已退(分)', value: (o) => o.refundedCents },
      { label: '赠送积分', value: (o) => o.grantedCredits },
      { label: '商品', value: (o: any) => o.items.map((i: any) => `${i.nameSnapshot}(${i.skuSnapshot})`).join(' / ') },
      { label: '会员套餐', value: (o: any) => o.membershipPlan?.code ?? '' },
      { label: '下单时间', value: (o) => o.createdAt },
      { label: '支付时间', value: (o) => o.paidAt },
    ];
    return toCsv(columns, rows);
  }

  // ── 支付流水 ──────────────────────────────────────────────────────

  private paymentWhere(q: PaymentListQuery): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    const range = this.dateRange(q.from, q.to);
    if (range) where.createdAt = range;
    return where;
  }

  /**
   * 批量手工核销（B7）。
   *
   * 逐条走 `OrderService.markPaid`：重复回调幂等、状态校验、积分发放、
   * 会员激活全部复用单条路径。批量核销是财务对账后最常见的动作
   * （渠道已收款但回调丢了），但它本质仍是「把订单标记为已付」——
   * 每一笔都会真实发积分，所以必须逐条给出结果，而不是一条 updateMany。
   *
   * 交易号带订单 id：同一次批量重复执行时不会互相覆盖，也不依赖
   * 循环里的时间戳（同一毫秒内 100 条会撞唯一约束）。
   */
  async batchMarkPaid(ids: string[], actorId: string) {
    return runBatch(ids, async (id) => {
      const order = await this.prisma.order.findUnique({
        where: { id },
        select: { userId: true, status: true },
      });
      if (!order) throw new AppError(40400, '订单不存在', 404);
      const res = await this.orders.markPaid({
        orderId: id,
        userId: order.userId,
        payTransactionId: `MANUAL-BATCH-${actorId}-${id}`,
        channel: 'manual',
      });
      return { orderId: id, idempotentHit: (res as { idempotentHit?: boolean }).idempotentHit ?? false };
    });
  }

  async listPayments(q: PaymentListQuery) {
    const take = Math.min(q.pageSize ?? 50, 200);
    const list = await this.prisma.payment.findMany({
      where: this.paymentWhere(q),
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        order: { select: { orderNo: true } },
        user: { select: { email: true } },
      },
    });
    return list.map((p: any) => ({
      id: p.id,
      orderNo: p.order?.orderNo ?? '',
      orderId: p.orderId,
      userEmail: p.user?.email ?? '',
      channel: p.channel,
      payTransactionId: p.payTransactionId,
      amountCents: p.amountCents,
      status: p.status,
      message: p.message,
      sandboxScenario: p.sandboxScenario,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    }));
  }

  async exportPayments(q: PaymentListQuery): Promise<string> {
    const rows = await this.prisma.payment.findMany({
      where: this.paymentWhere(q),
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMIT,
      include: {
        order: { select: { orderNo: true } },
        user: { select: { email: true } },
      },
    });
    const columns: CsvColumn<(typeof rows)[number]>[] = [
      { label: '订单号', value: (p: any) => p.order?.orderNo ?? '' },
      { label: '用户邮箱', value: (p: any) => p.user?.email ?? '' },
      { label: '渠道', value: (p) => p.channel },
      { label: '渠道流水号', value: (p) => p.payTransactionId },
      { label: '金额(分)', value: (p) => p.amountCents },
      { label: '金额(元)', value: (p) => centsToYuan(p.amountCents) },
      { label: '状态', value: (p) => p.status },
      { label: '说明', value: (p) => p.message ?? '' },
      { label: '沙箱场景', value: (p) => p.sandboxScenario ?? '' },
      { label: '支付时间', value: (p) => p.paidAt ?? '' },
      { label: '创建时间', value: (p) => p.createdAt },
    ];
    return toCsv(columns, rows);
  }

  // ── 积分 ──────────────────────────────────────────────────────────

  async listCredits(query: {
    userId?: string;
    email?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = buildPage(query as PageQueryDto, ['createdAt'], 'createdAt:desc');
    const where: Record<string, unknown> = {};
    if (query.userId) where.id = query.userId;
    if (query.email) where.email = { contains: query.email };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, name: true, createdAt: true },
      }),
      this.prisma.user.count({ where }),
    ]);

    // 逐个用户汇总余额 —— SQLite 下 ∑(批次) 没有现成聚合接口, 用户量在分页内可控
    const items = await Promise.all(
      users.map(async (u) => {
        const s = await this.credit.balanceOf(u.id);
        return {
          userId: u.id,
          email: u.email,
          name: u.name,
          balance: s.balance,
          expiringSoon: s.expiringSoon,
          totalEarned: s.totalEarned,
          totalConsumed: s.totalConsumed,
          activeLots: s.activeLots,
          nearestExpiry: s.nearestExpiry,
        };
      }),
    );
    return paginate(items, total, page);
  }

  async creditLots(userId: string, query: { from?: string; to?: string } = {}) {
    const range = this.dateRange(query.from, query.to);
    return this.prisma.creditLot.findMany({
      where: { userId, ...(range ? { createdAt: range } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async creditLedger(userId: string, query: CreditLedgerQuery = {}) {
    const where: Record<string, unknown> = { userId };
    if (query.type) {
      if (!(LEDGER_TYPES as readonly string[]).includes(query.type)) {
        throw new AppError(40001, `流水类型非法: ${query.type}`, 400);
      }
      where.type = query.type;
    }
    const range = this.dateRange(query.from, query.to);
    if (range) where.createdAt = range;

    const limit = Math.min(query.limit ?? 50, 500);
    return this.prisma.creditLedger.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { lot: { select: { source: true, expireAt: true } } },
    });
  }

  /**
   * 批量调整积分。
   *
   * 逐条独立执行并回传每条结果: 批量操作里一条失败不该让其余 99 条不生效,
   * 但失败必须逐条列出来 —— 否则运营看到"已完成"却少了一条, 只能靠对账发现。
   * 失败原因不改写成通用文案, 保留 service 抛出的原始提示 (如"余额不足")。
   */
  async batchAdjust(
    items: Array<{ userId: string; delta?: number; reason?: string }>,
    shared: { reason: string; operatorId: string; validDays?: number },
  ) {
    const results: Array<{
      userId: string;
      success: boolean;
      balance?: number;
      message?: string;
    }> = [];

    // 先批量取一次存在的用户: 逐条撞外键的话, 返回给运营的是 Prisma 的
    // 英文外键报错 (带 SQL 上下文), 既不可读也把实现细节泄进了界面
    const ids = Array.from(new Set(items.map((i) => i.userId)));
    const known = new Set(
      (
        await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        })
      ).map((u) => u.id),
    );

    for (const item of items) {
      const delta = item.delta ?? 0;
      // 单项原因优先, 未给则用整批原因; 两者都空时 adminAdjust 会拒绝
      const reason = (item.reason ?? '').trim() || shared.reason;
      if (!known.has(item.userId)) {
        results.push({ userId: item.userId, success: false, message: '用户不存在' });
        continue;
      }
      try {
        const r = await this.credit.adminAdjust({
          userId: item.userId,
          delta,
          reason,
          operatorId: shared.operatorId,
          validDays: shared.validDays,
        });
        results.push({ userId: item.userId, success: true, balance: r.balance });
      } catch (e: any) {
        results.push({ userId: item.userId, success: false, message: e?.message ?? '调整失败' });
      }
    }
    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  /**
   * 积分 CSV 导入（B7）。
   *
   * 表格列：`email,delta[,reason]`，首行可选表头（`email` / `邮箱`）。
   * 用邮箱而不是用户 id 定位 —— 运营手里的表格从来只有邮箱。
   *
   * 三条边界，缺一条都会在真实运营场景里出事：
   *   · **整批上限 500 行**。再多就不是"补发"而是"结算"，应当拆批留痕；
   *     同时在 2MB 文件上限内保证一次请求不会跑太久。
   *   · **逐行独立成败**。某行邮箱写错不该让另外 499 行不生效；但失败必须
   *     逐行列出，否则运营看到"完成"却少发了几个人，只能等用户来投诉。
   *   · **原因必填**。逐行 `reason` 列优先，缺省用整批原因；两者都空则
   *     `adminAdjust` 会拒绝 —— 无原因的发积分事后无法追责。
   *
   * 权限口径见 controller：走 `credit.adjust` 而非 `data.import`，这是给钱。
   */
  async importCreditsCsv(
    text: string,
    opts: { reason?: string; validDays?: number; operatorId: string },
  ) {
    const rows = parseCsv(text);
    if (rows.length === 0) {
      throw new AppError(40001, 'CSV 内容为空', 400);
    }

    // 表头可选：运营自己用 Excel 导出的文件通常带表头，程序生成的往往不带
    const first = rows[0].map((c) => c.trim().toLowerCase());
    const hasHeader = ['email', '邮箱', 'e-mail'].includes(first[0] ?? '');
    const body = hasHeader ? rows.slice(1) : rows;

    if (body.length === 0) {
      throw new AppError(40001, 'CSV 只有表头，没有数据行', 400);
    }
    if (body.length > IMPORT_LIMIT) {
      throw new AppError(
        40001,
        `单次最多导入 ${IMPORT_LIMIT} 行，当前 ${body.length} 行，请拆分后重试`,
        400,
      );
    }

    type Parsed = {
      row: number;
      email: string;
      delta?: number;
      reason?: string;
      error?: string;
    };
    const parsed: Parsed[] = body.map((cells, idx) => {
      // 行号按用户在 Excel 里看到的算：带表头时数据首行是第 2 行
      const row = idx + (hasHeader ? 2 : 1);
      const email = (cells[0] ?? '').trim();
      const rawDelta = (cells[1] ?? '').trim();
      const reason = (cells[2] ?? '').trim();
      const delta = /^[+-]?\d+$/.test(rawDelta) ? Number(rawDelta) : Number.NaN;
      let error: string | undefined;
      if (!email) error = '缺少邮箱';
      else if (!rawDelta) error = '缺少调整值';
      else if (Number.isNaN(delta)) error = `调整值必须是整数：${rawDelta}`;
      else if (delta === 0) error = '调整值不能为 0';
      return {
        row,
        email,
        delta: Number.isNaN(delta) ? undefined : delta,
        reason: reason || undefined,
        error,
      };
    });

    // 邮箱一律小写比对：库内是注册时 toLowerCase 存的，表格里常有大写
    const wanted = Array.from(new Set(parsed.filter((p) => p.email).map((p) => p.email.toLowerCase())));
    const users = await this.prisma.user.findMany({
      where: { email: { in: wanted } },
      select: { id: true, email: true },
    });
    const idByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

    const sharedReason = (opts.reason ?? '').trim() || 'CSV 导入';
    const results: Array<{
      row: number;
      email: string;
      delta: number;
      success: boolean;
      balance?: number;
      message?: string;
    }> = [];

    for (const item of parsed) {
      if (item.error || !item.delta) {
        results.push({
          row: item.row,
          email: item.email,
          delta: item.delta ?? 0,
          success: false,
          message: item.error ?? '数据非法',
        });
        continue;
      }
      const userId = idByEmail.get(item.email.toLowerCase());
      if (!userId) {
        results.push({
          row: item.row,
          email: item.email,
          delta: item.delta,
          success: false,
          message: '用户不存在',
        });
        continue;
      }
      try {
        const r = await this.credit.adminAdjust({
          userId,
          delta: item.delta,
          reason: item.reason ?? sharedReason,
          operatorId: opts.operatorId,
          validDays: opts.validDays,
        });
        results.push({
          row: item.row,
          email: item.email,
          delta: item.delta,
          success: true,
          balance: r.balance,
        });
      } catch (e: any) {
        results.push({
          row: item.row,
          email: item.email,
          delta: item.delta,
          success: false,
          message: e?.message ?? '调整失败',
        });
      }
    }

    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  async exportCredits(query: { userId?: string; email?: string }): Promise<string> {
    const where: Record<string, unknown> = {};
    if (query.userId) where.id = query.userId;
    if (query.email) where.email = { contains: query.email };
    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMIT,
      select: { id: true, email: true, name: true },
    });

    const rows = await Promise.all(
      users.map(async (u) => ({ ...u, summary: await this.credit.balanceOf(u.id) })),
    );
    const columns: CsvColumn<(typeof rows)[number]>[] = [
      { label: '用户ID', value: (r) => r.id },
      { label: '邮箱', value: (r) => r.email },
      { label: '昵称', value: (r) => r.name },
      { label: '当前余额', value: (r) => r.summary.balance },
      { label: '30天内到期', value: (r) => r.summary.expiringSoon },
      { label: '累计获得', value: (r) => r.summary.totalEarned },
      { label: '累计消耗', value: (r) => r.summary.totalConsumed },
      { label: '有效批次', value: (r) => r.summary.activeLots },
      { label: '最近到期', value: (r) => r.summary.nearestExpiry ?? '' },
    ];
    return toCsv(columns, rows);
  }

  // ── 日期范围 ──────────────────────────────────────────────────────

  /**
   * 解析 `from` / `to` 为 createdAt 过滤条件。
   *
   * `to` 含当天: 运营输入 2026-10-21 想看到的是这一整天, 而不是 00:00:00
   * 之前。只写日期的值补到 23:59:59.999。
   * 非法日期直接 400 —— 静默忽略会让导出结果与筛选条件不符且看不出来。
   */
  private dateRange(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
    const parse = (raw: string | undefined, endOfDay: boolean): Date | undefined => {
      if (!raw?.trim()) return undefined;
      const value = raw.trim();
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
      const d = new Date(dateOnly ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}` : value);
      if (Number.isNaN(d.getTime())) throw new AppError(40001, `日期格式非法: ${value}`, 400);
      return d;
    };
    const gte = parse(from, false);
    const lte = parse(to, true);
    if (!gte && !lte) return undefined;
    return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
  }
}

/** 导出用的中文状态标签。与前端 StatusTag 的文案保持一致 */
const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  cancelled: '已取消',
  refunded: '已退款',
  partial_refunded: '部分退款',
};
