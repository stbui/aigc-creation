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
exports.AdminSettingsController = exports.AdminRolesController = void 0;
const common_1 = require("@nestjs/common");
const admin_decorator_1 = require("./admin.decorator");
const admin_role_service_1 = require("./admin-role.service");
const settings_service_1 = require("./settings.service");
const permissions_1 = require("./permissions");
// ⚠️ DTO 必须用值导入 (不能用 `import type`)。
// `import type` 会在编译期抹掉类的运行时值, 使 design:paramtypes 退化成 Function,
// ValidationPipe 因此无法识别类型 —— @Body 拿到的是未校验的原始 body,
// 结果是「请求 200 但 DTO 上一个字段都没生效」, 比直接报错更难排查。
const audit_dto_1 = require("./dto/audit.dto");
const settings_dto_1 = require("./settings.dto");
/** 角色权限管理 */
let AdminRolesController = class AdminRolesController {
    constructor(roles) {
        this.roles = roles;
    }
    /**
     * 角色列表与各自的生效权限点。
     *
     * 返回的是**库里的实际值**而非代码默认值 —— 运营改过的权限要如实呈现,
     * 否则角色页会显示与实际不符的权限, 造成误操作。
     */
    async list(query) {
        const codes = query.code && (0, permissions_1.isAdminRole)(query.code)
            ? [query.code]
            : Object.keys(permissions_1.ROLE_LABELS).filter(permissions_1.isAdminRole);
        const items = [];
        for (const code of codes) {
            items.push({
                code,
                label: permissions_1.ROLE_LABELS[code] ?? code,
                builtIn: true,
                permissions: await this.roles.getPermissions(code),
            });
        }
        return { items };
    }
    /**
     * 更新角色权限点。
     *
     * 立即生效: AdminGuard/PermissionGuard 每次请求查库, 无需重启或重新登录。
     * 保护: 操作者自身的权限收窄也会立即生效 —— 这是刻意的,
     * "改完自己就锁在门外"是可接受的 (有其他 admin 可救), 换取的是权限确实收紧。
     */
    async updatePermissions(dto, req) {
        const changes = await this.roles.updatePermissions(dto.roles.map((role) => ({
            code: role.code,
            permissions: role.permissions,
        })));
        req.auditExtra = {
            roleCodes: changes.map((change) => change.code),
            changes: changes.map((change) => ({
                code: change.code,
                added: change.added,
                removed: change.removed,
                beforeCount: change.before.length,
                afterCount: change.after.length,
            })),
        };
        return {
            roles: changes.map((change) => ({
                code: change.code,
                permissions: change.after,
            })),
        };
    }
};
exports.AdminRolesController = AdminRolesController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.roleRead),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [audit_dto_1.RoleListQueryDto]),
    __metadata("design:returntype", Promise)
], AdminRolesController.prototype, "list", null);
__decorate([
    (0, common_1.Patch)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.roleWrite),
    (0, admin_decorator_1.AuditAction)("role.permissions_update"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [audit_dto_1.UpdateRolePermissionsDto, Object]),
    __metadata("design:returntype", Promise)
], AdminRolesController.prototype, "updatePermissions", null);
exports.AdminRolesController = AdminRolesController = __decorate([
    (0, common_1.Controller)("admin/roles"),
    __metadata("design:paramtypes", [admin_role_service_1.AdminRoleService])
], AdminRolesController);
/** 系统设置 */
let AdminSettingsController = class AdminSettingsController {
    constructor(settings) {
        this.settings = settings;
    }
    /** 分组读取全部设置 */
    read() {
        return this.settings.readAll();
    }
    /**
     * 写入系统设置 / 恢复默认。
     *
     * kv 结构提交：`{ settings: { 'upload.maxSizeMb': 20 }, clears: ['refund.windowDays'] }`。
     * 键的合法性与取值范围由 `SETTING_DEFS` 校验，未知键直接 400。
     */
    async update(dto, user, req) {
        const result = await this.settings.updateAll(dto?.settings ?? {}, dto?.clears ?? [], user?.email ?? "admin");
        /*
         * 把「键 → 旧值 → 新值」交给审计拦截器。
         *
         * 拦截器只从 body 里挑白名单字段，它拿不到旧值（旧值在库里，
         * 请求体里没有）。所以由 service 组装好挂在 request 上 ——
         * 否则审计里只有动作本身，改了哪个键、从几改成几全都查不到。
         */
        req.auditExtra = {
            changes: result.changes.map((c) => ({
                key: c.key,
                label: c.label,
                before: c.before,
                after: c.after,
                action: c.action,
            })),
            updated: result.updated,
            cleared: result.cleared,
        };
        return result;
    }
};
exports.AdminSettingsController = AdminSettingsController;
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.settingRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminSettingsController.prototype, "read", null);
__decorate([
    (0, common_1.Patch)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.settingWrite),
    (0, admin_decorator_1.AuditAction)("setting.update"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, admin_decorator_1.AdminUser)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [settings_dto_1.UpdateSettingsDto, Object, Object]),
    __metadata("design:returntype", Promise)
], AdminSettingsController.prototype, "update", null);
exports.AdminSettingsController = AdminSettingsController = __decorate([
    (0, common_1.Controller)("admin/settings"),
    __metadata("design:paramtypes", [settings_service_1.AdminSettingsService])
], AdminSettingsController);
//# sourceMappingURL=roles.controller.js.map