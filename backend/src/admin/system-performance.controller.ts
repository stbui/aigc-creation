import { Controller, Get } from '@nestjs/common';
import { RequirePermission } from './admin.decorator';
import { PERMISSIONS } from './permissions';
import { SystemPerformanceService } from './system-performance.service';

/**
 * 系统性能（`GET /admin/system-performance`）。
 *
 * 只读快照，权限与系统设置页一致使用 `setting.read`：这是运维与运营都会看的
 * 运行时诊断数据，不包含凭据、上游地址或用户内容。没有写接口 ——
 * 性能参数来自部署环境，不允许在后台改运行时阈值。
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
