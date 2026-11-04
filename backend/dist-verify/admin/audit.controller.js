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
exports.AdminAuditController = void 0;
const common_1 = require("@nestjs/common");
const admin_decorator_1 = require("./admin.decorator");
const app_exception_1 = require("../common/app.exception");
const csv_response_1 = require("../common/csv-response");
const audit_service_1 = require("./audit.service");
const permissions_1 = require("./permissions");
// 值导入: @Query() 的 DTO 同样依赖 design:paramtypes 做实例化与白名单剥离,
// 用 `import type` 会让查询参数完全绕过校验。
const audit_dto_1 = require("./dto/audit.dto");
/**
 * 操作审计查询。
 *
 * **只读**: 本 controller 不提供任何写方法, 后端整体也没有删除审计的入口。
 * 表设计上只允许 INSERT (AdminAuditLog 无 updatedAt 字段)。
 *
 * 已知不足: 管理员仍可直接操作数据库删除审计记录。
 * 彻底解决需独立存储或哈希链, 本期不做 (已在设计文档 §16.4 登记)。
 */
let AdminAuditController = class AdminAuditController {
    constructor(audit) {
        this.audit = audit;
    }
    /** 审计列表。附带动作筛选项 (从实际数据聚合, 避免前端硬编码过期清单) */
    list(query) {
        return this.audit.list(query);
    }
    /**
     * 导出审计日志 (CSV)。
     *
     * ⚠️ 路由必须声明在 `:id` 之前，否则 `export` 会被当成一条审计记录的 id。
     * 导出把操作人身份与 IP 带出系统，用独立的 `data.export` 权限点并留审计。
     */
    async export(query, res) {
        const csv = await this.audit.exportCsv(query);
        (0, csv_response_1.sendCsv)(res, "audit-logs", csv);
    }
    /** 单条详情 */
    async detail(id) {
        const item = await this.audit.detail(id);
        if (!item)
            throw new app_exception_1.AppError(40400, "记录不存在", 404);
        return item;
    }
};
exports.AdminAuditController = AdminAuditController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.auditRead),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [audit_dto_1.AuditListQueryDto]),
    __metadata("design:returntype", void 0)
], AdminAuditController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("export"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.auditRead, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("data.export"),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [audit_dto_1.AuditListQueryDto, Object]),
    __metadata("design:returntype", Promise)
], AdminAuditController.prototype, "export", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.auditRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminAuditController.prototype, "detail", null);
exports.AdminAuditController = AdminAuditController = __decorate([
    (0, common_1.Controller)("admin/audit-logs"),
    __metadata("design:paramtypes", [audit_service_1.AdminAuditService])
], AdminAuditController);
//# sourceMappingURL=audit.controller.js.map