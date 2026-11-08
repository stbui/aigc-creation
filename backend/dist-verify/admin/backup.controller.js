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
exports.AdminBackupController = exports.PruneBackupDto = void 0;
const common_1 = require("@nestjs/common");
const admin_decorator_1 = require("./admin.decorator");
const backup_service_1 = require("./backup.service");
const permissions_1 = require("./permissions");
const class_validator_1 = require("class-validator");
/** 保留份数清理 */
class PruneBackupDto {
}
exports.PruneBackupDto = PruneBackupDto;
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(100),
    __metadata("design:type", Number)
], PruneBackupDto.prototype, "keepCount", void 0);
/**
 * 数据备份与保留期 (admin-prd.md §3.19 B-96~B-101)。
 *
 * 权限点分离:
 *   backup.read  查看备份列表与统计
 *   backup.run   手动备份 / 恢复验证 / 清理
 *   data.export  下载备份文件 (归到导出, 因为它本质是数据流出)
 *
 * 下载刻意要求 **已验证** 才放行 (B-97): 未验证的备份在事故时才发现损坏就晚了。
 */
let AdminBackupController = class AdminBackupController {
    constructor(backup) {
        this.backup = backup;
    }
    /** 备份概览: 份数、占用、是否过期 */
    stats() {
        return this.backup.stats();
    }
    /** 备份列表 */
    list() {
        return this.backup.list();
    }
    detail(id) {
        return this.backup.detail(id);
    }
    /**
     * 手动备份。
     *
     * 同步执行 (备份本身耗时很短), 返回 201 与记录详情。
     * 前端以 busy 状态防重复点击；后端不承诺未落库的跨请求幂等。
     */
    run() {
        return this.backup.run("manual");
    }
    /**
     * 恢复验证 (B-97)。
     *
     * 只读打开备份文件做完整性/结构/可读性检查, **绝不触碰生产库**。
     * 这是不可逆操作前唯一的保险, 验证本身必须零副作用。
     */
    verify(id) {
        return this.backup.verify(id);
    }
    /**
     * 下载备份文件。
     *
     * 只允许下载已验证的备份 —— 未验证的视为无效 (B-97)。
     */
    async download(id, res) {
        const { filename, buffer } = await this.backup.readForDownload(id);
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(buffer);
    }
    /** 删除备份 (保留至少一份已验证备份) */
    remove(id) {
        return this.backup.remove(id);
    }
    /**
     * 保留份数清理。
     *
     * 只允许显式指定 1–100 份，避免 query/body 两套参数出现校验绕过。
     */
    prune(dto) {
        return this.backup.prune(dto.keepCount);
    }
};
exports.AdminBackupController = AdminBackupController;
__decorate([
    (0, common_1.Get)("stats"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.backupRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminBackupController.prototype, "stats", null);
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.backupRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminBackupController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.backupRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminBackupController.prototype, "detail", null);
__decorate([
    (0, common_1.Post)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.backupRun),
    (0, admin_decorator_1.AuditAction)("backup.run"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminBackupController.prototype, "run", null);
__decorate([
    (0, common_1.Post)(":id/verify"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.backupRun),
    (0, admin_decorator_1.AuditAction)("backup.verify"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminBackupController.prototype, "verify", null);
__decorate([
    (0, common_1.Get)(":id/download"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.backupRead, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("backup.download"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminBackupController.prototype, "download", null);
__decorate([
    (0, common_1.Delete)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.backupRun),
    (0, admin_decorator_1.AuditAction)("backup.delete"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminBackupController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)("prune"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.backupRun),
    (0, admin_decorator_1.AuditAction)("backup.prune"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [PruneBackupDto]),
    __metadata("design:returntype", void 0)
], AdminBackupController.prototype, "prune", null);
exports.AdminBackupController = AdminBackupController = __decorate([
    (0, common_1.Controller)("admin/backups"),
    __metadata("design:paramtypes", [backup_service_1.BackupService])
], AdminBackupController);
//# sourceMappingURL=backup.controller.js.map