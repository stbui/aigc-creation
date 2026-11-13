import {
  SetMetadata,
  createParamDecorator,
  ExecutionContext,
} from "@nestjs/common";

/** 权限点元数据键 */
export const PERMISSION_KEY = "admin:permission";

/** 「任一权限即可」元数据键 */
export const ANY_PERMISSION_KEY = "admin:anyPermission";

/** 「只要求后台身份」标记的元数据键 */
export const IDENTITY_ONLY_KEY = "admin:identityOnly";

/**
 * 声明端点所需权限点。
 *
 * 用法: @RequirePermission(PERMISSIONS.orderRefund)
 * 未声明权限点的 admin 端点由 PermissionGuard 默认拒绝。确实只需后台身份
 * 的自省类端点应显式使用 @AdminIdentityOnly()。
 */
export const RequirePermission = (permission: string) =>
  SetMetadata(PERMISSION_KEY, permission);

/**
 * 声明端点必须同时具备的所有权限点。
 *
 * 用于导出这类复合操作: 既要拥有来源领域的数据读取权限, 又要拥有
 * `data.export`。只校验后者会让没有该领域读取权限的角色把数据带走。
 */
export const RequireAllPermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSION_KEY, permissions);

/**
 * 声明端点满足任意一个权限点即可访问。
 *
 * 用于同一份只读数据存在多个合法入口权限的场景，例如「能力与模型」：
 * 能力运营有 `capability.read`，模型运营有 `logical_model.read`，两者都应
 * 能查看同一份能力清单。写操作仍必须使用 `@RequirePermission`，不能因为
 * 读权限放宽而连带放开写权限。
 */
export const RequireAnyPermissions = (...permissions: string[]) =>
  SetMetadata(ANY_PERMISSION_KEY, permissions);

/**
 * 声明该端点**只需后台身份, 不需要权限点**。
 *
 * 只有确实对全体后台角色开放的自省类端点才该用 (当前登录者是谁、
 * 自己能做什么、平台概览)。加这个标记的唯一作用是让 PermissionGuard
 * 不再为它打「未声明权限点」的告警 —— 告警必须保持稀缺,
 * 否则真正的漏声明会被淹没在一片噪音里。
 */
export const AdminIdentityOnly = () => SetMetadata(IDENTITY_ONLY_KEY, true);

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
