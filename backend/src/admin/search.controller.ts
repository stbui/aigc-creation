import { Controller, Get, Query } from "@nestjs/common";
import { AdminUser, RequirePermission } from "./admin.decorator";
import { AdminRoleService } from "./admin-role.service";
import { PERMISSIONS } from "./permissions";
import { AdminSearchService } from "./search.service";

/**
 * 全局搜索（顶栏搜索框）。
 *
 * 权限 `data.search`：搜索会把各表数据按关键字捞出来，等于开了一个
 * 跨模块的只读窗口。运营与财务默认有，其他角色需要显式授予。
 */
@Controller("admin/search")
export class AdminSearchController {
  constructor(
    private readonly search: AdminSearchService,
    private readonly roles: AdminRoleService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.dataSearch)
  async query(@AdminUser() user: AdminUser, @Query("q") q?: string) {
    const permissions = await this.roles.getPermissions(user.role);
    return this.search.search(q ?? "", permissions);
  }
}
