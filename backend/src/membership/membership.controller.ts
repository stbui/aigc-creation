import { Body, Controller, Get, Post } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { MembershipService } from './membership.service';

/**
 * 开通 / 续期会员。
 *
 * `orderId` **必填**: 会员与月度积分是花钱买的权益, 只能由「已支付且未兑换」的
 * 订单触发。此前它是可选的, 于是任何登录用户调一次接口就能白拿会员。
 * 正常流程是先 `POST /orders { membershipPlanId }` 再支付, 支付成功时
 * `OrderService` 会自动激活 —— 前端一般**不需要**主动调这个接口。
 */
class SubscribeDto {
  @IsString()
  @IsNotEmpty({ message: '请选择会员套餐' })
  planId!: string;

  @IsString()
  @IsNotEmpty({ message: '缺少已支付订单, 不能开通会员' })
  orderId!: string;
}

/**
 * C 端会员接口。
 *
 * ⚠ 守卫挂在**方法**上而不是类上：`plans` 必须公开免登录。类级
 * `@UseGuards` 会让访客拿不到价目，首页订阅区与结算页直接失败 ——
 * 而「没登录也要能看价目」是购买链路的第一环。
 */
@Controller('membership')
export class MembershipController {
  constructor(private readonly membership: MembershipService) {}

  /** 套餐列表。公开可读 —— 未登录也要能看价目 */
  @Get('plans')
  plans() {
    return this.membership.listPlans();
  }

  /** 我的会员详情 */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.membership.detailOf(user.id);
  }

  /** 开通/ 续期 */
  @Post('subscribe')
  @UseGuards(JwtAuthGuard)
  subscribe(@CurrentUser() user: AuthUser, @Body() dto: SubscribeDto) {
    return this.membership.subscribe({
      userId: user.id,
      planId: dto.planId,
      orderId: dto.orderId,
    });
  }

  /** 取消订阅。权益保留到当前周期结束 */
  @Post('cancel')
  @UseGuards(JwtAuthGuard)
  cancel(@CurrentUser() user: AuthUser) {
    return this.membership.cancel(user.id);
  }
}
