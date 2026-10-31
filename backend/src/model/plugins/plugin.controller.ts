/**
 * 后台插件接口（`/api/v1/admin/plugins`）。
 *
 *   · `GET    /admin/plugins`            清单 + 能力统计 + 协议注册状态
 *   · `GET    /admin/plugins/:id`        单个插件详情
 *   · `PATCH  /admin/plugins/:id`        系统级启停（写库 + 立即重注册协议）
 *   · `POST   /admin/plugins/:id/verify` 契约校验（不发送上游请求）
 *   · `POST   /admin/plugins/install`    上传安装插件包（zip）
 *   · `DELETE /admin/plugins/:id`        卸载上传安装的插件（内置包拒绝）
 *
 * 安装 / 卸载都是高危动作：`reason` 只进审计，不回显给前端。
 */

import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { AppError } from '../../common/app.exception';
import { AdminUser, AuditAction, RequirePermission } from '../../admin/admin.decorator';
import type { AdminUser as AdminUserContext } from '../../admin/admin.decorator';
import { PERMISSIONS } from '../../admin/permissions';
import { PLUGIN_PACKAGE_MAX_BYTES } from '../protocol/package';
import { PluginAdminService } from './plugin.admin.service';

export class PluginUpdateBodyDto {
  /** 必填：缺省时按「启用」处理会让一次误发的 PATCH 把停用插件放出来 */
  @IsBoolean() enabled: boolean;
  /** 高危动作原因（写审计） */
  @IsOptional() @IsString() reason?: string;
}

/** 装 / 卸共用的原因入参（只进审计） */
export class PluginReasonBodyDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

@Controller('admin/plugins')
export class AdminPluginsController {
  constructor(private readonly plugins: PluginAdminService) {}

  @Get()
  @RequirePermission(PERMISSIONS.pluginRead)
  list() {
    return this.plugins.list();
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.pluginRead)
  get(@Param('id') id: string) {
    return this.plugins.get(id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.pluginWrite)
  @AuditAction('plugin.toggle')
  update(@Param('id') id: string, @Body() body: PluginUpdateBodyDto, @AdminUser() user: AdminUserContext) {
    return this.plugins.setEnabled(id, body.enabled, user?.id ?? '');
  }

  @Post(':id/verify')
  @RequirePermission(PERMISSIONS.pluginWrite)
  @AuditAction('plugin.verify')
  verify(@Param('id') id: string, @AdminUser() user: AdminUserContext) {
    return this.plugins.verify(id, user?.id ?? '');
  }

  /**
   * 上传安装插件包。
   *
   * 上限与包格式常量同源（`PLUGIN_PACKAGE_MAX_BYTES`）：上传层先拦一次大文件，
   * 解析层再校验中央目录 —— 只靠其中一层都会让 48MB 的垃圾读到内存里才失败。
   */
  @Post('install')
  @RequirePermission(PERMISSIONS.pluginWrite)
  @AuditAction('plugin.install')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: PLUGIN_PACKAGE_MAX_BYTES },
    }),
  )
  install(
    @UploadedFile() file: { buffer?: Buffer } | undefined,
    @Body() body: PluginReasonBodyDto,
    @AdminUser() user: AdminUserContext,
  ) {
    if (!file?.buffer?.length) throw new AppError(40001, '请上传插件包（字段名 file，zip）', 400);
    return this.plugins.install(file.buffer, user?.id ?? '');
  }

  /** 卸载上传安装的插件；内置插件拒绝（随代码发布，删了也会回来） */
  @Delete(':id')
  @RequirePermission(PERMISSIONS.pluginWrite)
  @AuditAction('plugin.uninstall')
  async uninstall(
    @Param('id') id: string,
    @Body() body: PluginReasonBodyDto,
    @AdminUser() user: AdminUserContext,
  ) {
    return this.plugins.uninstall(id, user?.id ?? '');
  }
}
