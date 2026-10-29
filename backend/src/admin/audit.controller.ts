import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuditAction, RequirePermission } from './admin.decorator';
import { AppError } from '../common/app.exception';
import { sendCsv } from '../common/csv-response';
import { AdminAuditService } from './audit.service';
import { PERMISSIONS } from './permissions';
// 值导入: @Query() 的 DTO 同样依赖 design:paramtypes 做实例化与白名单剥离,
// 用 `import type` 会让查询参数完全绕过校验。
import { AuditListQueryDto } from './dto/audit.dto';

/**
 * 操作审计查询。
 *
 * **只读**: 本 controller 不提供任何写方法, 后端整体也没有删除审计的入口。
 * 表设计上只允许 INSERT (AdminAuditLog 无 updatedAt 字段)。
 *
 * 已知不足: 管理员仍可直接操作数据库删除审计记录。
 * 彻底解决需独立存储或哈希链, 本期不做 (已在设计文档 §16.4 登记)。
 */
@Controller('admin/audit-logs')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  /** 审计列表。附带动作筛选项 (从实际数据聚合, 避免前端硬编码过期清单) */
  @Get()
  @RequirePermission(PERMISSIONS.auditRead)
  list(@Query() query: AuditListQueryDto) {
    return this.audit.list(query);
  }

  /**
   * 导出审计日志 (CSV)。
   *
   * ⚠️ 路由必须声明在 `:id` 之前，否则 `export` 会被当成一条审计记录的 id。
   * 导出把操作人身份与 IP 带出系统，用独立的 `data.export` 权限点并留审计。
   */
  @Get('export')
  @RequirePermission(PERMISSIONS.dataExport)
  @AuditAction('data.export')
  async export(@Query() query: AuditListQueryDto, @Res() res: Response) {
    const csv = await this.audit.exportCsv(query);
    sendCsv(res, 'audit-logs', csv);
  }

  /** 单条详情 */
  @Get(':id')
  @RequirePermission(PERMISSIONS.auditRead)
  async detail(@Param('id') id: string) {
    const item = await this.audit.detail(id);
    if (!item) throw new AppError(40400, '记录不存在', 404);
    return item;
  }
}