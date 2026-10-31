/**
 * 后台用户分组接口（`/api/v1/admin/user-groups`）。
 *
 *   · `GET    /admin/user-groups`       列表（含用户数与默认分组标记）
 *   · `GET    /admin/user-groups/:id`   详情
 *   · `POST   /admin/user-groups`       新建
 *   · `PATCH  /admin/user-groups/:id`   保存
 *   · `DELETE /admin/user-groups/:id`   删除
 *
 * 语义校验（编码规则、倍率区间、渠道归属、套餐占用）在 `UserGroupAdminService`；
 * 这里只做形状校验与权限 / 审计声明。`code` 创建后不可改 —— 会员套餐按编码映射分组，
 * 改编码等于把存量会员整体换组。
 */

import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Allow, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AuditAction, RequirePermission } from '../../admin/admin.decorator';
import { PERMISSIONS } from '../../admin/permissions';
import { UserGroupAdminService, type UserGroupRequest } from './user-group.admin.service';

/** 分组写入入参（嵌套覆盖项整体透传，语义校验在 service） */
export class UserGroupWriteBodyDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() badgeLabel?: string;
  @IsOptional() @IsString() badgeStyle?: string;
  @IsOptional() @IsInt() @Min(0) @Max(999_999) sortOrder?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) ratioBasisPoints?: number;
  @IsOptional() @Allow() pointsPerUsdMicrocredits?: number | string;
  @IsOptional() @Allow() pointsPerCnyMicrocredits?: number | string;
  @IsOptional() @IsBoolean() allChannels?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) channelIds?: string[];
  @IsOptional() @IsArray() @Allow() modelOverrides?: unknown[];
  /** 高危动作原因（写审计） */
  @IsOptional() @IsString() reason?: string;
}

@Controller('admin/user-groups')
export class AdminUserGroupsController {
  constructor(private readonly groups: UserGroupAdminService) {}

  @Get()
  @RequirePermission(PERMISSIONS.userGroupRead)
  list() {
    return this.groups.list();
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.userGroupRead)
  get(@Param('id') id: string) {
    return this.groups.get(id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.userGroupWrite)
  @AuditAction('user_group.create')
  create(@Body() body: UserGroupWriteBodyDto) {
    return this.groups.create(body as UserGroupRequest);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.userGroupWrite)
  @AuditAction('user_group.update')
  update(@Param('id') id: string, @Body() body: UserGroupWriteBodyDto) {
    return this.groups.update(id, body as UserGroupRequest);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.userGroupWrite)
  @AuditAction('user_group.delete')
  async remove(@Param('id') id: string) {
    await this.groups.remove(id);
    return { ok: true };
  }
}
