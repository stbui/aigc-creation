/**
 * 中转计费：仅 POST 预留 → running → 结算 / 退款 / 待核对。
 *
 * 与任务路径共用 `BillingService` 的状态机与钱包，差异只有两点：
 *   · 没有前台模型与线路快照 —— 价格档直接按渠道模型 + 请求体选；
 *   · 请求体本身就是意图：Token 估算读真实 messages，按秒计费读 `seconds` /
 *     `duration`，图像选档读 `size` / `quality` 等上游原字段。
 *
 * 幂等：客户端可用 `X-Idempotency-Key` 重放同一笔请求；没有时每次生成新键，
 * 不做「按用户 + 分钟」之类的猜测性去重 —— 那会把合法重试当成重放。
 */

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { BillingOrderRow } from '../billing/billing.service';
import { BillingService } from '../billing/billing.service';
import { PriceTierService } from '../routing/price-tier.service';
import { UserGroupService } from '../user-groups/user-group.service';
import type { ModelRequestIntent } from '../intent/spec-types';
import { badRequest } from '../domain/json';
import { PROXY_SCENE } from './proxy.constants';
import type { ProxyChannelModel } from './proxy-channel.service';

export interface ProxyReservation {
  order: BillingOrderRow;
  /** 命中已有幂等键：本次不再重复预留 */
  idempotentHit: boolean;
}

@Injectable()
export class ProxyBillingService {
  constructor(
    private readonly billing: BillingService,
    private readonly priceTiers: PriceTierService,
    private readonly groups: UserGroupService,
  ) {}

  /**
   * 把上游请求体投影成计价意图。
   *
   * `options` 直接放整段请求体：报价 / 选档 / Token 估算读的都是上游原字段
   * （`size`、`quality`、`messages`、`max_tokens`），再做一层字段映射只会
   * 让「同一参数在中转与任务上算出的钱不同」。
   */
  buildIntent(channelModel: ProxyChannelModel, body: Buffer): ModelRequestIntent {
    const payload = parseJsonObject(body);
    const images = countImages(payload);
    const seconds = positiveInt(payload.seconds ?? payload.duration);
    const options: Record<string, unknown> = { ...payload };
    if (seconds > 0) {
      // 按秒计费读固定键名（`requestedBillingQuantity`），上游字段名不统一
      options.videoSeconds = seconds;
      options.audioSeconds = seconds;
    }
    return {
      capability: channelModel.capability,
      operation: String(payload.operation ?? '').trim() || undefined,
      inputs: images > 0 ? { image: images } : {},
      options,
    };
  }

  /**
   * 预留积分并置为运行中。
   *
   * 调用方必须在**槽位已占用之后**调用：没有拿到槽位就等于请求不会发出，
   * 此时建单再退款会污染账单与对账。
   */
  async reserve(input: {
    userId: string;
    channelModel: ProxyChannelModel;
    idempotencyKey?: string;
    scene?: string;
    body: Buffer;
  }): Promise<ProxyReservation> {
    const access = await this.groups.accessForUser(input.userId);
    const intent = this.buildIntent(input.channelModel, input.body);
    const tier = this.priceTiers.tierForIntent(input.channelModel.cached, intent);
    if (!tier) throw badRequest('当前模型尚未配置所选规格的价格，暂不能通过中转调用');
    const draft = this.billing.buildChannelDraft(access, input.channelModel.cached, tier, intent, input.scene || PROXY_SCENE);
    const key = `proxy:${String(input.idempotencyKey ?? '').trim() || randomUUID()}`;
    const reserved = await this.billing.reserveTaskBilling({
      userId: input.userId,
      taskId: '',
      idempotencyKey: key,
      draft,
    });
    if (!reserved.idempotentHit) await this.billing.markRunning(reserved.order.id);
    return { order: reserved.order, idempotentHit: reserved.idempotentHit };
  }

  /** 上游成功且调用记录已落库 → 结算 */
  async settle(orderId: string): Promise<void> {
    await this.billing.settle(orderId);
  }

  /** 上游明确失败（请求确实发出过）→ 原额退款 */
  async refund(orderId: string, reason: string): Promise<void> {
    await this.billing.refund(orderId, reason);
  }

  /** 结果不明 / 本地写入失败 → 转人工，不自动退款 */
  async uncertain(orderId: string, reason: string): Promise<void> {
    await this.billing.markUncertain(orderId, reason);
  }
}

function parseJsonObject(body: Buffer): Record<string, any> {
  if (!body || body.length === 0) return {};
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** 图像参考图数量：`images` / `image` 两种上游写法都要认，决定选档的 operation */
function countImages(payload: Record<string, any>): number {
  if (Array.isArray(payload.images)) return payload.images.length;
  if (Array.isArray(payload.image)) return payload.image.length;
  if (payload.image !== undefined && payload.image !== null && payload.image !== '') return 1;
  return 0;
}

function positiveInt(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
