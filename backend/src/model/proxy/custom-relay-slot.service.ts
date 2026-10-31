/**
 * 自定义中转的按用户并发槽。
 *
 * 与渠道槽（`ChannelSlotService`）分开的原因不是实现不同，而是**语义不同**：
 * 渠道槽守的是上游合同的并发上限（超了会 429 / 封号），用户槽守的是
 * 「一个人不能把自己的 Key 当跳板并发打满」，两者互不相干，共用一个键空间
 * 会让渠道 id 与用户 id 撞车。
 *
 * 拿不到槽位直接 429（不排队）：自定义中转是固定超时的请求，排队只会让
 * 客户端先超时、上游再扣费 —— 明确拒绝比「排到一半失败」更可解释。
 */

import { Injectable } from '@nestjs/common';

/** 单用户并发上限的兜底值；配置项 `MODEL_PROXY_CUSTOM_CONCURRENCY` 覆盖 */
export const DEFAULT_CUSTOM_RELAY_CONCURRENCY = 2;

@Injectable()
export class CustomRelaySlotService {
  /** userId → 已占用数 */
  private readonly used = new Map<string, number>();

  /**
   * 占用一个用户槽位；拿不到返回 `null`（调用方回 429）。
   *
   * @returns 释放函数；必须在 `finally` 中调用
   */
  acquire(userId: string, limit: number): (() => void) | null {
    const key = String(userId ?? '').trim();
    if (!key) return null;
    const max = Math.max(0, Math.trunc(limit));
    if (max === 0) return () => undefined;
    const current = this.used.get(key) ?? 0;
    if (current >= max) return null;
    this.used.set(key, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = (this.used.get(key) ?? 1) - 1;
      if (next <= 0) this.used.delete(key);
      else this.used.set(key, next);
    };
  }

  /** 后台观测用 */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.used);
  }
}
