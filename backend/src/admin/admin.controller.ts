import { Controller, Get, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { AdminIdentityOnly, AdminUser, RequirePermission } from './admin.decorator';
import { AdminRoleService } from './admin-role.service';
import { AdminOverviewService } from './overview.service';
import {
  ALL_PERMISSIONS,
  HIGH_RISK_PERMISSIONS,
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
} from './permissions';

/** 平台概览时间窗。白名单化, 避免任意大值拖垮聚合 */
class OverviewQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30, 90], { message: 'days 只支持 7 / 30 / 90' })
  days?: number;
}

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
  // 身份自省: 每个后台角色都必须能问"我是谁、我能做什么", 不设权限点
  @AdminIdentityOnly()
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
  async overview(@Query() query: OverviewQueryDto) {
    return this.overviewService.overview(query.days ?? 7);
  }

  /**
   * 权限点全集与内置角色默认配置。
   *
   * 只读: 角色权限的实际生效值走 /admin/roles (M10)。
   */
  @Get('permissions')
  // 权限目录是只读元数据 (角色页据此渲染), 与「我是谁」同属自省端点
  @AdminIdentityOnly()
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