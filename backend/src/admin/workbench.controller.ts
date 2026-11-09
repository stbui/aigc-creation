import { Controller, Get, Query } from '@nestjs/common';
import { AdminIdentityOnly, AdminUser, type AdminUser as AdminUserType } from './admin.decorator';
import { AdminWorkbenchService } from './workbench.service';

/**
 * 角色工作台。
 *
 * 与告警中心一样只要求后台身份，具体分组在 service 内按权限过滤 —— 用单一
 * 权限点会逼着前端为不同角色写不同请求，新增来源时还要再改一次权限矩阵。
 *
 * `view` 只允许 `admin` 用来预览运营/财务首屏，且只裁剪展示分组，不扩大数据范围。
 */
@Controller('admin/workbench')
export class AdminWorkbenchController {
  constructor(private readonly workbench: AdminWorkbenchService) {}

  @Get()
  @AdminIdentityOnly()
  get(@AdminUser() actor: AdminUserType, @Query('view') view?: string) {
    return this.workbench.get(actor, view);
  }
}
