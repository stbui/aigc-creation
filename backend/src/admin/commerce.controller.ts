import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ArrayMaxSize } from 'class-validator';
import { AuditAction, AdminUser, RequirePermission } from './admin.decorator';
import { AppError } from '../common/app.exception';
import { OrderService } from '../orders/order.service';
import { CreditService } from '../credits/credit.service';
import { CreditPriceService } from '../credits/credit-price.service';
import { PERMISSIONS } from './permissions';
import { buildPage, paginate } from './dto/page-query.dto';

/** 商品状态变更 */
export class ProductStatusDto {
  @IsIn(['active', 'offline']) status!: 'active' | 'offline';
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

export class CreditListQueryDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) page?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) pageSize?: number;
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
 * 交易后台 (admin-prd.md §3.6~3.9)。
 *
 * 权限点分离:
 *   product.read/write  商品
 *   order.read/refund   订单
 *   payment.read        支付流水
 *   credit.read/adjust  积分
 *
 * ⚠ 所有写操作都带 @AuditAction —— 交易域的每一次改动都必须可追责。
 */
@Controller('admin')
export class AdminCommerceController {
  constructor(
    private readonly orders: OrderService,
    private readonly credit: CreditService,
    private readonly creditPrice: CreditPriceService,
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
  async products(@Query('status') status?: string) {
    const list = await this.orders['prisma'].product.findMany({
      where: status ? { status } : {},
      orderBy: { sortOrder: 'asc' },
    });
    return list.map((p) => ({
      id: p.id, sku: p.sku, name: p.name, description: p.description,
      priceCents: p.priceCents, originalPriceCents: p.originalPriceCents,
      credits: p.credits, creditsValidDays: p.creditsValidDays,
      grantType: p.grantType, status: p.status,
      createdAt: p.createdAt,
    }));
  }

  /** 上架/ 下架 (B-36)。下架不影响历史订单 */
  @Patch('products/:id/status')
  @RequirePermission(PERMISSIONS.productWrite)
  @AuditAction('product.status_change')
  async setProductStatus(@Param('id') id: string, @Body() dto: ProductStatusDto) {
    await this.orders['prisma'].product.update({ where: { id }, data: { status: dto.status } });
    return { id, status: dto.status };
  }

  // ── 订单 (B-39~B-44) ─────────────────────────────────────────────

  /** 订单列表 */
  @Get('orders')
  @RequirePermission(PERMISSIONS.orderRead)
  async orderList(@Query('status') status?: string, @Query('userId') userId?: string,
                  @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const q = {
      page: Number(page ?? 1) || 1,
      pageSize: Math.min(Number(pageSize ?? 20) || 20, 100),
    };
    const page2 = buildPage({ page: q.page, pageSize: q.pageSize }, ['createdAt'], 'createdAt:desc');
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (userId) where.userId = userId;

    const [items, total] = await Promise.all([
      this.orders['prisma'].order.findMany({
        where, skip: page2.skip, take: page2.take, orderBy: page2.orderBy,
        include: { user: { select: { email: true } }, items: true, payments: true },
      }),
      this.orders['prisma'].order.count({ where }),
    ]);
    return paginate(items.map((o: any) => ({
      id: o.id, orderNo: o.orderNo, userId: o.userId, userEmail: o.user.email,
      status: o.status, channel: o.channel, totalCents: o.totalCents,
      refundedCents: o.refundedCents, grantedCredits: o.grantedCredits,
      itemCount: o.items.length, paymentCount: o.payments.length,
      createdAt: o.createdAt, paidAt: o.paidAt,
    })), total, page2);
  }

  /** 订单详情 (B-41) */
  @Get('orders/:id')
  @RequirePermission(PERMISSIONS.orderRead)
  orderDetail(@Param('id') id: string) {
    return this.orders.detail(id);
  }

  /** 手工核销 (B-42): 标记已支付, 须写审计 */
  @Post('orders/:id/mark-paid')
  @RequirePermission(PERMISSIONS.orderMarkPaid)
  @AuditAction('order.mark_paid')
  markPaid(@Param('id') id: string, @AdminUser() actor: AdminUser) {
    const order = this.orders['prisma'].order.findUnique({ where: { id } });
    return order.then((o: any) =>
      o ? this.orders.markPaid({
        orderId: id, userId: o.userId,
        payTransactionId: `MANUAL-${actor.id}-${Date.now()}`,
        channel: 'manual',
      }) : Promise.reject(new AppError(40400, '订单不存在', 404)),
    );
  }

  /** 退款 (B-43): 按批次剩余量扣回 */
  @Post('orders/:id/refund')
  @RequirePermission(PERMISSIONS.orderRefund)
  @AuditAction('order.refund')
  refund(@Param('id') id: string, @Body() dto: RefundDto, @AdminUser() actor: AdminUser) {
    return this.orders.refund({
      orderId: id, amountCents: dto.amountCents, reason: dto.reason, operatorId: actor.id,
    });
  }

  // ── 支付流水 (B-45) ─────────────────────────────────────────────

  @Get('payments')
  @RequirePermission(PERMISSIONS.paymentRead)
  async payments(@Query('status') status?: string, @Query('pageSize') pageSize?: string) {
    const n = Math.min(Number(pageSize ?? 50) || 50, 200);
    const list = await this.orders['prisma'].payment.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: n,
      include: { order: { select: { orderNo: true } }, user: { select: { email: true } } },
    });
    return list.map((p: any) => ({
      id: p.id, orderNo: p.order?.orderNo, orderId: p.orderId,
      userEmail: p.user?.email, channel: p.channel,
      payTransactionId: p.payTransactionId,
      amountCents: p.amountCents, status: p.status,
      message: p.message, sandboxScenario: p.sandboxScenario,
      paidAt: p.paidAt, createdAt: p.createdAt,
    }));
  }

  // ── 积分 (B-49~B-52) ────────────────────────────────────────────

  /** 用户积分总览 (B-49) */
  @Get('credits')
  @RequirePermission(PERMISSIONS.creditRead)
  async credits(@Query() query: CreditListQueryDto) {
    const page = buildPage(query, ['createdAt'], 'createdAt:desc');
    const where: Record<string, unknown> = {};
    if (query.userId) where.id = query.userId;
    if (query.email) where.email = { contains: query.email };

    const [users, total] = await Promise.all([
      this.orders['prisma'].user.findMany({
        where, skip: page.skip, take: page.take, orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, name: true, createdAt: true },
      }),
      this.orders['prisma'].user.count({ where }),
    ]);

    const items = await Promise.all(
      users.map(async (u) => {
        const s = await this.credit.balanceOf(u.id);
        return {
          userId: u.id, email: u.email, name: u.name,
          balance: s.balance, expiringSoon: s.expiringSoon,
          totalEarned: s.totalEarned, totalConsumed: s.totalConsumed,
          activeLots: s.activeLots, nearestExpiry: s.nearestExpiry,
        };
      }),
    );
    return paginate(items, total, page);
  }

  /** 某用户的批次明细 (B-50) */
  @Get('credits/:userId/lots')
  @RequirePermission(PERMISSIONS.creditRead)
  lots(@Param('userId') userId: string) {
    return this.credit.lotsOf(userId);
  }

  /** 某用户的流水 (B-51) */
  @Get('credits/:userId/ledger')
  @RequirePermission(PERMISSIONS.creditRead)
  ledger(@Param('userId') userId: string, @Query('limit') limit?: string) {
    const n = Number(limit ?? 50);
    return this.credit.ledgerOf(userId, Number.isFinite(n) ? Math.min(n, 200) : 50);
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
}
