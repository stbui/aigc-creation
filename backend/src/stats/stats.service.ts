import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getCapability } from '../capabilities/capability.registry';

/**
 * 数据中心聚合。
 *
 * 全部用真实表统计, 不编造"积分/消耗"这类尚不存在的概念 —— 账号数据区展示的是
 * 累计生成次数 / 成功率 / 素材量 / 近 7 天产出。
 */
@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(ownerId: string) {
    const now = new Date();
    const since = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const [taskGroups, assetGroups, projectCount, recentTasks, weekTasks] = await Promise.all([
      this.prisma.generationTask.groupBy({ by: ['capability', 'status'], where: { ownerId }, _count: { _all: true } }),
      this.prisma.asset.groupBy({ by: ['kind'], where: { ownerId }, _count: { _all: true } }),
      this.prisma.project.count({ where: { ownerId } }),
      this.prisma.generationTask.findMany({
        where: { ownerId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          capability: true,
          status: true,
          createdAt: true,
          outputAsset: { select: { id: true, sourceUrl: true } },
        },
      }),
      this.prisma.generationTask.findMany({
        where: { ownerId, createdAt: { gte: since } },
        select: { createdAt: true, status: true },
      }),
    ]);

    // 任务汇总
    const tasks: Record<string, number> = { total: 0, succeeded: 0, failed: 0, running: 0, pending: 0 };
    const byCapabilityMap = new Map<string, { total: number; succeeded: number }>();
    for (const g of taskGroups) {
      const n = g._count._all;
      tasks.total += n;
      if (tasks[g.status] !== undefined) tasks[g.status] += n;
      const cur = byCapabilityMap.get(g.capability) ?? { total: 0, succeeded: 0 };
      cur.total += n;
      if (g.status === 'succeeded') cur.succeeded += n;
      byCapabilityMap.set(g.capability, cur);
    }

    const assets: Record<string, number> = { total: 0, original: 0, generated: 0 };
    for (const g of assetGroups) {
      const n = g._count._all;
      assets.total += n;
      if (assets[g.kind] !== undefined) assets[g.kind] += n;
    }

    // 近 7 天: 补齐没有产出的日期, 前端直接画折线
    const dailyMap = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      dailyMap.set(dayKey(new Date(now.getTime() - i * 24 * 3600 * 1000)), 0);
    }
    for (const t of weekTasks) {
      const k = dayKey(new Date(t.createdAt));
      if (dailyMap.has(k)) dailyMap.set(k, (dailyMap.get(k) ?? 0) + 1);
    }

    const finished = tasks.succeeded + tasks.failed;

    // 每项能力取最近一次成功产出, 作为工作台卡片的示例图 (真实产出优先, 没有则前端用设计化占位)
    const capabilityThumbs = new Map<string, { url: string; createdAt: Date }>();
    for (const t of await this.prisma.generationTask.findMany({
      where: { ownerId, status: 'succeeded', outputAssetId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { capability: true, createdAt: true, outputAsset: { select: { sourceUrl: true } } },
    })) {
      const url = t.outputAsset?.sourceUrl;
      if (url && !capabilityThumbs.has(t.capability)) {
        capabilityThumbs.set(t.capability, { url, createdAt: t.createdAt });
      }
    }

    return {
      totals: {
        tasks: tasks.total,
        succeeded: tasks.succeeded,
        failed: tasks.failed,
        running: tasks.running + tasks.pending,
        assets: assets.total,
        originals: assets.original,
        generated: assets.generated,
        projects: projectCount,
        successRate: finished > 0 ? Math.round((tasks.succeeded / finished) * 100) : null,
      },
      byCapability: [...byCapabilityMap.entries()]
        .map(([capability, v]) => ({
          capability,
          name: getCapability(capability)?.name ?? capability,
          mode: getCapability(capability)?.mode ?? 'planned',
          total: v.total,
          succeeded: v.succeeded,
          thumbnailUrl: capabilityThumbs.get(capability)?.url ?? null,
        }))
        .sort((a, b) => b.total - a.total),
      last7Days: [...dailyMap.entries()].map(([date, count]) => ({ date, count })),
      recentTasks: recentTasks.map((t) => ({
        id: t.id,
        capability: t.capability,
        name: getCapability(t.capability)?.name ?? t.capability,
        status: t.status,
        createdAt: t.createdAt,
        thumbnailUrl: t.outputAsset?.sourceUrl ?? null,
      })),
    };
  }
}
