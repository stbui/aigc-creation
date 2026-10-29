import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CSV_EXPORT_MAX_ROWS, toCsv } from '../common/csv';
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
    const where = this.listWhere(query);

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

    // gateway 通道的平均耗时单独算: 历史本地结果与模型网关耗时量级不同,
    // 混算会掩盖真实模型体验。
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

  /**
   * 导出调用记录 (CSV)。
   *
   * 与列表共用 `listWhere`，筛选口径完全一致。提示词一并导出：
   * 排障时「当时送出的到底是什么」往往比耗时更能解释失败。
   */
  async exportCsv(query: ModelCallListQueryDto): Promise<string> {
    const rows = await this.prisma.modelCallLog.findMany({
      where: this.listWhere(query),
      orderBy: { createdAt: 'desc' },
      take: CSV_EXPORT_MAX_ROWS,
    });
    return toCsv(
      [
        { label: '时间', value: (r) => r.createdAt },
        { label: '能力', value: (r) => r.capability },
        { label: '路由', value: (r) => r.route },
        { label: '实际通道', value: (r) => r.source },
        { label: '历史回落', value: (r) => (r.fallback ? '是' : '否') },
        { label: '模型', value: (r) => r.model ?? '' },
        { label: '耗时(ms)', value: (r) => r.durationMs },
        { label: '结果', value: (r) => (r.success ? '成功' : '失败') },
        { label: '错误码', value: (r) => r.errorCode ?? '' },
        { label: '宽', value: (r) => r.width ?? '' },
        { label: '高', value: (r) => r.height ?? '' },
        { label: '产出(字节)', value: (r) => r.outputBytes },
        { label: '网关任务 ID', value: (r) => r.taskId ?? '' },
        { label: '原因', value: (r) => r.reason ?? '' },
        { label: '提示词', value: (r) => r.prompt ?? '' },
      ],
      rows,
    );
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

  /**
   * 列表与导出共用的筛选条件。
   *
   * 单独抽出而不是在两处各写一份：曾出现「列表筛失败 3 条、导出 4000 条」
   * 这类口径分歧，运营据此对账会直接得出错误结论。
   */
  private listWhere(query: ModelCallListQueryDto): Record<string, unknown> {
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
    return where;
  }
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
