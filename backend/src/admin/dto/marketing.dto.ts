import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PageQueryDto } from './page-query.dto';

/**
 * 营销中心 DTO (M11 · admin-detailed-design.md §12.5)。
 *
 * ⚠ **必须值导入** (不能用 `import type`): `@Body()` / `@Query()` 的 DTO 依赖
 * `design:paramtypes` 做实例化与白名单剥离, 用 `import type` 会让类退化成 Function,
 * 校验完全绕过 —— 与 model.dto.ts 同一条约束。
 *
 * 取值白名单是本文件的主要职责: SQLite 无 enum, 不在 DTO 层拦住非法值,
 * 就只能靠 service 层逐处 if 判断, 漏一处就是脏数据。
 */

/** 券类型 */
export const COUPON_TYPES = ['full_cut', 'discount', 'fixed'] as const;
/** 券适用范围 */
export const COUPON_SCOPES = ['all', 'product', 'new_user'] as const;
/** 券启停状态 */
export const COUPON_STATUSES = ['on', 'off'] as const;
/** 活动类型 */
export const CAMPAIGN_TYPES = ['limited_price', 'limited_free', 'popup'] as const;
/** 活动状态 */
export const CAMPAIGN_STATUSES = ['draft', 'active', 'ended', 'off'] as const;
/** 邀请奖励触发时机 */
export const INVITE_TRIGGERS = ['first_pay', 'register'] as const;

/** 券码: 4~24 位大写字母数字, 去掉容易混淆的 0/O/1/I */
const CODE_PATTERN = /^[A-Z0-9]{4,24}$/;

/** 券列表查询 */
export class CouponListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(COUPON_TYPES, { message: 'type 取值非法' })
  type?: string;

  @IsOptional()
  @IsIn(COUPON_STATUSES, { message: 'status 取值非法' })
  status?: string;

  /** 按券码或名称模糊查 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string;
}

/** 券创建/更新 */
export class UpsertCouponDto {
  /**
   * 券码。创建必填; 更新留空表示不改 (券码是用户手里的凭据,
   * 改了等于让已发出的券集体失效)。
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(CODE_PATTERN, { message: '券码需为 4~24 位大写字母或数字' })
  code?: string;

  @IsString()
  @MaxLength(64)
  name!: string;

  @IsIn(COUPON_TYPES, { message: 'type 取值非法' })
  type!: string;

  /**
   * 面额。语义随 type:
   *   full_cut / fixed → 减免金额(分), 正整数
   *   discount         → 折扣万分比, 1~9999 (8500 = 85折)
   * 类型相关的取值范围校验在 service.validateCoupon() 内做 —— DTO 层拿不到
   * type 的上下文 (create 与 update 可能是不同type), 强行拆开会两处重复。
   */
  @IsInt({ message: '面额必须是整数' })
  value!: number;

  @IsOptional()
  @IsInt()
  @Min(0, { message: '使用门槛不能为负' })
  thresholdCents?: number;

  @IsOptional()
  @IsIn(COUPON_SCOPES, { message: 'scope 取值非法' })
  scope?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  productIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(0, { message: '总量不能为负' })
  totalCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0, { message: '每人限用不能为负' })
  perUserLimit?: number;

  @IsOptional()
  @IsISO8601({}, { message: '生效时间格式非法' })
  validFrom?: string;

  @IsOptional()
  @IsISO8601({}, { message: '失效时间格式非法' })
  validTo?: string;

  @IsOptional()
  @IsIn(COUPON_STATUSES, { message: 'status 取值非法' })
  status?: string;
}

/** 活动列表查询 */
export class CampaignListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(CAMPAIGN_TYPES, { message: 'type 取值非法' })
  type?: string;

  @IsOptional()
  @IsIn(CAMPAIGN_STATUSES, { message: 'status 取值非法' })
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string;
}

/** 活动 payload: 按 type 校验, 避免"活动建了但没有可执行内容" */
export class CampaignPayloadDto {
  /** limited_price: 目标商品 */
  @IsOptional()
  @IsString()
  productId?: string;

  /** limited_price: 活动价(分) */
  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  /** limited_free: 享受免费的能力 id 列表 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  capabilityIds?: string[];

  /** popup: 标题 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  title?: string;

  /** popup: 正文 */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  body?: string;

  /** popup: 按钮文案 */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  ctaText?: string;

  /** popup: 跳转地址。限定站内相对路径, 不接受任意外链 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  ctaUrl?: string;
}

/** 活动创建/更新 */
export class UpsertCampaignDto {
  @IsString()
  @MaxLength(64)
  name!: string;

  @IsIn(CAMPAIGN_TYPES, { message: 'type 取值非法' })
  type!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignPayloadDto)
  payload?: CampaignPayloadDto;

  @IsISO8601({}, { message: '开始时间格式非法' })
  startAt!: string;

  @IsISO8601({}, { message: '结束时间格式非法' })
  endAt!: string;

  @IsOptional()
  @IsIn(CAMPAIGN_STATUSES, { message: 'status 取值非法' })
  status?: string;

  /** 投放人群。{ onlyNewUsers?: boolean } */
  @IsOptional()
  @IsBoolean()
  onlyNewUsers?: boolean;
}

/** 邀请规则写入 */
export class UpdateInviteRuleDto {
  @IsInt({ message: '邀请人奖励必须是整数' })
  @Min(0, { message: '奖励不能为负' })
  @Max(100000, { message: '单次奖励不得超过 100000 积分' })
  inviterCredits!: number;

  @IsInt({ message: '被邀请人奖励必须是整数' })
  @Min(0, { message: '奖励不能为负' })
  @Max(100000, { message: '单次奖励不得超过 100000 积分' })
  inviteeCredits!: number;

  @IsIn(INVITE_TRIGGERS, { message: 'triggerOn 取值非法' })
  triggerOn!: string;

  @IsOptional()
  @IsBoolean()
  valid?: boolean;
}

/** 签到加成规则项 */
export class CheckinBonusDto {
  @IsInt()
  @Min(2, { message: '加成起始天数最小为 2 (第 1 天即基础积分)' })
  @Max(3650, { message: '加成天数不得超过 3650' })
  day!: number;

  @IsInt()
  @Min(0, { message: '加成积分不能为负' })
  @Max(100000, { message: '单次加成不得超过 100000 积分' })
  bonus!: number;
}

/** 签到规则写入 */
export class UpdateCheckinRuleDto {
  @IsInt({ message: '基础积分必须是整数' })
  @Min(0, { message: '基础积分不能为负' })
  @Max(100000, { message: '基础积分不得超过 100000' })
  baseCredits!: number;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CheckinBonusDto)
  bonusRules!: CheckinBonusDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  maxStreak?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  dailyCap?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** C 端下单选券 */
export class ApplyCouponDto {
  /** 券码 */
  @IsString()
  @MaxLength(24)
  code!: string;

  /** 商品 id 数组 (含数量由 service 读取)。用于校验适用范围与计算门槛 */
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  productIds!: string[];
}