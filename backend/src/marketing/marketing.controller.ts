import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
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
}

/**
 * 需要登录的 C 端营销接口。
 */
@Controller('marketing')
@UseGuards(JwtAuthGuard)
export class MarketingMeController {
  constructor(private readonly marketing: MarketingService) {}

  /** 我的邀请码与邀请数据 */
  @Get('invites')
  myInvites(@CurrentUser() user: AuthUser) {
    return this.marketing.myInvites(user.id);
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
   * 试算不落库, 幂等, 可反复调。
   *
   * ⚠ 商品价格**从服务端读取**, 不接受客户端传入的价格:
   * 接受客户端价格等于把定价权交给前端, 改个请求就能 1 分钱买走全站商品。
   */
  @Post('quote')
  async quote(@CurrentUser() user: AuthUser, @Body() dto: QuoteDto) {
    if (!dto.productIds?.length) {
      return {
        subtotalCents: 0,
        discountCents: 0,
        payableCents: 0,
        coupons: [],
        items: [],
      };
    }

    const snapshot = await this.marketing.quoteItems(dto.productIds);
    const items = dto.productIds.map((id, i) => {
      const p = snapshot.get(id);
      return {
        productId: id,
        name: p?.name ?? '',
        priceCents: p?.priceCents ?? 0,
        credits: p?.credits ?? 0,
        quantity: dto.quantities?.[i] ?? 1,
        available: Boolean(p) && p.status === 'active',
      };
    });

    const validItems = items
      .filter((i) => i.available)
      .map(({ productId, priceCents, quantity }) => ({ productId, priceCents, quantity }));

    const subtotalCents = validItems.reduce((s, i) => s + i.priceCents * i.quantity, 0);

    const discount = await this.marketing.settleDiscount({
      userId: user.id,
      items: validItems,
      couponCode: dto.couponCode ?? null,
      campaignIds: dto.campaignIds,
    });

    const coupons = await this.marketing.previewCoupons({ userId: user.id, items: validItems });

    return {
      subtotalCents,
      discountCents: discount.discountCents,
      payableCents: Math.max(0, subtotalCents - discount.discountCents),
      // 明确告知取的是哪一个优惠, 以及另一个被放弃了 —— 用户自己能核对
      appliedSource: discount.source,
      appliedCouponCode: discount.couponCode,
      appliedCampaignId: discount.campaignId,
      notStackedNotice: (discount.snapshot as any)?.notStacked
        ? '优惠券与限时活动不叠加, 已自动取优惠金额更高的一项'
        : null,
      coupons,
      items,
    };
  }
}