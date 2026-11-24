import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/optional-jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { MarketingService } from './marketing.service';

/** 邀请链接带参: /?inv=CODE */
class InviteBindDto {
  @IsString()
  @MaxLength(24)
  inviteCode!: string;
}

/** 结算试算入参。商品明细以服务端为准, 这里只传 id 与数量 */
export class QuoteDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  productIds!: string[];

  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  quantities!: number[];

  @IsOptional()
  @IsString()
  @MaxLength(24)
  couponCode?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  campaignIds?: string[];
}

/**
 * C 端营销接口 (M11)。
 *
 * 与 admin 端的边界: 这里只暴露**读与自助领取**, 绝不含任何配置能力 ——
 * 用户能改自己的签到与邀请记录是正常的, 用户能改券规则则是漏洞。
 */
@Controller('marketing')
@UseGuards(OptionalJwtAuthGuard)
export class MarketingPublicController {
  constructor(private readonly marketing: MarketingService) {}

  /**
   * 弹窗活动位 (匿名可访问)。
   *
   * 匿名也要展示是刻意的: 落地页/工作台的促销位必须在未登录时可见, 否则首屏
   * 最大的一块转化位对全部新访客失效。带 token 时才做人群定向 (如仅新用户)。
   *
   * 用 `@Req()` 而非 `@CurrentUser()`: 公开端点没有守卫保证 user 存在,
   * CurrentUser 的返回类型标注为必选, 拿它写可选身份就是在骗类型检查。
   */
  @Get('popup')
  popup(@Req() req: { user?: { id: string } }) {
    return this.marketing.activePopupCampaign(req.user?.id);
  }

  /**
   * 进行中的限时活动（落地页「限时活动」页签）。
   *
   * 匿名可访问：促销信息本身不是隐私，而且这是首屏转化位。带 token 时按真实
   * 新客状态过滤“仅新用户”活动，避免老用户看到自己无法享受的价格。
   */
  @Get('campaigns')
  campaigns(@Req() req: { user?: { id: string } }) {
    return this.marketing.activeCampaigns(req.user?.id);
  }
}

/** 邀请列表分页参数。上限与 service 端收敛值一致 (take 最大 100) */
class InviteListQueryDto {
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
 * 需要登录的 C 端营销接口。
 */
@Controller('marketing')
@UseGuards(JwtAuthGuard)
export class MarketingMeController {
  constructor(private readonly marketing: MarketingService) {}

  /** 我的邀请码与邀请数据（limit/offset 分页） */
  @Get('invites')
  myInvites(@CurrentUser() user: AuthUser, @Query() query: InviteListQueryDto) {
    return this.marketing.myInvites(user.id, {
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * 绑定邀请关系。
   *
   * 由前端在注册成功后调用。**必须晚于注册**: 注册时用户还不存在,
   * 无法建立外键关系。
   */
  @Post('invites/bind')
  bind(@CurrentUser() user: AuthUser, @Body() dto: InviteBindDto) {
    return this.marketing.bindInvite({ inviteCode: dto.inviteCode, inviteeId: user.id });
  }

  /** 签到状态 (今日是否已签 / 连签天数 / 未来 7 天可得) */
  @Get('checkin')
  checkinStatus(@CurrentUser() user: AuthUser) {
    return this.marketing.checkinStatus(user.id);
  }

  /** 每日签到。重复调用幂等返回已签结果, 不重复发积分 */
  @Post('checkin')
  checkin(@CurrentUser() user: AuthUser) {
    return this.marketing.checkin(user.id);
  }

  /**
   * 结算试算: 返回原价、可用券列表、命中活动与最终优惠。
   *
   * 独立于下单接口的原因: 用户在结算页需要**先看优惠再决定是否下单**,
   * 而下单会创建订单 (占用幂等键且 30 分钟后超时关闭)。
   * 试算不落库, 幂等, 可反复调。金额计算与优惠叠加在 MarketingService
   * (quoteSettlement), 与下单链路共用同一份逻辑。
   */
  @Post('quote')
  quote(@CurrentUser() user: AuthUser, @Body() dto: QuoteDto) {
    return this.marketing.quoteSettlement({
      userId: user.id,
      productIds: dto.productIds ?? [],
      quantities: dto.quantities ?? [],
      couponCode: dto.couponCode ?? null,
      campaignIds: dto.campaignIds,
    });
  }
}
