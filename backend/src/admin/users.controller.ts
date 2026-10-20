import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AdminUser, AuditAction, RequirePermission } from './admin.decorator';
import { AdminUsersService } from './users.service';
import { PERMISSIONS, ROLE_LABELS } from './permissions';
import {
  ChangeUserRoleDto,
  ChangeUserStatusDto,
  DeleteUserDto,
  UserListQueryDto,
} from './dto/user.dto';

/**
 * 用户与账户管理。
 *
 * 动作命名约定: `<资源>.<动作>` (user.* / account.*), 与 AdminAuditLog.action 对齐。
 * 高危动作 (删除/重置密码) 走 @RequirePermission 的独立权限点,
 * 便于运营单独回收这些权限而不必撤销整个模块。
 */
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  /** 用户列表 */
  @Get()
  @RequirePermission(PERMISSIONS.userRead)
  list(@Query() query: UserListQueryDto) {
    return this.users.list(query);
  }

  /** 用户详情 */
  @Get(':id')
  @RequirePermission(PERMISSIONS.userRead)
  detail(@Param('id') id: string) {
    return this.users.detail(id);
  }

  /** 删除前的连带影响预览, 供确认弹窗展示具体数量 */
  @Get(':id/impact')
  @RequirePermission(PERMISSIONS.userRead)
  impact(@Param('id') id: string) {
    return this.users.impactPreview(id);
  }

  /**
   * 禁用 / 启用账号。
   *
   * 由于 AdminGuard 每次请求查库校验 status, 禁用后该用户的旧 token
   * 下一次请求即 403, 无需额外的 token 黑名单机制。
   */
  @Patch(':id/status')
  @RequirePermission(PERMISSIONS.userDisable)
  @AuditAction('user.status_change')
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeUserStatusDto,
    @AdminUser() actor: AdminUser,
  ) {
    return this.users.changeStatus(id, dto, actor.id);
  }

  /**
   * 变更角色。
   *
   * 防提权规则在 service 层: 只有 admin 能授予 admin, 且最后一个 admin 不可降级。
   */
  @Patch(':id/role')
  @RequirePermission(PERMISSIONS.userWrite)
  @AuditAction('user.role_change')
  changeRole(
    @Param('id') id: string,
    @Body() dto: ChangeUserRoleDto,
    @AdminUser() actor: AdminUser,
  ) {
    return this.users.changeRole(id, dto, actor);
  }

  /** 重置密码: 返回一次性临时密码, 明文不入库不入审计 */
  @Post(':id/password')
  @RequirePermission(PERMISSIONS.userResetPassword)
  @AuditAction('user.password_reset')
  resetPassword(@Param('id') id: string) {
    return this.users.resetPassword(id);
  }

  /**
   * 删除用户。
   *
   * 默认软删 (status='deleted' + 匿名化); `?hard=true` 物理删除可删部分。
   * **订单不在删除范围内** —— 《电子商务法》要求交易信息保存不少于 3 年。
   */
  @Delete(':id')
  @RequirePermission(PERMISSIONS.userDelete)
  @AuditAction('user.delete')
  remove(@Param('id') id: string, @Query('hard') hard: string, @Body() dto: DeleteUserDto) {
    return this.users.remove(id, hard === 'true', dto?.confirm);
  }

  /** 角色下拉选项 (供用户列表筛选用) */
  @Get('meta/roles')
  @RequirePermission(PERMISSIONS.userRead)
  roles() {
    return Object.entries(ROLE_LABELS).map(([code, label]) => ({ code, label }));
  }
}