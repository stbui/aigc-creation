import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditAction, AdminUser, RequirePermission } from './admin.decorator';
import { AppError } from '../common/app.exception';
import { MarketingService } from '../marketing/marketing.service';
import { PERMISSIONS } from './permissions';
import {
  CouponListQueryDto,
  CampaignListQueryDto,
  UpdateCheckinRuleDto,
  UpdateInviteRuleDto,
  UpsertCampaignDto,
  UpsertCouponDto,
} from './dto/marketing.dto';

/** 邀请关系列表查询 */
class InviteListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(16)
  page?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  pageSize?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  rewardStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string;
}

/** 签到记录列表查询 */
class CheckinListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(16)
  page?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  pageSize?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;
}

function toInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 营销中心 · 优惠券 (B-64)。
 *
 * 权限: marketing.write —— 运营可写(发券是运营日常), 财务不可。
 * 分权依据 docs/admin-prd.md §2.2: 财务能改钱, 运营能发券, 两者不可合并。
 * 发券直接减少收入, 但与退款不同 —— 退款是"退已有钱", 发券是"决定卖给谁多少钱",
 * 后者属运营定价决策。
 */
@Controller('admin/coupons')
@RequirePermission(PERMISSIONS.marketingWrite)
export class AdminCouponsController {
  constructor(private readonly marketing: MarketingService) {}

  @Get()
  list(@Query() query: CouponListQueryDto) {
    return this.marketing.listCoupons({
      page: query.page,
      pageSize: query.pageSize,
      type: query.type,
      status: query.status,
      keyword: query.keyword,
    });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.marketing.getCoupon(id);
  }

  @Post()
  @AuditAction('coupon.create')
  create(@Body() dto: UpsertCouponDto) {
    return this.marketing.createCoupon(dto);
  }

  @Patch(':id')
  @AuditAction('coupon.update')
  update(@Param('id') id: string, @Body() dto: UpsertCouponDto) {
    return this.marketing.updateCoupon(id, dto);
  }

  /** 启停切换。不提供删除: 已核销订单仍引用该券, 删了历史订单悬空 */
  @Patch(':id/toggle')
  @AuditAction('coupon.toggle')
  toggle(@Param('id') id: string) {
    return this.marketing.disableCoupon(id);
  }
}

/**
 * 营销中心 · 限时活动 (B-65)。
 */
@Controller('admin/campaigns')
@RequirePermission(PERMISSIONS.marketingWrite)
export class AdminCampaignsController {
  constructor(private readonly marketing: MarketingService) {}

  @Get()
  list(@Query() query: CampaignListQueryDto) {
    return this.marketing.listCampaigns({
      page: query.page,
      pageSize: query.pageSize,
      type: query.type,
      status: query.status,
      keyword: query.keyword,
    });
  }

  @Post()
  @AuditAction('campaign.create')
  create(@Body() dto: UpsertCampaignDto) {
    return this.marketing.createCampaign(dto);
  }

  @Patch(':id')
  @AuditAction('campaign.update')
  update(@Param('id') id: string, @Body() dto: UpsertCampaignDto) {
    return this.marketing.updateCampaign(id, dto);
  }

  @Patch(':id/toggle')
  @AuditAction('campaign.toggle')
  toggle(@Param('id') id: string) {
    return this.marketing.disableCampaign(id);
  }
}

/**
 * 营销中心 · 邀请分销与签到规则 (B-66 / B-67)。
 *
 * 规则写入与关系管理合并在一个控制器: 两者共用 invite/checkin 语境,
 * 拆两个控制器会让"邀请中心"这个运营心智模型在前端也被拆散。
 *
 * ⚠ **发放动作单独要求 credit.adjust**: 手动补发邀请奖励 = 直接给人发积分,
 * 与后台调整积分同性质, 走财务的权限点而非运营的营销权限点。
 */
@Controller('admin/invites')
@RequirePermission(PERMISSIONS.marketingWrite)
export class AdminInvitesController {
  constructor(private readonly marketing: MarketingService) {}

  @Get('rules')
  getRules() {
    return this.marketing.getInviteRule();
  }

  @Put('rules')
  @AuditAction('invite.rule_update')
  updateRules(@Body() dto: UpdateInviteRuleDto) {
    return this.marketing.updateInviteRule(dto);
  }

  @Get()
  list(@Query() query: InviteListQueryDto) {
    return this.marketing.listInvites({
      page: toInt(query.page, 1),
      pageSize: toInt(query.pageSize, 20),
      rewardStatus: query.rewardStatus,
      keyword: query.keyword,
    });
  }

  /**
   * 手动补发邀请奖励。
   *
   * 权限点换成 credit.adjust —— 这条路径直接改用户积分余额。
   */
  @Post(':id/grant')
  @RequirePermission(PERMISSIONS.creditAdjust)
  @AuditAction('invite.reward_grant')
  grant(@Param('id') id: string) {
    if (!id) throw new AppError(40001, '缺少关系 id', 400);
    return this.marketing.grantInviteRewardById(id);
  }
}

@Controller('admin/checkin')
@RequirePermission(PERMISSIONS.marketingWrite)
export class AdminCheckinController {
  constructor(private readonly marketing: MarketingService) {}

  @Get('rules')
  getRules() {
    return this.marketing.getCheckinRule();
  }

  @Put('rules')
  @AuditAction('checkin.rule_update')
  updateRules(@Body() dto: UpdateCheckinRuleDto) {
    return this.marketing.updateCheckinRule(dto);
  }

  @Get()
  list(@Query() query: CheckinListQueryDto) {
    return this.marketing.listCheckins({
      page: toInt(query.page, 1),
      pageSize: toInt(query.pageSize, 20),
      userId: query.userId,
    });
  }
}