import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { OrderService } from './order.service';

export class CreateOrderDto {
  /** 幂等键。客户端生成 (建议 UUID), 重复提交返回同一订单 */
  @IsString()
  @MaxLength(64)
  idempotencyKey!: string;

  @IsString()
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  /**
   * 优惠券码 (可选)。
   *
   * 券不可用**不阻断下单** (输错码不该连单都下不了), 服务端降级为不打折
   * 并在返回的 couponWarning 里说明原因。
   */
  @IsOptional()
  @IsString()
  @MaxLength(24)
  couponCode?: string;

  /** 指定参与的活动 id。省略 = 自动匹配当前生效的限时价 (§12.2) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  campaignIds?: string[];
}

export class SandboxPayDto {
  /** 沙箱场景。真实通道(M15)不需要这个字段 */
  @IsIn(['success', 'failed', 'timeout'], { message: '沙箱场景非法' })
  scenario!: 'success' | 'failed' | 'timeout';
}

/**
 * C 端订单接口。
 *
 * 订单归属当前用户, 任何跨用户访问返回 403 —— 不靠前端隐藏。
 */
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrderService) {}

  /** 幂等下单。券与活动不叠加, 取更优者 (admin-detailed-design.md §12.6) */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create({
      userId: user.id,
      idempotencyKey: dto.idempotencyKey,
      items: [{ productId: dto.productId, quantity: dto.quantity }],
      couponCode: dto.couponCode ?? null,
      campaignIds: dto.campaignIds,
    });
  }

  /** 我的订单 */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    const n = Number(limit ?? 20);
    return this.orders.listByUser(user.id, Number.isFinite(n) ? Math.min(n, 100) : 20);
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.detail(id, user.id);
  }

  /**
   * 沙箱支付 (M8)。
   *
   * 前端据scenario 决定演示哪种结果: 成功 / 失败 / 超时。
   * 真实通道 (M15) 上线后此端点废弃, 改走渠道回调。
   */
  @Post(':id/pay')
  pay(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: SandboxPayDto,
  ) {
    return this.orders.sandboxPay({ orderId: id, userId: user.id, scenario: dto.scenario });
  }
}
