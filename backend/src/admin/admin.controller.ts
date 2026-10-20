import { Controller, Get, Query } from '@nestjs/common';
import { AdminUser, RequirePermission } from './admin.decorator';
import { AdminRoleService } from './admin-role.service';
import { AdminOverviewService } from './overview.service';
import {
  ALL_PERMISSIONS,
  HIGH_RISK_PERMISSIONS,
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
} from './permissions';

/**
 * 后台骨架端点。
 *
 * 当前批次 (M2) 只交付能验证权限链路的最小组集:
 *   GET /admin/me           当前登录者身份 + 权限清单 (前端据此渲染菜单与按钮)
 *   GET /admin/overview     平台概览
 *   GET /admin/permissions 权限点全集与角色定义 (角色权限页用)
 * 业务端点按批次陆续加入本模块下的子 controller。
 */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly roles: AdminRoleService,
    private readonly overviewService: AdminOverviewService,
  ) {}

  /**
   * 当前后台用户。
   *
   * 前端不用 token 里的信息判定权限 —— 本端点返回的 permissions 才是唯一依据,
   * 因为后端是实时查库的, 权限变更后前端下一次刷新即生效。
   */
  @Get('me')
  async me(@AdminUser() user: AdminUser) {
    const permissions = await this.roles.getPermissions(user.role);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      roleLabel: ROLE_LABELS[user.role] ?? user.role,
      permissions,
      highRiskPermissions: HIGH_RISK_PERMISSIONS,
    };
  }

  /** 平台概览。days 白名单化, 避免任意大值拖垮聚合 */
  @Get('overview')
  @RequirePermission(PERMISSIONS.platformDashboard)
  async overview(@Query('days') days?: string) {
    const allowed = [7, 30, 90];
    const n = Number(days);
    return this.overviewService.overview(allowed.includes(n) ? n : 7);
  }

  /**
   * 权限点全集与内置角色默认配置。
   *
   * 只读: 角色权限的实际生效值走 /admin/roles (M10)。
   */
  @Get('permissions')
  async permissionCatalog() {
    return {
      permissions: ALL_PERMISSIONS,
      highRiskPermissions: HIGH_RISK_PERMISSIONS,
      roles: Object.entries(ROLE_PERMISSIONS).map(([code, permissions]) => ({
        code,
        label: ROLE_LABELS[code] ?? code,
        permissions,
      })),
    };
  }
}