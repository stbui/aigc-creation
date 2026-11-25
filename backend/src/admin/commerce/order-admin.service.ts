import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { OrderService } from "../../orders/order.service";
import { AppError } from "../../common/app.exception";
import { runBatch } from "../../common/batch";
import { buildPage, paginate } from "../dto/page-query.dto";
import { centsToYuan, toCsv, type CsvColumn } from "../../common/csv";
import {
  EXPORT_LIMIT,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  REFUND_STATES,
  type OrderListQuery,
} from "./commerce-admin.types";
import {
  dateRange,
  effectivePaidCents,
  latestRefundState,
} from "./commerce-admin.util";

const ORDER_LIST_INCLUDE = {
  user: { select: { email: true } },
  // 明细只取快照名与 SKU：订单页要能看出买的是哪件商品，
  // 商品被删除或改名都不影响这里（快照是下单时的值）
  items: { select: { id: true, nameSnapshot: true, skuSnapshot: true } },
  // status/channel 供 `effectivePaidCents` 区分 0 元单与历史空值
  payments: { select: { id: true, status: true, channel: true } },
  /*
   * 退款单要带上状态：退款状态挂在 `Refund` 而不是订单上，
   * 渠道异步退款时订单仍是 `paid`。列表若只给订单状态，运营
   * 「筛得出却看不出是哪单」—— 状态列必须与筛选条件同源。
   */
  refunds: { select: { status: true } },
  membershipPlan: { select: { code: true, name: true } },
} satisfies Prisma.OrderInclude;

type OrderListRow = Prisma.OrderGetPayload<{ include: typeof ORDER_LIST_INCLUDE }>;

/**
 * 后台订单管理（查询 / 详情 / 导出 / 删除 / 批量核销）。
 *
 * 约定:
 *   · 所有金额是**整数分**, 只有导出 CSV 时转成元
 *   · `to` 含当天 —— 运营输入 10-21 期望包含 10-21 全天
 */
@Injectable()
export class AdminCommerceOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
  ) {}

  private orderWhere(q: OrderListQuery): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};
    if (q.status) {
      if (!(ORDER_STATUSES as readonly string[]).includes(q.status)) {
        throw new AppError(40001, `订单状态非法: ${q.status}`, 400);
      }
      where.status = q.status;
    }
    if (q.channel) where.channel = q.channel;
    if (q.refundState) {
      if (!(REFUND_STATES as readonly string[]).includes(q.refundState)) {
        throw new AppError(40001, `退款状态非法: ${q.refundState}`, 400);
      }
      // 一笔订单可能有多笔退款, 用 some 命中任意一笔; 列表展示的仍是订单维度
      where.refunds = { some: { status: q.refundState } };
    }
    if (q.orderNo?.trim()) where.orderNo = { contains: q.orderNo.trim() };
    if (q.email?.trim()) where.user = { email: { contains: q.email.trim() } };
    // 商品维度：命中任一明细行即算。订单行数量有限，用 some 而非全部匹配
    if (q.productId?.trim()) {
      where.items = { some: { productId: q.productId.trim() } };
    }

    const range = dateRange(q.from, q.to);
    if (range) where.createdAt = range;
    return where;
  }

  async listOrders(q: OrderListQuery) {
    const page = buildPage(
      { page: q.page, pageSize: q.pageSize, sort: q.sort },
      ["createdAt", "paidAt", "totalCents"],
      "createdAt:desc",
    );
    const where = this.orderWhere(q);

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: page.orderBy,
        include: ORDER_LIST_INCLUDE,
      }),
      this.prisma.order.count({ where }),
    ]);

    return paginate(
      items.map((order: OrderListRow) => ({
        id: order.id,
        orderNo: order.orderNo,
        userId: order.userId,
        userEmail: order.user?.email ?? "",
        status: order.status,
        channel: order.channel,
        totalCents: order.totalCents,
        discountCents: order.discountCents ?? 0,
        paidCents: effectivePaidCents(order),
        refundedCents: order.refundedCents,
        grantedCredits: order.grantedCredits,
        itemCount: order.items.length,
        /** 快照名 + SKU，按明细顺序；列表只说「N 件商品」等于没说买了什么 */
        items: order.items.map((item) => ({
          name: item.nameSnapshot,
          sku: item.skuSnapshot,
        })),
        paymentCount: order.payments.length,
        /*
         * 最近一次下单/发起支付失败原因。列表里直接给出，运营不必逐笔打开
         * 详情才能判断「为什么这笔一直没付」；空串由写入层归一为空值。
         */
        lastError: order.lastError ?? null,
        /*
         * 退款状态列：与筛选口径（`some` 命中任意一笔退款单）同源，
         * 收敛成一个值 —— processing / failed / succeeded 都可能同时存在，
         * 列上只显示最需要人管的那一个：处理中 > 失败 > 成功。
         */
        refundState: latestRefundState(order.refunds),
        membershipPlanCode: order.membershipPlan?.code ?? null,
        membershipPlanName: order.membershipPlan?.name ?? null,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
      })),
      total,
      page,
    );
  }

  /** 订单详情: 用户 / 明细 / 支付 / 退款 / 券与活动 / 会员套餐 一次取全 */
  async orderDetail(id: string) {
    return this.prisma.order
      .findUnique({
        where: { id },
        include: {
          user: { select: { id: true, email: true, name: true, role: true } },
          items: true,
          payments: { orderBy: { createdAt: "desc" } },
          refunds: { orderBy: { createdAt: "desc" } },
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
      })
      .then((order) => {
        if (!order) throw new AppError(40400, "订单不存在", 404);
        /*
         * 详情与列表必须给同一个「实付」：历史订单 paidCents 为空时回落应付
         * 总额、0 元单显示 0。这里不能用原始字段 —— 那会让同一笔订单在列表
         * 与抽屉里显示两个数字，退款上限也跟着算错。
         */
        return { ...order, paidCents: effectivePaidCents(order) };
      });
  }

  /**
   * 删除一笔未支付订单。
   *
   * 订单一旦产生支付、退款、积分、会员、发票、对账或工单记录就是业务证据，不能物理删除。
   * 这里只放行 pending / cancelled，并在删除前重新核对所有关联；待支付订单占用的
   * 库存要随订单一起释放，否则删除测试单会让库存永久少卖。
   */
  async deleteOrder(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        orderNo: true,
        status: true,
        totalCents: true,
        refundedCents: true,
        grantedCredits: true,
        paidAt: true,
        providerPaidAt: true,
        providerTradeNo: true,
        membershipAppliedAt: true,
        stockReserved: true,
        membership: { select: { id: true } },
        items: {
          select: {
            productId: true,
            quantity: true,
            stockReservedSnapshot: true,
          },
        },
        payments: { select: { id: true }, take: 1 },
        refunds: { select: { id: true }, take: 1 },
        invoices: { select: { id: true }, take: 1 },
        membershipUsage: { select: { id: true }, take: 1 },
      },
    });
    if (!order) throw new AppError(40400, "订单不存在", 404);

    if (order.status !== "pending" && order.status !== "cancelled") {
      throw new AppError(
        40901,
        "只有待支付或已取消订单可删除；已支付订单请通过退款流程处理",
        409,
      );
    }

    /*
     * 支付尝试（即使失败）、退款、积分批次/流水、会员、发票、对账和工单证据都禁止删除。
     * 先给出可解释的 409，避免把数据库外键错误直接暴露给运营。
     */
    const [
      creditLots,
      legacyLedger,
      creditLedgerEntries,
      notifications,
      exceptions,
      reconciliation,
      legacyReconciliation,
      tickets,
    ] = await Promise.all([
      this.prisma.creditLot.count({ where: { orderId: id } }),
      this.prisma.creditLedger.count({ where: { orderId: id } }),
      this.prisma.creditLedgerEntry.count({ where: { paymentOrderId: id } }),
      this.prisma.paymentNotification.count({
        where: { OR: [{ orderId: id }, { merchantOrderNo: order.orderNo }] },
      }),
      this.prisma.paymentExceptionCase.count({
        where: { OR: [{ orderId: id }, { merchantOrderNo: order.orderNo }] },
      }),
      this.prisma.paymentReconciliationItem.count({
        where: { OR: [{ orderId: id }, { merchantOrderNo: order.orderNo }] },
      }),
      // 旧对账明细与工单只保存字符串引用，没有数据库外键兜底。
      this.prisma.reconciliationItem.count({ where: { orderId: id } }),
      this.prisma.ticket.count({ where: { orderId: id } }),
    ]);

    const hasFinancialHistory =
      order.refundedCents > 0 ||
      order.grantedCredits > 0 ||
      order.paidAt !== null ||
      order.providerPaidAt !== null ||
      order.providerTradeNo !== null ||
      order.membershipAppliedAt !== null ||
      order.membership !== null ||
      order.payments.length > 0 ||
      order.refunds.length > 0 ||
      order.invoices.length > 0 ||
      order.membershipUsage.length > 0 ||
      creditLots +
        legacyLedger +
        creditLedgerEntries +
        notifications +
        exceptions +
        reconciliation +
        legacyReconciliation +
        tickets >
        0;
    if (hasFinancialHistory) {
      throw new AppError(
        40901,
        "该订单已有支付、退款、积分、会员、发票、对账或工单关联，不能删除；请保留订单用于追溯",
        409,
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        if (order.stockReserved) {
          const reserved = new Map<string, number>();
          for (const item of order.items) {
            const quantity = item.stockReservedSnapshot ?? 0;
            if (quantity > 0) {
              reserved.set(
                item.productId,
                (reserved.get(item.productId) ?? 0) + quantity,
              );
            }
          }
          for (const [productId, quantity] of reserved) {
            const released = await tx.product.updateMany({
              where: { id: productId, stockReserved: { gte: quantity } },
              data: { stockReserved: { decrement: quantity } },
            });
            if (released.count === 0) {
              throw new AppError(
                40901,
                "订单库存占用状态异常，请刷新后重试",
                409,
              );
            }
          }
        }

        // OrderItem 是必填外键，先删明细再删订单；状态条件防止与支付回调并发误删。
        // paidCents 是应付金额，不是已支付金额，不能作为删除条件。
        await tx.orderItem.deleteMany({ where: { orderId: id } });
        const deleted = await tx.order.deleteMany({
          where: { id, status: { in: ["pending", "cancelled"] } },
        });
        if (deleted.count === 0) {
          throw new AppError(40909, "订单状态已变化，请刷新后重试", 409);
        }
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2003") {
        throw new AppError(
          40901,
          "该订单刚刚产生了关联记录，不能删除；请刷新后确认",
          409,
        );
      }
      throw error;
    }

    return { id: order.id, orderNo: order.orderNo };
  }

  /**
   * 订单导出 (CSV)。金额列同时给分与元, 财务按元核对, 技术按分回查。
   *
   * 超过 `EXPORT_LIMIT` 直接拒绝, **不静默截断**: 这是财务对账的交付物,
   * 少几行的 CSV 看起来和正常文件一模一样，对账差额永远查不出来。口径与
   * 支付域导出 (`payment-admin.service.ts` 超限报错) 保持一致。
   */
  async exportOrders(q: OrderListQuery): Promise<string> {
    const where = this.orderWhere(q);
    const total = await this.prisma.order.count({ where });
    if (total > EXPORT_LIMIT) {
      throw new AppError(
        40001,
        `筛选结果共 ${total} 单，超过单次导出上限 ${EXPORT_LIMIT} 单，请缩小时间范围后分批导出`,
        400,
      );
    }

    const rows = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: EXPORT_LIMIT,
      include: {
        user: { select: { email: true } },
        items: { select: { nameSnapshot: true, skuSnapshot: true } },
        membershipPlan: { select: { code: true } },
        payments: { select: { status: true, channel: true } },
      },
    });

    const columns: CsvColumn<(typeof rows)[number]>[] = [
      { label: "订单号", value: (order) => order.orderNo },
      { label: "用户邮箱", value: (order) => order.user?.email ?? "" },
      {
        label: "状态",
        value: (order) => ORDER_STATUS_LABELS[order.status] ?? order.status,
      },
      { label: "支付渠道", value: (order) => order.channel ?? "" },
      { label: "订单金额(分)", value: (order) => order.totalCents },
      { label: "订单金额(元)", value: (order) => centsToYuan(order.totalCents) },
      { label: "优惠(分)", value: (order) => order.discountCents ?? 0 },
      { label: "实付(分)", value: (order) => effectivePaidCents(order) },
      {
        label: "实付(元)",
        value: (order) => centsToYuan(effectivePaidCents(order)),
      },
      { label: "已退(分)", value: (order) => order.refundedCents },
      { label: "赠送积分", value: (order) => order.grantedCredits },
      {
        label: "商品",
        value: (order) =>
          order.items
            .map((item) => `${item.nameSnapshot}(${item.skuSnapshot})`)
            .join(" / "),
      },
      {
        label: "会员套餐",
        value: (order) => order.membershipPlan?.code ?? "",
      },
      { label: "下单时间", value: (order) => order.createdAt },
      { label: "支付时间", value: (order) => order.paidAt },
    ];
    return toCsv(columns, rows);
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
      if (!order) throw new AppError(40400, "订单不存在", 404);
      const res = await this.orders.markPaid({
        orderId: id,
        userId: order.userId,
        payTransactionId: `MANUAL-BATCH-${actorId}-${id}`,
        channel: "manual",
      });
      return {
        orderId: id,
        idempotentHit:
          (res as { idempotentHit?: boolean }).idempotentHit ?? false,
      };
    });
  }
}
