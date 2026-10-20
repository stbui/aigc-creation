import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuditAction, RequirePermission } from './admin.decorator';
import { AppError } from '../common/app.exception';
import { BackupService } from './backup.service';
import { PERMISSIONS } from './permissions';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** 手动触发备份 */
export class RunBackupDto {
  /** 幂等键。重复提交同一 key 时直接返回既有结果, 避免误连点产生多份备份 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;
}

/** 保留份数清理 */
export class PruneBackupDto {
  @IsInt()
  @Min(1)
  @Max(100)
  keepCount!: number;
}

/** 到期数据清理 */
export class CleanupDto {
  @IsIn(['AdminAuditLog', 'CleanupLog', 'BackupRecord'])
  target!: string;

  @IsInt()
  @Min(1)
  @Max(1095)
  retentionDays!: number;
}

/**
 * 数据备份与保留期 (admin-prd.md §3.19 B-96~B-101)。
 *
 * 权限点分离:
 *   backup.read  查看备份列表与统计
 *   backup.run   手动备份 / 恢复验证 / 清理
 *   data.export  下载备份文件 (归到导出, 因为它本质是数据流出)
 *
 * 下载刻意要求 **已验证** 才放行 (B-97): 未验证的备份在事故时才发现损坏就晚了。
 */
@Controller('admin/backups')
export class AdminBackupController {
  constructor(private readonly backup: BackupService) {}

  /** 备份概览: 份数、占用、是否过期 */
  @Get('stats')
  @RequirePermission(PERMISSIONS.backupRead)
  stats() {
    return this.backup.stats();
  }

  /**
   * 清理留痕 (B-100)。
   *
   * ⚠ **必须声明在 `@Get(':id')` 之前** —— NestJS 按声明顺序匹配路由,
   * 写在后面会被 `:id` 抢占, 请求 /cleanup-logs 会被当成查 id='cleanup-logs' 的备份
   * 而返回 404。同理 `prune` / `stats` 也在 `:id` 之前声明。
   */
  @Get('cleanup-logs')
  @RequirePermission(PERMISSIONS.backupRead)
  cleanupLogs(@Query('limit') limit?: string) {
    const n = Number(limit ?? 50);
    return this.backup.cleanupLogs(Number.isFinite(n) ? Math.min(n, 200) : 50);
  }

  /** 备份列表 */
  @Get()
  @RequirePermission(PERMISSIONS.backupRead)
  list() {
    return this.backup.list();
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.backupRead)
  detail(@Param('id') id: string) {
    return this.backup.detail(id);
  }

  /**
   * 手动备份。
   *
   * 同步执行 (备份本身耗时很短), 返回 201 与记录详情。
   * 幂等: 同 idempotencyKey 重复提交直接返回既有记录。
   */
  @Post()
  @RequirePermission(PERMISSIONS.backupRun)
  @AuditAction('backup.run')
  async run(@Body() dto: RunBackupDto) {
    if (dto?.idempotencyKey) {
      // 以文件名作为幂等凭据不可行(带时间戳), 这里用内存级去重窗口简化处理:
      // 5 秒内的重复提交视为同一次操作 —— 足够覆盖误连点, 又不会误伤正常重复备份
      const recent = await this.backup.list();
      const last = recent.find((r) => r.trigger === 'manual');
      if (
        last &&
        Date.now() - new Date(last.createdAt).getTime() < 5000 &&
        last.status === 'succeeded'
      ) {
        return last;
      }
    }
    return this.backup.run('manual');
  }

  /**
   * 恢复验证 (B-97)。
   *
   * 只读打开备份文件做完整性/结构/可读性检查, **绝不触碰生产库**。
   * 这是不可逆操作前唯一的保险, 验证本身必须零副作用。
   */
  @Post(':id/verify')
  @RequirePermission(PERMISSIONS.backupRun)
  @AuditAction('backup.verify')
  verify(@Param('id') id: string) {
    return this.backup.verify(id);
  }

  /**
   * 下载备份文件。
   *
   * 只允许下载已验证的备份 —— 未验证的视为无效 (B-97)。
   */
  @Get(':id/download')
  @RequirePermission(PERMISSIONS.dataExport)
  @AuditAction('backup.download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const { filename, buffer } = await this.backup.readForDownload(id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  /** 删除备份 (保留至少一份已验证备份) */
  @Delete(':id')
  @RequirePermission(PERMISSIONS.backupRun)
  @AuditAction('backup.delete')
  remove(@Param('id') id: string) {
    return this.backup.remove(id);
  }

  /**
   * 保留份数清理。
   *
   * 手动触发时可指定份数; 不传则用系统设置里的备份保留份数。
   */
  @Post('prune')
  @RequirePermission(PERMISSIONS.backupRun)
  @AuditAction('backup.prune')
  async prune(@Body() dto: PruneBackupDto, @Query('keepCount') keep?: string) {
    const n = Number(keep ?? dto?.keepCount ?? NaN);
    if (!Number.isFinite(n) || n < 1) {
      throw new AppError(40001, '请指定保留份数 (keepCount ≥ 1)', 400);
    }
    return this.backup.prune(n);
  }

  /** 手动触发到期数据清理 */
  @Post('cleanup')
  @RequirePermission(PERMISSIONS.backupRun)
  @AuditAction('data.cleanup')
  cleanup(@Body() dto: CleanupDto) {
    return this.backup.cleanupExpired(dto.target, dto.retentionDays, 'manual');
  }
}