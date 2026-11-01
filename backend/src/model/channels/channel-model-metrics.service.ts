/**
 * 渠道模型健康指标（`GET /admin/channel-models/health`）。
 *
 * 设计文档 §1.1 把「渠道模型健康（24h/7d、P95、最近样本）」列入观测域，
 * §4.2 要求它挂在**全量模型**端点上（`/channel-models/health?channelId=`）。
 *
 * ## 为什么按渠道模型出表
 *
 * 与 `ChannelHealthService`（启停 / 协议 / 冷却）同一条理由：**渠道模型才是
 * 线路的最小单位**。同一渠道下每个模型可以各自停用、各自冷却，404 只冷却
 * 那一个模型。按渠道聚合会把「这家有一条模型挂了」显示成「这家坏了」，
 * 值班时按错的地方去按。
 *
 * ## 指标口径
 *
 * 数据源是 `ApiCallLog`（只允许 INSERT 的调用事实表）。归属键是
 * `channelModelId`：写日志时已经带上渠道模型 id，渠道级调用（如
 * `GET /models`）留空 —— 空串的记录不计入任何线路。
 *
 * · **成功率** = `success` 次数 ÷ 终态次数（`success` + `failed`）。
 *   `pending` / `canceled` 不计入分母：它们不是「这条线坏了」的证据。
 * · **P95 耗时** = 终态样本里耗时第 95 百分位的值。用最近邻法（不做插值）：
 *   样本量小的时候插值出来的数没有实际含义。
 * · **最近样本** = 最近 10 条终态调用的状态 / 耗时 / 错误码 / 时间，
 *   让人一眼看出「刚才这条线在报什么错」。
 *
 * ## 窗口
 *
 * 24h 与 7d 两个窗口都要给：24h 看当下有没有挂，7d 看是不是间歇性问题
 * （7d 成功率 99% 但 24h 70%，通常意味着上游刚开始劣化）。
 * 两个窗口都从**当前时间**往回算，与 `ApiCallLog.createdAt` 对齐。
 *
 * ## P95 的实现代价
 *
 * 纯内存排序：单个渠道模型的终态样本量受限于调用频率，一次拉取上限
 * `HEALTH_SAMPLE_LIMIT` 行。超过这个上限就只统计最近的部分 —— 此时
 * `sampled: false`，前端要如实显示「按最近 N 条统计」，不能把截断后的
 * 成功率当成全窗口成功率。
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelHealthService, type ChannelHealthRow } from './channel-health.service';

/** 单条线路单窗口最多参与统计的样本数（防止慢线路把整表拉进内存） */
const HEALTH_SAMPLE_LIMIT = 2000;

/** 最近样本条数 */
const RECENT_SAMPLE_LIMIT = 10;

/** 两个观测窗口 */
const WINDOWS = [
  { key: 'day', label: '24 小时', hours: 24 },
  { key: 'week', label: '7 天', hours: 24 * 7 },
] as const;

export type HealthWindowKey = (typeof WINDOWS)[number]['key'];

/** 单个窗口的指标 */
export interface ChannelModelHealthWindow {
  /** 该窗口内的终态样本数（success + failed） */
  samples: number;
  success: number;
  failed: number;
  /** 成功率（0–1）；没有终态样本时为 null（不是 0 —— 「没数据」与「全失败」要分得开） */
  successRate: number | null;
  /** P95 耗时（毫秒）；没有终态样本时为 null */
  p95DurationMs: number | null;
  /** 终态样本的平均耗时（毫秒） */
  avgDurationMs: number | null;
  /** 是否因超过采样上限而只统计了最近的一部分 */
  sampled: boolean;
}

/** 最近一次终态调用样本 */
export interface ChannelModelHealthSample {
  status: string;
  statusCode: number;
  durationMs: number;
  errorCode: string;
  error: string;
  at: string;
}

/** 一条线路（渠道模型）的健康投影 */
export interface ChannelModelHealthRow extends ChannelHealthRow {
  /** 两个观测窗口的指标 */
  windows: Record<HealthWindowKey, ChannelModelHealthWindow>;
  /** 最近终态样本（倒序，最新在前） */
  recent: ChannelModelHealthSample[];
  /** 最近一次失败归一化的错误码（无失败则为空串） */
  lastErrorCode: string;
}

@Injectable()
export class ChannelModelMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: ChannelHealthService,
  ) {}

  /**
   * 全量线路健康指标；`channelId` 给出时只算该渠道的线路。
   *
   * 一次拉取所有 `ApiCallLog`（限窗口 + 限条数），在内存里按线路分组 ——
   * 逐线路查库是 N+1 次 SQLite 查询，而日志表天然按 `createdAt` 有序，
   * 一次取回更省。
   */
  async list(channelId?: string): Promise<ChannelModelHealthRow[]> {
    const base = await this.health.list();
    const rows = channelId ? base.filter((row) => row.channelId === channelId) : base;
    if (rows.length === 0) return [];

    const windowStart = new Date(Date.now() - WINDOWS[WINDOWS.length - 1].hours * 3600_000);
    const logs = await this.prisma.apiCallLog.findMany({
      where: {
        channelModelId: { in: rows.map((row) => row.id) },
        createdAt: { gte: windowStart },
      },
      select: {
        channelModelId: true,
        status: true,
        statusCode: true,
        durationMs: true,
        errorCode: true,
        error: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      // 上限按「线路数 × 单线样本上限」取一个保守值；截断由 sampled 标记如实呈现
      take: Math.max(HEALTH_SAMPLE_LIMIT, rows.length * HEALTH_SAMPLE_LIMIT),
    });

    const byModel = new Map<string, typeof logs>();
    for (const log of logs) {
      if (!log.channelModelId) continue;
      const list = byModel.get(log.channelModelId) ?? [];
      list.push(log);
      byModel.set(log.channelModelId, list);
    }

    return rows.map((row) => {
      const modelLogs = byModel.get(row.id) ?? [];
      return {
        ...row,
        windows: this.windowsFor(modelLogs),
        recent: modelLogs
          .filter((log) => isTerminal(log.status))
          .slice(0, RECENT_SAMPLE_LIMIT)
          .map((log) => ({
            status: log.status,
            statusCode: log.statusCode,
            durationMs: log.durationMs,
            errorCode: log.errorCode,
            error: log.error.slice(0, 200),
            at: log.createdAt.toISOString(),
          })),
        lastErrorCode: modelLogs.find((log) => log.errorCode)?.errorCode ?? '',
      };
    });
  }

  /** 按两个窗口分别统计 */
  private windowsFor(
    logs: Array<{
      status: string;
      durationMs: number;
      createdAt: Date;
    }>,
  ): Record<HealthWindowKey, ChannelModelHealthWindow> {
    const now = Date.now();
    const result = {} as Record<HealthWindowKey, ChannelModelHealthWindow>;
    for (const window of WINDOWS) {
      const since = now - window.hours * 3600_000;
      const inWindow = logs.filter((log) => log.createdAt.getTime() >= since);
      const terminal = inWindow.filter((log) => isTerminal(log.status));
      const success = terminal.filter((log) => log.status === 'success').length;
      const failed = terminal.length - success;
      const durations = terminal.map((log) => Math.max(0, log.durationMs)).sort((a, b) => a - b);
      result[window.key] = {
        samples: terminal.length,
        success,
        failed,
        successRate: terminal.length > 0 ? success / terminal.length : null,
        p95DurationMs: percentile(durations, 0.95),
        avgDurationMs:
          durations.length > 0
            ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
            : null,
        sampled: inWindow.length > HEALTH_SAMPLE_LIMIT,
      };
    }
    return result;
  }
}

/** 终态：成功与失败。`pending` / `canceled` 不是线路好坏的证据 */
function isTerminal(status: string): boolean {
  return status === 'success' || status === 'failed';
}

/**
 * 最近邻百分位（不做插值）。
 *
 * 样本量小的时候插值出来的 P95 没有实际含义 —— 「95 分位耗时 1234ms」
 * 这种数字会让人以为测过 20 次以上，实际只有 3 次。
 */
function percentile(sorted: number[], ratio: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index];
}
