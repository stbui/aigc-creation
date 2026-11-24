import { Injectable, Logger } from '@nestjs/common';
import { lockUserRow } from '../account/user-row-lock';
import { AppError } from '../common/app.exception';
import { CreditService } from '../credits/credit.service';
import { MarketingService } from '../marketing/marketing.service';
import { MembershipService } from '../membership/membership.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { orderInclude, toOrderView } from './order.view';

/**
 * 支付入账与会员激活。
 *
 * 订单状态只经 markPaid 一条写入路径；激活用订单上的 membershipAppliedAt
 * 做一次性闸门，失败交给调度重试。
 */
@Injectable()
export class OrderPaymentService {
  private readonly logger = new Logger(OrderPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credit: CreditService,
    private readonly marketing: MarketingService,
    private readonly membership: MembershipService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * 标记订单已支付并发积分 (M15 真实回调也走这里)。
   *
   * 幂等保证 (PRD §5「幂等回调」):
   *   1. payTransactionId 唯一 —— 重复回调不产生新流水
   *   2. 订单已是 paid → 直接返回, **不重复发积分**
   *   3. 发积分与订单状态变更在同一事务 —— 不会出现"订单已支付但积分没发"
   */
  async markPaid(params: {
    orderId: string;
    userId: string;
    payTransactionId: string;
    channel: string;
    /** 渠道币种; 传入时必须与订单币种一致 */
    currency?: string;
    providerConfigId?: string | null;
    providerConfigVersion?: number | null;
    /** 本次入账对应的 C 端支付方式；EasyPay 历史空值由此回填 */
    providerMethod?: string | null;
    /** 本次实际入账的支付实例；老订单/老调用方可为空 */
    providerInstanceId?: string | null;
    providerStatus?: string | null;
    providerPaidAt?: Date;
    /** intent 阶段已创建的 pending Payment; 有则原地更新, 不再新建 */
    paymentId?: string;
    /** 渠道实收金额; 传入时必须与订单应付一致 */
    amountCents?: number;
    sandboxScenario?: string;
    /** 渠道原始回调报文 (真实通道; 沙箱为空)。只落库, 不进接口响应 */
    rawPayload?: string;
    /** 渠道侧下单单据 id（PayPal order id / Stripe Checkout Session id 等） */
    providerRef?: string | null;
    /**
     * 后台手工核销依据。
     *
     * 人工入账没有渠道报文，这段文字是财务事后唯一能解释「这单为什么是手工
     * 入账」的凭据，落在 Payment.message 上随支付流水一起展示。
     */
    note?: string;
  }) {
    // 1) 交易号已存在 = 重复回调
    const dupPayment = await this.prisma.payment.findUnique({
      where: { payTransactionId: params.payTransactionId },
    });
    if (dupPayment) {
      /*
       * 交易号唯一是全局的。若它已绑定到另一笔订单，说明渠道侧数据串单，
       * 不能按本单幂等成功返回 —— 否则本单会一直 pending，而通知被 ack 成功。
       */
      if (dupPayment.orderId !== params.orderId) {
        throw new AppError(40901, '渠道交易号已绑定其他订单', 409);
      }
      if (dupPayment.status === 'succeeded') {
        const order = await this.viewOrder(params.orderId);
        return { order, idempotentHit: true, message: '重复回调, 已忽略' };
      }
      /*
       * 同一交易号可能先落在 failed/closed（沙箱失败、渠道超时后查单等），
       * 之后渠道才把真实成功回调补回来。不能仅因“交易号已存在”就 ack，
       * 否则订单会永久 pending。后续事务会把这个已存在的尝试原地提升为
       * succeeded；若调用方指向另一条 Payment，则说明归属有歧义，直接拒绝。
       */
      if (params.paymentId && params.paymentId !== dupPayment.id) {
        throw new AppError(40901, '渠道交易号已绑定另一支付尝试，禁止静默改挂', 409);
      }
    }

    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      include: orderInclude(),
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);

    // 2) 订单已支付 → 幂等返回, 不重复发积分
    if (order.status === 'paid') {
      return { order: toOrderView(order), idempotentHit: true, message: '订单已支付' };
    }
    if (order.status !== 'pending') {
      throw new AppError(40901, '订单状态已变化，请刷新后重试', 409);
    }

    /*
     * 金额与币种校验必须在这里, 不能只依赖调用方。
     * `markPaid` 是唯一入账入口, 任何新增调用方 (回调/查单/对账/后台补发)
     * 漏校验都会变成资损: 少收钱记成全额, 或把 USD 单按 CNY 入账。
     */
    if (params.currency && params.currency !== (order.currency || 'CNY')) {
      throw new AppError(
        40901,
        `币种不一致: 渠道 ${params.currency} / 订单 ${order.currency || 'CNY'}`,
        409,
      );
    }
    if (params.amountCents !== undefined && params.amountCents !== order.paidCents) {
      throw new AppError(
        40901,
        `金额不一致: 渠道 ${params.amountCents} 分 / 订单 ${order.paidCents} 分`,
        409,
      );
    }

    const succeededFields = {
      // 流水金额记**实付**, 不是订单原价。记原价会让对账看起来"收了全价",
      // 而用户实际少付了优惠部分 —— 财务对账时这个差额无法解释
      payTransactionId: params.payTransactionId,
      channel: params.channel,
      amountCents: order.paidCents,
      status: 'succeeded',
      paidAt: new Date(),
      currency: order.currency || 'CNY',
      providerConfigId: params.providerConfigId ?? order.providerConfigId ?? null,
      providerConfigVersion: params.providerConfigVersion ?? order.providerConfigVersion ?? null,
      ...(params.providerMethod !== undefined ? { providerMethod: params.providerMethod } : {}),
      providerInstanceId: params.providerInstanceId ?? order.providerInstanceId ?? null,
      providerStatus: params.providerStatus ?? null,
      lastError: null,
      closedAt: null,
      sandboxScenario: params.sandboxScenario ?? null,
      rawPayload: params.rawPayload ?? '',
      ...(params.providerRef ? { providerRef: params.providerRef } : {}),
      // 手工核销依据: 只在有值时写入，避免把渠道已有的失败原因冲成 null
      ...(params.note ? { message: params.note } : {}),
    };

    try {
      const won = await this.prisma.$transaction(async (tx) => {
        // 与邀请绑定共用同一把用户行锁：绑定若先提交，本笔支付就属于绑定后的
        // 首次付费；支付若先提交，绑定侧会看到 paid 并拒绝补绑。
        await lockUserRow(tx, order.userId);

        /*
         * 支付入账必须与建单预留使用同一把券锁，并在改订单状态前取得。
         * 否则建单可能在「订单仍 pending、usedCount 尚未增加」的窗口里再次
         * 放出同一张限量券。
         */
        if (order.couponId) {
          await this.marketing.lockCoupon(order.couponId, tx);
        }

        /*
         * `grantedCredits` 必须等于**实际自动发放的积分**。
         *
         * manual 商品由后台手工发放，不走自动发放；若这里仍按全部 OrderItem
         * 累加，退款回收 (`reclaimForOrder`) 会以这个虚高快照为上限，从用户
         * 其它批次里扣走从未到账的积分。先决定哪些条目会发，再累加。
         *
         * 会员积分也不能在这里预记：提前续费的新周期可能尚未开始，首月积分
         * 要等周期开始后才发放。会员每次实际发分时会在同一事务累加本字段。
         */
        const autoGrantItems: typeof order.items = [];
        let grantedCredits = 0;
        for (const item of order.items) {
          // 新订单按下单时快照发放。历史订单没有快照时才回退当前商品配置，
          // 确保加列前的待支付订单仍保持旧行为，不会因字段为空全部停发。
          const grantType =
            item.grantTypeSnapshot ??
            (item.productId
              ? (await tx.product.findUnique({ where: { id: item.productId } }))?.grantType
              : null);
          if (grantType === 'manual') continue;
          autoGrantItems.push(item);
          grantedCredits += item.creditsSnapshot * item.quantity;
        }

        /*
         * 先抢占订单状态（条件更新）。
         *
         * 查重与状态判断都在事务外，两个不同交易号的并发回调可能都读到
         * pending。这里用 `status='pending'` 条件更新让数据库裁决唯一赢家；
         * 输家不再写 Payment、不再发积分，只按「已支付」幂等返回。
         * 用无条件 update 会让两笔都发积分，退款时也只按一个 grantedCredits 回收。
         */
        const claimed = await tx.order.updateMany({
          where: { id: order.id, status: 'pending' },
          data: {
            status: 'paid',
            // 订单渠道以**实际成功入账**的渠道为准；发起支付时的 channel 只是最后一次尝试。
            // 0 元单记 'free'，后台渠道列显示「免费」且不参与渠道筛选。
            channel: params.channel,
            paidAt: new Date(),
            grantedCredits,
            providerTradeNo: params.payTransactionId,
            providerStatus: params.providerStatus ?? null,
            providerConfigId: params.providerConfigId ?? order.providerConfigId ?? null,
            providerConfigVersion:
              params.providerConfigVersion ?? order.providerConfigVersion ?? null,
            providerInstanceId: params.providerInstanceId ?? order.providerInstanceId ?? null,
            providerPaidAt: params.providerPaidAt ?? new Date(),
            // 终态必须清空 checkoutValue, 否则页面会把过期链接当可用
            checkoutValue: '',
            lastError: null,
            closeStartedAt: null,
            intentStartedAt: null,
            stockReserved: false,
          },
        });
        if (claimed.count === 0) return false;

        // 订单已在本事务内置为 paid，此时核销才具备原子性且不会被重复计数。
        if (order.couponId) {
          await this.marketing.redeemCoupon(order.couponId, order.id, tx);
        }

        /*
         * 有 pending 尝试就原地更新 (保留本次支付尝试的创建时间与 id),
         * 否则新建。更新 0 行说明该尝试已被关单/并发入账, 回退为 create。
         */
        const targetPaymentId = dupPayment?.id ?? params.paymentId;
        let updatedExisting = 0;
        if (targetPaymentId) {
          const result = await tx.payment.updateMany({
            where: {
              id: targetPaymentId,
              orderId: order.id,
              ...(dupPayment
                ? { status: { in: ['pending', 'failed', 'closed'] } }
                : { status: 'pending' }),
            },
            data: succeededFields,
          });
          updatedExisting = result.count;
        }
        if (updatedExisting === 0 && dupPayment) {
          throw new AppError(40901, '渠道交易号对应的支付尝试状态已变化，请重试', 409);
        }
        if (updatedExisting === 0) {
          await tx.payment.create({
            data: { orderId: order.id, userId: params.userId, ...succeededFields },
          });
        }

        /*
         * 库存占用转已售: 与订单置 paid 同一事务, 否则「已支付但库存仍占用」
         * 会让该商品永久少卖一份。
         */
        if (order.stockReserved) {
          for (const item of order.items) {
            if (!item.productId) continue;
            let reservedQuantity = item.stockReservedSnapshot;
            if (reservedQuantity == null) {
              // 历史订单没有库存快照，只能按当前策略兜底；新订单一律走快照。
              const product = await tx.product.findUnique({
                where: { id: item.productId },
                select: { saleStrategy: true },
              });
              reservedQuantity = product?.saleStrategy === 'inventory' ? item.quantity : 0;
            }
            if (reservedQuantity <= 0) continue;
            await tx.product.update({
              where: { id: item.productId },
              data: {
                stockSold: { increment: reservedQuantity },
                stockReserved: { decrement: reservedQuantity },
              },
            });
          }
        }

        for (const item of autoGrantItems) {
          /*
           * 0 积分商品（免费发放 / 纯权益商品）没有可发的批次。
           * `CreditService.grant` 对 ≤ 0 明确抛错，若不跳过，整笔支付事务会
           * 回滚——订单永远停在 pending，渠道重试也无法入账。
           */
          const credits = item.creditsSnapshot * item.quantity;
          if (credits <= 0) continue;
          await this.credit.grant(
            {
              userId: params.userId,
              credits,
              source: 'purchase',
              validDays: item.validDaysSnapshot,
              orderId: order.id,
              // 付费购买到账: 与会员月度发放（grant）区分开, 便于按「充值/订阅」分账
              businessType: 'purchase',
            },
            tx,
          );
        }

        return true;
      });

      if (!won) {
        const current = await this.viewOrder(params.orderId);
        if (current.status === 'paid') {
          return { order: current, idempotentHit: true, message: '订单已支付' };
        }
        throw new AppError(40901, '订单状态已变化，请刷新后重试', 409);
      }
    } catch (e) {
      /*
       * 并发重复回调可能同时通过前面的交易号查重, 最终由 Payment.payTransactionId
       * 唯一约束裁决。P2002 说明另一条通知已经入账成功, 这里按幂等成功返回,
       * 绝不能把重复通知抛成 500 —— 那会让渠道持续重试到死信。
       */
      if ((e as { code?: string })?.code === 'P2002') {
        const current = await this.viewOrder(params.orderId);
        // 只有本单确实已支付才算幂等成功；否则是交易号撞到了别的订单/别的约束，
        // 必须抛出去让通知落差异，不能 ack 成功把本单留在 pending。
        if (current.status === 'paid') {
          return { order: current, idempotentHit: true, message: '重复回调, 已忽略' };
        }
        throw new AppError(40901, '渠道交易号冲突，订单未入账', 409);
      }
      throw e;
    }

    /*
     * 营销副作用放在事务**之外**。
     *
     * 理由: 券核销与邀请发奖都是独立的资源变更, 若放进同一事务, 失败会连带
     * 回滚"支付成功"这一既成事实 —— 钱收了但订单回到 pending, 是更糟的状态。
     * 两者自身都有幂等闸 (条件更新), 重复执行安全。
     */
    try {
      await this.marketing.onOrderPaid(params.userId);
    } catch (e: any) {
      // 营销副作用失败**不得影响支付结果**: 记WARN 并继续返回成功
      this.logger.warn(`营销副作用执行失败 (订单 ${order.orderNo}): ${e?.message ?? e}`);
    }

    /*
     * 会员订阅单: 支付成功后**激活会员**。
     *
     * 权益发放放在事务之外、用订单上的 `membershipAppliedAt` 做一次性闸门:
     *   · 事务里发权益会连带回滚"支付成功"这一既成事实 (钱收了, 订单回 pending)
     *   · 闸门必须是订单字段而非 Membership.orderId —— 续费会复用同一行会员并
     *     覆盖 orderId, 旧订单因此"看起来没被用过", 重放就能再白拿一期
     *
     * 失败时闸门开回去并记 ERROR, 由调度任务重试 (retryPendingMembershipActivation)。
     */
    if (order.membershipPlanId) {
      await this.activateMembership(order.id);
    }

    const updated = await this.viewOrder(params.orderId);

    /*
     * 站内通知 (B4)。读 `updated` 而不是事务前的 `order`:
     * 发放积分是在事务里改的, 用旧对象会报出 0 积分。
     * 通知写失败只记 WARN, 绝不能让「钱已收到」的响应变成错误。
     */
    await this.notifications.notify({
      userId: params.userId,
      type: 'payment_success',
      vars: {
        orderNo: updated.orderNo,
        amount: (updated.paidCents / 100).toFixed(2),
        credits: updated.grantedCredits ?? 0,
      },
      fallbackTitle: '支付成功',
      fallbackBody: `订单 ${updated.orderNo} 已支付 ¥${(updated.paidCents / 100).toFixed(2)}。`,
      link: updated.membershipPlanId ? '/packages' : '/credits',
      emailEvent: 'payment_success',
    });

    return { order: updated, idempotentHit: false, message: '支付成功' };
  }

  /**
   * 激活会员订单的权益 (幂等)。
   *
   * ⚠ 一次性闸门**只在 `MembershipService.subscribe` 的事务里**:
   * 它用 `updateMany({ membershipAppliedAt: null })` 抢锁, 与「延期 + 发积分」
   * 同属一个事务, 抢不到就整笔跳过。
   *
   * 这里**不能**再抢一次 —— 曾经在这里先抢、再调 subscribe, 结果是
   * subscribe 看到闸门已被本方法置上, 判定"已兑换", 于是订单标记为已发放
   * 而会员与积分一个都没到账。加锁点只能有一个。
   *
   * @returns 'applied' 本次完成激活 | 'already' 已激活过 | 'failed' 失败待重试
   */
  private async activateMembership(orderId: string): Promise<'applied' | 'already' | 'failed'> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true, membershipPlanId: true },
    });
    if (!order?.membershipPlanId) return 'failed';

    try {
      const result = await this.membership.subscribe({
        userId: order.userId,
        planId: order.membershipPlanId,
        orderId,
      });
      return result.alreadyApplied ? 'already' : 'applied';
    } catch (e: any) {
      // 闸门在 subscribe 的事务内, 失败时随事务一起回滚, 无需手工开回
      this.logger.error(`会员激活失败, 待重试 (订单 ${orderId}): ${e?.message ?? e}`);
      return 'failed';
    }
  }

  /**
   * 重试「已支付但会员未激活」的订单 (调度任务 task-recover 调用)。
   *
   * 只扫最近 7 天: 更早的失败单需要人工介入 —— 无限重试一个永久失败的订单
   * 只会把日志刷满, 且用户早已发现权益没到账。
   */
  async retryPendingMembershipActivation(limit = 50): Promise<number> {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const pending = await this.prisma.order.findMany({
      where: {
        // 支付成功后、权益激活前可能先发生部分退款；只要不是全额退款，
        // 订单对应的会员周期仍然有效，恢复任务必须继续补激活。
        status: { in: ['paid', 'partial_refunded'] },
        membershipPlanId: { not: null },
        membershipAppliedAt: null,
        paidAt: { gte: since },
      },
      select: { id: true },
      take: limit,
    });

    let applied = 0;
    for (const o of pending) {
      if ((await this.activateMembership(o.id)) === 'applied') applied += 1;
    }
    if (applied > 0) this.logger.log(`会员激活重试: 补发 ${applied} 单`);
    return applied;
  }

  /** 订单视图读取入口：markPaid 的幂等返回与通知都用最新结果。 */
  private async viewOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: orderInclude(),
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);
    return toOrderView(order);
  }
}

export type MarkPaidParams = Parameters<OrderPaymentService['markPaid']>[0];
