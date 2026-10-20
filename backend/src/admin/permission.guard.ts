import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../common/app.exception';
import { PERMISSION_KEY } from './admin.decorator';
import { AdminRoleService } from './admin-role.service';

/**
 * 后台第二道守卫: 权限点校验。
 *
 * 必须在 AdminGuard 之后执行 (依赖 request.adminUser)。
 * 兜底默认拒: 元数据声明的权限点不在角色权限内即 403。
 *
 * 未声明 @RequirePermission 的路由: 只要求后台身份, 放行。
 * 这是有意取舍 —— 概览类的只读端点不值得为每个都声明权限点,
 * 但**新增写操作端点时必须显式声明**, 否则会静默放行。
 * 下面的 warn 日志会让漏声明的端点在日志里显形。
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly roles: AdminRoleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 全局守卫: 非后台路径直接放行 (与 AdminGuard 的判定保持一致)
    const url: string = request.originalUrl ?? request.url ?? '';
    if (!url.split('?')[0].includes('/admin')) return true;

    const required = this.reflector.get<string | undefined>(PERMISSION_KEY, context.getHandler());
    if (!required) return true;

    const adminUser = request.adminUser;
    if (!adminUser) {
      // AdminGuard 未执行或已失败 —— 守卫顺序被改动时兜底
      throw new AppError(40301, '需要管理员权限', 403);
    }

    const permissions = await this.roles.getPermissions(adminUser.role);
    if (!permissions.includes(required)) {
      this.logger.warn(
        `权限不足: ${adminUser.email} (${adminUser.role}) 缺少 ${required}`,
      );
      // 不回显所需权限点: 避免通过报错探测系统有哪些能力
      throw new AppError(40301, '无操作权限', 403);
    }

    return true;
  }
}