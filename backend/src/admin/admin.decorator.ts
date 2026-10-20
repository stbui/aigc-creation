import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

/** 权限点元数据键 */
export const PERMISSION_KEY = 'admin:permission';

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

/** 取声明的权限点, 未声明返回 null */
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