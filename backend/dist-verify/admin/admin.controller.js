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
exports.AdminController = void 0;
const common_1 = require("@nestjs/common");
const admin_decorator_1 = require("./admin.decorator");
const admin_role_service_1 = require("./admin-role.service");
const overview_service_1 = require("./overview.service");
const permissions_1 = require("./permissions");
/**
 * 后台骨架端点。
 *
 * 当前批次 (M2) 只交付能验证权限链路的最小组集:
 *   GET /admin/me           当前登录者身份 + 权限清单 (前端据此渲染菜单与按钮)
 *   GET /admin/overview     平台概览
 *   GET /admin/permissions 权限点全集与角色定义 (角色权限页用)
 * 业务端点按批次陆续加入本模块下的子 controller。
 */
let AdminController = class AdminController {
    constructor(roles, overviewService) {
        this.roles = roles;
        this.overviewService = overviewService;
    }
    /**
     * 当前后台用户。
     *
     * 前端不用 token 里的信息判定权限 —— 本端点返回的 permissions 才是唯一依据,
     * 因为后端是实时查库的, 权限变更后前端下一次刷新即生效。
     */
    async me(user) {
        const permissions = await this.roles.getPermissions(user.role);
        return {
            id: user.id,
            email: user.email,
            role: user.role,
            roleLabel: permissions_1.ROLE_LABELS[user.role] ?? user.role,
            permissions,
            highRiskPermissions: permissions_1.HIGH_RISK_PERMISSIONS,
        };
    }
    /** 平台概览。days 白名单化, 避免任意大值拖垮聚合 */
    async overview(days) {
        const allowed = [7, 30, 90];
        const n = Number(days);
        return this.overviewService.overview(allowed.includes(n) ? n : 7);
    }
    /**
     * 权限点全集与内置角色默认配置。
     *
     * 只读: 角色权限的实际生效值走 /admin/roles (M10)。
     */
    async permissionCatalog() {
        return {
            permissions: permissions_1.ALL_PERMISSIONS,
            highRiskPermissions: permissions_1.HIGH_RISK_PERMISSIONS,
            roles: Object.entries(permissions_1.ROLE_PERMISSIONS).map(([code, permissions]) => ({
                code,
                label: permissions_1.ROLE_LABELS[code] ?? code,
                permissions,
            })),
        };
    }
};
exports.AdminController = AdminController;
__decorate([
    (0, common_1.Get)('me')
    // 身份自省: 每个后台角色都必须能问"我是谁、我能做什么", 不设权限点
    ,
    (0, admin_decorator_1.AdminIdentityOnly)(),
    __param(0, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "me", null);
__decorate([
    (0, common_1.Get)('overview'),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.platformDashboard),
    __param(0, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "overview", null);
__decorate([
    (0, common_1.Get)('permissions')
    // 权限目录是只读元数据 (角色页据此渲染), 与「我是谁」同属自省端点
    ,
    (0, admin_decorator_1.AdminIdentityOnly)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "permissionCatalog", null);
exports.AdminController = AdminController = __decorate([
    (0, common_1.Controller)('admin'),
    __metadata("design:paramtypes", [admin_role_service_1.AdminRoleService,
        overview_service_1.AdminOverviewService])
], AdminController);
//# sourceMappingURL=admin.controller.js.map