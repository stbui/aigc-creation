"use strict";
/**
 * 后台账单与调用记录接口。
 *
 *   · `GET  /admin/billing-orders`              生成账单列表（筛选：状态 / 用户 / 任务 / 模型 / 渠道 / 分组 / 时间）
 *   · `GET  /admin/billing-orders/:id`          账单详情
 *   · `POST /admin/billing-orders/:id/resolve`  人工核对（settle | refund，高危）
 *   · `GET  /admin/api-logs`                    上游调用记录（`ApiCallLog`）
 *
 * 页面在 `/admin/model-calls`，走 `/admin/api-logs` —— 不能复用旧
 * `AdminModelCallsController` 的 `admin/model-calls` 路径：那套读的是旧
 * `ModelCallLog`，P6 随 `src/providers/**` 一起删除，两条链路共用同一路径会互相遮蔽。
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
exports.AdminApiLogsController = exports.AdminBillingOrdersController = exports.BillingBatchResolveBodyDto = exports.BillingResolveBodyDto = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const admin_decorator_1 = require("../../admin/admin.decorator");
const permissions_1 = require("../../admin/permissions");
const csv_response_1 = require("../../common/csv-response");
const billing_admin_service_1 = require("./billing-admin.service");
/** 人工核对入参：动作只允许 settle / refund（语义校验在 service） */
class BillingResolveBodyDto {
}
exports.BillingResolveBodyDto = BillingResolveBodyDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BillingResolveBodyDto.prototype, "action", void 0);
/** 批量核对入参：单条失败不影响其它条目 */
class BillingBatchResolveBodyDto {
}
exports.BillingBatchResolveBodyDto = BillingBatchResolveBodyDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BillingBatchResolveBodyDto.prototype, "ids", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BillingBatchResolveBodyDto.prototype, "action", void 0);
let AdminBillingOrdersController = class AdminBillingOrdersController {
    constructor(billing) {
        this.billing = billing;
    }
    list(status, userId, taskId, model, channelId, billingMode, group, from, to, page, pageSize) {
        const query = {
            status,
            userId,
            taskId,
            model,
            channelId,
            billingMode,
            group,
            from,
            to,
            page: numberOrUndefined(page),
            pageSize: numberOrUndefined(pageSize),
        };
        return this.billing.listOrders(query);
    }
    get(id) {
        return this.billing.getOrder(id);
    }
    /**
     * 高危动作：写审计。
     * 金额口径完全由 `BillingService.resolve` 决定。
     */
    resolve(id, body, user) {
        return this.billing.resolveOrder(id, body?.action, user?.id ?? "");
    }
    /**
     * 批量核对：一次处理多张待核对账单。
     *
     * 逐条独立处置 —— 一张失败不影响其余：批量场景常常是「同一批挂账」，
     * 其中一两条状态已经变了就整批重试会很烦。返回每条的结果，失败原因逐条可读。
     */
    async batchResolve(body, user) {
        const ids = String(body?.ids ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item !== "");
        return this.billing.batchResolveOrders(ids, body?.action, user?.id ?? "");
    }
};
exports.AdminBillingOrdersController = AdminBillingOrdersController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.billingOrderRead),
    __param(0, (0, common_1.Query)("status")),
    __param(1, (0, common_1.Query)("userId")),
    __param(2, (0, common_1.Query)("taskId")),
    __param(3, (0, common_1.Query)("model")),
    __param(4, (0, common_1.Query)("channelId")),
    __param(5, (0, common_1.Query)("billingMode")),
    __param(6, (0, common_1.Query)("group")),
    __param(7, (0, common_1.Query)("from")),
    __param(8, (0, common_1.Query)("to")),
    __param(9, (0, common_1.Query)("page")),
    __param(10, (0, common_1.Query)("pageSize")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], AdminBillingOrdersController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.billingOrderRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminBillingOrdersController.prototype, "get", null);
__decorate([
    (0, common_1.Post)(":id/resolve"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.billingOrderResolve),
    (0, admin_decorator_1.AuditAction)("billing_order.resolve"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, BillingResolveBodyDto, Object]),
    __metadata("design:returntype", void 0)
], AdminBillingOrdersController.prototype, "resolve", null);
__decorate([
    (0, common_1.Post)("batch-resolve"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.billingOrderResolve),
    (0, admin_decorator_1.AuditAction)("billing_order.batch_resolve"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [BillingBatchResolveBodyDto, Object]),
    __metadata("design:returntype", Promise)
], AdminBillingOrdersController.prototype, "batchResolve", null);
exports.AdminBillingOrdersController = AdminBillingOrdersController = __decorate([
    (0, common_1.Controller)("admin/billing-orders"),
    __metadata("design:paramtypes", [billing_admin_service_1.BillingAdminService])
], AdminBillingOrdersController);
let AdminApiLogsController = class AdminApiLogsController {
    constructor(billing) {
        this.billing = billing;
    }
    list(raw) {
        return this.billing.listApiLogs(apiLogQueryOf(raw));
    }
    /**
     * 导出调用记录（CSV）。
     *
     * 导出把用户数据带出系统，用独立的 `data.export` 权限点并留审计 —— 与任务
     * 导出同一口径。筛选与列表共用 `apiLogQueryOf`，不会出现两个口径。
     */
    async export(raw, res) {
        const csv = await this.billing.exportApiLogsCsv(apiLogQueryOf(raw));
        (0, csv_response_1.sendCsv)(res, "api-logs", csv);
    }
};
exports.AdminApiLogsController = AdminApiLogsController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.modelCallRead),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AdminApiLogsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("export"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.modelCallRead, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("data.export"),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminApiLogsController.prototype, "export", null);
exports.AdminApiLogsController = AdminApiLogsController = __decorate([
    (0, common_1.Controller)("admin/api-logs"),
    __metadata("design:paramtypes", [billing_admin_service_1.BillingAdminService])
], AdminApiLogsController);
/** 列表与导出共用的查询构造：两个入口必须解析出同一份筛选条件 */
function apiLogQueryOf(raw) {
    return {
        status: raw.status,
        requestKind: raw.requestKind,
        channelId: raw.channelId,
        taskId: raw.taskId,
        userId: raw.userId,
        model: raw.model,
        billable: raw.billable,
        from: raw.from,
        to: raw.to,
        page: numberOrUndefined(raw.page),
        pageSize: numberOrUndefined(raw.pageSize),
    };
}
function numberOrUndefined(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}
//# sourceMappingURL=billing-admin.controller.js.map