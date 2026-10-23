import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

/** 权限点元数据键 */
export const PERMISSION_KEY = 'admin:permission';

/** 「只要求后台身份」标记的元数据键 */
export const IDENTITY_ONLY_KEY = 'admin:identityOnly';

/** 审计动作元数据键 */
export const AUDIT_ACTION_KEY = 'admin:auditAction';

/**
 * 声明端点所需权限点。
 *
 * 用法: @RequirePermission(PERMISSIONS.orderRefund)
 * 未声明权限点的 admin 端点默认放行 (仅要求 admin 身份),
 * 因此新增端点时应显式声明 —— 声明缺失是漏保护, 与"默认拒"的取向相反,
 * 故在 PermissionGuard 中对无元数据的路由直接放行并在日志中可见。
 */
export const RequirePermission = (permission: string) => SetMetadata(PERMISSION_KEY, permission);

/**
 * 声明该端点**只需后台身份, 不需要权限点**。
 *
 * 只有确实对全体后台角色开放的自省类端点才该用 (当前登录者是谁、
 * 自己能做什么、平台概览)。加这个标记的唯一作用是让 PermissionGuard
 * 不再为它打「未声明权限点」的告警 —— 告警必须保持稀缺,
 * 否则真正的漏声明会被淹没在一片噪音里。
 */
export const AdminIdentityOnly = () => SetMetadata(IDENTITY_ONLY_KEY, true);

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
export const AuditAction = (action: string) => SetMetadata(AUDIT_ACTION_KEY, action);

/**
 * 取本次请求实际生效的权限点, 未声明返回 null。
 *
 * 值由 PermissionGuard 在放行时写入 `request.requiredPermission` ——
 * 守卫之外拿不到 Reflector, 直接用反射查会漏掉类级声明。
 * 未经过 PermissionGuard 的请求 (非 /admin 路径) 恒返回 null。
 */
export function getRequiredPermission(ctx: ExecutionContext): string | null {
  return ctx.switchToHttp().getRequest().requiredPermission ?? null;
}

/** 经守卫后注入的用户上下文 */
export interface AdminUser {
  id: string;
  email: string;
  role: string;
}

/**
 * 提取当前后台用户: @AdminUser() user
 *
 * 挂在 controller 上即可拿到已由 AdminGuard 校验过的身份,
 * 无需每个方法重复声明 @CurrentUser。
 */
export const AdminUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminUser => {
    return ctx.switchToHttp().getRequest().adminUser as AdminUser;
  },
);