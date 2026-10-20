import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { getCapability } from '../capabilities/capability.registry';
import { ALL_PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS } from './permissions';

/**
 * 平台概览聚合 (admin-prd.md B-07~B-12)。
 *
 * 当前为骨架实现: 只提供用户/项目/素材/任务的真实统计与权限清单,
 * 交易域相关指标在M9 上线前不出现 —— 不填0 值占位 (空卡片比没有更困惑)。
 */
@Injectable()
export class AdminOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 概览数据。
   *
   * days 控制两个窗口: 趋势与"新增"。任务状态分布不受窗口影响 (全量)。
   */
  async overview(days: number) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);

    const [
      userTotal,
      userNew,
      projectTotal,
      taskGroups,
      assetGroups,
      recentTasks,
      weekTasks,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.project.count(),
      this.prisma.generationTask.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.asset.groupBy({ by: ['kind'], _count: { _all: true } }),
      this.prisma.generationTask.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          capability: true,
          status: true,
          provider: true,
          errorCode: true,
          createdAt: true,
          updatedAt: true,
          outputAsset: { select: { id: true, sourceUrl: true } },
        },
      }),
      this.prisma.generationTask.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, status: true },
      }),
    ]);

    const tasks: Record<string, number> = {
      total: 0,
      succeeded: 0,
      failed: 0,
      running: 0,
      pending: 0,
    };
    for (const g of taskGroups) {
      const n = g._count._all;
      tasks.total += n;
      if (tasks[g.status] !== undefined) tasks[g.status] += n;
    }
    const finished = tasks.succeeded + tasks.failed;
    const successRate = finished === 0 ? null : Math.round((tasks.succeeded / finished) * 1000) / 10;

    const assets: Record<string, number> = { total: 0, original: 0, generated: 0 };
    for (const g of assetGroups) {
      const n = g._count._all;
      assets.total += n;
      if (assets[g.kind] !== undefined) assets[g.kind] += n;
    }

    return {
      days,
      totals: {
        users: userTotal,
        newUsers: userNew,
        projects: projectTotal,
        tasks: tasks.total,
        succeeded: tasks.succeeded,
        failed: tasks.failed,
        running: tasks.running,
        pending: tasks.pending,
        successRate,
        assets: assets.total,
        originals: assets.original,
        generated: assets.generated,
      },
      trend: this.buildTrend(weekTasks, days),
      recentTasks: recentTasks.map((t) => {
        const def = getCapability(t.capability);
        return {
          id: t.id,
          capability: t.capability,
          capabilityName: def?.name ?? t.capability,
          mode: def?.mode ?? 'unknown',
          status: t.status,
          provider: t.provider,
          errorCode: t.errorCode,
          createdAt: t.createdAt,
          durationMs: t.updatedAt.getTime() - t.createdAt.getTime(),
          thumbnailUrl: t.outputAsset?.sourceUrl ?? null,
        };
      }),
    };
  }

  /**
   * 趋势序列: 按日聚合并补齐无数据日。
   *
   * 不用数据库日期分组: SQLite driver adapter 对日期函数支持有限,
   * 改为取时间戳在 Node 侧聚合。7~30 天量级完全可接受。
   */
  private buildTrend(
    rows: Array<{ createdAt: Date; status: string }>,
    days: number,
  ): Array<{ date: string; total: number; succeeded: number; failed: number }> {
    const key = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const map = new Map<string, { total: number; succeeded: number; failed: number }>();
    for (let i = days - 1; i >= 0; i -= 1) {
      map.set(key(new Date(Date.now() - i * 24 * 3600 * 1000)), {
        total: 0,
        succeeded: 0,
        failed: 0,
      });
    }
    for (const r of rows) {
      const k = key(r.createdAt);
      const cur = map.get(k);
      if (!cur) continue;
      cur.total += 1;
      if (r.status === 'succeeded') cur.succeeded += 1;
      if (r.status === 'failed') cur.failed += 1;
    }
    return Array.from(map.entries()).map(([date, v]) => ({ date, ...v }));
  }
}