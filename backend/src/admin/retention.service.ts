import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { BackupService } from './backup.service';

export interface RetentionTarget {
  table: string;
  label: string;
  /** 超出天数的记录会被删除 */
  defaultDays: number;
  /** 为什么是这个下限 —— 写到界面上, 避免运营随手改成 1 天 */
  note: string;
}

export const RETENTION_TARGETS: RetentionTarget[] = [
  {
    table: 'ApiCallLog',
    label: '调用记录',
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

export const RETENTION_TABLE_NAMES = RETENTION_TARGETS.map((target) => target.table);

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
 * 这里只负责"可枚举的目标 + 当前数据量 + 触发"。
 */
@Injectable()
export class AdminRetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly backup: BackupService,
  ) {}

  /**
   * 可清理目标 + 当前数据量。
   *
   * 同时给出「当前条数 / 最早一条的时间 / 按默认天数会被删多少」——
   * 只显示条数的话, 运营点下确认前无法判断这次清理影响有多大。
   */
  async targets() {
    return Promise.all(
      RETENTION_TARGETS.map((target) => this.previewTarget(target, target.defaultDays)),
    );
  }

  /** 确认清理前按用户当前天数重新估算，避免拿页面上过期数字做不可逆操作 */
  async preview(targetTable: string, retentionDays: number) {
    const target = RETENTION_TARGETS.find((item) => item.table === targetTable);
    if (!target) {
      throw new AppError(40001, `不支持预览该目标: ${targetTable}`, 400);
    }
    return this.previewTarget(target, retentionDays);
  }

  /** 清理历史记录的分页查询，上限由服务端兜住 */
  async logs(pageSize?: number | string) {
    const raw = Number(pageSize ?? 50);
    const take = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 200) : 50;
    return this.prisma.cleanupLog.findMany({
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /**
   * 触发清理。
   *
   * 复用 BackupService.cleanupExpired —— 与调度任务走同一条路径,
   * 避免"手动清理"和"定时清理"两套逻辑在保留天数上各说各话。
   */
  async cleanup(target: string, retentionDays: number) {
    if (!RETENTION_TABLE_NAMES.includes(target)) {
      throw new AppError(40001, `不支持清理该目标: ${target}`, 400);
    }
    return this.backup.cleanupExpired(target, retentionDays, 'manual');
  }

  private async previewTarget(t: RetentionTarget, days: number) {
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
    const delegate = (this.prisma as any)[delegateName(t.table)];
    const [total, expired, oldest] = await Promise.all([
      delegate.count(),
      delegate.count({ where: { createdAt: { lt: cutoff } } }),
      delegate.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    return {
      table: t.table,
      label: t.label,
      note: t.note,
      retentionDays: days,
      total,
      /** 按指定天数会被删除的条数 (未执行, 仅预估) */
      expiring: expired,
      cutoff: cutoff.toISOString(),
      oldestAt: oldest?.createdAt ?? null,
    };
  }
}

/** Prisma 模型名 → 委托名首字母小写 */
function delegateName(table: string): string {
  return table.charAt(0).toLowerCase() + table.slice(1);
}
