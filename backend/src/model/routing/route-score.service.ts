/**
 * 运行时健康分层缓存。
 *
 * 只服务选路：把 `ChannelModelMetricsService` 的 24h 成功率换算成三档，
 * 进程内缓存 30 秒。读取失败一律返回空表（全部按 0 档处理），
 * 不能把指标库抖动放大成「所有线路降级」。
 */

import { Injectable } from '@nestjs/common';
import { ChannelModelMetricsService } from '../channels/channel-model-metrics.service';

/** 24h 终态样本的线路健康分层：0 健康 / 1 降级 / 2 不健康 */
export type HealthTier = 0 | 1 | 2;

@Injectable()
export class RouteScoreService {
  constructor(private readonly metrics: ChannelModelMetricsService) {}

  /**
   * 全量线路的健康分层。
   *
   * 无样本或样本 < 5 一律按 0：新线路不该因为「还没跑过」被降级。
   */
  async tiers(): Promise<Map<string, HealthTier>> {
    const result = new Map<string, HealthTier>();
    try {
      const rows = await this.metrics.list();
      for (const row of rows) {
        result.set(row.id, tierOf(row.windows?.day?.samples ?? 0, row.windows?.day?.successRate ?? null));
      }
    } catch {
      // 指标不可读时不做健康降级；选路仍受冷却与启停约束
    }
    return result;
  }
}

export function tierOf(samples: number, successRate: number | null): HealthTier {
  if (samples < 5 || successRate === null) return 0;
  if (successRate >= 0.9) return 0;
  if (successRate >= 0.5) return 1;
  return 2;
}
