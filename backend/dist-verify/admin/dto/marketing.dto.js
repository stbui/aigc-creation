"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApplyCouponDto = exports.UpdateCheckinRuleDto = exports.CheckinBonusDto = exports.UpdateInviteRuleDto = exports.UpsertCampaignDto = exports.CampaignPayloadDto = exports.CampaignListQueryDto = exports.UpsertCouponDto = exports.CouponListQueryDto = exports.INVITE_TRIGGERS = exports.CAMPAIGN_STATUSES = exports.CAMPAIGN_TYPES = exports.COUPON_STATUSES = exports.COUPON_SCOPES = exports.COUPON_TYPES = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const class_transformer_2 = require("class-transformer");
const page_query_dto_1 = require("./page-query.dto");
/**
 * 营销中心 DTO (M11 · admin-detailed-design.md §12.5)。
 *
 * ⚠ **必须值导入** (不能用 `import type`): `@Body()` / `@Query()` 的 DTO 依赖
 * `design:paramtypes` 做实例化与白名单剥离, 用 `import type` 会让类退化成 Function,
 * 校验完全绕过 —— 全部后台 DTO 同一条约束。
 *
 * 取值白名单是本文件的主要职责: SQLite 无 enum, 不在 DTO 层拦住非法值,
 * 就只能靠 service 层逐处 if 判断, 漏一处就是脏数据。
 */
/** 券类型 */
exports.COUPON_TYPES = ['full_cut', 'discount', 'fixed'];
/** 券适用范围 */
exports.COUPON_SCOPES = ['all', 'product', 'new_user'];
/** 券启停状态 */
exports.COUPON_STATUSES = ['on', 'off'];
/** 活动类型 */
exports.CAMPAIGN_TYPES = ['limited_price', 'limited_free', 'popup'];
/** 活动状态 */
exports.CAMPAIGN_STATUSES = ['draft', 'active', 'ended', 'off'];
/** 邀请奖励触发时机 */
exports.INVITE_TRIGGERS = ['first_pay', 'register'];
/** 券码: 4~24 位大写字母数字, 去掉容易混淆的 0/O/1/I */
const CODE_PATTERN = /^[A-Z0-9]{4,24}$/;
/** 券列表查询 */
class CouponListQueryDto extends page_query_dto_1.PageQueryDto {
}
exports.CouponListQueryDto = CouponListQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(exports.COUPON_TYPES, { message: 'type 取值非法' }),
    __metadata("design:type", String)
], CouponListQueryDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(exports.COUPON_STATUSES, { message: 'status 取值非法' }),
    __metadata("design:type", String)
], CouponListQueryDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], CouponListQueryDto.prototype, "keyword", void 0);
/** 券创建/更新 */
class UpsertCouponDto {
}
exports.UpsertCouponDto = UpsertCouponDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)),
    (0, class_validator_1.Matches)(CODE_PATTERN, { message: '券码需为 4~24 位大写字母或数字' }),
    __metadata("design:type", String)
], UpsertCouponDto.prototype, "code", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], UpsertCouponDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsIn)(exports.COUPON_TYPES, { message: 'type 取值非法' }),
    __metadata("design:type", String)
], UpsertCouponDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsInt)({ message: '面额必须是整数' }),
    __metadata("design:type", Number)
], UpsertCouponDto.prototype, "value", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0, { message: '使用门槛不能为负' }),
    __metadata("design:type", Number)
], UpsertCouponDto.prototype, "thresholdCents", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(exports.COUPON_SCOPES, { message: 'scope 取值非法' }),
    __metadata("design:type", String)
], UpsertCouponDto.prototype, "scope", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(200),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], UpsertCouponDto.prototype, "productIds", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0, { message: '总量不能为负' }),
    __metadata("design:type", Number)
], UpsertCouponDto.prototype, "totalCount", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0, { message: '每人限用不能为负' }),
    __metadata("design:type", Number)
], UpsertCouponDto.prototype, "perUserLimit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsISO8601)({}, { message: '生效时间格式非法' }),
    __metadata("design:type", String)
], UpsertCouponDto.prototype, "validFrom", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsISO8601)({}, { message: '失效时间格式非法' }),
    __metadata("design:type", String)
], UpsertCouponDto.prototype, "validTo", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(exports.COUPON_STATUSES, { message: 'status 取值非法' }),
    __metadata("design:type", String)
], UpsertCouponDto.prototype, "status", void 0);
/** 活动列表查询 */
class CampaignListQueryDto extends page_query_dto_1.PageQueryDto {
}
exports.CampaignListQueryDto = CampaignListQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(exports.CAMPAIGN_TYPES, { message: 'type 取值非法' }),
    __metadata("design:type", String)
], CampaignListQueryDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(exports.CAMPAIGN_STATUSES, { message: 'status 取值非法' }),
    __metadata("design:type", String)
], CampaignListQueryDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], CampaignListQueryDto.prototype, "keyword", void 0);
/** 活动 payload: 按 type 校验, 避免"活动建了但没有可执行内容" */
class CampaignPayloadDto {
}
exports.CampaignPayloadDto = CampaignPayloadDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CampaignPayloadDto.prototype, "productId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CampaignPayloadDto.prototype, "priceCents", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(50),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], CampaignPayloadDto.prototype, "capabilityIds", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], CampaignPayloadDto.prototype, "title", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CampaignPayloadDto.prototype, "body", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(16),
    __metadata("design:type", String)
], CampaignPayloadDto.prototype, "ctaText", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CampaignPayloadDto.prototype, "ctaUrl", void 0);
/** 活动创建/更新 */
class UpsertCampaignDto {
}
exports.UpsertCampaignDto = UpsertCampaignDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], UpsertCampaignDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsIn)(exports.CAMPAIGN_TYPES, { message: 'type 取值非法' }),
    __metadata("design:type", String)
], UpsertCampaignDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_2.Type)(() => CampaignPayloadDto),
    __metadata("design:type", CampaignPayloadDto)
], UpsertCampaignDto.prototype, "payload", void 0);
__decorate([
    (0, class_validator_1.IsISO8601)({}, { message: '开始时间格式非法' }),
    __metadata("design:type", String)
], UpsertCampaignDto.prototype, "startAt", void 0);
__decorate([
    (0, class_validator_1.IsISO8601)({}, { message: '结束时间格式非法' }),
    __metadata("design:type", String)
], UpsertCampaignDto.prototype, "endAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(exports.CAMPAIGN_STATUSES, { message: 'status 取值非法' }),
    __metadata("design:type", String)
], UpsertCampaignDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpsertCampaignDto.prototype, "onlyNewUsers", void 0);
/** 邀请规则写入 */
class UpdateInviteRuleDto {
}
exports.UpdateInviteRuleDto = UpdateInviteRuleDto;
__decorate([
    (0, class_validator_1.IsInt)({ message: '邀请人奖励必须是整数' }),
    (0, class_validator_1.Min)(0, { message: '奖励不能为负' }),
    (0, class_validator_1.Max)(100000, { message: '单次奖励不得超过 100000 积分' }),
    __metadata("design:type", Number)
], UpdateInviteRuleDto.prototype, "inviterCredits", void 0);
__decorate([
    (0, class_validator_1.IsInt)({ message: '被邀请人奖励必须是整数' }),
    (0, class_validator_1.Min)(0, { message: '奖励不能为负' }),
    (0, class_validator_1.Max)(100000, { message: '单次奖励不得超过 100000 积分' }),
    __metadata("design:type", Number)
], UpdateInviteRuleDto.prototype, "inviteeCredits", void 0);
__decorate([
    (0, class_validator_1.IsIn)(exports.INVITE_TRIGGERS, { message: 'triggerOn 取值非法' }),
    __metadata("design:type", String)
], UpdateInviteRuleDto.prototype, "triggerOn", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateInviteRuleDto.prototype, "valid", void 0);
/** 签到加成规则项 */
class CheckinBonusDto {
}
exports.CheckinBonusDto = CheckinBonusDto;
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(2, { message: '加成起始天数最小为 2 (第 1 天即基础积分)' }),
    (0, class_validator_1.Max)(3650, { message: '加成天数不得超过 3650' }),
    __metadata("design:type", Number)
], CheckinBonusDto.prototype, "day", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0, { message: '加成积分不能为负' }),
    (0, class_validator_1.Max)(100000, { message: '单次加成不得超过 100000 积分' }),
    __metadata("design:type", Number)
], CheckinBonusDto.prototype, "bonus", void 0);
/** 签到规则写入 */
class UpdateCheckinRuleDto {
}
exports.UpdateCheckinRuleDto = UpdateCheckinRuleDto;
__decorate([
    (0, class_validator_1.IsInt)({ message: '基础积分必须是整数' }),
    (0, class_validator_1.Min)(0, { message: '基础积分不能为负' }),
    (0, class_validator_1.Max)(100000, { message: '基础积分不得超过 100000' }),
    __metadata("design:type", Number)
], UpdateCheckinRuleDto.prototype, "baseCredits", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(50),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_2.Type)(() => CheckinBonusDto),
    __metadata("design:type", Array)
], UpdateCheckinRuleDto.prototype, "bonusRules", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(3650),
    __metadata("design:type", Number)
], UpdateCheckinRuleDto.prototype, "maxStreak", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(1000000),
    __metadata("design:type", Number)
], UpdateCheckinRuleDto.prototype, "dailyCap", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateCheckinRuleDto.prototype, "enabled", void 0);
/** C 端下单选券 */
class ApplyCouponDto {
}
exports.ApplyCouponDto = ApplyCouponDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(24),
    __metadata("design:type", String)
], ApplyCouponDto.prototype, "code", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(50),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], ApplyCouponDto.prototype, "productIds", void 0);
//# sourceMappingURL=marketing.dto.js.map