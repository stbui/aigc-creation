"use strict";
/**
 * 后台插件接口（`/api/v1/admin/plugins`）。
 *
 *   · `GET    /admin/plugins`            清单 + 能力统计 + 协议注册状态
 *   · `GET    /admin/plugins/:id`        单个插件详情
 *   · `PATCH  /admin/plugins/:id`        系统级启停（写库 + 立即重注册协议）
 *   · `POST   /admin/plugins/:id/verify` 契约校验（不发送上游请求）
 *   · `POST   /admin/plugins/install`    上传安装插件包（zip）
 *   · `DELETE /admin/plugins/:id`        卸载上传安装的插件（内置包拒绝）
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
exports.AdminPluginsController = exports.PluginUpdateBodyDto = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const class_validator_1 = require("class-validator");
const app_exception_1 = require("../../common/app.exception");
const admin_decorator_1 = require("../../admin/admin.decorator");
const permissions_1 = require("../../admin/permissions");
const package_1 = require("../protocol/package");
const plugin_admin_service_1 = require("./plugin.admin.service");
class PluginUpdateBodyDto {
}
exports.PluginUpdateBodyDto = PluginUpdateBodyDto;
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], PluginUpdateBodyDto.prototype, "enabled", void 0);
let AdminPluginsController = class AdminPluginsController {
    constructor(plugins) {
        this.plugins = plugins;
    }
    list() {
        return this.plugins.list();
    }
    get(id) {
        return this.plugins.get(id);
    }
    update(id, body, user) {
        return this.plugins.setEnabled(id, body.enabled, user?.id ?? "");
    }
    verify(id, user) {
        return this.plugins.verify(id, user?.id ?? "");
    }
    /**
     * 上传安装插件包。
     *
     * 上限与包格式常量同源（`PLUGIN_PACKAGE_MAX_BYTES`）：上传层先拦一次大文件，
     * 解析层再校验中央目录 —— 只靠其中一层都会让 48MB 的垃圾读到内存里才失败。
     */
    install(file, user) {
        if (!file?.buffer?.length)
            throw new app_exception_1.AppError(40001, "请上传插件包（字段名 file，zip）", 400);
        return this.plugins.install(file.buffer, user?.id ?? "");
    }
    /** 卸载上传安装的插件；内置插件拒绝（随代码发布，删了也会回来） */
    async uninstall(id, user) {
        return this.plugins.uninstall(id, user?.id ?? "");
    }
};
exports.AdminPluginsController = AdminPluginsController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.pluginRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminPluginsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.pluginRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminPluginsController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.pluginWrite),
    (0, admin_decorator_1.AuditAction)("plugin.toggle"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, PluginUpdateBodyDto, Object]),
    __metadata("design:returntype", void 0)
], AdminPluginsController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(":id/verify"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.pluginWrite),
    (0, admin_decorator_1.AuditAction)("plugin.verify"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AdminPluginsController.prototype, "verify", null);
__decorate([
    (0, common_1.Post)("install"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.pluginWrite),
    (0, admin_decorator_1.AuditAction)("plugin.install"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("file", {
        storage: (0, multer_1.memoryStorage)(),
        limits: { fileSize: package_1.PLUGIN_PACKAGE_MAX_BYTES },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AdminPluginsController.prototype, "install", null);
__decorate([
    (0, common_1.Delete)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.pluginWrite),
    (0, admin_decorator_1.AuditAction)("plugin.uninstall"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminPluginsController.prototype, "uninstall", null);
exports.AdminPluginsController = AdminPluginsController = __decorate([
    (0, common_1.Controller)("admin/plugins"),
    __metadata("design:paramtypes", [plugin_admin_service_1.PluginAdminService])
], AdminPluginsController);
//# sourceMappingURL=plugin.controller.js.map