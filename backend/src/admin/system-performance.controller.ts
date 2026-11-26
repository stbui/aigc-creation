import { Controller, Get } from '@nestjs/common';
import { RequirePermission } from './admin.decorator';
import { PERMISSIONS } from './permissions';
import { SystemPerformanceService } from './system-performance.service';

/**
 * 系统信息（`GET /admin/system-performance`）。
 *
 * 只读快照，权限与系统设置页一致使用 `setting.read`：运维与运营都会看的运行时
 * 诊断数据，不包含凭据、上游密钥或用户内容。数据库位置按脱敏形式返回（SQLite
 * 给库文件路径，PG 只给 `host[:port]/database`，一律不带用户名与密码）。
 * 没有写接口 —— 这些量来自部署环境与库本身，不允许在后台改。
 */
@Controller('admin/system-performance')
export class SystemPerformanceController {
  constructor(private readonly performance: SystemPerformanceService) {}

  @Get()
  @RequirePermission(PERMISSIONS.settingRead)
  snapshot() {
    return this.performance.snapshot();
  }
}
