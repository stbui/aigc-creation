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
exports.AdminAssetsController = exports.AssetBatchDto = exports.AssetBatchStatusDto = exports.AssetStatusDto = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const admin_decorator_1 = require("./admin.decorator");
const admin_role_service_1 = require("./admin-role.service");
const assets_admin_service_1 = require("./assets-admin.service");
const permissions_1 = require("./permissions");
const app_exception_1 = require("../common/app.exception");
const csv_response_1 = require("../common/csv-response");
// 必须用运行时导入: `import type` 会让 Nest 的 design:paramtypes 退化成
// Object/Function, ValidationPipe 无法转换 pageSize, 分页会静默退回默认 20。
const asset_dto_1 = require("./dto/asset.dto");
/** 下架/恢复 */
class AssetStatusDto {
}
exports.AssetStatusDto = AssetStatusDto;
__decorate([
    (0, class_validator_1.IsIn)(["visible", "hidden"], { message: "status 取值非法" }),
    __metadata("design:type", String)
], AssetStatusDto.prototype, "status", void 0);
/** 批量下架 */
class AssetBatchStatusDto {
}
exports.AssetBatchStatusDto = AssetBatchStatusDto;
__decorate([
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], AssetBatchStatusDto.prototype, "ids", void 0);
__decorate([
    (0, class_validator_1.IsIn)(["visible", "hidden"]),
    __metadata("design:type", String)
], AssetBatchStatusDto.prototype, "status", void 0);
/** 批量动作 */
class AssetBatchDto {
}
exports.AssetBatchDto = AssetBatchDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(100, { message: "单次批量最多 100 条" }),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], AssetBatchDto.prototype, "ids", void 0);
__decorate([
    (0, class_validator_1.IsIn)(["hide", "show", "delete"], {
        message: "action 只能是 hide / show / delete",
    }),
    __metadata("design:type", String)
], AssetBatchDto.prototype, "action", void 0);
/**
 * 项目与素材管理 (admin-prd.md §3.4 B-21~B-27)。
 *
 * 路由顺序: 字面量路径须在 `:id` 之前, 否则被参数路由抢占。
 */
let AdminAssetsController = class AdminAssetsController {
    constructor(assets, roles) {
        this.assets = assets;
        this.roles = roles;
    }
    // ── 项目 ──────────────────────────────────────────────────────────
    listProjects(query) {
        return this.assets.listProjects(query);
    }
    /**
     * 删除项目 (B-22)。
     * `?hard=true` 连带删除素材记录与文件; 默认软删(素材置hidden)。
     */
    removeProject(id, hard) {
        return this.assets.removeProject(id, hard === "true");
    }
    // ── 素材 ──────────────────────────────────────────────────────────
    stats() {
        return this.assets.stats();
    }
    list(query) {
        return this.assets.list(query);
    }
    /** 删除前的连带影响预览 */
    impact(id) {
        return this.assets.impact(id);
    }
    /**
     * 下架/ 恢复 (B-26)。
     * 只改 status, 文件与记录都保留 —— 误下架可恢复。
     */
    setStatus(id, dto) {
        return this.assets.setStatus(id, dto.status);
    }
    /** 批量下架 (B-87): 每条仍写审计 —— 批量不等于免审计 */
    batchStatus(dto) {
        return this.assets.setStatusMany(dto.ids ?? [], dto.status);
    }
    /**
     * 批量动作（B7）：下架 / 恢复 / 删除，逐条返回结果。
     *
     * 权限按 action 单独判定：`asset.hide` 管下架/恢复，`asset.delete` 管删除。
     * 删除是资产级不可逆动作，不能因为"路由上挂了 hide 权限"就被顺带放开。
     */
    async batch(dto, actor) {
        const needed = dto.action === "delete" ? permissions_1.PERMISSIONS.assetDelete : permissions_1.PERMISSIONS.assetHide;
        if (!(await this.roles.hasPermission(actor.id, needed))) {
            throw new app_exception_1.AppError(40301, `没有执行该批量动作的权限（${needed}）`, 403);
        }
        return this.assets.batchAction(dto.ids, dto.action);
    }
    /** 素材导出 (CSV) */
    async export(query, res) {
        const csv = await this.assets.exportCsv(query);
        (0, csv_response_1.sendCsv)(res, "assets", csv);
    }
    /** 删除素材 (B-27): 连带磁盘文件与产出任务, 不可逆 */
    remove(id) {
        return this.assets.remove(id);
    }
};
exports.AdminAssetsController = AdminAssetsController;
__decorate([
    (0, common_1.Get)("projects"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.projectRead),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [asset_dto_1.ProjectListQueryDto]),
    __metadata("design:returntype", void 0)
], AdminAssetsController.prototype, "listProjects", null);
__decorate([
    (0, common_1.Delete)("projects/:id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.projectDelete),
    (0, admin_decorator_1.AuditAction)("project.delete"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Query)("hard")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AdminAssetsController.prototype, "removeProject", null);
__decorate([
    (0, common_1.Get)("assets/stats"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.assetRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminAssetsController.prototype, "stats", null);
__decorate([
    (0, common_1.Get)("assets"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.assetRead),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [asset_dto_1.AssetListQueryDto]),
    __metadata("design:returntype", void 0)
], AdminAssetsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("assets/:id/impact"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.assetRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminAssetsController.prototype, "impact", null);
__decorate([
    (0, common_1.Patch)("assets/:id/status"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.assetHide),
    (0, admin_decorator_1.AuditAction)("asset.status_change"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, AssetStatusDto]),
    __metadata("design:returntype", void 0)
], AdminAssetsController.prototype, "setStatus", null);
__decorate([
    (0, common_1.Post)("assets/batch-status"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.assetHide),
    (0, admin_decorator_1.AuditAction)("asset.batch_status"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [AssetBatchStatusDto]),
    __metadata("design:returntype", void 0)
], AdminAssetsController.prototype, "batchStatus", null);
__decorate([
    (0, common_1.Post)("assets/batch"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.assetRead),
    (0, admin_decorator_1.AuditAction)("asset.batch"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [AssetBatchDto, Object]),
    __metadata("design:returntype", Promise)
], AdminAssetsController.prototype, "batch", null);
__decorate([
    (0, common_1.Get)("assets/export"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.assetRead, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("data.export"),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [asset_dto_1.AssetListQueryDto, Object]),
    __metadata("design:returntype", Promise)
], AdminAssetsController.prototype, "export", null);
__decorate([
    (0, common_1.Delete)("assets/:id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.assetDelete),
    (0, admin_decorator_1.AuditAction)("asset.delete"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminAssetsController.prototype, "remove", null);
exports.AdminAssetsController = AdminAssetsController = __decorate([
    (0, common_1.Controller)("admin"),
    __metadata("design:paramtypes", [assets_admin_service_1.AdminAssetsService,
        admin_role_service_1.AdminRoleService])
], AdminAssetsController);
//# sourceMappingURL=assets-admin.controller.js.map