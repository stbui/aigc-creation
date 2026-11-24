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
} from "@nestjs/common";
import type { Response } from "express";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { RequireAllPermissions, RequirePermission } from "./admin.decorator";
import { sendCsv } from "../common/csv-response";
import { MarketingService } from "../marketing/marketing.service";
import { PERMISSIONS } from "./permissions";
import { PageQueryDto } from "./dto/page-query.dto";
import {
  CouponListQueryDto,
  CampaignListQueryDto,
  UpdateCheckinRuleDto,
  UpdateInviteRuleDto,
  UpsertCampaignDto,
  UpsertCouponDto,
} from "./dto/marketing.dto";

/** 邀请关系列表查询 */
class InviteListQueryDto extends PageQueryDto {
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
class CheckinListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;
}

/**
 * 营销中心 · 优惠券 (B-64)。
 *
 * 权限: marketing.write —— 运营可写(发券是运营日常), 财务不可。
 * 分权依据 docs/admin-prd.md §2.2: 财务能改钱, 运营能发券, 两者不可合并。
 * 发券直接减少收入, 但与退款不同 —— 退款是"退已有钱", 发券是"决定卖给谁多少钱",
 * 后者属运营定价决策。
 */
@Controller("admin/coupons")
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

  /**
   * 导出优惠券 (CSV)。
   *
   * ⚠️ 路由必须声明在 `:id` 之前，否则 `export` 会被当成券 id。
   * 导出把券的发行与核销数据带出系统，使用独立的 `data.export` 权限点。
   * CSV 文件流直接写响应，不能走统一信封（否则会被包成 JSON 字符串）。
   */
  @Get("export")
  @RequireAllPermissions(PERMISSIONS.marketingWrite, PERMISSIONS.dataExport)
  async export(@Query() query: CouponListQueryDto, @Res() res: Response) {
    const csv = await this.marketing.exportCoupons(query);
    sendCsv(res, "coupons", csv);
  }

  @Get(":id")
  detail(@Param("id") id: string) {
    return this.marketing.getCoupon(id);
  }

  @Post()
  create(@Body() dto: UpsertCouponDto) {
    // DTO → 领域入参显式映射: DTO 实例不流入 service
    return this.marketing.createCoupon({
      code: dto.code,
      name: dto.name,
      type: dto.type,
      value: dto.value,
      thresholdCents: dto.thresholdCents,
      scope: dto.scope,
      productIds: dto.productIds,
      totalCount: dto.totalCount,
      perUserLimit: dto.perUserLimit,
      validFrom: dto.validFrom,
      validTo: dto.validTo,
      status: dto.status,
    });
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpsertCouponDto) {
    return this.marketing.updateCoupon(id, {
      code: dto.code,
      name: dto.name,
      type: dto.type,
      value: dto.value,
      thresholdCents: dto.thresholdCents,
      scope: dto.scope,
      productIds: dto.productIds,
      totalCount: dto.totalCount,
      perUserLimit: dto.perUserLimit,
      validFrom: dto.validFrom,
      validTo: dto.validTo,
      status: dto.status,
    });
  }

  /** 启停切换。停用不影响已核销订单 */
  @Patch(":id/toggle")
  toggle(@Param("id") id: string) {
    return this.marketing.disableCoupon(id);
  }

  /** 只允许删除没有关联订单的券；有订单时改为停用 */
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.marketing.deleteCoupon(id);
  }
}

/**
 * 营销中心 · 限时活动 (B-65)。
 */
@Controller("admin/campaigns")
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
      effective: query.effective,
      keyword: query.keyword,
    });
  }

  /**
   * 导出限时活动 (CSV)。筛选口径与列表一致，使用独立 `data.export` 权限。
   * 文件流直接写响应，不能走统一信封。
   */
  @Get("export")
  @RequireAllPermissions(PERMISSIONS.marketingWrite, PERMISSIONS.dataExport)
  async export(@Query() query: CampaignListQueryDto, @Res() res: Response) {
    const csv = await this.marketing.exportCampaigns(query);
    sendCsv(res, "campaigns", csv);
  }

  @Post()
  create(@Body() dto: UpsertCampaignDto) {
    return this.marketing.createCampaign(this.campaignInput(dto));
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpsertCampaignDto) {
    return this.marketing.updateCampaign(id, this.campaignInput(dto));
  }

  /** payload 逐字段投影: 嵌套 DTO 实例不流入 service */
  private campaignInput(dto: UpsertCampaignDto) {
    return {
      name: dto.name,
      type: dto.type,
      payload: dto.payload
        ? {
            productId: dto.payload.productId,
            priceCents: dto.payload.priceCents,
            capabilityIds: dto.payload.capabilityIds,
            title: dto.payload.title,
            body: dto.payload.body,
            ctaText: dto.payload.ctaText,
            ctaUrl: dto.payload.ctaUrl,
          }
        : undefined,
      startAt: dto.startAt,
      endAt: dto.endAt,
      status: dto.status,
      onlyNewUsers: dto.onlyNewUsers,
    };
  }

  @Patch(":id/toggle")
  toggle(@Param("id") id: string) {
    return this.marketing.toggleCampaign(id);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.marketing.deleteCampaign(id);
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
@Controller("admin/invites")
@RequirePermission(PERMISSIONS.marketingWrite)
export class AdminInvitesController {
  constructor(private readonly marketing: MarketingService) {}

  @Get("rules")
  getRules() {
    return this.marketing.getInviteRule();
  }

  @Put("rules")
  updateRules(@Body() dto: UpdateInviteRuleDto) {
    return this.marketing.updateInviteRule({
      inviterCredits: dto.inviterCredits,
      inviteeCredits: dto.inviteeCredits,
      triggerOn: dto.triggerOn,
      valid: dto.valid,
    });
  }

  @Get()
  list(@Query() query: InviteListQueryDto) {
    return this.marketing.listInvites({
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      rewardStatus: query.rewardStatus,
      keyword: query.keyword,
    });
  }

  /**
   * 手动补发邀请奖励。
   *
   * 权限点换成 credit.adjust —— 这条路径直接改用户积分余额。
   */
  @Post(":id/grant")
  @RequirePermission(PERMISSIONS.creditAdjust)
  grant(@Param("id") id: string) {
    return this.marketing.grantInviteRewardById(id);
  }
}

@Controller("admin/checkin")
@RequirePermission(PERMISSIONS.marketingWrite)
export class AdminCheckinController {
  constructor(private readonly marketing: MarketingService) {}

  @Get("rules")
  getRules() {
    return this.marketing.getCheckinRule();
  }

  @Put("rules")
  updateRules(@Body() dto: UpdateCheckinRuleDto) {
    return this.marketing.updateCheckinRule({
      baseCredits: dto.baseCredits,
      bonusRules: dto.bonusRules.map((b) => ({ day: b.day, bonus: b.bonus })),
      maxStreak: dto.maxStreak,
      dailyCap: dto.dailyCap,
      enabled: dto.enabled,
    });
  }

  @Get()
  list(@Query() query: CheckinListQueryDto) {
    return this.marketing.listCheckins({
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      userId: query.userId,
    });
  }
}
