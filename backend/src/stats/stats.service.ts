import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getCapability } from '../capabilities/capability.registry';
import { SignedUrlService } from '../common/signed-url.service';

/**
 * 能力示例图的最大扫描行数。
 *
 * 能力总量固定（18 项），取每项最新一张可见产出；500 条窗口留出足够余量，
 * 同时避免用户历史任务无限增长后每次打开数据中心都全量读取。
 */
const THUMB_SCAN_LIMIT = 500;

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
      this.prisma.generationTask.groupBy({
        by: ['capability', 'status'],
        where: { ownerId, project: { deletedAt: null } },
        _count: { _all: true },
      }),
      // 素材统计与素材库同口径: 只算 status='visible'。
      // 若把后台已下架的也算进来, 数据中心「素材总量 / 生成图」会比素材库
      // 的「共 N 个素材」多出看不见的条目, 用户无法核对。
      this.prisma.asset.groupBy({
        by: ['kind'],
        where: { ownerId, status: 'visible', project: { deletedAt: null } },
        _count: { _all: true },
      }),
      this.prisma.project.count({ where: { ownerId, deletedAt: null } }),
      this.prisma.generationTask.findMany({
        where: { ownerId, project: { deletedAt: null } },
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
        where: { ownerId, project: { deletedAt: null }, createdAt: { gte: since } },
        select: { createdAt: true, status: true },
      }),
    ]);

    // 任务汇总
    const tasks: Record<string, number> = { total: 0, succeeded: 0, failed: 0, running: 0, queued: 0 };
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
    /*
     * 只扫最近一段成功任务，而不是该用户的全部历史。
     *
     * 这里只需要「每项能力最新一张可见产出」，能力总量是有限的（18 项），
     * 最近 500 条成功记录足以覆盖；不设上限时，老用户积累上千条任务后
     * 每次打开数据中心都要把全部任务行连同素材关系读出来。
     *
     * 下架产出在 SQL 层就用关系过滤剔除，与素材库口径一致，也避免为
     * 已下架素材建缩略图 URL 后再丢弃。
     */
    for (const t of await this.prisma.generationTask.findMany({
      where: {
        ownerId,
        project: { deletedAt: null },
        status: 'succeeded',
        outputAsset: { is: { status: 'visible' } },
      },
      orderBy: { createdAt: 'desc' },
      take: THUMB_SCAN_LIMIT,
      select: {
        capability: true,
        createdAt: true,
        outputAsset: { select: { sourceUrl: true } },
      },
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
        // 「进行中」= 执行中 + 排队中：对用户而言两者都是还没出结果
        running: tasks.running + tasks.queued,
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
