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
var PermissionGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const app_exception_1 = require("../common/app.exception");
const admin_decorator_1 = require("./admin.decorator");
const admin_role_service_1 = require("./admin-role.service");
/**
 * 后台第二道守卫: 权限点校验。
 *
 * 必须在 AdminGuard 之后执行 (依赖 request.adminUser)。
 * 兜底默认拒: 元数据声明的权限点不在角色权限内即 403。
 *
 * ## 类级与方法级声明 (2026-10-21 修)
 *
 * 一个 controller 下的端点通常共享同一个权限点, 故 `/admin/coupons`、
 * `/admin/campaigns`、`/admin/invites`、`/admin/checkin` 四个 controller
 * 都把 `@RequirePermission(marketingWrite)` 写在**类上**。
 *
 * ⚠️ 此前只读 `context.getHandler()`, 类级声明被完全忽略 —— 这 15 条路由
 * 因此只要求后台身份, 任何一个后台角色都能改券、改活动、改邀请奖励规则。
 * 权限点写在类上却被静默放行, 是最危险的一类缺陷: 代码读起来"有权限控制",
 * 实际没有。
 *
 * 现改用 `getAllAndOverride([handler, class])` —— 方法级优先于类级,
 * 与 Nest 官方推荐一致 (个别端点需要更细的权限时在方法上覆盖)。
 *
 * ## 未声明权限点
 *
 * 默认拒绝并打 ERROR: 漏声明属于配置错误, 不能把后台端点降级成"只校验身份"。
 * 真正对全体后台角色开放的自省类端点 (当前身份/概览) 必须显式使用
 * `@AdminIdentityOnly()` 豁免。
 */
let PermissionGuard = PermissionGuard_1 = class PermissionGuard {
    constructor(reflector, roles) {
        this.reflector = reflector;
        this.roles = roles;
        this.logger = new common_1.Logger(PermissionGuard_1.name);
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        // 全局守卫: 非后台路径直接放行 (与 AdminGuard 的判定保持一致)
        const url = request.originalUrl ?? request.url ?? "";
        if (!url.split("?")[0].includes("/admin"))
            return true;
        const targets = [context.getHandler(), context.getClass()];
        const required = this.reflector.getAllAndOverride(admin_decorator_1.PERMISSION_KEY, targets);
        if (!required || (Array.isArray(required) && required.length === 0)) {
            const identityOnly = this.reflector.getAllAndOverride(admin_decorator_1.IDENTITY_ONLY_KEY, targets);
            if (!identityOnly) {
                /*
                 * 默认拒绝 (2026-10-22 从 fail-open 改为 fail-closed)。
                 *
                 * 旧行为只打 WARN 就放行: 新增或改名路由一旦漏写 @RequirePermission,
                 * 任何后台角色 (含权限最窄的运营/财务) 都能直接调用, 日志里只有一行
                 * 容易被忽略的警告。漏声明是配置错误, 不是「无需权限」——
                 * 真正无需权限的自省端点应显式写 @AdminIdentityOnly()。
                 */
                this.logger.error(`后台端点未声明权限点, 已拒绝: ${request.method ?? "?"} ${url} — 请补 @RequirePermission 或 @AdminIdentityOnly`);
                throw new app_exception_1.AppError(40301, "该端点未声明权限点, 已拒绝访问", 403);
            }
            return true;
        }
        const requiredPermissions = Array.isArray(required) ? required : [required];
        // 供 getRequiredPermission()/getRequiredPermissions() 读取 (守卫之外拿不到 Reflector)
        request.requiredPermissions = requiredPermissions;
        request.requiredPermission = requiredPermissions[0];
        const adminUser = request.adminUser;
        if (!adminUser) {
            // AdminGuard 未执行或已失败 —— 守卫顺序被改动时兜底
            throw new app_exception_1.AppError(40301, "需要管理员权限", 403);
        }
        const permissions = await this.roles.getPermissions(adminUser.role);
        const missing = requiredPermissions.filter((permission) => !permissions.includes(permission));
        if (missing.length > 0) {
            this.logger.warn(`权限不足: ${adminUser.email} (${adminUser.role}) 缺少 ${missing.join(", ")}`);
            // 不回显所需权限点: 避免通过报错探测系统有哪些能力
            throw new app_exception_1.AppError(40301, "无操作权限", 403);
        }
        return true;
    }
};
exports.PermissionGuard = PermissionGuard;
exports.PermissionGuard = PermissionGuard = PermissionGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector,
        admin_role_service_1.AdminRoleService])
], PermissionGuard);
//# sourceMappingURL=permission.guard.js.map