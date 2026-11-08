"use strict";
/**
 * 后台服务商目录接口（`/api/v1/admin/provider-catalog`）。
 *
 *   · `GET  /admin/provider-catalog`              当前目录（未配置时返回空态与原因）
 *   · `POST /admin/provider-catalog/refresh`      重新拉取远端清单
 *   · `POST /admin/provider-catalog/:id/verify`   校验条目（不下载、不安装）
 *   · `POST /admin/provider-catalog/:id/install`  下载并安装该条目的插件包
 *
 * 权限复用插件的读写点：目录本身就是「插件包的来源」，给它单独的权限点只会
 * 让角色配置多一条永远没人勾的项。
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
exports.AdminProviderCatalogController = void 0;
const common_1 = require("@nestjs/common");
const admin_decorator_1 = require("../../admin/admin.decorator");
const permissions_1 = require("../../admin/permissions");
const provider_catalog_service_1 = require("./provider-catalog.service");
let AdminProviderCatalogController = class AdminProviderCatalogController {
    constructor(catalog) {
        this.catalog = catalog;
    }
    list() {
        return this.catalog.list();
    }
    /** 写动作：拉取远端目录会产生出站请求，按高危动作留审计 */
    refresh() {
        return this.catalog.refresh();
    }
    verify(id) {
        return this.catalog.verify(id);
    }
    install(id, user) {
        return this.catalog.install(id, user?.id ?? '');
    }
};
exports.AdminProviderCatalogController = AdminProviderCatalogController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.pluginRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminProviderCatalogController.prototype, "list", null);
__decorate([
    (0, common_1.Post)('refresh'),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.pluginWrite),
    (0, admin_decorator_1.AuditAction)('provider_catalog.refresh'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminProviderCatalogController.prototype, "refresh", null);
__decorate([
    (0, common_1.Post)(':id/verify'),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.pluginRead),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminProviderCatalogController.prototype, "verify", null);
__decorate([
    (0, common_1.Post)(':id/install'),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.pluginWrite),
    (0, admin_decorator_1.AuditAction)('provider_catalog.install'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AdminProviderCatalogController.prototype, "install", null);
exports.AdminProviderCatalogController = AdminProviderCatalogController = __decorate([
    (0, common_1.Controller)('admin/provider-catalog'),
    __metadata("design:paramtypes", [provider_catalog_service_1.ProviderCatalogService])
], AdminProviderCatalogController);
//# sourceMappingURL=provider-catalog.controller.js.map