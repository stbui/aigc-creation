import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuditAction, RequirePermission } from './admin.decorator';
import { BackupService } from './backup.service';
import { AdminSettingsService } from './settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { PERMISSIONS } from './permissions';

/**
 * 保留期清理 (B-96)。
 *
 * 数据不能无限堆积, 但"删数据"必须同时满足三件事:
 *   1. 目标可枚举 —— 只允许清理日志/记录类表, 订单、积分流水、素材永不在此列
 *      (《电子商务法》要求交易信息保存三年, 且它们是对账的唯一凭据)
 *   2. 保留天数有下限 —— 传 0 或负数等于"删全表", 必须挡住
 *   3. 每次清理都留痕 —— CleanupLog 记录目标、天数、条数与触发方式
 *
 * 清理逻辑本身在 BackupService.cleanupExpired (与调度任务共用同一条路径),
 * 本控制器只负责"可枚举的目标 + 当前数据量 + 触发"。
 */

interface RetentionTarget {
  table: string;
  label: string;
  /** 超出天数的记录会被删除 */
  defaultDays: number;
  /** 为什么是这个下限 —— 写到界面上, 避免运营随手改成 1 天 */
  note: string;
}

const TARGETS: RetentionTarget[] = [
  {
    table: 'AdminAuditLog',
    label: '后台操作审计',
    defaultDays: 180,
    note: '合规要求可追溯, 默认保留半年; 实际天数取系统设置 retention.auditLogDays',
  },
  {
    table: 'ModelCallLog',
    label: '模型调用记录',
    defaultDays: 90,
    note: '排障窗口通常为一周, 保留三个月足够定位问题且不至于无限增长',
  },
  {
    table: 'BackupRecord',
    label: '备份记录',
    defaultDays: 180,
    note: '备份文件按份数裁剪, 记录留半年便于回溯哪次备份可恢复',
  },
  {
    table: 'CleanupLog',
    label: '清理日志',
    defaultDays: 365,
    note: '清理自身的记录保留最久, 否则"谁删了什么"将无从查证',
  },
];

const TABLE_NAMES = TARGETS.map((t) => t.table);

/** 手动清理 */
export class RetentionCleanupDto {
  @IsIn(TABLE_NAMES, { message: '不支持清理该目标' })
  target!: string;

  /** 保留天数。下限 7 —— 低于一周的日志连一次故障复盘都撑不过 */
  @IsInt()
  @Min(7, { message: '保留天数至少为 7 天' })
  @Max(3650)
  retentionDays!: number;

  /** 操作原因。高危动作强制填写 */
  @IsString()
  @MaxLength(200)
  reason!: string;
}

@Controller('admin/retention')
export class AdminRetentionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly backup: BackupService,
    private readonly settings: AdminSettingsService,
  ) {}

  /**
   * 可清理目标 + 当前数据量。
   *
   * 同时给出「当前条数 / 最早一条的时间 / 按默认天数会被删多少」——
   * 只显示条数的话, 运营点下确认前无法判断这次清理影响有多大。
   */
  @Get('targets')
  @RequirePermission(PERMISSIONS.backupRead)
  async targets() {
    const auditDays = Number(await this.settings.get('retention.auditLogDays')) || 180;

    return Promise.all(
      TARGETS.map(async (t) => {
        const days = t.table === 'AdminAuditLog' ? auditDays : t.defaultDays;
        const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
        const delegate = (this.prisma as any)[delegateName(t.table)];
        const [total, expired, oldest] = await Promise.all([
          delegate.count(),
          delegate.count({ where: { createdAt: { lt: cutoff } } }),
          delegate.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        ]);
        return {
          table: t.table,
          label: t.label,
          note: t.note,
          retentionDays: days,
          total,
          /** 按当前天数会被删除的条数 (未执行, 仅预估) */
          expiring: expired,
          cutoff: cutoff.toISOString(),
          oldestAt: oldest?.createdAt ?? null,
        };
      }),
    );
  }

  /** 清理历史记录 */
  @Get('logs')
  @RequirePermission(PERMISSIONS.backupRead)
  async logs(@Query('pageSize') pageSize?: string) {
    const raw = Number(pageSize ?? 50);
    const take = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 200) : 50;
    return this.prisma.cleanupLog.findMany({ orderBy: { createdAt: 'desc' }, take });
  }

  /**
   * 触发清理。
   *
   * 复用 BackupService.cleanupExpired —— 与调度任务走同一条路径,
   * 避免"手动清理"和"定时清理"两套逻辑在保留天数上各说各话。
   */
  @Post('cleanup')
  @RequirePermission(PERMISSIONS.backupRun)
  @AuditAction('data.cleanup')
  cleanup(@Body() dto: RetentionCleanupDto) {
    if (!TABLE_NAMES.includes(dto.target)) {
      throw new AppError(40001, `不支持清理该目标: ${dto.target}`, 400);
    }
    return this.backup.cleanupExpired(dto.target, dto.retentionDays, 'manual');
  }
}

/** `AdminAuditLog` → `adminAuditLog`, Prisma 委托名首字母小写 */
function delegateName(table: string): string {
  return table.charAt(0).toLowerCase() + table.slice(1);
}
