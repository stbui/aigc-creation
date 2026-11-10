import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreditService,
  emptyBalanceSummary,
  microcreditsToCredits,
  projectEntry,
} from "../credits/credit.service";
import { OrderService } from "../orders/order.service";
import { AppError } from "../common/app.exception";
import { runBatch } from "../common/batch";
import { buildPage, paginate, type PageQueryDto } from "./dto/page-query.dto";
import { centsToYuan, parseCsv, toCsv, type CsvColumn } from "../common/csv";
import { PaymentConfigService } from "../payments/payment-config.service";

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
  grantType?: "immediate" | "manual";
  status?: "active" | "offline";
  sortOrder?: number;
  /** CNY | USD */
  currency?: string;
  /** unlimited | periodic | inventory | timed */
  saleStrategy?: string;
  periodDays?: number;
  periodPurchaseLimit?: number;
  stockTotal?: number;
  saleStartAt?: string | null;
  saleEndAt?: string | null;
}

export interface ProductUpdateInput {
  name?: string;
  description?: string;
  priceCents?: number;
  originalPriceCents?: number | null;
  credits?: number;
  creditsValidDays?: number;
  grantType?: "immediate" | "manual";
  status?: "active" | "offline";
  sortOrder?: number;
  currency?: string;
  saleStrategy?: string;
  periodDays?: number;
  periodPurchaseLimit?: number;
  stockTotal?: number;
  saleStartAt?: string | null;
  saleEndAt?: string | null;
}

export interface OrderListQuery {
  status?: string;
  orderNo?: string;
  email?: string;
  channel?: string;
  /**
   * 按商品筛选：只回买过这个 SKU 的订单。
   *
   * 走 `OrderItem.productId` 而不是 SKU 快照字符串 —— 快照里有 SKU 编码，
   * 但同一编码可能对应重建后的新商品；订单项指向的是下单时那件商品本身。
   */
  productId?: string;
  /**
   * 退款状态 (2026-10-29)。
   *
   * 退款状态挂在 `Refund` 而不是订单上：一笔订单可能多次部分退款，且渠道
   * 异步处理时订单仍是 `paid`。告警中心深链到 `?refundState=processing`
   * 时靠这个筛选把「钱已受理但未确认到账」的订单捞出来。
   */
  refundState?: string;
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
  "pending",
  "paid",
  "cancelled",
  "refunded",
  "partial_refunded",
] as const;

/** `Refund.status` 的合法取值, 与退款落库路径保持一致 */
const REFUND_STATES = ["processing", "failed", "succeeded"] as const;

/**
 * 一笔订单的退款状态（列表列展示用）。
 *
 * 一笔订单可能有多笔退款单（部分退款会按笔落库），同一笔退款的渠道重试
 * 则是同一行改状态。列上只显示一个值，取**最需要人管的那个**：
 * 处理中 > 失败 > 成功。
 *
 * 为什么不是「最新一笔」：筛选 `?refundState=failed` 用的是 `some` 命中任意
 * 一笔退款单，列若只取最新一笔，运营按「退款失败」筛出来会看到空的列 ——
 * 列与筛选条件不同源。取聚合值保证「筛得到的每一行，列上一定看得到原因」。
 */
function latestRefundState(
  refunds: Array<{ status: string }>,
): 'processing' | 'failed' | 'succeeded' | null {
  let state: 'processing' | 'failed' | 'succeeded' | null = null;
  for (const refund of refunds) {
    if (refund.status === 'processing') return 'processing';
    if (refund.status === 'failed') state = 'failed';
    else if (refund.status === 'succeeded' && !state) state = 'succeeded';
  }
  return state;
}

const LEDGER_TYPES = [
  "purchase",
  "grant",
  "consume",
  "admin_adjust",
  "expire",
  "refund_reclaim",
  "reserve",
  "refund",
] as const;

const GRANT_TYPES = ["immediate", "manual"] as const;
const PRODUCT_STATUSES = ["active", "offline"] as const;
const PRODUCT_CURRENCIES = ["CNY", "USD"] as const;
const SALE_STRATEGIES = ["unlimited", "periodic", "inventory", "timed"] as const;

/**
 * 新建商品的默认排序权重。
 *
 * 取 100 而不是 0: 排序值「小的靠前」, 新商品默认插到现有商品之后,
 * 而不是和排在最前的老商品挤在同一档里。若运营明确要置顶, 在表单里改小即可。
 */
const PRODUCT_DEFAULT_SORT_ORDER = 100;

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
 *   现在 controller 只做权限与参数处理, 查询与规则在本服务。
 *
 * 约定:
 *   · 所有金额是**整数分**, 只有导出 CSV 时转成元 (人要对账的是元)
 *   · 所有时间过滤的 `to` 含当天 —— 运营输入 10-21 期望包含 10-21 全天
 *   · 写操作只负责业务规则与持久化
 */
@Injectable()
export class AdminCommerceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credit: CreditService,
    private readonly orders: OrderService,
    /*
     * 美元商品上架前要确认存在可用的 USD 收款渠道，否则用户下单才发现
     * 「没有可用的支付方式」。判定按渠道配置实时读，不看缓存的商品状态。
     */
    private readonly paymentConfigs: PaymentConfigService,
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
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      // 删除按钮要按订单数禁用/放行, 列表里一并带上, 免去逐张卡片再查一次
      include: { _count: { select: { orderItems: true } } },
    });
    return list.map((p) => this.toProductView(p));
  }

  async createProduct(input: ProductCreateInput) {
    this.assertProductNumbers(
      input.priceCents,
      input.credits,
      input.creditsValidDays,
    );
    this.assertOriginalPrice(input.originalPriceCents ?? null, input.priceCents);
    const sale = this.normalizeSaleFields(input, null);
    await this.assertCurrencySellable(
      String(sale.currency),
      input.status ?? "offline",
    );
    const exists = await this.prisma.product.findUnique({
      where: { sku: input.sku },
    });
    if (exists) throw new AppError(40001, `SKU 已存在: ${input.sku}`, 400);

    const product = await this.prisma.product.create({
      data: {
        sku: input.sku.trim(),
        name: input.name.trim(),
        description: input.description ?? "",
        type: input.type ?? "credits",
        priceCents: input.priceCents,
        originalPriceCents: input.originalPriceCents ?? null,
        credits: input.credits,
        creditsValidDays: input.creditsValidDays ?? 0,
        grantType: input.grantType ?? "immediate",
        status: input.status ?? "offline",
        sortOrder: input.sortOrder ?? PRODUCT_DEFAULT_SORT_ORDER,
        ...sale,
      },
      include: { _count: { select: { orderItems: true } } },
    });
    return this.toProductView(product);
  }

  async updateProduct(id: string, input: ProductUpdateInput) {
    const current = await this.prisma.product.findUnique({ where: { id } });
    if (!current) throw new AppError(40400, "商品不存在", 404);

    // 只校验本次要改的数值字段; 未传的沿用库里的值 (它们创建时已校验过)
    this.assertProductNumbers(
      input.priceCents ?? current.priceCents,
      input.credits ?? current.credits,
      input.creditsValidDays ?? current.creditsValidDays,
    );
    this.assertOriginalPrice(
      input.originalPriceCents !== undefined
        ? input.originalPriceCents
        : current.originalPriceCents,
      input.priceCents ?? current.priceCents,
    );
    const sale = this.normalizeSaleFields(input, current);
    await this.assertCurrencySellable(
      String(sale.currency),
      input.status ?? current.status,
    );

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.priceCents !== undefined
          ? { priceCents: input.priceCents }
          : {}),
        ...(input.originalPriceCents !== undefined
          ? { originalPriceCents: input.originalPriceCents }
          : {}),
        ...(input.credits !== undefined ? { credits: input.credits } : {}),
        ...(input.creditsValidDays !== undefined
          ? { creditsValidDays: input.creditsValidDays }
          : {}),
        ...(input.grantType !== undefined
          ? { grantType: input.grantType }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.sortOrder !== undefined
          ? { sortOrder: input.sortOrder }
          : {}),
        ...sale,
      },
      include: { _count: { select: { orderItems: true } } },
    });
    return this.toProductView(product);
  }

  /**
   * 上架策略 / 币种 / 库存 / 售卖窗口的归一化与校验。
   *
   * 创建时 `current` 为 null，全部走默认值；更新时未传的字段沿用库里现值 ——
   * 只改名的请求不会因为库里是库存商品就被要求重填库存。
   * 切换策略时清空旧策略的专属字段，避免「改成不限量后库存还挂在那里」。
   */
  private normalizeSaleFields(
    input: ProductCreateInput | ProductUpdateInput,
    current: {
      currency: string;
      saleStrategy: string;
      periodDays: number;
      periodPurchaseLimit: number;
      stockTotal: number;
      stockSold: number;
      stockReserved: number;
      saleStartAt: Date | null;
      saleEndAt: Date | null;
    } | null,
  ): Record<string, unknown> {
    const strategy = String(
      input.saleStrategy ?? current?.saleStrategy ?? "unlimited",
    );
    if (!(SALE_STRATEGIES as readonly string[]).includes(strategy)) {
      throw new AppError(40001, "上架策略非法", 400);
    }
    const currency = String(input.currency ?? current?.currency ?? "CNY");
    if (!(PRODUCT_CURRENCIES as readonly string[]).includes(currency)) {
      throw new AppError(40001, "币种只支持 CNY / USD", 400);
    }

    if (strategy === "periodic") {
      const days = Number(input.periodDays ?? current?.periodDays ?? 0);
      const limit = Number(
        input.periodPurchaseLimit ?? current?.periodPurchaseLimit ?? 0,
      );
      if (days <= 0 || limit <= 0) {
        throw new AppError(40001, "周期购买需要同时填写周期天数与限购次数", 400);
      }
      if (days > 365) throw new AppError(40001, "周期天数不能超过 365 天", 400);
      if (limit > 999) {
        throw new AppError(40001, "周期限购次数不能超过 999", 400);
      }
      return {
        currency,
        saleStrategy: strategy,
        periodDays: days,
        periodPurchaseLimit: limit,
        stockTotal: 0,
        saleStartAt: null,
        saleEndAt: null,
      };
    }

    if (strategy === "inventory") {
      const total = Number(input.stockTotal ?? current?.stockTotal ?? 0);
      /*
       * 0 不是「不限量」：下单校验按 `stockTotal - stockSold - stockReserved`
       * 计算，0 会让任何购买都报库存不足。库存商品必须显式填写正数，
       * 且不能小于已售 + 已占用（否则等于把已发生的售卖算成超卖）。
       */
      if (total < 1) {
        throw new AppError(40001, "库存商品必须填写大于 0 的库存总量", 400);
      }
      if (total > 1_000_000) {
        throw new AppError(40001, "库存总量不能超过 1,000,000", 400);
      }
      if (current && total < current.stockSold + current.stockReserved) {
        throw new AppError(40001, "库存总量不能小于已售 + 已占用", 400);
      }
      return {
        currency,
        saleStrategy: strategy,
        periodDays: 0,
        periodPurchaseLimit: 0,
        stockTotal: total,
        saleStartAt: null,
        saleEndAt: null,
      };
    }

    if (strategy === "timed") {
      const start =
        input.saleStartAt !== undefined
          ? parseShanghai(input.saleStartAt)
          : (current?.saleStartAt ?? null);
      const end =
        input.saleEndAt !== undefined
          ? parseShanghai(input.saleEndAt)
          : (current?.saleEndAt ?? null);
      if (!start || !end) {
        throw new AppError(40001, "限时商品必须填写开始与结束时间", 400);
      }
      if (start.getTime() >= end.getTime()) {
        throw new AppError(40001, "开售时间必须早于结束时间", 400);
      }
      return {
        currency,
        saleStrategy: strategy,
        periodDays: 0,
        periodPurchaseLimit: 0,
        stockTotal: 0,
        saleStartAt: start,
        saleEndAt: end,
      };
    }

    return {
      currency,
      saleStrategy: "unlimited",
      periodDays: 0,
      periodPurchaseLimit: 0,
      stockTotal: 0,
      saleStartAt: null,
      saleEndAt: null,
    };
  }

  private async assertCurrencySellable(
    currency: string,
    status: string,
  ): Promise<void> {
    if (currency !== "USD" || status !== "active") return;
    // 商品币种能否上架取决于真实渠道能力，而不是 C 端两个可见按钮的
    // 路由结果：PayPal / Stripe 支持 USD，但不属于可见方式解析链路。
    const available = await this.paymentConfigs.available("USD");
    if (available.length === 0) {
      throw new AppError(
        40001,
        "当前没有支持 USD 的可用支付渠道，不能上架美元商品",
        400,
      );
    }
  }

  /**
   * 删除商品（物理删除）。
   *
   * 只允许删除**没有任何历史订单**的 SKU：
   *   · `OrderItem.productId` 是 `ON DELETE RESTRICT` 外键，有订单时数据库本来就删不掉；
   *   · 退款与积分回收要回查该 SKU 的原价与发放积分，删掉后对账无从追溯。
   *
   * 因此先数订单并给运营一句能照着做的话（改为下架），而不是把外键报错原样抛出。
   * 已售罄但订单已清空的商品仍可删；SKU 是 `@unique`，删除后编码可复用。
   */
  async deleteProduct(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        sku: true,
        _count: { select: { orderItems: true } },
      },
    });
    if (!product) throw new AppError(40400, "商品不存在", 404);

    const orderCount = product._count.orderItems;
    if (orderCount > 0) {
      throw new AppError(
        40901,
        `该商品已有 ${orderCount} 笔历史订单，不能删除；请改为下架`,
        409,
      );
    }

    /*
     * 计数与删除之间可能刚产生一笔订单：外键 RESTRICT 会在这里拦住。
     * 转成同一条 409 提示，不把 P2003 原样抛成 500。
     */
    try {
      await this.prisma.product.delete({ where: { id } });
    } catch (error) {
      if ((error as { code?: string }).code === "P2003") {
        throw new AppError(
          40901,
          "该商品刚刚产生了历史订单，不能删除；请改为下架",
          409,
        );
      }
      throw error;
    }
    return { id, sku: product.sku };
  }

  /** 价格 / 积分 / 有效期三项数值校验。创建与修改共用，口径必须一致 */
  private assertProductNumbers(
    priceCents: number,
    credits: number,
    validDays = 0,
  ): void {
    if (!Number.isInteger(priceCents) || priceCents < 0) {
      throw new AppError(40001, "商品价格必须是非负整数分", 400);
    }
    if (!Number.isInteger(credits) || credits < 0) {
      throw new AppError(40001, "赠送积分必须是非负整数", 400);
    }
    if (!Number.isInteger(validDays) || validDays < 0) {
      throw new AppError(40001, "积分有效期必须是非负整数天", 400);
    }
  }

  /**
   * 划线价只用于展示对比，但低于售价会显示成「省 -x 元」。
   *
   * 前端表单会拦一次；后端仍必须拦 —— 接口不只有后台页面这一个调用方。
   */
  private assertOriginalPrice(
    originalPriceCents: number | null,
    priceCents: number,
  ): void {
    if (originalPriceCents === null) return;
    if (!Number.isInteger(originalPriceCents) || originalPriceCents < 0) {
      throw new AppError(40001, "划线价必须是非负整数分", 400);
    }
    if (originalPriceCents < priceCents) {
      throw new AppError(40001, "划线价不能低于售价", 400);
    }
  }

  private toProductView(p: any) {
    const remaining = p.stockTotal - p.stockSold - p.stockReserved;
    let saleStatus = "on_sale";
    /*
     * 售卖窗口按服务端时钟判定：前端按浏览器时区算会在跨时区运营时
     * 把「已开售」显示成「未开始」，下单校验却按服务端走，两边打架。
     */
    if (p.status !== "active") saleStatus = "disabled";
    else if (p.saleStrategy === "timed" && p.saleStartAt && Date.now() < p.saleStartAt.getTime()) {
      saleStatus = "upcoming";
    } else if (p.saleStrategy === "timed" && p.saleEndAt && Date.now() > p.saleEndAt.getTime()) {
      saleStatus = "ended";
    } else if (p.saleStrategy === "inventory" && remaining <= 0) {
      saleStatus = "sold_out";
    }

    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      type: p.type,
      currency: p.currency,
      priceCents: p.priceCents,
      originalPriceCents: p.originalPriceCents,
      credits: p.credits,
      creditsValidDays: p.creditsValidDays,
      grantType: p.grantType,
      status: p.status,
      sortOrder: p.sortOrder,
      saleStrategy: p.saleStrategy,
      periodDays: p.periodDays,
      periodPurchaseLimit: p.periodPurchaseLimit,
      stockTotal: p.stockTotal,
      stockReserved: p.stockReserved,
      stockSold: p.stockSold,
      stockRemaining: remaining,
      saleStartAt: p.saleStartAt ? p.saleStartAt.toISOString() : null,
      saleEndAt: p.saleEndAt ? p.saleEndAt.toISOString() : null,
      saleStatus,
      canPurchase: saleStatus === "on_sale",
      /** 历史订单数。> 0 时不可删除, 前台据此拦截并提示改为下架 */
      orderCount: p._count?.orderItems ?? 0,
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

    const range = this.dateRange(q.from, q.to);
    if (range) where.createdAt = range;
    return where;
  }

  async listOrders(q: OrderListQuery) {
    const page = buildPage(
      { page: q.page, pageSize: q.pageSize, sort: q.sort } as PageQueryDto,
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
        include: {
          user: { select: { email: true } },
          // 明细只取快照名与 SKU：订单页要能看出买的是哪件商品，
          // 商品被删除或改名都不影响这里（快照是下单时的值）
          items: { select: { id: true, nameSnapshot: true, skuSnapshot: true } },
          payments: { select: { id: true } },
          /*
           * 退款单要带上状态：退款状态挂在 `Refund` 而不是订单上，
           * 渠道异步退款时订单仍是 `paid`。列表若只给订单状态，运营
           * 「筛得出却看不出是哪单」—— 状态列必须与筛选条件同源。
           */
          refunds: { select: { status: true } },
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
        userEmail: o.user?.email ?? "",
        status: o.status,
        channel: o.channel,
        totalCents: o.totalCents,
        discountCents: o.discountCents ?? 0,
        paidCents: o.paidCents > 0 ? o.paidCents : o.totalCents,
        refundedCents: o.refundedCents,
        grantedCredits: o.grantedCredits,
        itemCount: o.items.length,
        /** 快照名 + SKU，按明细顺序；列表只说「N 件商品」等于没说买了什么 */
        items: o.items.map((i: any) => ({
          name: i.nameSnapshot,
          sku: i.skuSnapshot,
        })),
        paymentCount: o.payments.length,
        /*
         * 退款状态列：与筛选口径（`some` 命中任意一笔退款单）同源，
         * 收敛成一个值 —— processing / failed / succeeded 都可能同时存在，
         * 列上只显示最需要人管的那一个：处理中 > 失败 > 成功。
         */
        refundState: latestRefundState(o.refunds),
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
      .then((o) => {
        if (!o) throw new AppError(40400, "订单不存在", 404);
        return o;
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
              reserved.set(item.productId, (reserved.get(item.productId) ?? 0) + quantity);
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
          throw new AppError(
            40909,
            "订单状态已变化，请刷新后重试",
            409,
          );
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

  /** 订单导出 (CSV)。金额列同时给分与元, 财务按元核对, 技术按分回查 */
  async exportOrders(q: OrderListQuery): Promise<string> {
    const rows = await this.prisma.order.findMany({
      where: this.orderWhere(q),
      orderBy: { createdAt: "desc" },
      take: EXPORT_LIMIT,
      include: {
        user: { select: { email: true } },
        items: { select: { nameSnapshot: true, skuSnapshot: true } },
        membershipPlan: { select: { code: true } },
      },
    });

    const columns: CsvColumn<(typeof rows)[number]>[] = [
      { label: "订单号", value: (o) => o.orderNo },
      { label: "用户邮箱", value: (o) => o.user?.email ?? "" },
      {
        label: "状态",
        value: (o) => ORDER_STATUS_LABELS[o.status] ?? o.status,
      },
      { label: "支付渠道", value: (o) => o.channel ?? "" },
      { label: "订单金额(分)", value: (o) => o.totalCents },
      { label: "订单金额(元)", value: (o) => centsToYuan(o.totalCents) },
      { label: "优惠(分)", value: (o) => o.discountCents ?? 0 },
      {
        label: "实付(分)",
        value: (o) => (o.paidCents > 0 ? o.paidCents : o.totalCents),
      },
      {
        label: "实付(元)",
        value: (o) => centsToYuan(o.paidCents > 0 ? o.paidCents : o.totalCents),
      },
      { label: "已退(分)", value: (o) => o.refundedCents },
      { label: "赠送积分", value: (o) => o.grantedCredits },
      {
        label: "商品",
        value: (o: any) =>
          o.items
            .map((i: any) => `${i.nameSnapshot}(${i.skuSnapshot})`)
            .join(" / "),
      },
      { label: "会员套餐", value: (o: any) => o.membershipPlan?.code ?? "" },
      { label: "下单时间", value: (o) => o.createdAt },
      { label: "支付时间", value: (o) => o.paidAt },
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

  async listPayments(q: PaymentListQuery) {
    const take = Math.min(q.pageSize ?? 50, 200);
    const list = await this.prisma.payment.findMany({
      where: this.paymentWhere(q),
      orderBy: { createdAt: "desc" },
      take,
      include: {
        order: { select: { orderNo: true } },
        user: { select: { email: true } },
      },
    });
    return list.map((p: any) => ({
      id: p.id,
      orderNo: p.order?.orderNo ?? "",
      orderId: p.orderId,
      userEmail: p.user?.email ?? "",
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
      orderBy: { createdAt: "desc" },
      take: EXPORT_LIMIT,
      include: {
        order: { select: { orderNo: true } },
        user: { select: { email: true } },
      },
    });
    const columns: CsvColumn<(typeof rows)[number]>[] = [
      { label: "订单号", value: (p: any) => p.order?.orderNo ?? "" },
      { label: "用户邮箱", value: (p: any) => p.user?.email ?? "" },
      { label: "渠道", value: (p) => p.channel },
      { label: "渠道流水号", value: (p) => p.payTransactionId },
      { label: "金额(分)", value: (p) => p.amountCents },
      { label: "金额(元)", value: (p) => centsToYuan(p.amountCents) },
      { label: "状态", value: (p) => p.status },
      { label: "说明", value: (p) => p.message ?? "" },
      { label: "沙箱场景", value: (p) => p.sandboxScenario ?? "" },
      { label: "支付时间", value: (p) => p.paidAt ?? "" },
      { label: "创建时间", value: (p) => p.createdAt },
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
    const page = buildPage(
      query as PageQueryDto,
      ["createdAt"],
      "createdAt:desc",
    );
    const where: Record<string, unknown> = {};
    if (query.userId) where.id = query.userId;
    if (query.email) where.email = { contains: query.email };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: { createdAt: "desc" },
        select: { id: true, email: true, name: true, createdAt: true },
      }),
      this.prisma.user.count({ where }),
    ]);

    // 当前页用户一次分组聚合；逐用户调用 balanceOf 会放大成 4×N 次查询
    const summaries = await this.credit.balancesOf(users.map((u) => u.id));
    const items = users.map((u) => {
      const s = summaries.get(u.id);
      return {
        userId: u.id,
        email: u.email,
        name: u.name,
        balance: s?.balance ?? 0,
        expiringSoon: s?.expiringSoon ?? 0,
        totalEarned: s?.totalEarned ?? 0,
        totalConsumed: s?.totalConsumed ?? 0,
        activeLots: s?.activeLots ?? 0,
        nearestExpiry: s?.nearestExpiry ?? null,
      };
    });
    return paginate(items, total, page);
  }

  /**
   * 积分批次（后台只读）。
   *
   * 库里的金额是 BigInt 微积分，必须投影成积分口径再出参 —— 直接返回 Prisma 行
   * 会让 `JSON.stringify` 在 BigInt 上抛错。`status` 与 C 端口径保持一致。
   */
  async creditLots(userId: string, query: { from?: string; to?: string } = {}) {
    const range = this.dateRange(query.from, query.to);
    const rows = await this.prisma.creditLot.findMany({
      where: { userId, ...(range ? { createdAt: range } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const now = Date.now();
    return rows.map((row) => {
      const remaining = microcreditsToCredits(row.remainingMicrocredits);
      return {
        id: row.id,
        userId: row.userId,
        source: row.source,
        orderId: row.orderId,
        totalCredits: microcreditsToCredits(row.totalMicrocredits),
        remainingCredits: remaining,
        expireAt: row.expireAt,
        createdAt: row.createdAt,
        status:
          remaining <= 0
            ? "exhausted"
            : row.expireAt && row.expireAt.getTime() <= now
              ? "expired"
              : "active",
      };
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
    const rows = await this.prisma.creditLedgerEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(projectEntry);
  }

  /**
   * 批量调整积分。
   *
   * 逐条独立执行并回传每条结果: 批量操作里一条失败不该让其余 99 条不生效,
   * 但失败必须逐条列出来 —— 否则运营看到"已完成"却少了一条, 只能靠对账发现。
   * 失败原因不改写成通用文案, 保留 service 抛出的原始提示 (如"余额不足")。
   *
   * ## 幂等
   *
   * 每条按 `batch:{operatorId}:{batchKey}:{rowNo}` 落幂等键。同一批重试时
   * 已成功的行直接命中已有流水、不再二次发放；`batchKey` 由调用方传入
   * （前端在打开抽屉时生成一次），缺省则按本次请求生成随机值 —— 那种情况下
   * 重试**没有**防重保护，属于调用方主动放弃。
   *
   * 行号参与键：同一批里同一用户可能出现两次（如「先补 100 再扣 20」），
   * 只用 userId 做键会把第二行误判成重试。
   */
  async batchAdjust(
    items: Array<{ userId: string; delta?: number; reason?: string }>,
    shared: {
      operatorId: string;
      validDays?: number;
      reason?: string;
      idempotencyKey?: string;
    },
  ) {
    const results: Array<{
      userId: string;
      success: boolean;
      balance?: number;
      message?: string;
      idempotentHit?: boolean;
    }> = [];

    const reason = String(shared.reason ?? "").trim();
    const batchKey = String(shared.idempotencyKey ?? "").trim() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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

    for (const [index, item] of items.entries()) {
      const delta = item.delta ?? 0;
      if (!known.has(item.userId)) {
        results.push({
          userId: item.userId,
          success: false,
          message: "用户不存在",
        });
        continue;
      }
      try {
        const r = await this.credit.adminAdjust({
          userId: item.userId,
          delta,
          // 单条可覆盖整批原因（批量里常有「个别特殊补偿」）
          reason: String(item.reason ?? "").trim() || reason || undefined,
          operatorId: shared.operatorId,
          validDays: shared.validDays,
          idempotencyKey: `batch:${shared.operatorId}:${batchKey}:${index}`,
        });
        results.push({
          userId: item.userId,
          success: true,
          balance: r.balance,
          ...(r.idempotentHit ? { idempotentHit: true } : {}),
        });
      } catch (e: any) {
        results.push({
          userId: item.userId,
          success: false,
          message: e?.message ?? "调整失败",
        });
      }
    }
    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      // 重试时命中的行数，便于运营判断「这次是不是重复提交」
      idempotentHits: results.filter((r) => r.idempotentHit).length,
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
   *   · **说明稳定**。逐行 `reason` 列优先，缺省用固定说明；
   *     积分账本必须能解释每一笔变动。
   *
   * 权限口径见 controller：走 `credit.adjust` 而非通用导入权限，这是给钱。
   */
  async importCreditsCsv(
    text: string,
    opts: { validDays?: number; operatorId: string; importKey?: string },
  ) {
    const rows = parseCsv(text);
    if (rows.length === 0) {
      throw new AppError(40001, "CSV 内容为空", 400);
    }

    // 表头可选：运营自己用 Excel 导出的文件通常带表头，程序生成的往往不带
    const first = rows[0].map((c) => c.trim().toLowerCase());
    const hasHeader = ["email", "邮箱", "e-mail"].includes(first[0] ?? "");
    const body = hasHeader ? rows.slice(1) : rows;

    if (body.length === 0) {
      throw new AppError(40001, "CSV 只有表头，没有数据行", 400);
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
      const email = (cells[0] ?? "").trim();
      const rawDelta = (cells[1] ?? "").trim();
      const reason = (cells[2] ?? "").trim();
      const delta = /^[+-]?\d+$/.test(rawDelta) ? Number(rawDelta) : Number.NaN;
      let error: string | undefined;
      if (!email) error = "缺少邮箱";
      else if (!rawDelta) error = "缺少调整值";
      else if (Number.isNaN(delta)) error = `调整值必须是整数：${rawDelta}`;
      else if (delta === 0) error = "调整值不能为 0";
      return {
        row,
        email,
        delta: Number.isNaN(delta) ? undefined : delta,
        reason: reason || undefined,
        error,
      };
    });

    // 邮箱一律小写比对：库内是注册时 toLowerCase 存的，表格里常有大写
    const wanted = Array.from(
      new Set(parsed.filter((p) => p.email).map((p) => p.email.toLowerCase())),
    );
    const users = await this.prisma.user.findMany({
      where: { email: { in: wanted } },
      select: { id: true, email: true },
    });
    const idByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

    /*
     * 缺省说明不再是「CSV 导入用户积分」这种等于没写的固定文案：
     * 带上文件名以外的可辨识信息（行号由幂等键体现），并明确要求
     * 运营在第三列写清原因 —— 积分账本要能回答「为什么给他加」。
     */
    const sharedReason = "CSV 导入用户积分（未填写逐行原因）";
    /* 导入批次的幂等前缀：同一份文件重复提交时，已成功的行不再二次发放 */
    const importKey =
      String(opts.importKey ?? "").trim() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const results: Array<{
      row: number;
      email: string;
      delta: number;
      success: boolean;
      balance?: number;
      message?: string;
      idempotentHit?: boolean;
    }> = [];

    for (const item of parsed) {
      if (item.error || !item.delta) {
        results.push({
          row: item.row,
          email: item.email,
          delta: item.delta ?? 0,
          success: false,
          message: item.error ?? "数据非法",
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
          message: "用户不存在",
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
          // 行号而非邮箱做键：同一文件里同一邮箱可能出现多行（补发 + 扣减）
          idempotencyKey: `import:${opts.operatorId}:${importKey}:${item.row}`,
        });
        results.push({
          row: item.row,
          email: item.email,
          delta: item.delta,
          success: true,
          balance: r.balance,
          ...(r.idempotentHit ? { idempotentHit: true } : {}),
        });
      } catch (e: any) {
        results.push({
          row: item.row,
          email: item.email,
          delta: item.delta,
          success: false,
          message: e?.message ?? "调整失败",
        });
      }
    }

    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      idempotentHits: results.filter((r) => r.idempotentHit).length,
      results,
    };
  }

  async exportCredits(query: {
    userId?: string;
    email?: string;
  }): Promise<string> {
    const where: Record<string, unknown> = {};
    if (query.userId) where.id = query.userId;
    if (query.email) where.email = { contains: query.email };
    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: EXPORT_LIMIT,
      select: { id: true, email: true, name: true },
    });

    const summaries = await this.credit.balancesOf(users.map((u) => u.id));
    const rows = users.map((u) => ({
      ...u,
      summary: summaries.get(u.id) ?? emptyBalanceSummary(),
    }));
    const columns: CsvColumn<(typeof rows)[number]>[] = [
      { label: "用户ID", value: (r) => r.id },
      { label: "邮箱", value: (r) => r.email },
      { label: "昵称", value: (r) => r.name },
      { label: "当前余额", value: (r) => r.summary.balance },
      { label: "30天内到期", value: (r) => r.summary.expiringSoon },
      { label: "累计获得", value: (r) => r.summary.totalEarned },
      { label: "累计消耗", value: (r) => r.summary.totalConsumed },
      { label: "有效批次", value: (r) => r.summary.activeLots },
      { label: "最近到期", value: (r) => r.summary.nearestExpiry ?? "" },
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
  private dateRange(
    from?: string,
    to?: string,
  ): { gte?: Date; lte?: Date } | undefined {
    const parse = (
      raw: string | undefined,
      endOfDay: boolean,
    ): Date | undefined => {
      if (!raw?.trim()) return undefined;
      const value = raw.trim();
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
      const d = new Date(
        dateOnly
          ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`
          : value,
      );
      if (Number.isNaN(d.getTime()))
        throw new AppError(40001, `日期格式非法: ${value}`, 400);
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
  pending: "待支付",
  paid: "已支付",
  cancelled: "已取消",
  refunded: "已退款",
  partial_refunded: "部分退款",
};

/**
 * 后台输入的时间按 Asia/Shanghai 解释，数据库存 UTC。
 *
 * 接受 `yyyy-mm-dd`、`yyyy-mm-ddTHH:mm`（datetime-local 的原生格式）与
 * `yyyy-mm-dd HH:mm`；不带时区的值补 `+08:00`，不是交给 `new Date` 按
 * 服务器本地时区猜 —— 容器通常在 UTC，猜出来会整体偏 8 小时。
 */
function parseShanghai(value: unknown): Date | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T00:00:00+08:00`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)
      ? `${text}:00+08:00`
      : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)
        ? `${text.replace(" ", "T")}:00+08:00`
        : text;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(40001, `时间格式非法: ${text}`, 400);
  }
  return date;
}
