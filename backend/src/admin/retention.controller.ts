import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import { RequirePermission } from './admin.decorator';
import { PERMISSIONS } from './permissions';
import { AdminRetentionService, RETENTION_TABLE_NAMES } from './retention.service';

/** 手动清理 */
export class RetentionCleanupDto {
  @IsIn(RETENTION_TABLE_NAMES, { message: '不支持清理该目标' })
  target!: string;

  /** 保留天数。下限 7 —— 低于一周的日志连一次故障复盘都撑不过 */
  @IsInt()
  @Min(7, { message: '保留天数至少为 7 天' })
  @Max(3650)
  retentionDays!: number;
}

/** 按指定目标与天数重新预览影响范围 */
export class RetentionPreviewQueryDto {
  @IsIn(RETENTION_TABLE_NAMES, { message: '不支持预览该目标' })
  target!: string;

  @Type(() => Number)
  @IsInt()
  @Min(7, { message: '保留天数至少为 7 天' })
  @Max(3650)
  retentionDays!: number;
}

/** 保留期清理：目标枚举与清理动作都在 AdminRetentionService */
@Controller('admin/retention')
export class AdminRetentionController {
  constructor(private readonly retention: AdminRetentionService) {}

  /** 可清理目标 + 当前数据量（含按默认天数的预估删除量） */
  @Get('targets')
  @RequirePermission(PERMISSIONS.backupRead)
  targets() {
    return this.retention.targets();
  }

  /** 确认清理前按用户当前天数重新估算，避免拿页面上过期数字做不可逆操作 */
  @Get('preview')
  @RequirePermission(PERMISSIONS.backupRead)
  preview(@Query() query: RetentionPreviewQueryDto) {
    return this.retention.preview(query.target, query.retentionDays);
  }

  /** 清理历史记录 */
  @Get('logs')
  @RequirePermission(PERMISSIONS.backupRead)
  logs(@Query('pageSize') pageSize?: string) {
    return this.retention.logs(pageSize);
  }

  /** 触发清理 */
  @Post('cleanup')
  @RequirePermission(PERMISSIONS.backupRun)
  cleanup(@Body() dto: RetentionCleanupDto) {
    return this.retention.cleanup(dto.target, dto.retentionDays);
  }
}
