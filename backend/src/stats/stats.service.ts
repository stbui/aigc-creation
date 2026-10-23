import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getCapability } from '../capabilities/capability.registry';
import { SignedUrlService } from '../common/signed-url.service';

/**
 * 数据中心聚合。
 *
 * 全部用真实表统计, 不编造"积分/消耗"这类尚不存在的概念 —— 账号数据区展示的是
 * 累计生成次数 / 成功率 / 素材量 / 近 7 天产出。
 */
@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signedUrl: SignedUrlService,
  ) {}

  async overview(ownerId: string) {
    const now = new Date();
    const since = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const [taskGroups, assetGroups, projectCount, recentTasks, weekTasks] = await Promise.all([
      this.prisma.generationTask.groupBy({ by: ['capability', 'status'], where: { ownerId }, _count: { _all: true } }),
      // 素材统计与素材库同口径: 只算 status='visible'。
      // 若把后台已下架的也算进来, 数据中心「素材总量 / 生成图」会比素材库
      // 的「共 N 个素材」多出看不见的条目, 用户无法核对。
      this.prisma.asset.groupBy({
        by: ['kind'],
        where: { ownerId, status: 'visible' },
        _count: { _all: true },
      }),
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
          outputAsset: { select: { id: true, sourceUrl: true, status: true } },
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
      select: {
        capability: true,
        createdAt: true,
        outputAsset: { select: { sourceUrl: true, status: true } },
      },
    })) {
      // 下架产出不拿来当示例图: 素材库看不到它, 这里却展示会让用户点开 404
      const url = t.outputAsset?.status === 'visible' ? t.outputAsset.sourceUrl : null;
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
          // 展示专用: 开启 ASSET_SIGNING_SECRET 后必须签名, 否则 <img> 403
          thumbnailUrl: this.signedUrl.displayUrl(capabilityThumbs.get(capability)?.url),
        }))
        .sort((a, b) => b.total - a.total),
      last7Days: [...dailyMap.entries()].map(([date, count]) => ({ date, count })),
      recentTasks: recentTasks.map((t) => ({
        id: t.id,
        capability: t.capability,
        name: getCapability(t.capability)?.name ?? t.capability,
        status: t.status,
        createdAt: t.createdAt,
        // 下架产出不给缩略图 (与素材库同口径: 用户看不到它)
        thumbnailUrl: this.signedUrl.displayUrl(
          t.outputAsset?.status === 'visible' ? t.outputAsset.sourceUrl : null,
        ),
      })),
    };
  }
}
