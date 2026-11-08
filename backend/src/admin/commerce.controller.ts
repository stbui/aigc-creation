import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
import {
  AuditAction,
  AdminUser,
  RequireAllPermissions,
  RequirePermission,
} from "./admin.decorator";
import { AppError } from "../common/app.exception";
import { OrderService } from "../orders/order.service";
import { CreditService } from "../credits/credit.service";
import { CreditPriceService } from "../credits/credit-price.service";
import { AdminCommerceService } from "./commerce-admin.service";
import { AdminSettingsService } from "./settings.service";
import { PERMISSIONS } from "./permissions";
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
}

/** 退款 */
export class RefundDto {
  @IsInt() @Min(1) amountCents!: number;
  /** 退款原因。强制填写 */
  @IsString() @MaxLength(200) reason!: string;
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
 * 生成稳定说明，操作人、目标用户和动作仍由审计日志自动记录。
 */
export class AdjustCreditDto {
  @IsString() userId!: string;
  /** 正数为增加, 负数为扣减, 不能为 0 */
  @IsInt() delta!: number;
  /** 调整备注。写入积分流水；留空时由服务端生成系统说明 */
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
  @IsOptional() @IsInt() @Min(0) validDays?: number;
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

/** 单项消耗价 */
export class CreditPriceItemDto {
  @IsString() @MaxLength(40) capabilityId!: string;
  /** 非负整数。0 = 该能力免费 */
  @IsInt() @Min(0) @Max(10000) cost!: number;
}

/**
 * 批量改价 (commerce-design.md §8.2 `PUT /admin/credit-prices`)。
 *
 * 数组而非对象: class-validator 的属性名不能带点号, 消耗价的 key 是
 * `creditPrice.<capabilityId>` 这种动态形式, 走扁平 DTO 表达不了。
 */
export class UpdateCreditPricesDto {
  @IsArray() @ArrayMaxSize(50) items!: CreditPriceItemDto[];
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

/** 把 query 里的数字安全转成 number; 非法值给 undefined 让 service 用默认值 */
function num(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
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
 * ⚠ 所有写操作都带 @AuditAction —— 交易域的每一次改动都必须可追责。
 * 查询与规则在 AdminCommerceService, 本控制器只做权限/参数/响应。
 */
@Controller("admin")
export class AdminCommerceController {
  constructor(
    private readonly orders: OrderService,
    private readonly commerce: AdminCommerceService,
    private readonly credit: CreditService,
    private readonly creditPrice: CreditPriceService,
    private readonly settings: AdminSettingsService,
  ) {}

  // ── 能力消耗价 (commerce-design.md §4.4) ──────────────────────────

  /**
   * 全站能力消耗价。
   *
   * 每项同时返回 `cost`(生效价) / `registryDefault`(代码默认) / `source`,
   * 让运营一眼看出「这个价现在是谁在管」—— 改价页上不标明来源,
   * 就会出现「我改了没生效」时无法判断该改哪一层。
   */
  @Get("credit-prices")
  @RequirePermission(PERMISSIONS.productPrice)
  creditPrices() {
    return this.creditPrice.adminList();
  }

  /**
   * 批量改价。逐项落库并即时失效缓存 —— 改完立刻生效, 不必等 3s TTL。
   *
   * ⚠ 写审计: 定价是影响收入的关键操作, 必须能回答「这个价谁在什么时候改的」。
   */
  @Put("credit-prices")
  @RequirePermission(PERMISSIONS.productPrice)
  @AuditAction("credit.price_update")
  async updateCreditPrices(@Body() dto: UpdateCreditPricesDto) {
    if (!dto.items?.length) {
      throw new AppError(40001, "没有需要更新的消耗价", 400);
    }
    const updated = [];
    for (const it of dto.items) {
      updated.push(await this.creditPrice.setPrice(it.capabilityId, it.cost));
    }
    return { updated };
  }

  /** 单项回落默认值 (删掉 SystemSetting 覆盖, 回到 registry) */
  @Post("credit-prices/:capabilityId/reset")
  @RequirePermission(PERMISSIONS.productPrice)
  @AuditAction("credit.price_reset")
  resetCreditPrice(@Param("capabilityId") capabilityId: string) {
    return this.creditPrice.resetPrice(capabilityId);
  }

  // ── 商品 (B-34~B-36) ────────────────────────────────────────────

  /** 商品列表 */
  @Get("products")
  @RequirePermission(PERMISSIONS.productRead)
  products(@Query("status") status?: string) {
    return this.commerce.listProducts(status);
  }

  /** 新建商品。默认下架, 确认无误后再上架 */
  @Post("products")
  @RequirePermission(PERMISSIONS.productWrite)
  @AuditAction("product.create")
  createProduct(@Body() dto: ProductCreateDto) {
    return this.commerce.createProduct(dto);
  }

  /**
   * 修改商品。
   *
   * 改价不影响已生成的订单 —— 订单存的是下单时快照, 这是交易系统的基本约定。
   */
  @Patch("products/:id")
  @RequirePermission(PERMISSIONS.productWrite)
  @AuditAction("product.update")
  updateProduct(@Param("id") id: string, @Body() dto: ProductUpdateDto) {
    return this.commerce.updateProduct(id, dto);
  }

  /** 上架/ 下架 (B-36)。下架不影响历史订单 */
  @Patch("products/:id/status")
  @RequirePermission(PERMISSIONS.productWrite)
  @AuditAction("product.status_change")
  async setProductStatus(
    @Param("id") id: string,
    @Body() dto: ProductStatusDto,
  ) {
    const product = await this.commerce.updateProduct(id, {
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
  @AuditAction("product.delete")
  deleteProduct(@Param("id") id: string) {
    return this.commerce.deleteProduct(id);
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
  orderList(
    @Query("status") status?: string,
    @Query("orderNo") orderNo?: string,
    @Query("email") email?: string,
    @Query("channel") channel?: string,
    @Query("refundState") refundState?: string,
    @Query("productId") productId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("userId") userId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("sort") sort?: string,
  ) {
    return this.commerce.listOrders({
      status,
      orderNo,
      email,
      channel,
      refundState,
      productId,
      from,
      to,
      page: num(page),
      pageSize: num(pageSize),
      sort,
    });
  }

  /**
   * 订单导出 (CSV)。
   *
   * 用 @Res() 直接写响应: 全局 ResponseInterceptor 会把返回值包成
   * `{code,data}` JSON, 那样浏览器拿到的是一个 JSON 字符串而不是可下载的文件。
   */
  @Get("orders/export")
  @RequireAllPermissions(PERMISSIONS.orderRead, PERMISSIONS.dataExport)
  @AuditAction("data.export")
  async exportOrders(
    @Res() res: Response,
    @Query("status") status?: string,
    @Query("orderNo") orderNo?: string,
    @Query("email") email?: string,
    @Query("channel") channel?: string,
    @Query("refundState") refundState?: string,
    @Query("productId") productId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const csv = await this.commerce.exportOrders({
      status,
      orderNo,
      email,
      channel,
      refundState,
      productId,
      from,
      to,
    });
    sendCsv(res, "orders", csv);
  }

  /** 订单详情 (B-41): 明细 / 支付 / 退款 / 券 / 会员套餐一次取全 */
  @Get("orders/:id")
  @RequirePermission(PERMISSIONS.orderRead)
  orderDetail(@Param("id") id: string) {
    return this.commerce.orderDetail(id);
  }

  /** 手工核销 (B-42): 标记已支付, 须写审计 */
  @Post("orders/:id/mark-paid")
  @RequirePermission(PERMISSIONS.orderMarkPaid)
  @AuditAction("order.mark_paid")
  async markPaid(@Param("id") id: string, @AdminUser() actor: AdminUser) {
    const order = await this.commerce.orderDetail(id);
    return this.orders.markPaid({
      orderId: id,
      userId: order.userId,
      payTransactionId: `MANUAL-${actor.id}-${Date.now()}`,
      channel: "manual",
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
  @AuditAction("order.batch")
  batchMarkPaid(@Body() dto: OrderBatchDto, @AdminUser() actor: AdminUser) {
    return this.commerce.batchMarkPaid(dto.ids, actor.id);
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
  @AuditAction("order.refund")
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
  @AuditAction("order.refund_confirm")
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
  payments(
    @Query("status") status?: string,
    @Query("pageSize") pageSize?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.commerce.listPayments({
      status,
      pageSize: num(pageSize),
      from,
      to,
    });
  }

  @Get("payments/export")
  @RequireAllPermissions(PERMISSIONS.paymentRead, PERMISSIONS.dataExport)
  @AuditAction("data.export")
  async exportPayments(
    @Res() res: Response,
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const csv = await this.commerce.exportPayments({ status, from, to });
    sendCsv(res, "payments", csv);
  }

  // ── 积分 (B-49~B-52) ────────────────────────────────────────────

  /** 用户积分总览 (B-49) */
  @Get("credits")
  @RequirePermission(PERMISSIONS.creditRead)
  credits(
    @Query("userId") userId?: string,
    @Query("email") email?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.commerce.listCredits({
      userId,
      email,
      page: num(page),
      pageSize: num(pageSize),
    });
  }

  /** 积分总览导出 (CSV) */
  @Get("credits/export")
  @RequireAllPermissions(PERMISSIONS.creditRead, PERMISSIONS.dataExport)
  @AuditAction("data.export")
  async exportCredits(
    @Res() res: Response,
    @Query("userId") userId?: string,
    @Query("email") email?: string,
  ) {
    const csv = await this.commerce.exportCredits({ userId, email });
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
  auditCredits(@Query("limit") limit?: string) {
    const n = num(limit);
    return this.credit.auditConsistency(n !== undefined && n > 0 ? Math.min(n, 5000) : 500);
  }

  /** 某用户的批次明细 (B-50) */
  @Get("credits/:userId/lots")
  @RequirePermission(PERMISSIONS.creditRead)
  lots(
    @Param("userId") userId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.commerce.creditLots(userId, { from, to });
  }

  /** 某用户的流水 (B-51), 可按类型与时间过滤 */
  @Get("credits/:userId/ledger")
  @RequirePermission(PERMISSIONS.creditRead)
  ledger(
    @Param("userId") userId: string,
    @Query("type") type?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ) {
    return this.commerce.creditLedger(userId, {
      type,
      from,
      to,
      limit: num(limit),
    });
  }

  /** 人工增减积分 (B-52)。备注可选，动作与操作人由审计自动留痕。 */
  @Post("credits/adjust")
  @RequirePermission(PERMISSIONS.creditAdjust)
  @AuditAction("credit.adjust")
  adjust(@Body() dto: AdjustCreditDto, @AdminUser() actor: AdminUser) {
    return this.credit.adminAdjust({
      userId: dto.userId,
      delta: dto.delta,
      reason: dto.reason,
      operatorId: actor.id,
      validDays: dto.validDays,
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
  @AuditAction("credit.batch_adjust")
  batchAdjust(@Body() dto: BatchAdjustDto, @AdminUser() actor: AdminUser) {
    return this.commerce.batchAdjust(dto.items, {
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
  @AuditAction("credit.import")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      // 2MB ≈ 数万行，足够运营的一次活动补发；再大应拆批
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async importCredits(
    @UploadedFile()
    file: { buffer?: Buffer; originalname?: string } | undefined,
    @Body() dto: CreditImportDto,
    @AdminUser() actor: AdminUser,
  ) {
    if (!file?.buffer?.length) {
      throw new AppError(40001, "请上传 CSV 文件（字段名 file）", 400);
    }
    return this.commerce.importCreditsCsv(file.buffer.toString("utf8"), {
      validDays: dto.validDays,
      operatorId: actor.id,
      importKey: dto.importKey,
    });
  }
}
