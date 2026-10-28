import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AuditAction, AdminUser, RequirePermission } from './admin.decorator';
import { AppError } from '../common/app.exception';
import { OrderService } from '../orders/order.service';
import { CreditService } from '../credits/credit.service';
import { CreditPriceService } from '../credits/credit-price.service';
import { AdminCommerceService } from './commerce-admin.service';
import { AdminSettingsService } from './settings.service';
import { PERMISSIONS } from './permissions';
import { csvFilename } from '../common/csv';

/** 商品上/下架 */
export class ProductStatusDto {
  @IsIn(['active', 'offline']) status!: 'active' | 'offline';
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
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
  @IsOptional() @IsIn(['immediate', 'manual']) grantType?: 'immediate' | 'manual';
  @IsOptional() @IsIn(['active', 'offline']) status?: 'active' | 'offline';
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
  @IsOptional() @IsIn(['immediate', 'manual']) grantType?: 'immediate' | 'manual';
  @IsOptional() @IsIn(['active', 'offline']) status?: 'active' | 'offline';
  @IsOptional() @IsInt() sortOrder?: number;
  /** 改价原因。价格变动属高危动作, 写审计时带出 */
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/** 退款 */
export class RefundDto {
  @IsInt() @Min(1) amountCents!: number;
  /** 退款原因。强制填写 */
  @IsString() @MaxLength(200) reason!: string;
}

/**
 * 人工调整积分 (B-52)。
 *
 * 字段名用 **delta** 而非 amount —— delta 明确表达「有正负的变动量」,
 * amount 会被误解为「金额」或「绝对值」, 后者会让"扣减"无法表达。
 */
export class AdjustCreditDto {
  @IsString() userId!: string;
  /** 正数为增加, 负数为扣减, 不能为 0 */
  @IsInt() delta!: number;
  /** 原因。强制填写 —— 无理由的积分变动无法追责 */
  @IsString() @MaxLength(200) reason!: string;
  @IsOptional() @IsInt() @Min(0) validDays?: number;
}

/**
 * 批量调整积分。
 *
 * 每条可带自己的原因 (补偿 A、扣回 B 的理由不同), 未带则用整批原因。
 * 上限 100 条: 再大应走导入任务, 而不是一个可能超时 30s 的同步请求。
 */
export class BatchAdjustItemDto {
  @IsString() userId!: string;
  @IsInt() delta!: number;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class BatchAdjustDto {
  @IsArray()
  @ArrayMaxSize(100, { message: '单次批量调整最多 100 条' })
  @ValidateNested({ each: true })
  @Type(() => BatchAdjustItemDto)
  items!: BatchAdjustItemDto[];

  /** 整批原因。逐条未带原因时使用 */
  @IsString() @MaxLength(200) reason!: string;
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
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/**
 * 批量核销订单。
 *
 * `reason` 强制填写：批量核销会一次给多个用户发积分，事后必须能回答
 * 「为什么这 37 笔被标记为已支付」。单笔核销的 reason 是可选的，
 * 批量这里刻意更严 —— 一次点错影响的人数不同。
 */
export class OrderBatchDto {
  @IsArray()
  @ArrayMaxSize(100, { message: '单次批量最多 100 条' })
  @IsString({ each: true })
  ids!: string[];

  @IsIn(['mark_paid'], { message: 'action 只能是 mark_paid' })
  action!: 'mark_paid';

  @IsString()
  @MaxLength(200)
  reason!: string;
}

/** 积分 CSV 导入的整批默认值（multipart 文本字段） */
export class CreditImportDto {
  /** 整批原因。逐行未带 reason 列时使用 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  validDays?: number;
}

/** 把 query 里的数字安全转成 number; 非法值给 undefined 让 service 用默认值 */
function num(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
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
@Controller('admin')
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
  @Get('credit-prices')
  @RequirePermission(PERMISSIONS.productPrice)
  creditPrices() {
    return this.creditPrice.adminList();
  }

  /**
   * 批量改价。逐项落库并即时失效缓存 —— 改完立刻生效, 不必等 3s TTL。
   *
   * ⚠ 写审计: 定价是影响收入的关键操作, 必须能回答「这个价谁在什么时候改的」。
   */
  @Put('credit-prices')
  @RequirePermission(PERMISSIONS.productPrice)
  @AuditAction('credit.price_update')
  async updateCreditPrices(@Body() dto: UpdateCreditPricesDto) {
    if (!dto.items?.length) {
      throw new AppError(40001, '没有需要更新的消耗价', 400);
    }
    const updated = [];
    for (const it of dto.items) {
      updated.push(await this.creditPrice.setPrice(it.capabilityId, it.cost));
    }
    return { updated };
  }

  /** 单项回落默认值 (删掉 SystemSetting 覆盖, 回到 registry) */
  @Post('credit-prices/:capabilityId/reset')
  @RequirePermission(PERMISSIONS.productPrice)
  @AuditAction('credit.price_reset')
  resetCreditPrice(@Param('capabilityId') capabilityId: string) {
    return this.creditPrice.resetPrice(capabilityId);
  }

  // ── 商品 (B-34~B-36) ────────────────────────────────────────────

  /** 商品列表 */
  @Get('products')
  @RequirePermission(PERMISSIONS.productRead)
  products(@Query('status') status?: string) {
    return this.commerce.listProducts(status);
  }

  /** 新建商品。默认下架, 确认无误后再上架 */
  @Post('products')
  @RequirePermission(PERMISSIONS.productWrite)
  @AuditAction('product.create')
  createProduct(@Body() dto: ProductCreateDto) {
    return this.commerce.createProduct(dto);
  }

  /**
   * 修改商品。
   *
   * 改价不影响已生成的订单 —— 订单存的是下单时快照, 这是交易系统的基本约定。
   */
  @Patch('products/:id')
  @RequirePermission(PERMISSIONS.productWrite)
  @AuditAction('product.update')
  updateProduct(@Param('id') id: string, @Body() dto: ProductUpdateDto) {
    return this.commerce.updateProduct(id, dto);
  }

  /** 上架/ 下架 (B-36)。下架不影响历史订单 */
  @Patch('products/:id/status')
  @RequirePermission(PERMISSIONS.productWrite)
  @AuditAction('product.status_change')
  async setProductStatus(@Param('id') id: string, @Body() dto: ProductStatusDto) {
    const product = await this.commerce.updateProduct(id, { status: dto.status });
    return { id: product.id, status: product.status };
  }

  // ── 订单 (B-39~B-44) ─────────────────────────────────────────────

  /**
   * 订单列表。
   *
   * 支持 orderNo / email / status / channel / 时间范围 过滤:
   * 客服拿着"用户邮箱 + 大概日期"来问，是最高频的排障入口。
   */
  @Get('orders')
  @RequirePermission(PERMISSIONS.orderRead)
  orderList(
    @Query('status') status?: string,
    @Query('orderNo') orderNo?: string,
    @Query('email') email?: string,
    @Query('channel') channel?: string,
    @Query('refundState') refundState?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: string,
  ) {
    return this.commerce.listOrders({
      status,
      orderNo,
      email,
      channel,
      refundState,
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
  @Get('orders/export')
  @RequirePermission(PERMISSIONS.dataExport)
  @AuditAction('data.export')
  async exportOrders(
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('orderNo') orderNo?: string,
    @Query('email') email?: string,
    @Query('channel') channel?: string,
    @Query('refundState') refundState?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.commerce.exportOrders({
      status,
      orderNo,
      email,
      channel,
      refundState,
      from,
      to,
    });
    sendCsv(res, csvFilename('orders'), csv);
  }

  /** 订单详情 (B-41): 明细 / 支付 / 退款 / 券 / 会员套餐一次取全 */
  @Get('orders/:id')
  @RequirePermission(PERMISSIONS.orderRead)
  orderDetail(@Param('id') id: string) {
    return this.commerce.orderDetail(id);
  }

  /** 手工核销 (B-42): 标记已支付, 须写审计 */
  @Post('orders/:id/mark-paid')
  @RequirePermission(PERMISSIONS.orderMarkPaid)
  @AuditAction('order.mark_paid')
  async markPaid(@Param('id') id: string, @AdminUser() actor: AdminUser) {
    const order = await this.commerce.orderDetail(id);
    return this.orders.markPaid({
      orderId: id,
      userId: order.userId,
      payTransactionId: `MANUAL-${actor.id}-${Date.now()}`,
      channel: 'manual',
    });
  }

  /**
   * 批量核销（B7）。
   *
   * 权限直接用 `order.mark_paid`（本端点只有一个动作，静态装饰器足够）。
   * 逐条返回结果：40 笔里有一笔已退款、两笔已被渠道回调核销，
   * 运营需要知道具体是哪几笔、为什么。
   */
  @Post('orders/batch')
  @RequirePermission(PERMISSIONS.orderMarkPaid)
  @AuditAction('order.batch')
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
  @Post('orders/:id/refund')
  @RequirePermission(PERMISSIONS.orderRefund)
  @AuditAction('order.refund')
  async refund(@Param('id') id: string, @Body() dto: RefundDto, @AdminUser() actor: AdminUser) {
    const rules = await this.settings.refundRules();
    return this.orders.refund({
      orderId: id,
      amountCents: dto.amountCents,
      reason: dto.reason,
      operatorId: actor.id,
      rules,
    });
  }

  // ── 支付流水 (B-45) ─────────────────────────────────────────────

  @Get('payments')
  @RequirePermission(PERMISSIONS.paymentRead)
  payments(
    @Query('status') status?: string,
    @Query('pageSize') pageSize?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.commerce.listPayments({ status, pageSize: num(pageSize), from, to });
  }

  @Get('payments/export')
  @RequirePermission(PERMISSIONS.dataExport)
  @AuditAction('data.export')
  async exportPayments(
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.commerce.exportPayments({ status, from, to });
    sendCsv(res, csvFilename('payments'), csv);
  }

  // ── 积分 (B-49~B-52) ────────────────────────────────────────────

  /** 用户积分总览 (B-49) */
  @Get('credits')
  @RequirePermission(PERMISSIONS.creditRead)
  credits(
    @Query('userId') userId?: string,
    @Query('email') email?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.commerce.listCredits({
      userId,
      email,
      page: num(page),
      pageSize: num(pageSize),
    });
  }

  /** 积分总览导出 (CSV) */
  @Get('credits/export')
  @RequirePermission(PERMISSIONS.dataExport)
  @AuditAction('data.export')
  async exportCredits(
    @Res() res: Response,
    @Query('userId') userId?: string,
    @Query('email') email?: string,
  ) {
    const csv = await this.commerce.exportCredits({ userId, email });
    sendCsv(res, csvFilename('credits'), csv);
  }

  /** 某用户的批次明细 (B-50) */
  @Get('credits/:userId/lots')
  @RequirePermission(PERMISSIONS.creditRead)
  lots(
    @Param('userId') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.commerce.creditLots(userId, { from, to });
  }

  /** 某用户的流水 (B-51), 可按类型与时间过滤 */
  @Get('credits/:userId/ledger')
  @RequirePermission(PERMISSIONS.creditRead)
  ledger(
    @Param('userId') userId: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.commerce.creditLedger(userId, { type, from, to, limit: num(limit) });
  }

  /** 人工增减积分 (B-52)。强制填写原因 */
  @Post('credits/adjust')
  @RequirePermission(PERMISSIONS.creditAdjust)
  @AuditAction('credit.adjust')
  adjust(@Body() dto: AdjustCreditDto, @AdminUser() actor: AdminUser) {
    return this.credit.adminAdjust({
      userId: dto.userId,
      delta: dto.delta,
      reason: dto.reason,
      operatorId: actor.id,
      validDays: dto.validDays,
    });
  }

  /** 批量调整积分。逐条独立执行并回传每条结果 */
  @Post('credits/batch-adjust')
  @RequirePermission(PERMISSIONS.creditAdjust)
  @AuditAction('credit.batch_adjust')
  batchAdjust(@Body() dto: BatchAdjustDto, @AdminUser() actor: AdminUser) {
    return this.commerce.batchAdjust(dto.items, {
      reason: dto.reason,
      operatorId: actor.id,
      validDays: dto.validDays,
    });
  }

  /**
   * 积分 CSV 导入（B7）。
   *
   * 列格式：`email,delta[,reason]`，首行可选表头（`email` / `邮箱`）。
   * 用邮箱定位用户而不是用户 id —— 运营手里的表格从来只有邮箱。
   *
   * 为什么走 `credit.adjust` 而不是 `data.import`：这不是"导入一批数据"，
   * 这是**给钱**。CSV 只是输入格式，权限应当跟着动作走，否则一个持有
   * `data.import`、没有 `credit.adjust` 的角色就能绕过积分权限。
   *
   * `delta` 为负即扣减，与人工调整同一套规则（余额不足整条失败，
   * 失败原因原样回传，不写成通用文案）。
   */
  @Post('credits/import')
  @RequirePermission(PERMISSIONS.creditAdjust)
  @AuditAction('credit.import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      // 2MB ≈ 数万行，足够运营的一次活动补发；再大应拆批
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async importCredits(
    @UploadedFile() file: { buffer?: Buffer; originalname?: string } | undefined,
    @Body() dto: CreditImportDto,
    @AdminUser() actor: AdminUser,
  ) {
    if (!file?.buffer?.length) {
      throw new AppError(40001, '请上传 CSV 文件（字段名 file）', 400);
    }
    return this.commerce.importCreditsCsv(file.buffer.toString('utf8'), {
      reason: dto.reason,
      validDays: dto.validDays,
      operatorId: actor.id,
    });
  }
}

/** 统一的 CSV 响应头。文件名固定由服务端生成, 不拼用户输入 */
function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}
