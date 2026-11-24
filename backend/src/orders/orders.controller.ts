import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
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
} from 'class-validator';
import { Transform } from 'class-transformer';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { OrderService } from './order.service';

/**
 * 下单入参。
 *
 * `productId` 与 `membershipPlanId` **二选一** (服务层强校验, 不靠前端):
 *   - productId        → 积分包/套餐商品, 走 OrderItem 快照与积分发放
 *   - membershipPlanId → 会员订阅, 金额取套餐价, 支付成功后激活会员
 *
 * 为什么不做成"商品表里加一类会员商品": 会员是**权益**而非一次性积分,
 * 它的金额、周期、发放时机都与商品不同, 混进 Product 会让
 * 「买完发多少积分」这条规则出现两套真相。
 */
export class CreateOrderDto {
  /** 幂等键。客户端生成 (建议 UUID), 重复提交返回同一订单 */
  @IsString()
  @MaxLength(64)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  /** 会员套餐 id。与 productId 互斥 */
  @IsOptional()
  @IsString()
  membershipPlanId?: string;

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

/** 订单列表分页参数。上限 100 与 service 端收敛值一致 */
export class OrderListQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 最小为 1' })
  @Max(100, { message: 'limit 最大为 100' })
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: 'offset 必须是整数' })
  @Min(0, { message: 'offset 不能为负' })
  offset?: number;
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
    // 互斥与空单校验在 OrderService.create 内: 判断是业务规则, controller 只做 DTO 映射
    return this.orders.create({
      userId: user.id,
      idempotencyKey: dto.idempotencyKey,
      ...(dto.membershipPlanId
        ? { membershipPlanId: dto.membershipPlanId }
        : { items: [{ productId: dto.productId!, quantity: dto.quantity ?? 1 }] }),
      couponCode: dto.couponCode ?? null,
      campaignIds: dto.campaignIds,
    });
  }

  /** 我的订单（limit/offset 分页，返回 total 与各状态计数） */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: OrderListQueryDto) {
    return this.orders.listByUser(user.id, query.limit ?? 20, query.offset ?? 0);
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
