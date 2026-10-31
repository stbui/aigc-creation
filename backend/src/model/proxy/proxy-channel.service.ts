/**
 * 中转侧的渠道装配：把渠道 / 渠道模型行变成「可以发请求」的运行期对象。
 *
 * 与任务侧的 `ChannelRuntimeService` 刻意分开：任务只按 `channelModelId` 派发，
 * 而中转要先从**客户端给的模型名**反查渠道模型（模型名是上游口径，可能是
 * `modelKey` 也可能是 `providerModelKey`），并且要容忍 `GET /models`
 * 这类没有模型的请求。共用一份实现只会让任务侧被迫接受「模型名模糊匹配」。
 *
 * 凭证解密与自定义头解析仍复用同一套 `SecretCipher` / `parseOutboundHeaders`：
 * 中转不能自己发明一份头规则。
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SecretCipher } from '../infra/secret-cipher';
import { parseOutboundHeaders, type OutboundHeader } from '../infra/outbound';
import { ProtocolRegistry } from '../protocol/registry';
import type { ProtocolMetadata } from '../protocol/runtime';
import { projectCachedChannelModel } from '../routing/channel-model.projection';
import type { CachedChannelModel } from '../routing/routing.types';
import { channelModelActiveKey } from '../channels/channel.presentation';

/** 可中转的渠道（已解密，仅供本次请求使用，不得写入日志或快照） */
export interface ProxyChannel {
  id: string;
  name: string;
  scope: string;
  baseUrl: string;
  apiFormat: string;
  concurrencyLimit: number;
  proxyUrl: string | null;
  apiKey: string;
  headers: OutboundHeader[];
}

/** 客户端模型名 → 渠道模型（含价格档） */
export interface ProxyChannelModel {
  id: string;
  channelId: string;
  modelKey: string;
  providerModelKey: string;
  capability: string;
  protocol: string;
  billingMode: string;
  cached: CachedChannelModel;
  metadata: ProtocolMetadata | null;
}

@Injectable()
export class ProxyChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: SecretCipher,
    private readonly registry: ProtocolRegistry,
  ) {}

  /**
   * 取系统渠道；不存在 / 停用 / 已删除 / 非系统范围一律返回 `null`
   * （控制器统一回「系统渠道不存在或已停用」，不泄漏存在性）。
   */
  async loadSystemChannel(channelId: string): Promise<ProxyChannel | null> {
    const id = String(channelId ?? '').trim();
    if (!id) return null;
    const row = await this.prisma.modelChannel.findUnique({ where: { id } });
    if (!row || row.deletedAt || !row.enabled || row.scope !== 'system') return null;
    const baseUrl = String(row.baseUrl ?? '').trim();
    if (!baseUrl) return null;
    return {
      id: row.id,
      name: row.name,
      scope: row.scope,
      baseUrl,
      apiFormat: row.apiFormat,
      concurrencyLimit: Math.max(0, Math.trunc(row.concurrencyLimit ?? 0)),
      proxyUrl: String(row.proxyUrl ?? '').trim() || null,
      apiKey: this.cipher.decrypt(String(row.apiKey ?? '')),
      headers: this.parseHeaders(row.headersJson),
    };
  }

  /**
   * 按客户端给的模型名找渠道模型。
   *
   * 先按公开 `modelKey`（`activeKey`）匹配，再按上游 `providerModelKey` ——
   * 中转客户端拿到的是上游模型名，只认 `modelKey` 会让「上游名 ≠ 展示名」
   * 的渠道全部 403。
   */
  async findChannelModel(channelId: string, model: string): Promise<ProxyChannelModel | null> {
    const key = String(model ?? '').trim().replace(/^models\//, '');
    if (!key) return null;
    const row = await this.prisma.channelModel.findFirst({
      where: {
        channelId,
        deletedAt: null,
        enabled: true,
        OR: [{ activeKey: channelModelActiveKey(key) }, { providerModelKey: key }],
      },
    });
    if (!row) return null;
    const tiers = await this.prisma.channelModelPriceTier.findMany({
      where: { channelModelId: row.id, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }],
    });
    const cached = projectCachedChannelModel(row, tiers);
    const protocol = String(row.protocol ?? '').trim();
    return {
      id: row.id,
      channelId: row.channelId,
      modelKey: row.modelKey,
      providerModelKey: String(row.providerModelKey ?? '').trim() || row.modelKey,
      capability: row.capability,
      protocol,
      billingMode: row.billingMode,
      cached,
      metadata: protocol ? this.registry.resolve(protocol)?.metadata ?? null : null,
    };
  }

  /**
   * 渠道上是否存在某个协议的可用模型。
   *
   * 只服务一种请求：MiniMax 视频结果查询（`GET /v2/query/video_generation/:id`）
   * 没有模型名，无法反查渠道模型，只能按「这个渠道到底配没配 MiniMax 视频」判定。
   */
  async channelHasProtocol(channelId: string, protocol: string): Promise<boolean> {
    const count = await this.prisma.channelModel.count({
      where: { channelId, protocol, deletedAt: null, enabled: true },
    });
    return count > 0;
  }

  /** 协议元数据（`GET /models` 这类没有渠道模型的请求也要判定协议族） */
  protocolMetadata(protocol: string): ProtocolMetadata | null {
    const id = String(protocol ?? '').trim();
    return id ? this.registry.resolve(id)?.metadata ?? null : null;
  }

  /**
   * 渠道自定义头：配置损坏时按「没有自定义头」处理（与任务路径一致），
   * 让请求照常发出比整体失败更容易排障。
   */
  private parseHeaders(raw: string): OutboundHeader[] {
    const value = String(raw ?? '').trim();
    if (value === '') return [];
    try {
      return parseOutboundHeaders(this.cipher.decrypt(value));
    } catch {
      return [];
    }
  }
}
