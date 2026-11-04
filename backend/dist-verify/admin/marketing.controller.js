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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminCheckinController = exports.AdminInvitesController = exports.AdminCampaignsController = exports.AdminCouponsController = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const admin_decorator_1 = require("./admin.decorator");
const app_exception_1 = require("../common/app.exception");
const csv_response_1 = require("../common/csv-response");
const marketing_service_1 = require("../marketing/marketing.service");
const permissions_1 = require("./permissions");
const marketing_dto_1 = require("./dto/marketing.dto");
/** 邀请关系列表查询 */
class InviteListQueryDto {
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(16),
    __metadata("design:type", String)
], InviteListQueryDto.prototype, "page", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(16),
    __metadata("design:type", String)
], InviteListQueryDto.prototype, "pageSize", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(16),
    __metadata("design:type", String)
], InviteListQueryDto.prototype, "rewardStatus", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], InviteListQueryDto.prototype, "keyword", void 0);
/** 签到记录列表查询 */
class CheckinListQueryDto {
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(16),
    __metadata("design:type", String)
], CheckinListQueryDto.prototype, "page", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(16),
    __metadata("design:type", String)
], CheckinListQueryDto.prototype, "pageSize", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], CheckinListQueryDto.prototype, "userId", void 0);
function toInt(v, fallback) {
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
let AdminCouponsController = class AdminCouponsController {
    constructor(marketing) {
        this.marketing = marketing;
    }
    list(query) {
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
     * 导出把券的发行与核销数据带出系统，用独立的 `data.export` 权限点并留审计。
     */
    async export(query, res) {
        const csv = await this.marketing.exportCoupons(query);
        (0, csv_response_1.sendCsv)(res, "coupons", csv);
    }
    detail(id) {
        return this.marketing.getCoupon(id);
    }
    create(dto) {
        return this.marketing.createCoupon(dto);
    }
    update(id, dto) {
        return this.marketing.updateCoupon(id, dto);
    }
    /** 启停切换。不提供删除: 已核销订单仍引用该券, 删了历史订单悬空 */
    toggle(id) {
        return this.marketing.disableCoupon(id);
    }
};
exports.AdminCouponsController = AdminCouponsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [marketing_dto_1.CouponListQueryDto]),
    __metadata("design:returntype", void 0)
], AdminCouponsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("export"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.marketingWrite, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("data.export"),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [marketing_dto_1.CouponListQueryDto, Object]),
    __metadata("design:returntype", Promise)
], AdminCouponsController.prototype, "export", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminCouponsController.prototype, "detail", null);
__decorate([
    (0, common_1.Post)(),
    (0, admin_decorator_1.AuditAction)("coupon.create"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [marketing_dto_1.UpsertCouponDto]),
    __metadata("design:returntype", void 0)
], AdminCouponsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(":id"),
    (0, admin_decorator_1.AuditAction)("coupon.update"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, marketing_dto_1.UpsertCouponDto]),
    __metadata("design:returntype", void 0)
], AdminCouponsController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(":id/toggle"),
    (0, admin_decorator_1.AuditAction)("coupon.toggle"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminCouponsController.prototype, "toggle", null);
exports.AdminCouponsController = AdminCouponsController = __decorate([
    (0, common_1.Controller)("admin/coupons"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.marketingWrite),
    __metadata("design:paramtypes", [marketing_service_1.MarketingService])
], AdminCouponsController);
/**
 * 营销中心 · 限时活动 (B-65)。
 */
let AdminCampaignsController = class AdminCampaignsController {
    constructor(marketing) {
        this.marketing = marketing;
    }
    list(query) {
        return this.marketing.listCampaigns({
            page: query.page,
            pageSize: query.pageSize,
            type: query.type,
            status: query.status,
            keyword: query.keyword,
        });
    }
    /** 导出限时活动 (CSV)。筛选口径与列表一致，独立 `data.export` 权限并留审计 */
    async export(query, res) {
        const csv = await this.marketing.exportCampaigns(query);
        (0, csv_response_1.sendCsv)(res, "campaigns", csv);
    }
    create(dto) {
        return this.marketing.createCampaign(dto);
    }
    update(id, dto) {
        return this.marketing.updateCampaign(id, dto);
    }
    toggle(id) {
        return this.marketing.disableCampaign(id);
    }
};
exports.AdminCampaignsController = AdminCampaignsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [marketing_dto_1.CampaignListQueryDto]),
    __metadata("design:returntype", void 0)
], AdminCampaignsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("export"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.marketingWrite, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("data.export"),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [marketing_dto_1.CampaignListQueryDto, Object]),
    __metadata("design:returntype", Promise)
], AdminCampaignsController.prototype, "export", null);
__decorate([
    (0, common_1.Post)(),
    (0, admin_decorator_1.AuditAction)("campaign.create"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [marketing_dto_1.UpsertCampaignDto]),
    __metadata("design:returntype", void 0)
], AdminCampaignsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(":id"),
    (0, admin_decorator_1.AuditAction)("campaign.update"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, marketing_dto_1.UpsertCampaignDto]),
    __metadata("design:returntype", void 0)
], AdminCampaignsController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(":id/toggle"),
    (0, admin_decorator_1.AuditAction)("campaign.toggle"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminCampaignsController.prototype, "toggle", null);
exports.AdminCampaignsController = AdminCampaignsController = __decorate([
    (0, common_1.Controller)("admin/campaigns"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.marketingWrite),
    __metadata("design:paramtypes", [marketing_service_1.MarketingService])
], AdminCampaignsController);
/**
 * 营销中心 · 邀请分销与签到规则 (B-66 / B-67)。
 *
 * 规则写入与关系管理合并在一个控制器: 两者共用 invite/checkin 语境,
 * 拆两个控制器会让"邀请中心"这个运营心智模型在前端也被拆散。
 *
 * ⚠ **发放动作单独要求 credit.adjust**: 手动补发邀请奖励 = 直接给人发积分,
 * 与后台调整积分同性质, 走财务的权限点而非运营的营销权限点。
 */
let AdminInvitesController = class AdminInvitesController {
    constructor(marketing) {
        this.marketing = marketing;
    }
    getRules() {
        return this.marketing.getInviteRule();
    }
    updateRules(dto) {
        return this.marketing.updateInviteRule(dto);
    }
    list(query) {
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
    grant(id) {
        if (!id)
            throw new app_exception_1.AppError(40001, "缺少关系 id", 400);
        return this.marketing.grantInviteRewardById(id);
    }
};
exports.AdminInvitesController = AdminInvitesController;
__decorate([
    (0, common_1.Get)("rules"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminInvitesController.prototype, "getRules", null);
__decorate([
    (0, common_1.Put)("rules"),
    (0, admin_decorator_1.AuditAction)("invite.rule_update"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [marketing_dto_1.UpdateInviteRuleDto]),
    __metadata("design:returntype", void 0)
], AdminInvitesController.prototype, "updateRules", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [InviteListQueryDto]),
    __metadata("design:returntype", void 0)
], AdminInvitesController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(":id/grant"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.creditAdjust),
    (0, admin_decorator_1.AuditAction)("invite.reward_grant"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminInvitesController.prototype, "grant", null);
exports.AdminInvitesController = AdminInvitesController = __decorate([
    (0, common_1.Controller)("admin/invites"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.marketingWrite),
    __metadata("design:paramtypes", [marketing_service_1.MarketingService])
], AdminInvitesController);
let AdminCheckinController = class AdminCheckinController {
    constructor(marketing) {
        this.marketing = marketing;
    }
    getRules() {
        return this.marketing.getCheckinRule();
    }
    updateRules(dto) {
        return this.marketing.updateCheckinRule(dto);
    }
    list(query) {
        return this.marketing.listCheckins({
            page: toInt(query.page, 1),
            pageSize: toInt(query.pageSize, 20),
            userId: query.userId,
        });
    }
};
exports.AdminCheckinController = AdminCheckinController;
__decorate([
    (0, common_1.Get)("rules"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminCheckinController.prototype, "getRules", null);
__decorate([
    (0, common_1.Put)("rules"),
    (0, admin_decorator_1.AuditAction)("checkin.rule_update"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [marketing_dto_1.UpdateCheckinRuleDto]),
    __metadata("design:returntype", void 0)
], AdminCheckinController.prototype, "updateRules", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CheckinListQueryDto]),
    __metadata("design:returntype", void 0)
], AdminCheckinController.prototype, "list", null);
exports.AdminCheckinController = AdminCheckinController = __decorate([
    (0, common_1.Controller)("admin/checkin"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.marketingWrite),
    __metadata("design:paramtypes", [marketing_service_1.MarketingService])
], AdminCheckinController);
//# sourceMappingURL=marketing.controller.js.map