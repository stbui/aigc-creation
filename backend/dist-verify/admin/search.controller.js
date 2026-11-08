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
exports.AdminSearchController = void 0;
const common_1 = require("@nestjs/common");
const admin_decorator_1 = require("./admin.decorator");
const admin_role_service_1 = require("./admin-role.service");
const permissions_1 = require("./permissions");
const search_service_1 = require("./search.service");
/**
 * 全局搜索（顶栏搜索框）。
 *
 * 权限 `data.search`：搜索会把各表数据按关键字捞出来，等于开了一个
 * 跨模块的只读窗口。运营与财务默认有，其他角色需要显式授予。
 */
let AdminSearchController = class AdminSearchController {
    constructor(search, roles) {
        this.search = search;
        this.roles = roles;
    }
    async query(user, q) {
        const permissions = await this.roles.getPermissions(user.role);
        return this.search.search(q ?? "", permissions);
    }
};
exports.AdminSearchController = AdminSearchController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.dataSearch),
    __param(0, (0, admin_decorator_1.AdminUser)()),
    __param(1, (0, common_1.Query)("q")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], AdminSearchController.prototype, "query", null);
exports.AdminSearchController = AdminSearchController = __decorate([
    (0, common_1.Controller)("admin/search"),
    __metadata("design:paramtypes", [search_service_1.AdminSearchService,
        admin_role_service_1.AdminRoleService])
], AdminSearchController);
//# sourceMappingURL=search.controller.js.map