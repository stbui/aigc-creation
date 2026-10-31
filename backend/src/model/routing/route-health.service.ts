/**
 * 线路健康与冷却（本地内存）。
 *
 * 移植自 open-ai-canvas `model_router_attempts.go` 的 `blockLogicalRouteForFailure`
 * 与 `model_router.go` 的 `logicalRouteBlocked`。
 *
 * 三条键共同参与判定：
 *   · `channel:<id>`       —— 渠道凭证级故障（401/403、429 限流）
 *   · `channel-model:<id>` —— 单个模型不存在（404），不能连坐整条渠道
 *   · `route:<id>`         —— 预留：线路被人工摘除时的显式禁用
 *
 * 只有**明确可归因**的失败才冷却：超时、5xx、连接中断一律不冷却 ——
 * 上游抖动时把线路关 10 分钟，会让一次偶发故障放大成整段时间不可用。
 *
 * 本仓没有 Redis：冷却只做进程内。多实例部署时各进程独立冷却，
 * 代价是「某个实例先感知故障」，不影响正确性（选路失败只是换线或失败退款）。
 */

import { Injectable } from '@nestjs/common';

/** 冷却目标的三个键 */
export interface RouteHealthTarget {
  channelId: string;
  channelModelId: string;
  routeId: string;
}

export interface RouteHealthBlock {
  key: string;
  until: number;
}

/** 失败码 → 冷却键与时长（毫秒）；返回 null 表示不冷却 */
export function cooldownForFailure(
  failureCode: string,
  target: RouteHealthTarget,
  retryAfterMs?: number,
): { key: string; durationMs: number } | null {
  switch (String(failureCode ?? '').trim()) {
    case 'upstream_401':
    case 'upstream_403':
      return { key: `channel:${target.channelId}`, durationMs: 10 * 60 * 1000 };
    case 'upstream_404':
      // 404 是「这个模型在这家渠道不存在」，冷却整条渠道会误伤同渠道其它模型
      return { key: `channel-model:${target.channelModelId}`, durationMs: 10 * 60 * 1000 };
    case 'upstream_429': {
      const durationMs = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : 30 * 1000;
      return { key: `channel:${target.channelId}`, durationMs };
    }
    default:
      return null;
  }
}

@Injectable()
export class RouteHealthService {
  /** key → 解封时间戳（毫秒） */
  private blocked = new Map<string, number>();

  /** 判定线路是否在冷却中；顺带清理已过期项 */
  isBlocked(target: RouteHealthTarget, now = Date.now()): boolean {
    for (const key of this.keysOf(target)) {
      const until = this.blocked.get(key);
      if (until === undefined) continue;
      if (until <= now) {
        this.blocked.delete(key);
        continue;
      }
      return true;
    }
    return false;
  }

  /** 记录一次可归因失败；不可归因的失败码直接忽略 */
  recordFailure(
    failureCode: string,
    target: RouteHealthTarget,
    retryAfterMs?: number,
    now = Date.now(),
  ): void {
    const cooldown = cooldownForFailure(failureCode, target, retryAfterMs);
    if (!cooldown) return;
    this.blocked.set(cooldown.key, now + cooldown.durationMs);
  }

  /** 显式冷却一条键（后台「临时禁用线路」与验收脚本使用） */
  block(key: string, durationMs: number, now = Date.now()): void {
    if (!key || durationMs <= 0) return;
    this.blocked.set(key, now + durationMs);
  }

  /** 后台排查用：当前冷却中的键与解封时间 */
  snapshot(now = Date.now()): RouteHealthBlock[] {
    const result: RouteHealthBlock[] = [];
    for (const [key, until] of this.blocked) {
      if (until <= now) this.blocked.delete(key);
      else result.push({ key, until });
    }
    return result.sort((left, right) => left.key.localeCompare(right.key));
  }

  /** 清空（后台重置健康状态与验收脚本使用） */
  clear(): void {
    this.blocked.clear();
  }

  private keysOf(target: RouteHealthTarget): string[] {
    return [`channel:${target.channelId}`, `channel-model:${target.channelModelId}`, `route:${target.routeId}`];
  }
}
