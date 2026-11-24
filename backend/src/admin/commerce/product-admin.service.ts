import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import type { Product } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AppError } from "../../common/app.exception";
import { PaymentConfigService } from "../../payments/payment-config.service";
import {
  PRODUCT_CURRENCIES,
  PRODUCT_DEFAULT_SORT_ORDER,
  PRODUCT_STATUSES,
  SALE_STRATEGIES,
  type ProductCreateInput,
  type ProductUpdateInput,
} from "./commerce-admin.types";
import { parseShanghai } from "./commerce-admin.util";

type ProductWithOrderCount = Prisma.ProductGetPayload<{
  include: { _count: { select: { orderItems: true } } };
}>;

type ProductSaleState = Pick<
  Product,
  | "currency"
  | "saleStrategy"
  | "periodDays"
  | "periodPurchaseLimit"
  | "stockTotal"
  | "stockSold"
  | "stockReserved"
  | "saleStartAt"
  | "saleEndAt"
>;

/** 归一化后的上架字段；同时可直接展开进 create / update 的 data */
interface NormalizedSaleFields {
  currency: string;
  saleStrategy: string;
  periodDays: number;
  periodPurchaseLimit: number;
  stockTotal: number;
  saleStartAt: Date | null;
  saleEndAt: Date | null;
}

/**
 * 后台商品管理。
 *
 * 约定:
 *   · 所有金额是**整数分**, 只有导出 CSV 时转成元 (人要对账的是元)
 *   · sku 只在创建时给 —— 改 sku 会让历史订单快照与商品对不上号
 */
@Injectable()
export class AdminCommerceProductService {
  constructor(
    private readonly prisma: PrismaService,
    /*
     * 美元商品上架前要确认存在可用的 USD 收款渠道，否则用户下单才发现
     * 「没有可用的支付方式」。判定按渠道配置实时读，不看缓存的商品状态。
     */
    private readonly paymentConfigs: PaymentConfigService,
  ) {}

  async listProducts(status?: string) {
    const where: Prisma.ProductWhereInput = {};
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
    return list.map((product) => this.toProductView(product));
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
    current: ProductSaleState | null,
  ): NormalizedSaleFields {
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

  private toProductView(product: ProductWithOrderCount) {
    const remaining =
      product.stockTotal - product.stockSold - product.stockReserved;
    let saleStatus = "on_sale";
    /*
     * 售卖窗口按服务端时钟判定：前端按浏览器时区算会在跨时区运营时
     * 把「已开售」显示成「未开始」，下单校验却按服务端走，两边打架。
     */
    if (product.status !== "active") saleStatus = "disabled";
    else if (
      product.saleStrategy === "timed" &&
      product.saleStartAt &&
      Date.now() < product.saleStartAt.getTime()
    ) {
      saleStatus = "upcoming";
    } else if (
      product.saleStrategy === "timed" &&
      product.saleEndAt &&
      Date.now() > product.saleEndAt.getTime()
    ) {
      saleStatus = "ended";
    } else if (product.saleStrategy === "inventory" && remaining <= 0) {
      saleStatus = "sold_out";
    }

    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      type: product.type,
      currency: product.currency,
      priceCents: product.priceCents,
      originalPriceCents: product.originalPriceCents,
      credits: product.credits,
      creditsValidDays: product.creditsValidDays,
      grantType: product.grantType,
      status: product.status,
      sortOrder: product.sortOrder,
      saleStrategy: product.saleStrategy,
      periodDays: product.periodDays,
      periodPurchaseLimit: product.periodPurchaseLimit,
      stockTotal: product.stockTotal,
      stockReserved: product.stockReserved,
      stockSold: product.stockSold,
      stockRemaining: remaining,
      saleStartAt: product.saleStartAt ? product.saleStartAt.toISOString() : null,
      saleEndAt: product.saleEndAt ? product.saleEndAt.toISOString() : null,
      saleStatus,
      canPurchase: saleStatus === "on_sale",
      /** 历史订单数。> 0 时不可删除, 前台据此拦截并提示改为下架 */
      orderCount: product._count?.orderItems ?? 0,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }
}
