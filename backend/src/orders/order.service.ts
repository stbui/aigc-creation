import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { type OrderStatus, transitionOrder } from './order.state';
import { orderInclude, toOrderView } from './order.view';
import { type CreateOrderParams, OrderCheckoutService } from './order-checkout.service';
import { type MarkPaidParams, OrderPaymentService } from './order-payment.service';
import {
  type ConfirmRefundParams,
  OrderRefundService,
  type RefundParams,
} from './order-refund.service';

export type { OrderStatus } from './order.state';
export type { RefundRules } from './order-refund-policy.service';

/**
 * 订单与沙箱支付 (admin-prd.md §3.7 B-39~B-44 / M8)。
 *
 * 状态机 (PRD §5: **不可跳跃**):
 *
 *   pending ──支付成功──> paid ──全额退款──> refunded
 *      │                   │
 *      │                   └──部分退款──> partial_refunded ──再退──> refunded
 *      └──超时/取消──> cancelled
 *
 *   cancelled / refunded 是终态, 不可回退。任何试图跳跃的调用返回 409。
 *
 * 幂等 (PRD §5):
 *   · 下单按 (userId, idempotencyKey) 去重, 重复请求返回同一订单
 *   · 回调按 payTransactionId 去重, **已支付订单收到重复回调不重复发积分**
 *
 * 本类是订单域的对外门面：外部调用方只依赖这里，实现按生命周期拆在
 * checkout / payment / refund 三个服务中。门面自身保留读取、沙箱支付、
 * 库存释放与状态迁移，避免子服务反向依赖。
 */

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly checkout: OrderCheckoutService,
    private readonly payment: OrderPaymentService,
    private readonly refunds: OrderRefundService,
  ) {}

  // ── 下单 ──────────────────────────────────────────────────────────

  /**
   * 创建订单 (幂等)。
   *
   * 幂等实现: 数据库唯一约束 (userId, idempotencyKey) + 冲突后查回既有订单。
   * 先查后插会有竞态(两个请求同时查不到), 靠唯一约束兜底才是可靠的。
   *
   * 优惠 (M11): 券与限时活动**不叠加, 取更优者** (admin-detailed-design.md §12.6),
   * 结果连同**规则快照**一起落库 —— 事后改券价或活动到期都不影响历史订单。
   *
   * ⚠ 优惠**不即时核销**: Coupon.usedCount 只在支付成功时 +1。
   * 下单即计数会让用户反复下单不付款就能把限量券耗光。
   */
  create(params: CreateOrderParams) {
    return this.checkout.create(params);
  }

  /** 订单详情 */
  async detail(orderId: string, userId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: orderInclude(),
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);
    // 传了 userId 就是C 端查询, 必须校验归属
    if (userId && order.userId !== userId) {
      throw new AppError(40301, '无权查看该订单', 403);
    }
    return toOrderView(order);
  }

  /**
   * C 端订单列表（服务端分页）。
   *
   * 之前固定 take:20 且不返回 total，超过 20 条的历史订单在 C 端永久不可见；
   * 筛选计数也只能对截断后的数组做统计。现在返回分页信息与各状态真实计数，
   * 前端可以「加载更多」并显示准确的筛选数量。
   */
  async listByUser(userId: string, limit = 20, offset = 0) {
    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = Math.max(Number(offset) || 0, 0);
    const [orders, total, statusGroups] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: orderInclude(),
      }),
      this.prisma.order.count({ where: { userId } }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
      }),
    ]);
    const statusCounts = Object.fromEntries(
      statusGroups.map((row) => [row.status, row._count._all]),
    );
    return {
      items: orders.map((o) => toOrderView(o)),
      total,
      limit: take,
      offset: skip,
      statusCounts,
    };
  }

  /*
   * 用户取消订单不在本 service 提供入口：必须走 PaymentOrderService.close()，
   * 先向渠道查单/关单，再在本地置 cancelled 并释放库存与券预占。
   * 这里保留说明而不保留直改状态的便捷方法，避免未来误用绕过资金安全链路。
   */

  // ── 沙箱支付 ──────────────────────────────────────────────────────

  /**
   * 沙箱支付 (M8)。
   *
   * 模拟三种场景, 让前端能完整走通购买流程而无需商户号:
   *   'success' 支付成功 → 发积分
   *   'failed'  支付失败 → 订单保持 pending, 可重新支付
   *   'timeout' 支付超时 → 订单转cancelled
   *
   * ⚠ **沙箱不产生真实资金流转**, 仅用于开发联调。真实通道见 M15。
   */
  async sandboxPay(params: {
    orderId: string;
    userId: string;
    scenario: 'success' | 'failed' | 'timeout';
  }) {
    /*
     * 站内模拟支付只允许「非生产 + 沙箱通道」。
     *
     * 这个端点直接调 markPaid，等于绕过渠道回调把订单置为已支付。一旦
     * PAYMENT_PROVIDER 配成 alipay/wechat，任何登录用户对自己的 pending 单
     * POST 一次就能免费拿积分/会员；生产环境更不该存在这条路径。
     * 按「不存在」处理（404），不对外暴露端点存在性。
     */
    if (this.config.get<string>('app.env') === 'production') {
      throw new AppError(40400, '订单不存在', 404);
    }

    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      include: orderInclude(),
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);
    if (order.userId !== params.userId) {
      throw new AppError(40301, '无权支付该订单', 403);
    }

    /*
     * 站内模拟支付只能用于沙箱订单。
     * 仅挡 production 不够：测试/预发环境若配了真实渠道，用户对一笔
     * 支付宝/微信订单调用本端点仍可免费入账。渠道不是 sandbox 一律拒绝。
     */
    if (order.channel !== 'sandbox') {
      throw new AppError(40901, '该订单不是沙箱订单，不能使用站内模拟支付', 409);
    }

    // 已支付的订单重复支付 → 幂等返回, 不重复发积分
    if (order.status === 'paid') {
      return { order: toOrderView(order), idempotentHit: true, message: '订单已支付' };
    }
    if (order.status !== 'pending') {
      throw new AppError(40901, '订单状态已变化，请刷新后重试', 409);
    }
    // 超时订单不可再支付
    if (new Date() > order.expiresAt) {
      await this.cancelSandboxOrder(order.id);
      throw new AppError(40901, '订单已超时关闭', 409);
    }

    const transactionId = `SBX-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (params.scenario === 'timeout') {
      await this.prisma.payment.create({
        data: {
          orderId: order.id,
          userId: params.userId,
          payTransactionId: transactionId,
          amountCents: order.paidCents,
          status: 'failed',
          message: '沙箱模拟: 支付超时',
          sandboxScenario: 'timeout',
        },
      });
      const outcome = await this.cancelSandboxOrder(order.id);
      if (outcome === 'paid') {
        const paid = await this.detail(order.id);
        return { order: paid, idempotentHit: true, message: '订单已支付' };
      }
      const updated = await this.detail(order.id);
      return { order: updated, idempotentHit: false, message: '支付超时, 订单已关闭' };
    }

    if (params.scenario === 'failed') {
      await this.prisma.payment.create({
        data: {
          orderId: order.id,
          userId: params.userId,
          payTransactionId: transactionId,
          amountCents: order.paidCents,
          status: 'failed',
          message: '沙箱模拟: 支付失败',
          sandboxScenario: 'failed',
        },
      });
      // 订单保持 pending —— 允许用户重新支付
      return {
        order: toOrderView(order),
        idempotentHit: false,
        message: '支付失败, 可重新发起支付',
      };
    }

    // success
    return this.payment.markPaid({
      orderId: order.id,
      userId: params.userId,
      payTransactionId: transactionId,
      channel: 'sandbox',
      sandboxScenario: 'success',
    });
  }

  // ── 支付入账与会员 ────────────────────────────────────────────────

  /**
   * 标记订单已支付并发积分 (M15 真实回调也走这里)。
   *
   * 幂等保证 (PRD §5「幂等回调」):
   *   1. payTransactionId 唯一 —— 重复回调不产生新流水
   *   2. 订单已是 paid → 直接返回, **不重复发积分**
   *   3. 发积分与订单状态变更在同一事务 —— 不会出现"订单已支付但积分没发"
   */
  markPaid(params: MarkPaidParams) {
    return this.payment.markPaid(params);
  }

  /**
   * 重试「已支付但会员未激活」的订单 (调度任务 task-recover 调用)。
   *
   * 只扫最近 7 天: 更早的失败单需要人工介入 —— 无限重试一个永久失败的订单
   * 只会把日志刷满, 且用户早已发现权益没到账。
   */
  retryPendingMembershipActivation(limit?: number) {
    return this.payment.retryPendingMembershipActivation(limit);
  }

  // ── 退款 (B-43) ──────────────────────────────────────────────────

  /**
   * 退款。
   *
   * 按 CreditLot.remaining 逐批扣回 —— 退的是"还没花掉的部分"(B-43)。
   * 已消耗的部分无法追回, 如实记为 creditsUnreclaimable。
   *
   * 支持部分退款: 退款金额小于订单金额时, 订单转partial_refunded。
   */
  refund(params: RefundParams) {
    return this.refunds.refund(params);
  }

  /**
   * 渠道异步退款的最终人工核销。
   *
   * 本仓库尚未接退款回调，`processing` 必须由运营核对渠道商户后台后落到成功
   * 或失败。成功路径复用与同步退款完全相同的原子记账函数；失败路径只关闭
   * 退款单并保留证据，不改订单和积分。
   */
  confirmRefund(params: ConfirmRefundParams) {
    return this.refunds.confirmRefund(params);
  }

  // ── 状态机 ────────────────────────────────────────────────────────

  /**
   * 释放库存占用（取消/超时/关单）。
   *
   * 幂等：先条件更新 `stockReserved: true → false` 抢占，抢不到直接返回，
   * 避免重复释放把 `stockReserved` 减成负数。
   */
  async releaseReservation(orderId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const release = async (db: Prisma.TransactionClient | PrismaService) => {
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          stockReserved: true,
          items: {
            select: {
              productId: true,
              quantity: true,
              stockReservedSnapshot: true,
            },
          },
        },
      });
      if (!order?.stockReserved) return;

      const flag = await db.order.updateMany({
        where: { id: orderId, stockReserved: true },
        data: { stockReserved: false },
      });
      if (flag.count === 0) return;
      for (const item of order.items) {
        if (!item.productId) continue;
        let reservedQuantity = item.stockReservedSnapshot;
        if (reservedQuantity == null) {
          // 历史订单没有库存快照，只能按当前策略兜底；新订单一律走快照。
          const product = await db.product.findUnique({
            where: { id: item.productId },
            select: { saleStrategy: true },
          });
          reservedQuantity = product?.saleStrategy === 'inventory' ? item.quantity : 0;
        }
        if (reservedQuantity <= 0) continue;
        await db.product.update({
          where: { id: item.productId },
          data: { stockReserved: { decrement: reservedQuantity } },
        });
      }
    };

    if (tx) {
      await release(tx);
      return;
    }
    await this.prisma.$transaction(release);
  }

  /**
   * 校验并执行状态迁移。非法迁移抛 409, 绝不静默通过。
   *
   * `tx` 用于「状态迁移必须与另一处写入同时生效」的场景（退款记账）：
   * 传了事务客户端就走同一个事务，否则各自独立提交。
   */
  async transition(orderId: string, to: OrderStatus, tx?: Prisma.TransactionClient): Promise<void> {
    return transitionOrder(tx ?? this.prisma, orderId, to);
  }

  /**
   * 沙箱支付超时的本地原子取消。
   *
   * 沙箱没有外部渠道订单，但仍必须与支付编排保持相同终态：订单 cancelled、
   * pending 支付尝试 closed、库存占用释放，三者同一事务完成。调用前已校验
   * 订单属于当前用户且 channel=sandbox。
   */
  private async cancelSandboxOrder(orderId: string): Promise<'cancelled' | 'paid'> {
    return this.prisma.$transaction(async (tx) => {
      // SQLite deferred transaction 需要先写一行拿到订单级写锁，再判断状态。
      await tx.$executeRaw`
        UPDATE "Order" SET "updatedAt" = "updatedAt" WHERE id = ${orderId}`;
      const current = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      if (!current) throw new AppError(40400, '订单不存在', 404);
      if (current.status === 'paid') return 'paid';
      if (current.status !== 'pending') {
        throw new AppError(40901, '订单状态已变化，无法关闭，请刷新后重试', 409);
      }

      await tx.payment.updateMany({
        where: { orderId, status: 'pending' },
        data: { status: 'closed', closedAt: new Date() },
      });
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'cancelled',
          closedAt: new Date(),
          closeStartedAt: null,
          intentStartedAt: null,
          checkoutValue: '',
          lastError: null,
        },
      });
      await this.releaseReservation(orderId, tx);
      return 'cancelled';
    });
  }
}
