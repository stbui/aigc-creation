import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from './admin.decorator';
import { PERMISSIONS } from './permissions';
import { AdminSearchService } from './search.service';

/**
 * 全局搜索（顶栏搜索框）。
 *
 * 权限 `data.search`：搜索会把各表数据按关键字捞出来，等于开了一个
 * 跨模块的只读窗口。运营与财务默认有，其他角色需要显式授予。
 */
@Controller('admin/search')
export class AdminSearchController {
  constructor(private readonly search: AdminSearchService) {}

  @Get()
  @RequirePermission(PERMISSIONS.dataSearch)
  query(@Query('q') q?: string) {
    return this.search.search(q ?? '');
  }
}
