import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminUser, AuditAction, RequirePermission } from './admin.decorator';
import { AdminRoleService } from './admin-role.service';
import { AdminUsersService } from './users.service';
import { PERMISSIONS, ROLE_LABELS } from './permissions';
import { AppError } from '../common/app.exception';
import { runBatch } from '../common/batch';
import { csvFilename } from '../common/csv';
import {
  ChangeUserRoleDto,
  ChangeUserStatusDto,
  DeleteUserDto,
  UserListQueryDto,
} from './dto/user.dto';

/**
 * 批量启用 / 禁用。
 *
 * 刻意**不提供批量删除**：禁用可逆，删除不可逆，而批量删除是「点错一次
 * 影响 100 个人」的操作。需要清退账号时逐条走删除（有影响面预览与确认词）。
 */
export class UserBatchDto {
  @IsArray()
  @ArrayMaxSize(100, { message: '单次批量最多 100 条' })
  @IsString({ each: true })
  ids!: string[];

  @IsIn(['disable', 'enable'], { message: 'action 只能是 disable 或 enable' })
  action!: 'disable' | 'enable';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/**
 * 用户与账户管理。
 *
 * 动作命名约定: `<资源>.<动作>` (user.* / account.*), 与 AdminAuditLog.action 对齐。
 * 高危动作 (删除/重置密码) 走 @RequirePermission 的独立权限点,
 * 便于运营单独回收这些权限而不必撤销整个模块。
 */
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly roles: AdminRoleService,
  ) {}

  /** 用户列表 */
  @Get()
  @RequirePermission(PERMISSIONS.userRead)
  list(@Query() query: UserListQueryDto) {
    return this.users.list(query);
  }

  /**
   * 导出用户 (CSV)。
   *
   * ⚠️ 必须声明在 `:id` 之前：否则 `/admin/users/export` 会被当成 id 为 export 的用户。
   */
  @Get('export')
  @RequirePermission(PERMISSIONS.dataExport)
  @AuditAction('data.export')
  async export(@Query() query: UserListQueryDto, @Res() res: Response) {
    const csv = await this.users.exportCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csvFilename('users')}"`);
    res.send(csv);
  }

  /**
   * 批量启用 / 禁用。
   *
   * 权限按 action 单独判定（`user.disable`）：路由上挂的是 `user.read`
   * 作为入口权限，动作权限在处理器内用 AdminRoleService 显式校验 ——
   * 一个端点承载多个动作时，静态装饰器表达不了「按 action 取权限」，
   * 而把两者都放宽成 user.read 会让只读角色获得禁用能力。
   */
  @Post('batch')
  @RequirePermission(PERMISSIONS.userRead)
  @AuditAction('user.batch')
  async batch(@Body() dto: UserBatchDto, @AdminUser() actor: AdminUser) {
    if (!(await this.roles.hasPermission(actor.id, PERMISSIONS.userDisable))) {
      throw new AppError(40301, '没有批量启停账号的权限', 403);
    }
    return this.users.batchStatus(dto.ids, dto.action === 'disable' ? 'disabled' : 'active', actor.id);
  }

  /** 用户详情 */
  @Get(':id')
  @RequirePermission(PERMISSIONS.userRead)
  detail(@Param('id') id: string) {
    return this.users.detail(id);
  }

  /**
   * 最近登录记录。
   *
   * 单独成端点而不是塞进 detail 的原因：登录 IP/UA 属于**安全审计数据**，
   * 权限点与用户管理不同（audit.read），只有运营/管理员角色默认持有。
   * 塞进 detail 会让仅有 user.read 的角色顺手看到全站登录 IP。
   */
  @Get(':id/logins')
  @RequirePermission(PERMISSIONS.auditRead)
  logins(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.users.recentLogins(id, Number(limit) || 50);
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

  /**
   * 角色下拉选项 (供用户列表筛选用)。
   *
   * 方法名不能叫 `roles` —— 构造函数里注入的 `AdminRoleService` 占了这个名字,
   * 同类内重复声明的成员会让编译直接失败。路由路径不受影响。
   */
  @Get('meta/roles')
  @RequirePermission(PERMISSIONS.userRead)
  roleOptions() {
    return Object.entries(ROLE_LABELS).map(([code, label]) => ({ code, label }));
  }
}