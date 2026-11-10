/**
 * 后台服务商目录接口（`/api/v1/admin/provider-catalog`）。
 *
 *   · `GET  /admin/provider-catalog`              当前目录（未配置时返回空态与原因）
 *   · `POST /admin/provider-catalog/refresh`      重新拉取远端清单
 *   · `POST /admin/provider-catalog/:id/verify`   校验条目（不下载、不安装）
 *   · `POST /admin/provider-catalog/:id/install`  下载并安装该条目的插件包
 *
 * 权限复用插件的读写点：目录本身就是「插件包的来源」，给它单独的权限点只会
 * 让角色配置多一条永远没人勾的项。
 */

import { Controller, Get, Param, Post } from '@nestjs/common';
import { AdminUser, RequirePermission } from '../../admin/admin.decorator';
import type { AdminUser as AdminUserContext } from '../../admin/admin.decorator';
import { PERMISSIONS } from '../../admin/permissions';
import { ProviderCatalogService } from './provider-catalog.service';

@Controller('admin/provider-catalog')
export class AdminProviderCatalogController {
  constructor(private readonly catalog: ProviderCatalogService) {}

  @Get()
  @RequirePermission(PERMISSIONS.pluginRead)
  list() {
    return this.catalog.list();
  }

  /** 写动作：拉取远端目录会产生出站请求，因此使用独立写权限 */
  @Post('refresh')
  @RequirePermission(PERMISSIONS.pluginWrite)
  refresh() {
    return this.catalog.refresh();
  }

  @Post(':id/verify')
  @RequirePermission(PERMISSIONS.pluginRead)
  verify(@Param('id') id: string) {
    return this.catalog.verify(id);
  }

  @Post(':id/install')
  @RequirePermission(PERMISSIONS.pluginWrite)
  install(@Param('id') id: string, @AdminUser() user: AdminUserContext) {
    return this.catalog.install(id, user?.id ?? '');
  }
}
