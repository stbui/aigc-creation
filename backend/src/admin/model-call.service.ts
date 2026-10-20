import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildPage, paginate, type PageResult } from './dto/page-query.dto';
import type { ModelCallListQueryDto } from './dto/model.dto';
import { CAPABILITY_IDS } from '../providers/channel-config.defs';

const SORTABLE = ['createdAt', 'durationMs', 'outputBytes'] as const;

/**
 * 模型调用记录查询。
 *
 * **只读**: 与审计日志同取向 —— 不提供任何删除接口。
 * 已知不足: 库管理员仍可直接删库 (彻底解决需独立存储或哈希链, 本期不做)。
 *
 * 统计数据是本页存在的主要理由: 单看调用流水要看 100 行, 而运营真正想问的是
 * 「最近成功率多少、平均多久、哪个能力最慢、回落了几次」——
 * 这些在分页接口之外单独聚合一次返回。
 */
@Injectable()
export class ModelCallService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ModelCallListQueryDto): Promise<{
    result: PageResult<unknown>;
    stats: {
      total: number;
      gatewayCount: number;
      localCount: number;
      successCount: number;
      fallbackCount: number;
      avgDurationMs: number;
      gatewayAvgDurationMs: number;
    };
    capabilities: Array<{ capability: string; count: number }>;
    sources: Array<{ source: string; count: number }>;
  }> {
    const page = buildPage(query, [...SORTABLE], 'createdAt:desc');

    const where: Record<string, unknown> = {};
    if (query.capability) where['capability'] = query.capability;
    if (query.source) where['source'] = query.source;
    if (query.fallback !== undefined) where['fallback'] = query.fallback;
    if (query.success !== undefined) where['success'] = query.success;
    if (query.model) where['model'] = query.model;
    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      const from = parseDate(query.from);
      const to = parseDate(query.to);
      if (from) createdAt['gte'] = from;
      if (to) createdAt['lte'] = to;
      if (Object.keys(createdAt).length > 0) where['createdAt'] = createdAt;
    }

    const [items, total, capGroups, sourceGroups, agg] = await Promise.all([
      this.prisma.modelCallLog.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: page.orderBy,
      }),
      this.prisma.modelCallLog.count({ where }),
      this.prisma.modelCallLog.groupBy({ by: ['capability'], _count: { _all: true } }),
      this.prisma.modelCallLog.groupBy({ by: ['source'], _count: { _all: true } }),
      this.prisma.modelCallLog.aggregate({
        where,
        _avg: { durationMs: true },
        _sum: { durationMs: true, outputBytes: true },
      }),
    ]);

    // gateway 通道的平均耗时单独算: 混在本地算法里算没有意义
    // (本地 Jimp 是毫秒级, 网关是秒级, 平均值会被本地拉平, 掩盖真实体验)
    const gatewayAgg = await this.prisma.modelCallLog.aggregate({
      where: { ...where, source: 'gateway' },
      _avg: { durationMs: true },
    });

    const gatewayCount = sourceGroups.find((g) => g.source === 'gateway')?._count._all ?? 0;
    const successCount = await this.prisma.modelCallLog.count({ where: { ...where, success: true } });
    const fallbackCount = await this.prisma.modelCallLog.count({ where: { ...where, fallback: true } });

    return {
      result: paginate(
        items.map((row) => ({
          id: row.id,
          createdAt: row.createdAt,
          capability: row.capability,
          taskId: row.taskId,
          route: row.route,
          source: row.source,
          fallback: row.fallback,
          reason: row.reason,
          model: row.model,
          prompt: row.prompt,
          durationMs: row.durationMs,
          success: row.success,
          outputBytes: row.outputBytes,
          width: row.width,
          height: row.height,
          errorCode: row.errorCode,
        })),
        total,
        page,
      ),
      stats: {
        total,
        gatewayCount,
        localCount: (sourceGroups.find((g) => g.source === 'local')?._count._all ?? 0),
        successCount,
        fallbackCount,
        avgDurationMs: Math.round(agg._avg.durationMs ?? 0),
        gatewayAvgDurationMs: Math.round(gatewayAgg._avg.durationMs ?? 0),
      },
      capabilities: capGroups
        .map((g) => ({ capability: g.capability, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
      sources: sourceGroups.map((g) => ({ source: g.source, count: g._count._all })),
    };
  }

  /** 单条详情 (含完整 prompt) */
  async detail(id: string) {
    const row = await this.prisma.modelCallLog.findUnique({ where: { id } });
    return row ? { ...row } : null;
  }

  /** 已知能力 id 全集 (供前端筛选下拉, 与后端校验口径一致) */
  capabilityOptions() {
    return CAPABILITY_IDS.map((id) => ({ id }));
  }
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}