/**
 * 订单读取视图。
 *
 * Prisma include 与对外字段映射只在本文档维护一份：门面、下单、支付、退款
 * 都从这里取，避免同一个订单在不同入口返回不同字段。
 */

export function orderInclude() {
  return {
    /*
     * ⚠ 不要把 membershipPlanId 写进 include —— 它是标量不是关联,
     * Prisma 会抛 `include statements only accept relation fields`。
     * 标量默认就在查询结果里, 不需要显式声明。
     */
    items: true,
    payments: { orderBy: { createdAt: 'desc' as const } },
    refunds: { orderBy: { createdAt: 'desc' as const } },
    user: { select: { id: true, email: true, name: true } },
    // 券可能事后被改价/停用, 但订单要显示"当时用的是哪张券" —— 取快照而非实时值
    coupon: { select: { code: true, name: true } },
    campaign: { select: { id: true, name: true } },
    // 会员单要能显示"买的哪个套餐"(商品单该字段为空)
    membershipPlan: {
      select: { id: true, code: true, name: true, durationDays: true, monthlyCredits: true },
    },
  };
}

export function toOrderView(o: any) {
  /*
   * 会员加油包折扣。
   *
   * `totalCents` 存的是**会员折扣后**的小计，`discountCents` 只含券/活动；
   * 前端要逐行展示 "原价 - 会员优惠 - 券优惠 = 实付"，必须把这段差额
   * 单独透出。不能用 discountCents 反推，否则会员单的账永远算不平。
   * 会员订阅单没有 OrderItem（items 为空），差额为 0。
   */
  const itemsSubtotalCents = (o.items ?? []).reduce(
    (sum: number, item: any) => sum + item.priceCentsSnapshot * item.quantity,
    0,
  );
  const memberDiscountCents = Math.max(0, itemsSubtotalCents - (o.totalCents ?? 0));
  return {
    id: o.id,
    orderNo: o.orderNo,
    userId: o.userId,
    userEmail: o.user?.email ?? '',
    status: o.status,
    channel: o.channel,
    /** 商品原价小计（会员订阅单为套餐原价） */
    itemsSubtotalCents: itemsSubtotalCents || o.totalCents,
    totalCents: o.totalCents,
    memberDiscountCents,
    discountCents: o.discountCents ?? 0,
    /*
     * 旧订单无 paidCents 字段值时回落原价, 避免展示为 0 元。
     * 但真正的 0 元单有 channel='free' 的成功流水，必须显示 0，
     * 不能回落成原价 —— 否则用户会看到「免费领取的包要付全价」。
     */
    paidCents:
      o.paidCents > 0
        ? o.paidCents
        : (o.payments ?? []).some((p: any) => p.status === 'succeeded' && p.channel === 'free')
          ? 0
          : o.totalCents,
    refundedCents: o.refundedCents,
    couponId: o.couponId ?? null,
    couponCode: o.coupon?.code ?? null,
    couponName: o.coupon?.name ?? null,
    campaignId: o.campaignId ?? null,
    // 会员订阅单: membershipPlanId 非空即表示"本单买的是会员"
    membershipPlanId: o.membershipPlanId ?? null,
    membershipPlanCode: o.membershipPlan?.code ?? null,
    membershipPlanName: o.membershipPlan?.name ?? null,
    /** 会员权益是否已发放。paid 且为 null = 待重试 (正常几秒内完成) */
    membershipAppliedAt: o.membershipAppliedAt ?? null,
    grantedCredits: o.grantedCredits,
    paidAt: o.paidAt,
    expiresAt: o.expiresAt,
    createdAt: o.createdAt,
    items: (o.items ?? []).map((i: any) => ({
      id: i.id,
      productId: i.productId,
      sku: i.skuSnapshot,
      name: i.nameSnapshot,
      priceCents: i.priceCentsSnapshot,
      credits: i.creditsSnapshot,
      validDays: i.validDaysSnapshot,
      quantity: i.quantity,
    })),
    payments: (o.payments ?? []).map((p: any) => ({
      id: p.id,
      payTransactionId: p.payTransactionId,
      channel: p.channel,
      amountCents: p.amountCents,
      status: p.status,
      message: p.message,
      sandboxScenario: p.sandboxScenario,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    })),
    refunds: (o.refunds ?? []).map((r: any) => ({
      id: r.id,
      amountCents: r.amountCents,
      creditsReclaimed: r.creditsReclaimed,
      creditsUnreclaimable: r.creditsUnreclaimable,
      creditsExpired: r.creditsExpired,
      reason: r.reason,
      status: r.status,
      providerRefundId: r.providerRefundId ?? null,
      detail: r.detail,
      operatorId: r.operatorId ?? null,
      createdAt: r.createdAt,
    })),
  };
}
