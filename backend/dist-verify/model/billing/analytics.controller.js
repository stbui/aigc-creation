"use strict";
/**
 * 后台财务分析接口（`/api/v1/admin/analytics/finance`）。
 *
 * 只读聚合，权限点用 `model.analytics_read`（与渠道 / 路由观测同一档）：
 * 金额口径属于运营敏感数据，不能挂在只读账单权限之外随便下放。
 *
 * 查询参数用裸 `@Query()` 取而不是 DTO：区间只有 `from` / `to` 两个字符串，
 * 非法值由 service 抛 400 并指名格式 —— 与账单列表页的筛选写法保持一致。
 */
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
exports.AdminAnalyticsController = void 0;
const common_1 = require("@nestjs/common");
const admin_decorator_1 = require("../../admin/admin.decorator");
const permissions_1 = require("../../admin/permissions");
const finance_analytics_service_1 = require("./finance-analytics.service");
let AdminAnalyticsController = class AdminAnalyticsController {
    constructor(finance) {
        this.finance = finance;
    }
    /** 财务汇总：区间总额、按日趋势、按模型 / 渠道 / 能力 / 场景 Top 10 */
    summary(from, to) {
        return this.finance.summary({ from, to });
    }
};
exports.AdminAnalyticsController = AdminAnalyticsController;
__decorate([
    (0, common_1.Get)('finance'),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.modelAnalyticsRead),
    __param(0, (0, common_1.Query)('from')),
    __param(1, (0, common_1.Query)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminAnalyticsController.prototype, "summary", null);
exports.AdminAnalyticsController = AdminAnalyticsController = __decorate([
    (0, common_1.Controller)('admin/analytics'),
    __metadata("design:paramtypes", [finance_analytics_service_1.FinanceAnalyticsService])
], AdminAnalyticsController);
//# sourceMappingURL=analytics.controller.js.map