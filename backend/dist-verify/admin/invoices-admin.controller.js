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
exports.AdminInvoicesController = exports.RejectInvoiceDto = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const admin_decorator_1 = require("./admin.decorator");
const permissions_1 = require("./permissions");
const csv_response_1 = require("../common/csv-response");
const invoices_service_1 = require("../invoices/invoices.service");
class RejectInvoiceDto {
}
exports.RejectInvoiceDto = RejectInvoiceDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: "请填写驳回原因" }),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], RejectInvoiceDto.prototype, "reason", void 0);
/**
 * 后台发票审核。
 *
 * 只给财务: `invoice.write`。开具是不可逆动作 (票号已占用, 抬头印在票上),
 * 驳回也不删记录 —— 驳回原因要能回到用户侧展示。
 */
let AdminInvoicesController = class AdminInvoicesController {
    constructor(invoices) {
        this.invoices = invoices;
    }
    list(status, keyword, limit, offset) {
        return this.invoices.listForAdmin({
            status: status || undefined,
            keyword: keyword || undefined,
            limit: Number(limit) || 20,
            offset: Number(offset) || 0,
        });
    }
    issue(id, admin) {
        return this.invoices.issue(id, admin.id);
    }
    reject(id, dto, admin) {
        return this.invoices.reject(id, admin.id, dto.reason);
    }
    /**
     * 导出发票 (CSV)。
     *
     * 导出把用户抬头与税号带出系统，用独立的 `data.export` 权限点并留审计；
     * 列出口径与列表完全一致（同一 status / keyword）。
     */
    async export(res, status, keyword) {
        const csv = await this.invoices.exportCsvForAdmin({
            status: status || undefined,
            keyword: keyword || undefined,
        });
        (0, csv_response_1.sendCsv)(res, "invoices", csv);
    }
    async file(id, res) {
        const { html, filename } = await this.invoices.renderFile(id);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
        res.send(html);
    }
};
exports.AdminInvoicesController = AdminInvoicesController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.invoiceWrite),
    __param(0, (0, common_1.Query)("status")),
    __param(1, (0, common_1.Query)("keyword")),
    __param(2, (0, common_1.Query)("limit")),
    __param(3, (0, common_1.Query)("offset")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], AdminInvoicesController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(":id/issue"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.invoiceWrite),
    (0, admin_decorator_1.AuditAction)("invoice.issue"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AdminInvoicesController.prototype, "issue", null);
__decorate([
    (0, common_1.Post)(":id/reject"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.invoiceWrite),
    (0, admin_decorator_1.AuditAction)("invoice.reject"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, RejectInvoiceDto, Object]),
    __metadata("design:returntype", void 0)
], AdminInvoicesController.prototype, "reject", null);
__decorate([
    (0, common_1.Get)("export"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.invoiceWrite, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("data.export"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Query)("status")),
    __param(2, (0, common_1.Query)("keyword")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], AdminInvoicesController.prototype, "export", null);
__decorate([
    (0, common_1.Get)(":id/file"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.invoiceWrite),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminInvoicesController.prototype, "file", null);
exports.AdminInvoicesController = AdminInvoicesController = __decorate([
    (0, common_1.Controller)("admin/invoices"),
    __metadata("design:paramtypes", [invoices_service_1.InvoicesService])
], AdminInvoicesController);
//# sourceMappingURL=invoices-admin.controller.js.map