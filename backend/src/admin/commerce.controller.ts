import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import type { Response } from "express";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { AdminUser, RequireAllPermissions, RequirePermission } from "./admin.decorator";
import { AppError } from "../common/app.exception";
import { OrderService } from "../orders/order.service";
import { CreditService } from "../credits/credit.service";
import { AdminCommerceProductService } from "./commerce/product-admin.service";
import { AdminCommerceOrderService } from "./commerce/order-admin.service";
import { AdminCommercePaymentService } from "./commerce/payment-admin.service";
import { AdminCommerceCreditService } from "./commerce/credit-admin.service";
import { AdminSettingsService } from "./settings.service";
import { PERMISSIONS } from "./permissions";
import { PageQueryDto } from "./dto/page-query.dto";
import { sendCsv } from "../common/csv-response";

/** 商品上/下架 */
export class ProductStatusDto {
  @IsIn(["active", "offline"]) status!: "active" | "offline";
}

/** 新建商品 */
export class ProductCreateDto {
  /** SKU 一经创建不可改 —— 历史订单与外部对账都靠它认商品 */
  @IsString() @MaxLength(40) sku!: string;
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(20) type?: string;
  /** 整数分。0 = 免费发放 */
  @IsInt() @Min(0) priceCents!: number;
  @IsOptional() @IsInt() @Min(0) originalPriceCents?: number;
  /** 购买赠送的积分数 */
  @IsInt() @Min(0) credits!: number;
  /** 积分有效期天数, 0 = 永久 */
  @IsOptional() @IsInt() @Min(0) creditsValidDays?: number;
  @IsOptional() @IsIn(["immediate", "manual"]) grantType?:
    "immediate" | "manual";
  @IsOptional() @IsIn(["active", "offline"]) status?: "active" | "offline";
  @IsOptional() @IsInt() sortOrder?: number;
  /** 收款币种。USD 商品只有存在可用美元渠道时才允许上架 */
  @IsOptional() @IsIn(["CNY", "USD"]) currency?: "CNY" | "USD";
  /** 上架策略：不限量 / 周期限购 / 库存 / 限时 */
  @IsOptional()
  @IsIn(["unlimited", "periodic", "inventory", "timed"])
  saleStrategy?: "unlimited" | "periodic" | "inventory" | "timed";
  @IsOptional() @IsInt() @Min(1) @Max(365) periodDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(999) periodPurchaseLimit?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) stockTotal?: number;
  /** 限时售卖窗口；接受 yyyy-mm-dd / yyyy-mm-ddTHH:mm */
  @IsOptional() @IsString() saleStartAt?: string | null;
  @IsOptional() @IsString() saleEndAt?: string | null;
}

/** 修改商品。sku 不可改, 故不在此列 */
export class ProductUpdateDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsInt() @Min(0) priceCents?: number;
  @IsOptional() @IsInt() @Min(0) originalPriceCents?: number;
  @IsOptional() @IsInt() @Min(0) credits?: number;
  @IsOptional() @IsInt() @Min(0) creditsValidDays?: number;
  @IsOptional() @IsIn(["immediate", "manual"]) grantType?:
    "immediate" | "manual";
  @IsOptional() @IsIn(["active", "offline"]) status?: "active" | "offline";
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsIn(["CNY", "USD"]) currency?: "CNY" | "USD";
  @IsOptional()
  @IsIn(["unlimited", "periodic", "inventory", "timed"])
  saleStrategy?: "unlimited" | "periodic" | "inventory" | "timed";
  @IsOptional() @IsInt() @Min(1) @Max(365) periodDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(999) periodPurchaseLimit?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) stockTotal?: number;
  @IsOptional() @IsString() saleStartAt?: string | null;
  @IsOptional() @IsString() saleEndAt?: string | null;
}

/** 退款 */
export class RefundDto {
  @IsInt() @Min(1) amountCents!: number;
  /** 退款原因。强制填写 */
  @IsString() @MaxLength(200) reason!: string;
}

/**
 * 手工核销。
 *
 * `note` 是「为什么这笔钱算是收到了」的依据（线下转账凭证号、渠道商户后台
 * 查到的交易号等）。接口保持可选以兼容脚本调用；后台界面强制填写 —— 人工
 * 入账没有渠道报文，这段文字是事后唯一的凭据。
 */
export class MarkPaidDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** 异步退款人工核销：必须先到渠道商户后台核实最终结果 */
export class RefundConfirmDto {
  @IsIn(["succeeded", "failed"])
  outcome!: "succeeded" | "failed";

  @IsOptional()
  @IsString()
  @MaxLength(120)
  providerRefundId?: string;

  @IsString()
  @IsNotEmpty({ message: "请填写人工核销依据" })
  @MaxLength(300)
  reason!: string;
}

/**
 * 人工调整积分 (B-52)。
 *
 * 字段名用 **delta** 而非 amount —— delta 明确表达「有正负的变动量」,
 * amount 会被误解为「金额」或「绝对值」, 后者会让"扣减"无法表达。
 *
 * `reason` 可选：有具体业务依据时写入流水备注；未填写时由系统按增减方向
 * 生成稳定说明；操作人与目标用户随积分流水保存。
 */
export class AdjustCreditDto {
  @IsString() userId!: string;
  /** 正数为增加, 负数为扣减, 不能为 0 */
  @IsInt() delta!: number;
  /** 调整备注。写入积分流水；留空时由服务端生成系统说明 */
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
  @IsOptional() @IsInt() @Min(0) validDays?: number;
  /** 幂等键：同一次调整的重试必须复用，避免超时后重复加减积分 */
  @IsOptional() @IsString() @MaxLength(80) idempotencyKey?: string;
}

/**
 * 批量调整积分。
 *
 * 上限 100 条: 再大应走导入任务, 而不是一个可能超时 30s 的同步请求。
 *
 * `reason` 整批共用；逐条可再带 `reason` 覆盖（批量里往往有个别「特殊补偿」）。
 */
export class BatchAdjustItemDto {
  @IsString() userId!: string;
  @IsInt() delta!: number;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class BatchAdjustDto {
  @IsArray()
  @ArrayMaxSize(100, { message: "单次批量调整最多 100 条" })
  @ValidateNested({ each: true })
  @Type(() => BatchAdjustItemDto)
  items!: BatchAdjustItemDto[];

  /** 整批共用的调整备注（可选；单条可用自己的 reason 覆盖） */
  @IsOptional() @IsString() @MaxLength(200) reason?: string;

  /**
   * 幂等键（建议前端在打开抽屉时生成一次，重试时原样复用）。
   * 缺省时服务端按请求生成，此时重试无法防重。
   */
  @IsOptional() @IsString() @MaxLength(80) idempotencyKey?: string;

  @IsOptional() @IsInt() @Min(0) validDays?: number;
}

/** 批量核销订单。 */
export class OrderBatchDto {
  @IsArray()
  @ArrayMaxSize(100, { message: "单次批量最多 100 条" })
  @IsString({ each: true })
  ids!: string[];

  @IsIn(["mark_paid"], { message: "action 只能是 mark_paid" })
  action!: "mark_paid";
}

/** 积分 CSV 导入的整批默认值（multipart 文本字段） */
export class CreditImportDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  validDays?: number;

  /**
   * 幂等键。导入是 500 行级别的写操作，超时重试必须有防重手段：
   * 前端在选好文件后生成一次，重试时原样带上。
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  importKey?: string;
}

/** 订单列表 / 导出查询。列表与导出共用筛选, 分页字段在导出时被忽略 */
export class AdminOrderListQueryDto extends PageQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() orderNo?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() channel?: string;
  @IsOptional() @IsString() refundState?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() userId?: string;
}

/** 支付流水列表 / 导出查询 */
export class AdminPaymentListQueryDto extends PageQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

/** 用户积分总览 / 导出查询 */
export class AdminCreditListQueryDto extends PageQueryDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() email?: string;
}

/** 积分对账扫描条数。上限 5000 属对账场景的存量豁免 (远大于分页上限):
 *  逐批扫描全量账户才能发现等式破裂, 不是面向用户的分页列表 */
export class CreditAuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "limit 必须是整数" })
  @Min(1, { message: "limit 最小为 1" })
  @Max(5000, { message: "limit 最大为 5000" })
  limit?: number;
}

/** 积分流水查询。limit 上限 200 与 service 端收敛值一致 */
export class AdminCreditLedgerQueryDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  businessType?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "limit 必须是整数" })
  @Min(1, { message: "limit 最小为 1" })
  @Max(200, { message: "limit 最大为 200" })
  limit?: number;
}

/** 积分批次明细查询 (时间范围) */
export class CreditLotsQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

/**
 * 交易后台 (admin-prd.md §3.6~3.9)。
 *
 * 权限点分离:
 *   product.read/write  商品
 *   order.read/refund   订单
 *   payment.read        支付流水
 *   credit.read/adjust  积分
 *   data.export         任何 CSV 导出 (导出即把用户数据带出系统)
 *
 * 所有写操作都必须经过独立权限校验。
 * 查询与规则在 commerce/ 下的四个领域服务, 本控制器只做权限/参数/响应。
 */
@Controller("admin")
export class AdminCommerceController {
  constructor(
    private readonly orders: OrderService,
    private readonly productAdmin: AdminCommerceProductService,
    private readonly orderAdmin: AdminCommerceOrderService,
    private readonly paymentAdmin: AdminCommercePaymentService,
    private readonly creditAdmin: AdminCommerceCreditService,
    private readonly credit: CreditService,
    private readonly settings: AdminSettingsService,
  ) {}

  // ── 商品 (B-34~B-36) ────────────────────────────────────────────

  /** 商品列表 */
  @Get("products")
  @RequirePermission(PERMISSIONS.productRead)
  products(@Query("status") status?: string) {
    return this.productAdmin.listProducts(status);
  }

  /** 新建商品。默认下架, 确认无误后再上架 */
  @Post("products")
  @RequirePermission(PERMISSIONS.productWrite)
  createProduct(@Body() dto: ProductCreateDto) {
    // DTO → 领域入参显式映射: service 不感知 class-validator
    return this.productAdmin.createProduct({
      sku: dto.sku,
      name: dto.name,
      description: dto.description,
      type: dto.type,
      priceCents: dto.priceCents,
      originalPriceCents: dto.originalPriceCents,
      credits: dto.credits,
      creditsValidDays: dto.creditsValidDays,
      grantType: dto.grantType,
      status: dto.status,
      sortOrder: dto.sortOrder,
      currency: dto.currency,
      saleStrategy: dto.saleStrategy,
      periodDays: dto.periodDays,
      periodPurchaseLimit: dto.periodPurchaseLimit,
      stockTotal: dto.stockTotal,
      saleStartAt: dto.saleStartAt,
      saleEndAt: dto.saleEndAt,
    });
  }

  /**
   * 修改商品。
   *
   * 改价不影响已生成的订单 —— 订单存的是下单时快照, 这是交易系统的基本约定。
   */
  @Patch("products/:id")
  @RequirePermission(PERMISSIONS.productWrite)
  updateProduct(@Param("id") id: string, @Body() dto: ProductUpdateDto) {
    return this.productAdmin.updateProduct(id, {
      name: dto.name,
      description: dto.description,
      priceCents: dto.priceCents,
      originalPriceCents: dto.originalPriceCents,
      credits: dto.credits,
      creditsValidDays: dto.creditsValidDays,
      grantType: dto.grantType,
      status: dto.status,
      sortOrder: dto.sortOrder,
      currency: dto.currency,
      saleStrategy: dto.saleStrategy,
      periodDays: dto.periodDays,
      periodPurchaseLimit: dto.periodPurchaseLimit,
      stockTotal: dto.stockTotal,
      saleStartAt: dto.saleStartAt,
      saleEndAt: dto.saleEndAt,
    });
  }

  /** 上架/ 下架 (B-36)。下架不影响历史订单 */
  @Patch("products/:id/status")
  @RequirePermission(PERMISSIONS.productWrite)
  async setProductStatus(
    @Param("id") id: string,
    @Body() dto: ProductStatusDto,
  ) {
    const product = await this.productAdmin.updateProduct(id, {
      status: dto.status,
    });
    return { id: product.id, status: product.status };
  }

  /**
   * 删除商品（物理删除）。
   *
   * 只允许删除没有历史订单的 SKU；已有订单返回 409 并提示改为下架 ——
   * 退款与积分回收要回查该 SKU 的原价与发放积分，记录必须留着。
   */
  @Delete("products/:id")
  @RequirePermission(PERMISSIONS.productDelete)
  deleteProduct(@Param("id") id: string) {
    return this.productAdmin.deleteProduct(id);
  }

  // ── 订单 (B-39~B-44) ─────────────────────────────────────────────

  /**
   * 订单列表。
   *
   * 支持 orderNo / email / status / channel / 时间范围 过滤:
   * 客服拿着"用户邮箱 + 大概日期"来问，是最高频的排障入口。
   */
  @Get("orders")
  @RequirePermission(PERMISSIONS.orderRead)
  orderList(@Query() query: AdminOrderListQueryDto) {
    return this.orderAdmin.listOrders(query);
  }

  /**
   * 订单导出 (CSV)。
   *
   * 用 @Res() 直接写响应: 全局 ResponseInterceptor 会把返回值包成
   * `{code,data}` JSON, 那样浏览器拿到的是一个 JSON 字符串而不是可下载的文件。
   */
  @Get("orders/export")
  @RequireAllPermissions(PERMISSIONS.orderRead, PERMISSIONS.dataExport)
  async exportOrders(@Res() res: Response, @Query() query: AdminOrderListQueryDto) {
    const csv = await this.orderAdmin.exportOrders({
      status: query.status,
      orderNo: query.orderNo,
      email: query.email,
      channel: query.channel,
      refundState: query.refundState,
      productId: query.productId,
      from: query.from,
      to: query.to,
    });
    sendCsv(res, "orders", csv);
  }

  /** 订单详情 (B-41): 明细 / 支付 / 退款 / 券 / 会员套餐一次取全 */
  @Get("orders/:id")
  @RequirePermission(PERMISSIONS.orderRead)
  orderDetail(@Param("id") id: string) {
    return this.orderAdmin.orderDetail(id);
  }

  /**
   * 删除订单。仅允许没有支付/退款/积分/会员/发票/对账/工单关联的
   * 待支付或已取消订单；已支付订单保留并走退款流程。
   */
  @Delete("orders/:id")
  @RequirePermission(PERMISSIONS.orderDelete)
  deleteOrder(@Param("id") id: string) {
    return this.orderAdmin.deleteOrder(id);
  }

  /** 手工核销 (B-42): 标记已支付 */
  @Post("orders/:id/mark-paid")
  @RequirePermission(PERMISSIONS.orderMarkPaid)
  async markPaid(
    @Param("id") id: string,
    @Body() dto: MarkPaidDto,
    @AdminUser() actor: AdminUser,
  ) {
    const order = await this.orderAdmin.orderDetail(id);
    return this.orders.markPaid({
      orderId: id,
      userId: order.userId,
      payTransactionId: `MANUAL-${actor.id}-${Date.now()}`,
      channel: "manual",
      note: dto?.note?.trim() || undefined,
    });
  }

  /**
   * 批量核销（B7）。
   *
   * 权限直接用 `order.mark_paid`（本端点只有一个动作，静态装饰器足够）。
   * 逐条返回结果：40 笔里有一笔已退款、两笔已被渠道回调核销，
   * 运营需要知道具体是哪几笔、为什么。
   */
  @Post("orders/batch")
  @RequirePermission(PERMISSIONS.orderMarkPaid)
  batchMarkPaid(@Body() dto: OrderBatchDto, @AdminUser() actor: AdminUser) {
    return this.orderAdmin.batchMarkPaid(dto.ids, actor.id);
  }

  /**
   * 退款 (B-43 + B8 规则): 按批次剩余量扣回。
   *
   * 规则（时间窗 / 可退比例 / 是否允许已消耗积分退款）在提交这一刻从设置里
   * 读出并冻结, 交给 `OrderService.refund` 判定 —— 判定逻辑留在订单域,
   * 这样将来 C 端自助退款接同一套服务时不会漏规则。
   */
  @Post("orders/:id/refund")
  @RequirePermission(PERMISSIONS.orderRefund)
  async refund(
    @Param("id") id: string,
    @Body() dto: RefundDto,
    @AdminUser() actor: AdminUser,
  ) {
    const rules = await this.settings.refundRules();
    return this.orders.refund({
      orderId: id,
      amountCents: dto.amountCents,
      reason: dto.reason,
      operatorId: actor.id,
      rules,
    });
  }

  /**
   * 异步退款人工核销。
   *
   * 渠道返回 PROCESSING 后，订单与积分都保持未变；运营在商户后台确认最终
   * 结果后调用本接口。成功会原子扣回积分并推进订单，失败则只关闭退款单。
   */
  @Post("orders/:id/refunds/:refundId/confirm")
  @RequirePermission(PERMISSIONS.orderRefund)
  confirmRefund(
    @Param("id") id: string,
    @Param("refundId") refundId: string,
    @Body() dto: RefundConfirmDto,
    @AdminUser() actor: AdminUser,
  ) {
    return this.orders.confirmRefund({
      orderId: id,
      refundId,
      outcome: dto.outcome,
      providerRefundId: dto.providerRefundId,
      reason: dto.reason,
      operatorId: actor.id,
    });
  }

  // ── 支付流水 (B-45) ─────────────────────────────────────────────

  @Get("payments")
  @RequirePermission(PERMISSIONS.paymentRead)
  payments(@Query() query: AdminPaymentListQueryDto) {
    return this.paymentAdmin.listPayments({
      status: query.status,
      pageSize: query.pageSize,
      from: query.from,
      to: query.to,
    });
  }

  /** 支付流水导出 (CSV)。同订单导出：必须直接写文件流，不能走统一信封 */
  @Get("payments/export")
  @RequireAllPermissions(PERMISSIONS.paymentRead, PERMISSIONS.dataExport)
  async exportPayments(@Res() res: Response, @Query() query: AdminPaymentListQueryDto) {
    const csv = await this.paymentAdmin.exportPayments({
      status: query.status,
      from: query.from,
      to: query.to,
    });
    sendCsv(res, "payments", csv);
  }

  // ── 积分 (B-49~B-52) ────────────────────────────────────────────

  /** 用户积分总览 (B-49) */
  @Get("credits")
  @RequirePermission(PERMISSIONS.creditRead)
  credits(@Query() query: AdminCreditListQueryDto) {
    return this.creditAdmin.listCredits({
      userId: query.userId,
      email: query.email,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /** 积分总览导出 (CSV)。同订单导出：必须直接写文件流，不能走统一信封 */
  @Get("credits/export")
  @RequireAllPermissions(PERMISSIONS.creditRead, PERMISSIONS.dataExport)
  async exportCredits(@Res() res: Response, @Query() query: AdminCreditListQueryDto) {
    const csv = await this.creditAdmin.exportCredits({
      userId: query.userId,
      email: query.email,
    });
    sendCsv(res, "credits", csv);
  }

  /**
   * 账实核对：比对「账户可用」与「Σ 批次剩余」。
   *
   * 冻结量不参与等式 —— 预留是「可用 -X、冻结 +X，同时批次 -X」，
   * 已冻结部分在预留时就离开了批次。
   *
   * 只读，不修数。积分体系有两条必须相等的余额（账户权威 / 批次权威），
   * 任何一处绕过钱包直接改批次都会让等式破裂，而破裂后**所有扣费都会失败**。
   * 此前只在注释里承诺「每日对账」，实际没有检测入口。
   */
  @Get("credits/audit")
  @RequirePermission(PERMISSIONS.creditRead)
  auditCredits(@Query() query: CreditAuditQueryDto) {
    return this.credit.auditConsistency(query.limit ?? 500);
  }

  /** 某用户的批次明细 (B-50) */
  @Get("credits/:userId/lots")
  @RequirePermission(PERMISSIONS.creditRead)
  lots(@Param("userId") userId: string, @Query() query: CreditLotsQueryDto) {
    return this.creditAdmin.creditLots(userId, { from: query.from, to: query.to });
  }

  /** 某用户的流水 (B-51), 可按类型与时间过滤 */
  @Get("credits/:userId/ledger")
  @RequirePermission(PERMISSIONS.creditRead)
  ledger(@Param("userId") userId: string, @Query() query: AdminCreditLedgerQueryDto) {
    return this.creditAdmin.creditLedger(userId, {
      type: query.type,
      businessType: query.businessType,
      from: query.from,
      to: query.to,
      limit: query.limit,
    });
  }

  /** 人工增减积分 (B-52)。备注可选，操作人随积分流水保存。 */
  @Post("credits/adjust")
  @RequirePermission(PERMISSIONS.creditAdjust)
  adjust(@Body() dto: AdjustCreditDto, @AdminUser() actor: AdminUser) {
    return this.credit.adminAdjust({
      userId: dto.userId,
      delta: dto.delta,
      reason: dto.reason,
      operatorId: actor.id,
      validDays: dto.validDays,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  /**
   * 批量调整积分。逐条独立执行并回传每条结果。
   *
   * 幂等键按「操作人 + 批次号」生成，由前端在打开抽屉时生成并随提交带上：
   * 超时重试不会二次发放。缺省时服务端生成一次性键（此时重试无保护，
   * 前端不传即等于放弃该保护）。
   */
  @Post("credits/batch-adjust")
  @RequirePermission(PERMISSIONS.creditAdjust)
  batchAdjust(@Body() dto: BatchAdjustDto, @AdminUser() actor: AdminUser) {
    return this.creditAdmin.batchAdjust(dto.items, {
      operatorId: actor.id,
      validDays: dto.validDays,
      reason: dto.reason,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  /**
   * 积分 CSV 导入（B7）。
   *
   * 列格式：`email,delta[,reason]`，首行可选表头（`email` / `邮箱`）。
   * 用邮箱定位用户而不是用户 id —— 运营手里的表格从来只有邮箱。
   *
   * 为什么走 `credit.adjust` 而不是通用数据工具权限：这不是"导入一批数据"，
   * 这是**给钱**。CSV 只是输入格式，权限应当跟着动作走，否则没有
   * `credit.adjust` 的角色就能靠导入绕过积分权限。
   *
   * `delta` 为负即扣减，与人工调整同一套规则（余额不足整条失败，
   * 失败原因原样回传，不写成通用文案）。
   */
  @Post("credits/import")
  @RequirePermission(PERMISSIONS.creditAdjust)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      // 2MB ≈ 数万行，足够运营的一次活动补发；再大应拆批
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async importCredits(
    @UploadedFile()
    file: Express.Multer.File | undefined,
    @Body() dto: CreditImportDto,
    @AdminUser() actor: AdminUser,
  ) {
    if (!file?.buffer?.length) {
      throw new AppError(40001, "请上传 CSV 文件（字段名 file）", 400);
    }
    return this.creditAdmin.importCreditsCsv(file.buffer.toString("utf8"), {
      validDays: dto.validDays,
      operatorId: actor.id,
      importKey: dto.importKey,
    });
  }
}
