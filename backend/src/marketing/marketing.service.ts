import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { CSV_EXPORT_MAX_ROWS, toCsv } from '../common/csv';
import { CreditService } from '../credits/credit.service';
import { Prisma } from '@prisma/client';
import { lockUserRow } from '../account/user-row-lock';

/**
 * 营销中心 (M11 · admin-prd.md B-64~B-67 / admin-detailed-design.md §12)。
 *
 * 四个子模块共用一个 service 的理由: 它们共享两处**不可复制的判定逻辑** ——
 * 券的资格校验 (门槛/范围/限用/时间窗) 与 活动的生效判定 (时间窗/人群/payload)。
 * 拆成四个 service 会让下单链路同时依赖四个模块, 且两处判定各写一份必然漂移。
 *
 * 三条贯穿全模块的硬约定:
 *
 * **1. 优惠只在下单时刻算一次, 之后写快照。**
 *    券规则事后可改, 活动会到期。若结算时实时查营销表, 则同一张订单在
 *    "下单瞬间" 与 "支付瞬间" 会得到不同金额, 对账必然出现无法解释的差额。
 *
 * **2. 券与活动不叠加, 取更优者。** (§12.6 明确要求)
 *    叠加会让优惠金额随规则组合爆炸, 且用户拿到手的价格无法事前解释。
 *
 * **3. 发放类动作(邀请奖励/签到)必须幂等。**
 *    支付回调可重复到达, 签到可被连点。重复发放 = 直接资损。
 */

export type CouponType = 'full_cut' | 'discount' | 'fixed';
export type CouponScope = 'all' | 'product' | 'new_user';
export type CampaignType = 'limited_price' | 'limited_free' | 'popup';
export type CampaignStatus = 'draft' | 'active' | 'ended' | 'off';

/** 券列表中文名 */
export const COUPON_TYPE_LABELS: Record<CouponType, string> = {
  full_cut: '满减',
  discount: '折扣',
  fixed: '固定额',
};

/** 券范围中文名 */
export const COUPON_SCOPE_LABELS: Record<CouponScope, string> = {
  all: '全站通用',
  product: '指定商品',
  new_user: '仅新用户',
};

/** 券派生生效态中文名 (与开关 status 分开: 过期/售罄不是「停用」) */
export const COUPON_EFFECTIVE_LABELS: Record<string, string> = {
  on: '生效中',
  off: '已停用',
  expired: '已过期',
  not_started: '未开始',
  sold_out: '已售罄',
};

/** 活动类型中文名 */
export const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  limited_price: '限时价',
  limited_free: '限时免费',
  popup: '弹窗位',
};

/** 活动状态中文名 */
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: '草稿',
  active: '进行中',
  ended: '已结束',
  off: '已下线',
};

/** 活动派生生效态中文名 (status=active 但时间窗未到, 对用户就是不生效) */
export const CAMPAIGN_EFFECTIVE_LABELS: Record<string, string> = {
  draft: '草稿',
  live: '生效中',
  scheduled: '未开始',
  ended: '已结束',
  off: '已下线',
};

/** 折扣万分比换算: 8500 → 0.85 */
const DISCOUNT_BASE = 10000;

/** 优惠来源标识: 用于快照与展示 */
export type DiscountSource = 'coupon' | 'campaign';

export interface DiscountResult {
  /** 优惠金额(分), 恒 >= 0 且 <= 原始金额 */
  discountCents: number;
  source: DiscountSource | null;
  couponId: string | null;
  couponCode: string | null;
  campaignId: string | null;
  /** 写入 Order.couponSnapshot 的规则快照 */
  snapshot: Record<string, unknown>;
}

@Injectable()
export class MarketingService {
  private readonly log = new Logger(MarketingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credit: CreditService,
  ) {}

  /**
   * 结算试算所需的商品快照。
   *
   * 独立方法而非在 controller 里直接查 Prisma: 让 MarketingService 保持
   * 「营销相关数据的唯一出入口」, controller 不出现第二个数据访问层。
   *
   * ⚠ 只返回**下单所需**的字段, 不含成本/毛利等后台字段 ——
   * 试算是公开端点, 返回整个商品对象等于把内部定价结构送给前端。
   */
  async quoteItems(productIds: string[]): Promise<
    Map<string, { name: string; priceCents: number; credits: number; status: string }>
  > {
    const rows = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, priceCents: true, credits: true, status: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  // ════════════════════════════════════════════════════════════════
  // 优惠券
  // ════════════════════════════════════════════════════════════════

  /** 券列表 (分页 + 筛选) */
  async listCoupons(query: {
    page?: number;
    pageSize?: number;
    type?: string;
    status?: string;
    keyword?: string;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 20);
    const skip = (page - 1) * pageSize;

    const where = this.couponWhere(query);

    const [rows, total, summary] = await Promise.all([
      this.prisma.coupon.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: { _count: { select: { orders: true } } },
      }),
      this.prisma.coupon.count({ where }),
      // 汇总不受分页影响 —— 否则翻到第 2 页就看不到全站券总量
      this.prisma.coupon.aggregate({
        where,
        _sum: { totalCount: true, usedCount: true },
        _count: true,
      }),
    ]);

    const pendingByCoupon = await this.pendingReservationCounts(rows.map((c) => c.id));
    const now = new Date();
    return {
      items: rows.map((c) => this.toCouponView(c, now, pendingByCoupon.get(c.id) ?? 0)),
      total,
      page,
      pageSize,
      summary: {
        count: summary._count,
        totalIssued: summary._sum.totalCount ?? 0,
        totalUsed: summary._sum.usedCount ?? 0,
      },
      typeLabels: COUPON_TYPE_LABELS,
      scopeLabels: COUPON_SCOPE_LABELS,
    };
  }

  /**
   * 导出优惠券 (CSV)。
   *
   * 与列表共用 `couponWhere`，筛选口径一致。面额按展示口径导出
   * （折扣 → 折数，其余 → 元），运营拿到表格不必再自己换算万分比。
   */
  async exportCoupons(query: {
    type?: string;
    status?: string;
    keyword?: string;
  }): Promise<string> {
    const rows = await this.prisma.coupon.findMany({
      where: this.couponWhere(query),
      orderBy: { createdAt: 'desc' },
      take: CSV_EXPORT_MAX_ROWS,
    });
    const now = new Date();
    const pendingByCoupon = await this.pendingReservationCounts(rows.map((c) => c.id));
    const views = rows.map((c) => this.toCouponView(c, now, pendingByCoupon.get(c.id) ?? 0));
    return toCsv(
      [
        { label: '券码', value: (c) => c.code },
        { label: '名称', value: (c) => c.name },
        { label: '类型', value: (c) => c.typeLabel },
        { label: '面额', value: (c) => c.valueLabel },
        { label: '使用门槛', value: (c) => c.thresholdLabel },
        { label: '适用范围', value: (c) => c.scopeLabel },
        { label: '发放总量', value: (c) => c.totalCount },
        { label: '已使用', value: (c) => c.usedCount },
        { label: '待支付预占', value: (c) => c.pendingReserved },
        { label: '剩余', value: (c) => (c.remaining === null ? '不限' : c.remaining) },
        { label: '每人限用', value: (c) => c.perUserLimit },
        { label: '开关', value: (c) => (c.status === 'on' ? '启用' : '停用') },
        { label: '生效状态', value: (c) => COUPON_EFFECTIVE_LABELS[c.effective] ?? c.effective },
        { label: '开始时间', value: (c) => c.validFrom },
        { label: '结束时间', value: (c) => c.validTo },
        { label: '创建时间', value: (c) => c.createdAt },
      ],
      views,
    );
  }

  /** 券列表与导出共用的筛选条件 */
  private couponWhere(query: { type?: string; status?: string; keyword?: string }): Prisma.CouponWhereInput {
    return {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { code: { contains: query.keyword.toUpperCase() } },
              { name: { contains: query.keyword } },
            ],
          }
        : {}),
    };
  }

  async getCoupon(id: string) {
    const c = await this.prisma.coupon.findUnique({
      where: { id },
      include: { _count: { select: { orders: true } } },
    });
    if (!c) throw new AppError(40400, '优惠券不存在', 404);
    const pending = await this.pendingReservationCounts([id]);
    return this.toCouponView(c, new Date(), pending.get(id) ?? 0);
  }

  /** 创建券 */
  async createCoupon(dto: any) {
    this.validateCoupon(dto, true);
    const code = dto.code.trim().toUpperCase();

    const dup = await this.prisma.coupon.findUnique({ where: { code } });
    if (dup) throw new AppError(40001, `券码已存在: ${code}`, 400);

    const created = await this.prisma.coupon.create({
      data: {
        code,
        name: dto.name.trim(),
        type: dto.type,
        value: dto.value,
        thresholdCents: dto.thresholdCents ?? 0,
        scope: dto.scope ?? 'all',
        productIds: JSON.stringify(dto.productIds ?? []),
        totalCount: dto.totalCount ?? 0,
        // perUserLimit 不显式给 1: 券码新建时 DTO 未传即为不限, 由校验层保证语义一致
        perUserLimit: dto.perUserLimit ?? 1,
        validFrom: new Date(dto.validFrom),
        validTo: new Date(dto.validTo),
        status: dto.status ?? 'on',
      },
    });
    return this.toCouponView(created, new Date(), 0);
  }

  /** 更新券。券码不可改, 规则改动不追溯已核销订单 (§12.6) */
  async updateCoupon(id: string, dto: any) {
    const existing = await this.prisma.coupon.findUnique({ where: { id } });
    if (!existing) throw new AppError(40400, '优惠券不存在', 404);

    // 合并后再校验: 部分更新时必须拿"改后的完整规则"判断合法性,
    // 否则只改面额就能绕过"折扣不得为 0"这类跨字段约束
    const merged = {
      type: dto.type ?? existing.type,
      value: dto.value ?? existing.value,
      thresholdCents: dto.thresholdCents ?? existing.thresholdCents,
      scope: dto.scope ?? existing.scope,
      validFrom: dto.validFrom ?? existing.validFrom.toISOString(),
      validTo: dto.validTo ?? existing.validTo.toISOString(),
    };
    this.validateCoupon(merged, false);

    if (dto.code && dto.code.trim().toUpperCase() !== existing.code) {
      throw new AppError(40001, '券码不可修改 (已发出的券会失效)', 400);
    }

    const updated = await this.prisma.coupon.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? existing.name,
        type: merged.type,
        value: merged.value,
        thresholdCents: merged.thresholdCents,
        scope: merged.scope,
        ...(dto.productIds ? { productIds: JSON.stringify(dto.productIds) } : {}),
        ...(dto.totalCount !== undefined ? { totalCount: dto.totalCount } : {}),
        ...(dto.perUserLimit !== undefined ? { perUserLimit: dto.perUserLimit } : {}),
        validFrom: new Date(merged.validFrom),
        validTo: new Date(merged.validTo),
        ...(dto.status ? { status: dto.status } : {}),
      },
      include: { _count: { select: { orders: true } } },
    });
    const pending = await this.pendingReservationCounts([id]);
    return this.toCouponView(updated, new Date(), pending.get(id) ?? 0);
  }

  /**
   * 删除券。
   *
   * 只有从未产生过订单的券可以物理删除。已有关联订单时必须保留券行，
   * 否则历史订单的优惠来源会悬空，运营应改为停用。
   */
  async deleteCoupon(id: string) {
    const existing = await this.prisma.coupon.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        _count: { select: { orders: true } },
      },
    });
    if (!existing) throw new AppError(40400, '优惠券不存在', 404);

    const orderCount = existing._count.orders;
    if (orderCount > 0) {
      throw new AppError(
        40901,
        `该优惠券已有 ${orderCount} 笔关联订单，不能删除；请改为停用`,
        409,
      );
    }

    try {
      await this.prisma.coupon.delete({ where: { id } });
    } catch (error) {
      // 预检后仍可能有订单并发写入；统一转成 409，不把外键错误暴露成 500。
      if ((error as { code?: string }).code === 'P2003') {
        throw new AppError(
          40901,
          '该优惠券刚刚产生了关联订单，不能删除；请改为停用',
          409,
        );
      }
      throw error;
    }

    return { id, code: existing.code, name: existing.name };
  }

  /** 启停券。停用不影响已核销订单。 */
  async disableCoupon(id: string) {
    const existing = await this.prisma.coupon.findUnique({ where: { id } });
    if (!existing) throw new AppError(40400, '优惠券不存在', 404);
    const updated = await this.prisma.coupon.update({
      where: { id },
      data: { status: existing.status === 'on' ? 'off' : 'on' },
      include: { _count: { select: { orders: true } } },
    });
    const pending = await this.pendingReservationCounts([id]);
    return this.toCouponView(updated, new Date(), pending.get(id) ?? 0);
  }

  /**
   * 校验券规则合法性。
   *
   * 跨字段约束 (门槛与面额的关系、折扣区间、时间顺序) 只能在 service 做——
   * DTO 的 class-validator 无法访问其他字段的值。
   */
  private validateCoupon(dto: any, creating: boolean) {
    const errors: string[] = [];

    const validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    const validTo = dto.validTo ? new Date(dto.validTo) : null;
    if (creating && (!validFrom || !validTo)) {
      errors.push('生效期与失效时间为必填');
    }
    if (validFrom && validTo && validTo <= validFrom) {
      errors.push('失效时间必须晚于生效时间');
    }

    const threshold = dto.thresholdCents ?? 0;
    const value = dto.value;
    const type = dto.type;

    if (!Number.isInteger(value) || value <= 0) {
      errors.push('面额必须为正整数');
    } else if (type === 'discount') {
      // 万分比: 10000 = 无优惠, >= 10000 等于不打折, 不该建这种券(会让用户以为有优惠)
      if (value >= DISCOUNT_BASE) errors.push('折扣需小于 10 折 (value < 10000)');
      if (value < 1) errors.push('折扣不能低于 0.01 折');
    } else {
      // 满减/固定额: 面额不得超过门槛, 否则"满 100 减 200"会变成负价订单
      if (threshold > 0 && value > threshold) {
        errors.push('减免金额不得超过使用门槛');
      }
    }

    if (dto.scope === 'product' && (!dto.productIds || dto.productIds.length === 0)) {
      errors.push('适用范围为指定商品时必须选择商品');
    }

    if (errors.length) throw new AppError(40001, errors.join('; '), 400);
  }

  /**
   * 校验券资格并计算优惠金额。
   *
   * 返回 discountCents=0 + reason 表示"不可用但不该报错"的情况(如门槛未达),
   * 调用方据此展示提示; 真正的非法输入(券不存在/已停用)才抛错。
   */
  async evaluateCoupon(params: {
    userId: string;
    code: string;
    items: Array<{ productId: string; priceCents: number; quantity: number }>;
    /** 建单事务内传 tx，确保限量与每人限额检查能锁住券行 */
    db?: Prisma.TransactionClient;
    /** 为 true 时先取得 Coupon 行写锁，再统计待支付预占 */
    lockForReservation?: boolean;
  }): Promise<{ discountCents: number; coupon: any; reason: string | null }> {
    const code = params.code.trim().toUpperCase();
    const db = (params.db ?? this.prisma) as Prisma.TransactionClient;
    if (params.lockForReservation) {
      // SQLite 的 deferred BEGIN 不提供读锁升级保证；先 no-op UPDATE 取得写锁，
      // 让同一张券的建单事务串行化。支付核销也必须先锁同一行。
      await db.$executeRaw`
        UPDATE "Coupon" SET "updatedAt" = "updatedAt" WHERE code = ${code}`;
    }
    const coupon = await db.coupon.findUnique({ where: { code } });
    if (!coupon) throw new AppError(40400, `券码不存在: ${code}`, 404);

    const now = new Date();
    const fail = (reason: string) => ({ discountCents: 0, coupon, reason });

    if (coupon.status !== 'on') return fail('优惠券已停用');
    if (now < coupon.validFrom) return fail('尚未到生效时间');
    if (now > coupon.validTo) return fail('已过有效期');

    /*
     * 限量 = 已支付核销 + 待支付预占。
     * 只统计 usedCount 会让并发的待支付订单都能拿到同一张限量券；只统计全部
     * 订单又会把已核销数量重复计算。取消/超时后订单离开 pending，名额自动释放。
     */
    if (coupon.totalCount > 0) {
      const pendingReservations = await db.order.count({
        where: { couponId: coupon.id, status: 'pending' },
      });
      if (coupon.usedCount + pendingReservations >= coupon.totalCount) {
        return fail('优惠券已被领完');
      }
    }

    const subtotal = params.items.reduce((s, i) => s + i.priceCents * i.quantity, 0);
    if (coupon.thresholdCents > 0 && subtotal < coupon.thresholdCents) {
      return fail(`未达使用门槛 (需满 ${(coupon.thresholdCents / 100).toFixed(2)} 元)`);
    }

    // 范围校验
    if (coupon.scope === 'product') {
      const allowed = this.parseJson<string[]>(coupon.productIds, []);
      const hit = params.items.some((i) => allowed.includes(i.productId));
      if (!hit) return fail('订单商品不在优惠券适用范围内');
    }
    if (coupon.scope === 'new_user') {
      const paidCount = await db.order.count({
        where: { userId: params.userId, status: { in: ['paid', 'partial_refunded', 'refunded'] } },
      });
      if (paidCount > 0) return fail('该优惠券仅限未购买过的新用户使用');
    }

    // 每人限用同样把 pending 算作占用，否则同一用户可先挂多笔待支付单绕过限额。
    if (coupon.perUserLimit > 0) {
      const used = await db.order.count({
        where: {
          userId: params.userId,
          couponId: coupon.id,
          status: { in: ['pending', 'paid', 'partial_refunded', 'refunded'] },
        },
      });
      if (used >= coupon.perUserLimit) {
        return fail(`每人限用 ${coupon.perUserLimit} 张, 已用完`);
      }
    }

    const raw = this.calcCouponDiscount(coupon, subtotal);
    return { discountCents: raw, coupon, reason: raw > 0 ? null : '优惠金额为 0' };
  }

  /** 按券类型算优惠额(分)。折扣向下取整到分, 不产生 0.005 分这类浮点尾数 */
  private calcCouponDiscount(coupon: any, subtotal: number): number {
    let discount: number;
    if (coupon.type === 'discount') {
      discount = subtotal - Math.floor((subtotal * coupon.value) / DISCOUNT_BASE);
    } else {
      discount = coupon.value;
    }
    // 优惠不得超过商品总额: 否则应付为负, 退款计算会崩
    return Math.max(0, Math.min(discount, subtotal));
  }

  /** 取得优惠券行写锁。建单预留与支付核销必须使用同一把锁。 */
  async lockCoupon(couponId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`
      UPDATE "Coupon" SET "updatedAt" = "updatedAt" WHERE id = ${couponId}`;
  }

  /**
   * 支付成功后在**同一事务内**核销券: usedCount +1。
   *
   * 下单时已经用 pending 订单预占名额；支付事务先锁券行再置订单 paid 并递增，
   * 与建单侧串行化。这里不再用 `usedCount < totalCount` 条件更新：订单已经
   * 享受了折扣，即使运营事后调低 totalCount，也必须如实记录本次核销。
   */
  async redeemCoupon(
    couponId: string,
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = (tx ?? this.prisma) as Prisma.TransactionClient;
    await this.lockCoupon(couponId, db);

    // 只核销本单在事务内已置为 paid 的券，防止调用方传错订单造成计数漂移。
    const applied = await db.order.count({
      where: { id: orderId, couponId, status: 'paid' },
    });
    if (applied === 0) return;

    const res = await db.coupon.updateMany({
      where: { id: couponId },
      data: { usedCount: { increment: 1 } },
    });
    if (res.count === 0) {
      this.log.warn(`券 ${couponId} 已不存在，订单 ${orderId} 核销未记账`);
    }
  }

/**
   * 券视图。
   *
   * ⚠ **状态刻意拆成两个字段**, 因为读语义与写语义不同:
   *   status    —— 写入用, 两态 (on|off), 是**人工设置**
   *   effective —— 读取用, 五态 (on|off|expired|not_started|sold_out), 是**派生结果**
   * 共用一个字段名会让前端把「券过期了」显示成「券被停用了」,
   * 运营会去找根本不存在的误操作, 而过期与停用的正确处置完全不同。
   */
  private toCouponView(c: any, now: Date, pendingReserved = 0) {
    const notStarted = now < new Date(c.validFrom);
    const expired = now > new Date(c.validTo);
    const occupied = c.usedCount + pendingReserved;
    const soldOut = c.totalCount > 0 && occupied >= c.totalCount;

    const effective: 'on' | 'off' | 'expired' | 'not_started' | 'sold_out' =
      c.status !== 'on'
        ? 'off'
        : expired
          ? 'expired'
          : notStarted
            ? 'not_started'
            : soldOut
              ? 'sold_out'
              : 'on';

    return {
      id: c.id,
      code: c.code,
      name: c.name,
      type: c.type,
      typeLabel: COUPON_TYPE_LABELS[c.type as CouponType] ?? c.type,
      value: c.value,
      /** 展示用面额: 折扣转成"8.5 折", 其余为元 */
      valueLabel:
        c.type === 'discount'
          ? `${(c.value / 1000).toFixed(2).replace(/0$/, '')} 折`
          : `¥${(c.value / 100).toFixed(2)}`,
      thresholdCents: c.thresholdCents,
      thresholdLabel:
        c.thresholdCents > 0 ? `满 ${(c.thresholdCents / 100).toFixed(2)} 元可用` : '无门槛',
      scope: c.scope,
      scopeLabel: COUPON_SCOPE_LABELS[c.scope as CouponScope] ?? c.scope,
      productIds: this.parseJson<string[]>(c.productIds, []),
      totalCount: c.totalCount,
      usedCount: c.usedCount,
      pendingReserved,
      orderCount: c._count?.orders ?? 0,
      remaining: c.totalCount > 0 ? Math.max(0, c.totalCount - occupied) : null,
      perUserLimit: c.perUserLimit,
      validFrom: c.validFrom,
      validTo: c.validTo,
      status: c.status,
      effective,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  /** 批量统计待支付订单对券名额的预占，避免后台视图把已预占的券显示成可售 */
  private async pendingReservationCounts(
    couponIds: string[],
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Map<string, number>> {
    const ids = [...new Set(couponIds.filter(Boolean))];
    if (ids.length === 0) return new Map();

    const rows = await db.order.groupBy({
      by: ['couponId'],
      where: { couponId: { in: ids }, status: 'pending' },
      _count: { _all: true },
    });
    return new Map(
      rows
        .filter((row): row is typeof row & { couponId: string } => Boolean(row.couponId))
        .map((row) => [row.couponId, row._count._all]),
    );
  }

  // ════════════════════════════════════════════════════════════════
  // 限时活动
  // ════════════════════════════════════════════════════════════════

  async listCampaigns(query: {
    page?: number;
    pageSize?: number;
    type?: string;
    status?: string;
    keyword?: string;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 20);
    const skip = (page - 1) * pageSize;

    const where = this.campaignWhere(query);

    const [rows, total, activeCount] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: { _count: { select: { orders: true } } },
      }),
      this.prisma.campaign.count({ where }),
      // 进行中数量单独算: 它取决于**当前时间**而非 status 字段, 列表页要如实反映
      this.prisma.campaign.count({
        where: { status: 'active', startAt: { lte: new Date() }, endAt: { gte: new Date() } },
      }),
    ]);

    const now = new Date();
    return {
      items: rows.map((c) => this.toCampaignView(c, now)),
      total,
      page,
      pageSize,
      summary: { count: total, liveNow: activeCount },
      typeLabels: CAMPAIGN_TYPE_LABELS,
      statusLabels: CAMPAIGN_STATUS_LABELS,
    };
  }

  /**
   * 导出限时活动 (CSV)。
   *
   * 与列表共用 `campaignWhere`。类型/状态导出中文名而不是原始枚举值 ——
   * 这份表格会直接给运营与财务看，`limited_free` 不如「限时免费」可读。
   */
  async exportCampaigns(query: {
    type?: string;
    status?: string;
    keyword?: string;
  }): Promise<string> {
    const rows = await this.prisma.campaign.findMany({
      where: this.campaignWhere(query),
      orderBy: { createdAt: 'desc' },
      take: CSV_EXPORT_MAX_ROWS,
    });
    const now = new Date();
    const views = rows.map((c) => this.toCampaignView(c, now));
    return toCsv(
      [
        { label: '活动名称', value: (c) => c.name },
        { label: '类型', value: (c) => c.typeLabel },
        { label: '状态', value: (c) => c.statusLabel },
        { label: '生效状态', value: (c) => CAMPAIGN_EFFECTIVE_LABELS[c.effective] ?? c.effective },
        { label: '开始时间', value: (c) => c.startAt },
        { label: '结束时间', value: (c) => c.endAt },
        { label: '配置', value: (c) => c.payload },
        { label: '人群', value: (c) => c.audience },
        { label: '创建时间', value: (c) => c.createdAt },
      ],
      views,
    );
  }

  /** 活动列表与导出共用的筛选条件 */
  private campaignWhere(query: {
    type?: string;
    status?: string;
    keyword?: string;
  }): Prisma.CampaignWhereInput {
    return {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword ? { name: { contains: query.keyword } } : {}),
    };
  }

  async createCampaign(dto: any) {
    this.validateCampaign(dto);
    const created = await this.prisma.campaign.create({
      data: {
        name: dto.name.trim(),
        type: dto.type,
        payload: JSON.stringify(dto.payload ?? {}),
        startAt: new Date(dto.startAt),
        endAt: new Date(dto.endAt),
        status: dto.status ?? 'draft',
        audience: JSON.stringify(dto.onlyNewUsers ? { onlyNewUsers: true } : {}),
      },
    });
    return this.toCampaignView(created, new Date());
  }

  async updateCampaign(id: string, dto: any) {
    const existing = await this.prisma.campaign.findUnique({ where: { id } });
    if (!existing) throw new AppError(40400, '活动不存在', 404);

    const merged = {
      type: dto.type ?? existing.type,
      startAt: dto.startAt ?? existing.startAt.toISOString(),
      endAt: dto.endAt ?? existing.endAt.toISOString(),
      payload: dto.payload ?? this.parseJson<Record<string, unknown>>(existing.payload, {}),
    };
    this.validateCampaign(merged);

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? existing.name,
        type: merged.type,
        ...(dto.payload ? { payload: JSON.stringify(dto.payload) } : {}),
        startAt: new Date(merged.startAt),
        endAt: new Date(merged.endAt),
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.onlyNewUsers !== undefined
          ? { audience: JSON.stringify(dto.onlyNewUsers ? { onlyNewUsers: true } : {}) }
          : {}),
      },
    });
    return this.toCampaignView(updated, new Date());
  }

  async disableCampaign(id: string) {
    const existing = await this.prisma.campaign.findUnique({ where: { id } });
    if (!existing) throw new AppError(40400, '活动不存在', 404);
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: existing.status === 'off' ? 'active' : 'off' },
    });
    return this.toCampaignView(updated, new Date());
  }

  /**
   * 删除活动。
   *
   * `Order.campaignId` 是 RESTRICT 外键：已经有订单使用过该活动的优惠时，
   * 物理删除会让历史订单无法追溯优惠来源，因此只允许删除从未产生订单的活动。
   * 有关联订单时给出可执行提示——改为下线，保住历史对账链路。
   */
  async deleteCampaign(id: string) {
    const existing = await this.prisma.campaign.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: { select: { orders: true } },
      },
    });
    if (!existing) throw new AppError(40400, '活动不存在', 404);

    const orderCount = existing._count.orders;
    if (orderCount > 0) {
      throw new AppError(
        40901,
        `该活动已有 ${orderCount} 笔关联订单，不能删除；请改为下线`,
        409,
      );
    }

    try {
      await this.prisma.campaign.delete({ where: { id } });
    } catch (error) {
      // 预检后仍可能有订单并发写入；统一转成 409，不把外键错误暴露成 500。
      if ((error as { code?: string }).code === 'P2003') {
        throw new AppError(
          40901,
          '该活动刚刚产生了关联订单，不能删除；请改为下线',
          409,
        );
      }
      throw error;
    }

    return { id, name: existing.name };
  }

  private validateCampaign(dto: any) {
    const errors: string[] = [];
    const start = new Date(dto.startAt);
    const end = new Date(dto.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      errors.push('活动时间格式非法');
    } else if (end <= start) {
      errors.push('结束时间必须晚于开始时间');
    }

    // payload 必须与 type 匹配: 建一个没有 productId 的限时价活动,
    // 上线后结算时才发现没价格可覆盖, 此时已对外投放
    const payload = dto.payload ?? {};
    if (dto.type === 'limited_price') {
      if (!payload.productId) errors.push('限时价活动必须指定商品');
      if (!Number.isInteger(payload.priceCents) || payload.priceCents < 0) {
        errors.push('限时价活动必须指定活动价(分)');
      }
    } else if (dto.type === 'limited_free') {
      if (!Array.isArray(payload.capabilityIds) || payload.capabilityIds.length === 0) {
        errors.push('限时免费活动必须指定能力');
      }
    } else if (dto.type === 'popup') {
      if (!payload.title) errors.push('弹窗活动必须填写标题');
      // 外链会引入钓鱼与合规风险, 站内相对路径之外一律拒绝
      if (payload.ctaUrl && !payload.ctaUrl.startsWith('/')) {
        errors.push('弹窗按钮仅支持站内相对路径');
      }
    }

    if (errors.length) throw new AppError(40001, errors.join('; '), 400);
  }

  /**
   * 找出当前对指定商品生效的限时价活动。
   *
   * 多个限时价同时命中同一商品时取**最低价** —— 与券的"不叠加取更优"同一取向。
   * 商品只查一次 (此前在循环内查, 同商品多活动时会重复打库)。
   */
  async findLimitedPriceCampaign(
    productId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
    userId?: string,
  ): Promise<{ id: string; priceCents: number; campaignName: string } | null> {
    const now = new Date();

    // 商品不可售时一律不生效: 下架商品不该再被活动拉回可购买状态
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { priceCents: true, status: true },
    });
    if (!product || product.status !== 'active') return null;

    const rows = await db.campaign.findMany({
      where: { type: 'limited_price', status: 'active', startAt: { lte: now }, endAt: { gte: now } },
    });

    let best: { id: string; priceCents: number; campaignName: string } | null = null;
    const eligibleNewUser = userId ? await this.isNewUser(userId, db) : null;
    for (const c of rows) {
      if (!this.audienceMatches(c.audience, eligibleNewUser)) continue;
      const payload = this.parseJson<{ productId?: string; priceCents?: number }>(c.payload, {});
      if (payload.productId !== productId || !Number.isInteger(payload.priceCents)) continue;

      // 活动价高于原价时按原价计 —— 名为"限时优惠"却更贵是配置错误,
      // 不能让它变成涨价 (这里夹到原价而不是报错, 结算链路不因配置错误中断)
      const price = Math.min(payload.priceCents as number, product.priceCents);
      if (!best || price < best.priceCents) {
        best = { id: c.id, priceCents: price, campaignName: c.name };
      }
    }
    return best;
  }

  /** 当前生效的弹窗活动 (C 端 PromoBar / 落地页弹窗位) */
  async activePopupCampaign(userId?: string): Promise<{
    id: string;
    title: string;
    body: string;
    ctaText: string;
    ctaUrl: string;
    startAt: string;
    endAt: string;
    /** 服务端当前时间戳 —— 前端倒计时基准, 不得本地自减 */
    serverNow: string;
  } | null> {
    const now = new Date();
    const rows = await this.prisma.campaign.findMany({
      where: { type: 'popup', status: 'active', startAt: { lte: now }, endAt: { gte: now } },
      orderBy: { startAt: 'desc' },
    });

    for (const c of rows) {
      const audience = this.parseJson<{ onlyNewUsers?: boolean }>(c.audience, {});
      if (audience.onlyNewUsers && userId) {
        const paidCount = await this.prisma.order.count({
          where: { userId, status: { in: ['paid', 'partial_refunded', 'refunded'] } },
        });
        if (paidCount > 0) continue; // 已购用户不属新客, 跳过该活动
      }
      const payload = this.parseJson<{ title?: string; body?: string; ctaText?: string; ctaUrl?: string }>(
        c.payload,
        {},
      );
      return {
        id: c.id,
        title: payload.title ?? c.name,
        body: payload.body ?? '',
        ctaText: payload.ctaText ?? '立即查看',
        ctaUrl: payload.ctaUrl ?? '/packages',
        startAt: c.startAt.toISOString(),
        endAt: c.endAt.toISOString(),
        serverNow: now.toISOString(),
      };
    }
    return null;
  }

  /**
   * 进行中的促销活动（C 端落地页「限时活动」页签）。
   *
   * 只回两种真正影响价格的类型：
   *   - `limited_price` —— 带上目标商品与**实际生效的活动价**（取与原价的较小值，
   *     与 `findLimitedPriceCampaign` 同一口径，不在展示层另算一套）
   *   - `limited_free`  —— 带上免费覆盖的能力 id
   *
   * 商品已下架、或活动价并不低于原价的，一律不展示：对外宣传一个点进去
   * 并不存在的优惠，比不展示更糟。`popup` 走 `activePopupCampaign`（带人群定向），
   * 不进这个列表 —— 弹窗位不是「套餐区的一个页签」。
   */
  async activeCampaigns(userId?: string): Promise<
    Array<{
      id: string;
      name: string;
      type: 'limited_price' | 'limited_free';
      startAt: string;
      endAt: string;
      product?: { id: string; sku: string; name: string; priceCents: number };
      priceCents?: number;
      capabilityIds?: string[];
    }>
  > {
    const now = new Date();
    const rows = await this.prisma.campaign.findMany({
      where: {
        type: { in: ['limited_price', 'limited_free'] },
        status: 'active',
        startAt: { lte: now },
        endAt: { gte: now },
      },
      orderBy: { startAt: 'asc' },
    });
    if (rows.length === 0) return [];

    const eligibleNewUser = userId ? await this.isNewUser(userId, this.prisma) : null;

    const productIds = rows
      .map((c) => this.parseJson<{ productId?: string }>(c.payload, {}).productId)
      .filter((id): id is string => Boolean(id));
    const products =
      productIds.length > 0
        ? await this.prisma.product.findMany({
            where: { id: { in: productIds }, status: 'active' },
            select: { id: true, sku: true, name: true, priceCents: true },
          })
        : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    const out: Array<{
      id: string;
      name: string;
      type: 'limited_price' | 'limited_free';
      startAt: string;
      endAt: string;
      product?: { id: string; sku: string; name: string; priceCents: number };
      priceCents?: number;
      capabilityIds?: string[];
    }> = [];

    for (const c of rows) {
      // 匿名访问保留“仅新用户”活动用于拉新；已登录用户则必须按真实新客状态过滤。
      if (!this.audienceMatches(c.audience, eligibleNewUser)) continue;
      if (c.type === 'limited_price') {
        const payload = this.parseJson<{ productId?: string; priceCents?: number }>(c.payload, {});
        const product = payload.productId ? productById.get(payload.productId) : undefined;
        if (!product || !Number.isInteger(payload.priceCents)) continue;
        const priceCents = Math.min(payload.priceCents as number, product.priceCents);
        if (priceCents >= product.priceCents) continue;
        out.push({
          id: c.id,
          name: c.name,
          type: 'limited_price',
          startAt: c.startAt.toISOString(),
          endAt: c.endAt.toISOString(),
          product,
          priceCents,
        });
      } else {
        const payload = this.parseJson<{ capabilityIds?: string[] }>(c.payload, {});
        const capabilityIds = Array.isArray(payload.capabilityIds) ? payload.capabilityIds : [];
        if (capabilityIds.length === 0) continue;
        out.push({
          id: c.id,
          name: c.name,
          type: 'limited_free',
          startAt: c.startAt.toISOString(),
          endAt: c.endAt.toISOString(),
          capabilityIds,
        });
      }
    }
    return out;
  }

  /** 限时免费当前覆盖的能力 id 集合 (供生成链路判定免积分) */
  async freeCapabilityIds(userId?: string): Promise<Set<string>> {
    const now = new Date();
    const rows = await this.prisma.campaign.findMany({
      where: { type: 'limited_free', status: 'active', startAt: { lte: now }, endAt: { gte: now } },
      select: { payload: true, audience: true },
    });
    const eligibleNewUser = userId ? await this.isNewUser(userId, this.prisma) : null;
    const set = new Set<string>();
    for (const r of rows) {
      if (!this.audienceMatches(r.audience, eligibleNewUser)) continue;
      const payload = this.parseJson<{ capabilityIds?: string[] }>(r.payload, {});
      for (const id of payload.capabilityIds ?? []) set.add(id);
    }
    return set;
  }

  /**
   * 到期活动收尾 (调度器调用)。
   *
   * 把 endAt 已过但 status 仍为 active 的活动置为 ended。
   *
   * ⚠ **不恢复 Product.priceCents**: 限时价从不写商品本体价格(见 schema 注释),
   * 所以"到期恢复"天然成立 —— 这里只改状态, 没有需要回滚的副作用。
   * 这正是当初不落Product 表的理由, 若改成落表, 这里就得补还原逻辑且容易漏。
   */
  async expireCampaigns(): Promise<number> {
    const now = new Date();
    const res = await this.prisma.campaign.updateMany({
      where: { status: 'active', endAt: { lt: now } },
      data: { status: 'ended' },
    });
    if (res.count > 0) this.log.log(`活动到期自动结束: ${res.count} 个`);
    return res.count;
  }

  private toCampaignView(c: any, now: Date) {
    const payload = this.parseJson<Record<string, unknown>>(c.payload, {});
    const notStarted = now < new Date(c.startAt);
    const expired = now > new Date(c.endAt);
    const live = c.status === 'active' && !notStarted && !expired;

    // 生效态独立于 status 字段: status='active' 但时间窗未到, 对用户就是不生效。
    // 后台列表必须分开显示, 否则运营会以为活动已在跑
    const effective: 'draft' | 'live' | 'scheduled' | 'ended' | 'off' =
      c.status === 'off' ? 'off' : notStarted ? 'scheduled' : expired ? 'ended' : live ? 'live' : 'draft';

    return {
      id: c.id,
      name: c.name,
      type: c.type,
      typeLabel: CAMPAIGN_TYPE_LABELS[c.type as CampaignType] ?? c.type,
      payload,
      startAt: c.startAt,
      endAt: c.endAt,
      status: c.status,
      statusLabel: CAMPAIGN_STATUS_LABELS[c.status as CampaignStatus] ?? c.status,
      effective,
      audience: this.parseJson<Record<string, unknown>>(c.audience, {}),
      orderCount: c._count?.orders ?? 0,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // 结算编排: 券 vs 活动, 不叠加取更优 (§12.6)
  // ════════════════════════════════════════════════════════════════

  /**
   * 结算优惠计算入口。
   *
   * @param couponCode 用户输入的券码, 可为空(纯用活动优惠)
   * @param campaignIds 用户勾选参与的活动; 省略时**自动匹配**所有命中商品的在架活动 ——
   *   自动匹配是默认行为: 限时价的意义就是"到点自动生效", 要求用户手选活动
   *   会让活动形同虚设。传空数组则显式表示"不参与任何活动"。
   */
  async settleDiscount(params: {
    userId: string;
    items: Array<{ productId: string; priceCents: number; quantity: number }>;
    couponCode?: string | null;
    campaignIds?: string[];
    /** 建单事务内传入，所有校验与最终优惠计算都读取同一事务快照 */
    tx?: Prisma.TransactionClient;
    /** 在事务内首次计算券时一并取得 Coupon 行写锁 */
    lockCouponForReservation?: boolean;
  }): Promise<DiscountResult> {
    const db = (params.tx ?? this.prisma) as Prisma.TransactionClient;
    const empty: DiscountResult = {
      discountCents: 0,
      source: null,
      couponId: null,
      couponCode: null,
      campaignId: null,
      snapshot: {},
    };

    // 活动侧。逐商品找当前生效的限时价, 取对整个订单总优惠最大的那个活动
    let campaignBest: {
      id: string;
      discount: number;
      name: string;
      snapshot: Record<string, unknown>;
    } | null = null;

    // undefined = 自动匹配当前所有生效活动；[] = 用户明确不参与活动；
    // 非空数组 = 只考虑指定活动。三种语义必须可区分，否则空数组会悄悄变成自动匹配。
    const explicit = params.campaignIds !== undefined ? params.campaignIds : null;
    const productIds = params.items.map((i) => i.productId);

    const now = new Date();
    const rows =
      explicit?.length === 0
        ? []
        : await db.campaign.findMany({
            where: {
              type: 'limited_price',
              status: 'active',
              startAt: { lte: now },
              endAt: { gte: now },
              ...(explicit ? { id: { in: explicit } } : {}),
            },
          });
    const eligibleNewUser = await this.isNewUser(params.userId, db);

    for (const c of rows) {
      if (!this.audienceMatches(c.audience, eligibleNewUser)) continue;
      const payload = this.parseJson<{ productId?: string; priceCents?: number }>(c.payload, {});
      if (!payload.productId || !Number.isInteger(payload.priceCents)) continue;
      if (!productIds.includes(payload.productId)) continue;

      // 自动匹配时二次校验商品仍在架且活动价不高于原价:
      // build 时商品可能已下架, 或活动价被误配成高于原价(名为优惠实为涨价)
      if (!explicit) {
        const verified = await this.findLimitedPriceCampaign(payload.productId, db, params.userId);
        if (!verified || verified.id !== c.id) continue;
      }

      const matched = params.items.filter((i) => i.productId === payload.productId);
      const quantity = matched.reduce((s, i) => s + i.quantity, 0);
      // 多个订单项同商品时以最低单价为基准算一次, 避免按不同快照价重复计优惠
      const basePriceCents = Math.min(...matched.map((i) => i.priceCents));
      const campaignPriceCents = Math.min(payload.priceCents as number, basePriceCents);
      const discount = Math.max(0, basePriceCents - campaignPriceCents) * quantity;
      if (discount <= 0) continue;

      if (!campaignBest || discount > campaignBest.discount) {
        campaignBest = {
          id: c.id,
          discount,
          name: c.name,
          snapshot: {
            type: 'campaign',
            campaignId: c.id,
            campaignName: c.name,
            productId: payload.productId,
            basePriceCents,
            campaignPriceCents,
            quantity,
            discountCents: discount,
            capturedAt: new Date().toISOString(),
          },
        };
      }
    }

    // 券侧
    let couponBest: { id: string; code: string; discount: number; snapshot: Record<string, unknown> } | null =
      null;
    let couponWarning: string | null = null;

    if (params.couponCode?.trim()) {
      const evaluated = await this.evaluateCoupon({
        userId: params.userId,
        code: params.couponCode,
        items: params.items,
        db,
        lockForReservation: params.lockCouponForReservation,
      });
      if (evaluated.reason) {
        couponWarning = evaluated.reason;
      } else if (evaluated.discountCents > 0) {
        const c = evaluated.coupon;
        couponBest = {
          id: c.id,
          code: c.code,
          discount: evaluated.discountCents,
          snapshot: {
            type: 'coupon',
            couponId: c.id,
            couponCode: c.code,
            couponName: c.name,
            couponType: c.type,
            couponValue: c.value,
            thresholdCents: c.thresholdCents,
            scope: c.scope,
            discountCents: evaluated.discountCents,
            // 快照时间: 事后券规则改动不影响此单, 靠这个字段还原当时规则
            capturedAt: new Date().toISOString(),
          },
        };
      }
    }

    // 取更优者, 平手取券 (券是用户主动输入的, 优先满足显式意图)
    const couponAmt = couponBest?.discount ?? 0;
    const campaignAmt = campaignBest?.discount ?? 0;

    if (campaignAmt > couponAmt && campaignBest) {
      return {
        discountCents: campaignAmt,
        source: 'campaign',
        couponId: null,
        couponCode: null,
        campaignId: campaignBest.id,
        snapshot: {
          ...campaignBest.snapshot,
          ...(couponWarning ? { couponWarning } : {}),
          notStacked: couponAmt > 0 ? { couponCode: couponBest?.code, couponDiscount: couponAmt } : undefined,
        },
      };
    }
    if (couponBest) {
      return {
        discountCents: couponAmt,
        source: 'coupon',
        couponId: couponBest.id,
        couponCode: couponBest.code,
        campaignId: null,
        snapshot: {
          ...couponBest.snapshot,
          ...(campaignAmt > 0 ? { notStacked: { campaignId: campaignBest.id, campaignDiscount: campaignAmt } } : {}),
        },
      };
    }
    return { ...empty, snapshot: couponWarning ? { couponWarning } : {} };
  }

  /** C 端: 试算可用券 (不核销, 仅展示) */
  async previewCoupons(params: {
    userId: string;
    items: Array<{ productId: string; priceCents: number; quantity: number }>;
  }) {
    const now = new Date();
    // 放量上限: 全站券表可能很大, 逐张 evaluateCoupon 会 N+1 打库。
    // 只取最近创建且可能生效的前 50 张做试算, 够展示而不拖慢结算页
    const candidates = await this.prisma.coupon.findMany({
      where: { status: 'on', validFrom: { lte: now }, validTo: { gte: now } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const usable: Array<{ id: string; code: string; name: string; discountCents: number; valueLabel: string; thresholdLabel: string }> = [];
    for (const c of candidates) {
      const r = await this.evaluateCoupon({ userId: params.userId, code: c.code, items: params.items });
      if (r.reason || r.discountCents <= 0) continue;
      usable.push({
        id: c.id,
        code: c.code,
        name: c.name,
        discountCents: r.discountCents,
        valueLabel: this.toCouponView(c, now).valueLabel,
        thresholdLabel: this.toCouponView(c, now).thresholdLabel,
      });
    }
    usable.sort((a, b) => b.discountCents - a.discountCents);
    return usable;
  }

  // ════════════════════════════════════════════════════════════════
  // 邀请分销
  // ════════════════════════════════════════════════════════════════

  /** 读取邀请规则 (不存在则返回默认值, 不自动落库 —— 读取不该有副作用) */
  async getInviteRule() {
    const row = await this.prisma.inviteRewardRule.findUnique({ where: { id: 'default' } });
    return {
      inviterCredits: row?.inviterCredits ?? 0,
      inviteeCredits: row?.inviteeCredits ?? 0,
      triggerOn: row?.triggerOn ?? 'first_pay',
      valid: row?.valid ?? true,
      updatedAt: row?.updatedAt ?? null,
      /** 未配置过 —— 前端据此提示"当前未配置奖励, 邀请不会发放积分" */
      configured: Boolean(row),
    };
  }

  async updateInviteRule(dto: any) {
    const row = await this.prisma.inviteRewardRule.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        inviterCredits: dto.inviterCredits,
        inviteeCredits: dto.inviteeCredits,
        triggerOn: dto.triggerOn,
        valid: dto.valid ?? true,
      },
      update: {
        inviterCredits: dto.inviterCredits,
        inviteeCredits: dto.inviteeCredits,
        triggerOn: dto.triggerOn,
        valid: dto.valid ?? true,
      },
    });
    return this.getInviteRule().then((r) => ({ ...r, updatedAt: row.updatedAt }));
  }

  /**
   * 获取或生成用户邀请码 (惰性生成, 幂等)。
   *
   * 码取自 `User.inviteCode` (unique), 不放在 InviteRelation:
   * 从码反查邀请人必须可靠, 而关系表里没有"从未邀请过任何人"的记录,
   * 若码只存在关系表, 这类用户将永远无法生成邀请链接。
   *
   * 生成规则: id 尾 6 位大写 + 2 位校验位。
   * 用可读的字母数字而非纯随机串 —— 邀请码要能被人抄写/口述。
   * 校验位不参与业务判定, 只帮助用户发现抄错 (输入时校验不符直接拒绝,
   * 比去查库发现"码不存在"更快也更明确)。
   */
  async ensureInviteCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, inviteCode: true },
    });
    if (!user) throw new AppError(40400, '用户不存在', 404);
    if (user.inviteCode) return user.inviteCode;

    const base = user.id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase().padStart(6, 'X');
    const candidate = base + checksumOf(base);

    // 撞码极罕见(尾部 6 位相同才会), 但唯一约束必须兜住, 不能靠概率
    let code = candidate;
    for (let i = 0; i < 5 && (await this.inviteCodeTaken(code, userId)); i++) {
      code = base + checksumOf(base + String(i));
    }
    await this.prisma.user.update({ where: { id: userId }, data: { inviteCode: code } });
    return code;
  }

  private async inviteCodeTaken(code: string, exceptUserId: string): Promise<boolean> {
    const holder = await this.prisma.user.findUnique({
      where: { inviteCode: code },
      select: { id: true },
    });
    return Boolean(holder && holder.id !== exceptUserId);
  }

  /**
   * 绑定邀请关系 (注册时调用)。
   *
   * ⚠ 拒绝条件 (§12.6): 空码、码不存在、自邀请、已被绑定、已付费。
   * **自邀请必须拒**: 否则用户自己注册小号刷邀请积分, 是最直接的资损路径。
   * **已绑定不覆盖**: 覆盖会让先到的邀请人丢失已发放奖励的归属, 对账无从归因。
   * **已付费不绑定**: 否则用户先付款、后补邀请码，下一笔订单就能冒领“首次付费”奖励。
   */
  async bindInvite(params: { inviteCode: string; inviteeId: string }) {
    const code = params.inviteCode.trim().toUpperCase();
    if (!code) return { bound: false, reason: 'empty_code' };

    const outcome = await this.prisma.$transaction(async (tx) => {
      // 与 OrderService.markPaid 使用同一把锁，关闭“已付费检查通过后、创建
      // 关系前恰好完成支付”的窗口。锁必须先于所有读取。
      await lockUserRow(tx, params.inviteeId);

      const [inviter, existing, paidCount] = await Promise.all([
        tx.user.findUnique({
          where: { inviteCode: code },
          select: { id: true },
        }),
        tx.inviteRelation.findUnique({ where: { inviteeId: params.inviteeId } }),
        tx.order.count({
          where: {
            userId: params.inviteeId,
            status: { in: ['paid', 'partial_refunded', 'refunded'] },
          },
        }),
      ]);
      if (!inviter) return { bound: false as const, reason: 'code_not_found' };
      if (inviter.id === params.inviteeId) {
        return { bound: false as const, reason: 'self_invite' };
      }
      if (existing) return { bound: false as const, reason: 'already_bound' };
      if (paidCount > 0) return { bound: false as const, reason: 'already_paid' };

      try {
        const created = await tx.inviteRelation.create({
          data: {
            inviteCode: code,
            inviterId: inviter.id,
            inviteeId: params.inviteeId,
            rewardStatus: 'pending',
          },
        });
        return { bound: true as const, relationId: created.id };
      } catch (error) {
        // 并发绑定由 inviteeId 唯一约束裁决，重复请求按已绑定返回而不是抛 500。
        if (isUniqueViolation(error)) {
          return { bound: false as const, reason: 'already_bound' };
        }
        throw error;
      }
    });
    if (!outcome.bound) return outcome;

    // 规则为 register 时立即发放
    const rule = await this.getInviteRule();
    if (rule.configured && rule.valid && rule.triggerOn === 'register') {
      await this.grantInviteReward(outcome.relationId);
    }
    return outcome;
  }

  /**
   * 发放邀请奖励。
   *
   * **幂等**: 条件更新 rewardStatus 从 pending → granted, 影响 0 行即已发过。
   * 支付回调会重复到达, 没有这道闸就是重复发积分。
   */
  async grantInviteReward(relationId: string): Promise<{ granted: boolean; credits: number }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const relation = await tx.inviteRelation.findUnique({ where: { id: relationId } });
      if (!relation || relation.rewardStatus !== 'pending') {
        return { granted: false, credits: 0 };
      }

      const rule = await tx.inviteRewardRule.findUnique({ where: { id: 'default' } });
      // 未配置或已关闭时不抢占 pending；规则重新开启后仍可补发。
      if (!rule || !rule.valid) return { granted: false, credits: 0 };

      // 条件更新是并发去重闸门。它与两笔积分发放处于同一事务：
      // 任一笔发放失败都会回滚为 pending，重复回调可以完整重试。
      const claimed = await tx.inviteRelation.updateMany({
        where: { id: relationId, rewardStatus: 'pending' },
        data: { rewardStatus: 'granted' },
      });
      if (claimed.count === 0) return { granted: false, credits: 0 };

      let total = 0;
      if (rule.inviterCredits > 0) {
        await this.credit.grant(
          {
            userId: relation.inviterId,
            credits: rule.inviterCredits,
            source: 'grant',
            reason: `邀请奖励 (${relation.inviteeId.slice(-6)})`,
            idempotencyKey: `invite:${relation.id}:inviter`,
          },
          tx,
        );
        total += rule.inviterCredits;
      }
      if (rule.inviteeCredits > 0) {
        await this.credit.grant(
          {
            userId: relation.inviteeId,
            credits: rule.inviteeCredits,
            source: 'grant',
            reason: '新用户邀请奖励',
            idempotencyKey: `invite:${relation.id}:invitee`,
          },
          tx,
        );
        total += rule.inviteeCredits;
      }
      return { granted: true, credits: total };
    });

    if (result.granted) {
      this.log.log(`邀请奖励已发放: 关系 ${relationId}, 合计 ${result.credits} 积分`);
    }
    return result;
  }

  /** 支付成功后触发: 首次付费的被邀请人, 关系转granted */
  async onOrderPaid(userId: string): Promise<void> {
    const relation = await this.prisma.inviteRelation.findUnique({
      where: { inviteeId: userId },
    });
    if (!relation || relation.rewardStatus !== 'pending') return;

    const rule = await this.getInviteRule();
    if (!rule.configured || !rule.valid || rule.triggerOn !== 'first_pay') return;

    await this.grantInviteReward(relation.id);
  }

  /** 我的邀请数据 (C 端 /invitations，支持 limit/offset 分页) */
  async myInvites(userId: string, options: { limit?: number; offset?: number } = {}) {
    const inviteCode = await this.ensureInviteCode(userId);
    const rule = await this.getInviteRule();
    const take = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
    const skip = Math.max(Number(options.offset) || 0, 0);

    const [relations, total, granted, pending] = await Promise.all([
      this.prisma.inviteRelation.findMany({
        where: { inviterId: userId },
        orderBy: { boundAt: 'desc' },
        skip,
        take,
        include: { invitee: { select: { id: true, name: true, email: true, createdAt: true } } },
      }),
      this.prisma.inviteRelation.count({ where: { inviterId: userId } }),
      this.prisma.inviteRelation.count({ where: { inviterId: userId, rewardStatus: 'granted' } }),
      this.prisma.inviteRelation.count({ where: { inviterId: userId, rewardStatus: 'pending' } }),
    ]);

    // 累计收益 = 已发放关系数 × 邀请人奖励。pending 不计入 —— 未发放的不能算收益,
    // 否则用户看到"已赚 400"但积分账户里没有, 是可被认定为虚假宣传的
    const earnedCredits = granted * rule.inviterCredits;

    return {
      inviteCode,
      rule,
      enabled: rule.configured && rule.valid && (rule.inviterCredits > 0 || rule.inviteeCredits > 0),
      metrics: {
        totalInvited: total,
        rewardedCount: granted,
        pendingCount: pending,
        earnedCredits,
        // 好友付费后可得的积分 (按当前规则推算, 规则可能调整, 故标注为估算)
        pendingCredits: pending * rule.inviterCredits,
      },
      relations: relations.map((r) => ({
        id: r.id,
        boundAt: r.boundAt,
        rewardStatus: r.rewardStatus,
        inviteeName: maskName(r.invitee.name, r.invitee.email),
      })),
    };
  }

  /** 邀请关系列表 (后台) */
  async listInvites(query: { page?: number; pageSize?: number; rewardStatus?: string; keyword?: string }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 20);
    const where: Prisma.InviteRelationWhereInput = {
      ...(query.rewardStatus ? { rewardStatus: query.rewardStatus } : {}),
      ...(query.keyword
        ? {
            OR: [
              { inviteCode: { contains: query.keyword.toUpperCase() } },
              { inviter: { email: { contains: query.keyword } } },
              { invitee: { email: { contains: query.keyword } } },
            ],
          }
        : {}),
    };

    const [rows, total, stat] = await Promise.all([
      this.prisma.inviteRelation.findMany({
        where,
        orderBy: { boundAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          inviter: { select: { id: true, email: true, name: true } },
          invitee: { select: { id: true, email: true, name: true } },
        },
      }),
      this.prisma.inviteRelation.count({ where }),
      this.prisma.inviteRelation.groupBy({ by: ['rewardStatus'], _count: true }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        inviteCode: r.inviteCode,
        inviterEmail: r.inviter.email,
        inviterName: r.inviter.name,
        inviteeEmail: r.invitee.email,
        inviteeName: r.invitee.name,
        boundAt: r.boundAt,
        rewardStatus: r.rewardStatus,
      })),
      total,
      page,
      pageSize,
      summary: {
        pending: stat.find((s) => s.rewardStatus === 'pending')?._count ?? 0,
        granted: stat.find((s) => s.rewardStatus === 'granted')?._count ?? 0,
      },
    };
  }

  /** 手动补发邀请奖励 (后台) */
  async grantInviteRewardById(id: string) {
    const r = await this.grantInviteReward(id);
    if (!r.granted) throw new AppError(40901, '该关系已发放过或规则未开启', 409);
    return r;
  }

  // ════════════════════════════════════════════════════════════════
  // 签到
  // ════════════════════════════════════════════════════════════════

  async getCheckinRule() {
    const row = await this.prisma.checkinRule.findUnique({ where: { id: 'default' } });
    return {
      baseCredits: row?.baseCredits ?? 5,
      bonusRules: this.parseJson<Array<{ day: number; bonus: number }>>(row?.bonusRules ?? '[]', []),
      maxStreak: row?.maxStreak ?? 0,
      dailyCap: row?.dailyCap ?? 0,
      enabled: row?.enabled ?? true,
      updatedAt: row?.updatedAt ?? null,
      configured: Boolean(row),
    };
  }

  async updateCheckinRule(dto: any) {
    this.validateCheckinRule(dto);

    // 同一 day 不允许配置多次。静默取最大值会让后台看到的规则与实际发分不一致。
    const bonusByDay = new Map<number, number>();
    for (const b of dto.bonusRules) {
      if (bonusByDay.has(b.day)) {
        throw new AppError(40001, `连续签到第 ${b.day} 天重复配置`, 400);
      }
      bonusByDay.set(b.day, b.bonus);
    }
    const bonusRules = [...bonusByDay.entries()]
      .map(([day, bonus]) => ({ day, bonus }))
      .sort((a, b) => a.day - b.day);

    await this.prisma.checkinRule.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        baseCredits: dto.baseCredits,
        bonusRules: JSON.stringify(bonusRules),
        maxStreak: dto.maxStreak ?? 0,
        dailyCap: dto.dailyCap ?? 0,
        enabled: dto.enabled ?? true,
      },
      update: {
        baseCredits: dto.baseCredits,
        bonusRules: JSON.stringify(bonusRules),
        maxStreak: dto.maxStreak ?? 0,
        dailyCap: dto.dailyCap ?? 0,
        enabled: dto.enabled ?? true,
      },
    });
    return this.getCheckinRule();
  }

  /** service 层兜底校验：即使绕过 DTO（脚本/内部调用）也不能写入非法规则。 */
  private validateCheckinRule(dto: any): void {
    if (!dto || typeof dto !== 'object') {
      throw new AppError(40001, '签到规则格式不正确', 400);
    }
    if (!Number.isInteger(dto.baseCredits) || dto.baseCredits < 0) {
      throw new AppError(40001, '基础积分必须是非负整数', 400);
    }
    if (
      dto.maxStreak !== undefined &&
      (!Number.isInteger(dto.maxStreak) || dto.maxStreak < 0)
    ) {
      throw new AppError(40001, '连续签到上限必须是非负整数', 400);
    }
    if (
      dto.dailyCap !== undefined &&
      (!Number.isInteger(dto.dailyCap) || dto.dailyCap < 0)
    ) {
      throw new AppError(40001, '每日积分上限必须是非负整数', 400);
    }
    if (dto.enabled !== undefined && typeof dto.enabled !== 'boolean') {
      throw new AppError(40001, '签到启用状态必须是布尔值', 400);
    }
    if (dto.bonusRules !== undefined && !Array.isArray(dto.bonusRules)) {
      throw new AppError(40001, '签到加成必须是数组', 400);
    }
    for (const bonus of dto.bonusRules ?? []) {
      if (!Number.isInteger(bonus?.day) || bonus.day <= 0) {
        throw new AppError(40001, '加成天数必须是正整数', 400);
      }
      if (!Number.isInteger(bonus?.bonus) || bonus.bonus < 0) {
        throw new AppError(40001, '加成积分必须是非负整数', 400);
      }
    }
  }

  /** 本地日期 YYYY-MM-DD。用本地时区而非 UTC: 签到是"用户所在地的今天" */
  private localDay(d = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * 计算当前连续签到天数。
   *
   * 从今天往前数连续存在的签到日。**今天没签不算断** —— 断签要到明天才成立,
   * 否则用户白天没来得及签, 界面就显示"已断签 1 天", 属误报。
   */
  /** 有效连签天数 = min(真实连续天数, maxStreak)；0 表示不封顶 */
  private capStreak(streak: number, maxStreak: number): number {
    return maxStreak > 0 ? Math.min(streak, maxStreak) : streak;
  }

  private async calcStreak(userId: string, maxStreak = 0): Promise<number> {
    const records = await this.prisma.checkinRecord.findMany({
      where: { userId },
      orderBy: { day: 'desc' },
      // 达到 maxStreak 后无需继续加载更早历史，避免长签到用户无界扫描。
      take: maxStreak > 0 ? Math.max(1, maxStreak) : 400,
      select: { day: true },
    });
    if (records.length === 0) return 0;

    const days = new Set(records.map((r) => r.day));
    const cursor = new Date();
    // 今天未签 → 从昨天开始数
    if (!days.has(this.localDay(cursor))) cursor.setDate(cursor.getDate() - 1);

    let streak = 0;
    while (days.has(this.localDay(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
      if (maxStreak > 0 ? streak >= maxStreak : streak >= 400) break;
    }
    return this.capStreak(streak, maxStreak);
  }

  /** 签到状态 (今日是否已签 + 可得积分) */
  async checkinStatus(userId: string) {
    const rule = await this.getCheckinRule();
    const today = this.localDay();
    const done = await this.prisma.checkinRecord.findUnique({
      where: { userId_day: { userId, day: today } },
    });
    const streak = await this.calcStreak(userId, rule.maxStreak);
    const nextStreak = done ? streak : this.capStreak(streak + 1, rule.maxStreak);
    const preview = this.calcCheckinCredits(rule, nextStreak);

    return {
      rule,
      today,
      checkedIn: Boolean(done),
      todayCredits: done?.credits ?? 0,
      streak,
      nextStreak,
      nextCredits: done ? 0 : preview,
      /** 未来 7 天逐日可得, 让用户看清连签路线 */
      forecast: this.forecast(rule, streak, done ? today : null, 7),
      serverNow: new Date().toISOString(),
    };
  }

  private calcCheckinCredits(
    rule: {
      baseCredits: number;
      bonusRules: Array<{ day: number; bonus: number }>;
      maxStreak: number;
      dailyCap: number;
    },
    streak: number,
  ): number {
    const bonus = rule.bonusRules.find((b) => b.day === streak)?.bonus ?? 0;
    let total = rule.baseCredits + bonus;
    if (rule.dailyCap > 0) total = Math.min(total, rule.dailyCap);
    return total;
  }

  private forecast(
    rule: {
      baseCredits: number;
      bonusRules: Array<{ day: number; bonus: number }>;
      maxStreak: number;
      dailyCap: number;
    },
    currentStreak: number,
    checkedDay: string | null,
    days: number,
  ) {
    const out: Array<{ day: string; streak: number; credits: number }> = [];
    // 今天已签 → 从明天起算; 未签 → 今天算第 currentStreak+1 天
    const cursor = new Date();
    if (checkedDay) cursor.setDate(cursor.getDate() + 1);
    let streak = checkedDay
      ? this.capStreak(currentStreak, rule.maxStreak)
      : this.capStreak(currentStreak + 1, rule.maxStreak);

    for (let i = 0; i < days; i++) {
      out.push({
        day: this.localDay(cursor),
        streak,
        credits: this.calcCheckinCredits(rule, streak),
      });
      cursor.setDate(cursor.getDate() + 1);
      streak = this.capStreak(streak + 1, rule.maxStreak);
    }
    return out;
  }

  /**
   * 执行签到。
   *
   * **幂等**: (userId, day) 唯一约束兜底。并发双击时第二个请求走P2002 分支返回
   * 已有结果, 而不是报错 —— 用户看到"签到成功"比看到 500 好。
   */
  async checkin(userId: string) {
    const rule = await this.getCheckinRule();
    if (!rule.enabled) throw new AppError(40001, '签到功能未开启', 400);

    const today = this.localDay();
    const existing = await this.prisma.checkinRecord.findUnique({
      where: { userId_day: { userId, day: today } },
    });
    if (existing) {
      return { alreadyCheckedIn: true, credits: existing.credits, streak: existing.streak, record: existing };
    }

    const currentStreak = await this.calcStreak(userId, rule.maxStreak);
    const streak = this.capStreak(currentStreak + 1, rule.maxStreak);
    const credits = this.calcCheckinCredits(rule, streak);

    try {
      // 记录与积分必须同事务：只落记录不发分会把当日签到永久锁死，
      // 重试只能得到 alreadyCheckedIn，积分永远补不回来。
      const record = await this.prisma.$transaction(async (tx) => {
        const created = await tx.checkinRecord.create({
          data: { userId, day: today, credits, streak },
        });
        if (credits > 0) {
          await this.credit.grant(
            {
              userId,
              credits,
              source: 'grant',
              reason: `每日签到 (连续 ${streak} 天)`,
              idempotencyKey: `checkin:${userId}:${today}`,
            },
            tx,
          );
        }
        return created;
      });
      return { alreadyCheckedIn: false, credits, streak, record };
    } catch (e: any) {
      // 唯一约束冲突 = 并发下另一请求已写入
      if (isUniqueViolation(e)) {
        const again = await this.prisma.checkinRecord.findUnique({
          where: { userId_day: { userId, day: today } },
        });
        if (again) {
          return { alreadyCheckedIn: true, credits: again.credits, streak: again.streak, record: again };
        }
      }
      throw e;
    }
  }

  /** 签到记录 (后台/用户) */
  async listCheckins(query: { page?: number; pageSize?: number; userId?: string }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 20);
    const where: Prisma.CheckinRecordWhereInput = query.userId ? { userId: query.userId } : {};

    const [rows, total, stat] = await Promise.all([
      this.prisma.checkinRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { email: true, name: true } } },
      }),
      this.prisma.checkinRecord.count({ where }),
      this.prisma.checkinRecord.aggregate({ where, _sum: { credits: true }, _count: true }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        userEmail: r.user.email,
        userName: r.user.name,
        day: r.day,
        credits: r.credits,
        streak: r.streak,
        createdAt: r.createdAt,
      })),
      total,
      page,
      pageSize,
      summary: { count: stat._count, creditsIssued: stat._sum.credits ?? 0 },
    };
  }

  // ════════════════════════════════════════════════════════════════
  // 内部
  // ════════════════════════════════════════════════════════════════

  /** 解析可能损坏的 JSON 字段。回落到默认值而非抛错: 一条脏数据不该让整个列表 500 */
  private parseJson<T>(raw: string, fallback: T): T {
    try {
      const v = JSON.parse(raw);
      return (v ?? fallback) as T;
    } catch {
      return fallback;
    }
  }

  /** 新用户口径与券的 new_user 范围一致：存在任何已支付/退款订单即非新用户 */
  private async isNewUser(
    userId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    const paidCount = await db.order.count({
      where: {
        userId,
        status: { in: ['paid', 'partial_refunded', 'refunded'] },
      },
    });
    return paidCount === 0;
  }

  /**
   * 活动人群匹配。
   *
   * eligibleNewUser=null 表示匿名或尚未判定：保留“仅新用户”活动用于拉新；
   * 已登录用户传入真实布尔值，老用户绝不会命中定向活动。
   */
  private audienceMatches(audienceRaw: string, eligibleNewUser: boolean | null): boolean {
    const audience = this.parseJson<{ onlyNewUsers?: boolean }>(audienceRaw, {});
    return !audience.onlyNewUsers || eligibleNewUser !== false;
  }
}

/** 邀请码校验位: 字符和模 100。纯防抄错用, 不承担安全职责 */
function checksumOf(base: string): string {
  return (base.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0) % 100)
    .toString()
    .padStart(2, '0');
}

/**
 * 判断错误是否为唯一约束冲突。
 *
 * ⚠ **必须同时判 P2002 与底层 SQLite 错误**: 本项目用自研 node-sqlite driver
 * adapter, 它把驱动原始错误透传为 `P2039`(Prisma 的通用事务/执行失败码),
 * **不会**映射成 Prisma 官方的 `P2002`。只判 P2002 的话, 并发签到的分支
 * 永远走不到 —— 用户双击签到直接 500, 幂等形同虚设。
 *
 * 错误消息里 SQLite 的原文是 "UNIQUE constraint failed", 以此兜底。
 */
function isUniqueViolation(e: any): boolean {
  if (e?.code === 'P2002') return true;
  const msg = String(e?.message ?? '');
  return /UNIQUE constraint failed/i.test(msg) || /P2002/i.test(msg);
}

/** 邮箱打码: 邀请列表属敏感信息, 不在营销页明文展示 */
function maskName(name: string, email: string): string {
  const n = name?.trim();
  if (n && n.length > 1) return `${n.slice(0, 1)}***`;
  const at = email?.indexOf('@') ?? -1;
  if (at > 2) return `${email.slice(0, 2)}***${email.slice(at)}`;
  return '***';
}
