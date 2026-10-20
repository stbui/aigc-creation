import { Body, Controller, Get, Post } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { MembershipService } from './membership.service';

/** 订阅购买 */
class SubscribeDto {
  @IsString() planId!: string;
  @IsOptional() @IsString() orderId?: string;
}

/** C 端会员接口 */
@Controller('membership')
@UseGuards(JwtAuthGuard)
export class MembershipController {
  constructor(private readonly membership: MembershipService) {}

  /** 套餐列表。公开可读 —— 未登录也要能看价目 */
  @Get('plans')
  plans() {
    return this.membership.listPlans();
  }

  /** 我的会员详情 */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.membership.detailOf(user.id);
  }

  /** 开通/ 续期 */
  @Post('subscribe')
  subscribe(@CurrentUser() user: AuthUser, @Body() dto: SubscribeDto) {
    return this.membership.subscribe({
      userId: user.id,
      planId: dto.planId,
      orderId: dto.orderId,
    });
  }

  /** 取消订阅。权益保留到当前周期结束 */
  @Post('cancel')
  cancel(@CurrentUser() user: AuthUser) {
    return this.membership.cancel(user.id);
  }
}
