"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminUser = exports.AuditTarget = exports.AuditAction = exports.AdminIdentityOnly = exports.RequireAllPermissions = exports.RequirePermission = exports.AUDIT_TARGET_KEY = exports.AUDIT_ACTION_KEY = exports.IDENTITY_ONLY_KEY = exports.PERMISSION_KEY = void 0;
exports.getRequiredPermission = getRequiredPermission;
exports.getRequiredPermissions = getRequiredPermissions;
const common_1 = require("@nestjs/common");
/** 权限点元数据键 */
exports.PERMISSION_KEY = "admin:permission";
/** 「只要求后台身份」标记的元数据键 */
exports.IDENTITY_ONLY_KEY = "admin:identityOnly";
/** 审计动作元数据键 */
exports.AUDIT_ACTION_KEY = "admin:auditAction";
/** 审计对象元数据键 */
exports.AUDIT_TARGET_KEY = "admin:auditTarget";
/**
 * 声明端点所需权限点。
 *
 * 用法: @RequirePermission(PERMISSIONS.orderRefund)
 * 未声明权限点的 admin 端点由 PermissionGuard 默认拒绝。确实只需后台身份
 * 的自省类端点应显式使用 @AdminIdentityOnly()。
 */
const RequirePermission = (permission) => (0, common_1.SetMetadata)(exports.PERMISSION_KEY, permission);
exports.RequirePermission = RequirePermission;
/**
 * 声明端点必须同时具备的所有权限点。
 *
 * 用于导出这类复合操作: 既要拥有来源领域的数据读取权限, 又要拥有
 * `data.export`。只校验后者会让没有该领域读取权限的角色把数据带走。
 */
const RequireAllPermissions = (...permissions) => (0, common_1.SetMetadata)(exports.PERMISSION_KEY, permissions);
exports.RequireAllPermissions = RequireAllPermissions;
/**
 * 声明该端点**只需后台身份, 不需要权限点**。
 *
 * 只有确实对全体后台角色开放的自省类端点才该用 (当前登录者是谁、
 * 自己能做什么、平台概览)。加这个标记的唯一作用是让 PermissionGuard
 * 不再为它打「未声明权限点」的告警 —— 告警必须保持稀缺,
 * 否则真正的漏声明会被淹没在一片噪音里。
 */
const AdminIdentityOnly = () => (0, common_1.SetMetadata)(exports.IDENTITY_ONLY_KEY, true);
exports.AdminIdentityOnly = AdminIdentityOnly;
/**
 * 声明该端点产生的审计动作名。
 *
 * 为什么显式声明而不是从 URL 推断: 推断在 /admin/users/:id/disable 这类
 * 嵌套路径下会失真, 且资源名词与动作语义常常不一致 (POST /admin/roles/finance
 * 推断出的是 "roles" 而非实际动作 "role.permissions_update")。
 * 审计记录是事后追责与举证的依据, 动作名必须准确。
 *
 * 未声明时 AuditInterceptor 回退到 URL 推断, 保证审计条目不丢失。
 *
 * 用法: @AuditAction('user.disable')
 */
const AuditAction = (action) => (0, common_1.SetMetadata)(exports.AUDIT_ACTION_KEY, action);
exports.AuditAction = AuditAction;
/**
 * 声明审计对象类型与路由参数名。
 *
 * 嵌套路由不能只按 URL 第二段推断对象: 例如
 * `PATCH /admin/channels/c1/models/m2` 的实际对象是渠道模型 m2, 而不是渠道 c1。
 */
const AuditTarget = (targetType, param = "id") => (0, common_1.SetMetadata)(exports.AUDIT_TARGET_KEY, {
    targetType,
    param,
});
exports.AuditTarget = AuditTarget;
/**
 * 取本次请求实际生效的权限点, 未声明返回 null。
 *
 * 值由 PermissionGuard 在放行时写入 `request.requiredPermission` ——
 * 守卫之外拿不到 Reflector, 直接用反射查会漏掉类级声明。
 * 未经过 PermissionGuard 的请求 (非 /admin 路径) 恒返回 null。
 */
function getRequiredPermission(ctx) {
    return ctx.switchToHttp().getRequest().requiredPermission ?? null;
}
/** 取本次请求实际生效的全部权限点; 未声明返回空数组。 */
function getRequiredPermissions(ctx) {
    return ctx.switchToHttp().getRequest().requiredPermissions ?? [];
}
/**
 * 提取当前后台用户: @AdminUser() user
 *
 * 挂在 controller 上即可拿到已由 AdminGuard 校验过的身份,
 * 无需每个方法重复声明 @CurrentUser。
 */
exports.AdminUser = (0, common_1.createParamDecorator)((_data, ctx) => {
    return ctx.switchToHttp().getRequest().adminUser;
});
//# sourceMappingURL=admin.decorator.js.map