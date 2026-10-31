/**
 * 后台渠道的「上游拉取 / 导入模型」。
 *
 * 移植自 open-ai-canvas `PreviewAdminChannelModels` / `ImportAdminChannelModels`：
 * 拉取只读、导入只增。两条硬规则：
 *
 *   1. **自动发现不能绕过定价边界**。导入的模型一律 `enabled=false`、
 *      `priceConfigured=false`，管理员定价后才能启用 —— 否则一次误点就会让
 *      未定价模型进入可用路由。
 *   2. **已被模型家族吸收的 SKU 不重复创建**。`retiredModelsJson` 记录这些上游键，
 *      拉取与导入都要跳过。普通手动删除不在其中 —— 上游仍存在的模型允许重新导入。
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SecretCipher } from '../infra/secret-cipher';
import { parseOutboundHeaders } from '../infra/outbound';
import { ModelDomainError, normalizeModelKey, uniqueNonEmpty } from '../domain/json';
import { channelModelActiveKey, retiredChannelModelKeys } from '../channels/channel.presentation';
import { ModelCatalogClient } from './model-catalog.client';
import type { ChannelModelCatalogItem, ChannelModelFetchResult } from './model-catalog.types';

const MAX_IMPORT_MODELS = 500;

@Injectable()
export class ModelCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: SecretCipher,
    private readonly client: ModelCatalogClient,
  ) {}

  /** 只读取上游目录，不写入任何数据 */
  async preview(channelId: string): Promise<ChannelModelCatalogItem[]> {
    const channel = await this.requireChannel(channelId);
    return this.client.fetch({
      baseUrl: channel.baseUrl,
      apiKey: this.cipher.decrypt(String(channel.apiKey ?? '')),
      apiFormat: channel.apiFormat,
      headers: this.channelHeaders(channel.headersJson),
      proxyUrl: channel.proxyUrl,
    });
  }

  /**
   * 导入管理员勾选的模型。只接受仍在**当前上游目录**里的键：上游已下线的模型
   * 导入进来只会得到一条永远失败的路由。
   */
  async import(channelId: string, selected: string[]): Promise<ChannelModelFetchResult> {
    const channel = await this.requireChannel(channelId);
    const catalog = await this.client.fetch({
      baseUrl: channel.baseUrl,
      apiKey: this.cipher.decrypt(String(channel.apiKey ?? '')),
      apiFormat: channel.apiFormat,
      headers: this.channelHeaders(channel.headersJson),
      proxyUrl: channel.proxyUrl,
    });

    const requested = uniqueNonEmpty(selected ?? []);
    if (requested.length === 0) throw new ModelDomainError('请至少选择一个要导入的模型');
    if (requested.length > MAX_IMPORT_MODELS) {
      throw new ModelDomainError(`单次最多导入 ${MAX_IMPORT_MODELS} 个模型`);
    }

    // 上游键不区分大小写比对，但写库保留上游的规范大小写
    const available = new Map<string, string>();
    for (const item of catalog) available.set(channelModelActiveKey(item.id), item.id);

    const chosen: string[] = [];
    const seen = new Set<string>();
    for (const raw of requested) {
      const key = channelModelActiveKey(normalizeModelKey(raw));
      if (key === '') continue;
      const canonical = available.get(key);
      if (!canonical) throw new ModelDomainError(`所选模型不在上游模型目录中：${normalizeModelKey(raw)}`);
      if (seen.has(key)) continue;
      seen.add(key);
      chosen.push(canonical);
    }
    if (chosen.length === 0) throw new ModelDomainError('请至少选择一个有效的模型');

    const existing = await this.prisma.channelModel.findMany({
      where: { channelId, deletedAt: null },
    });
    const known = new Set(existing.map((row) => row.activeKey || channelModelActiveKey(row.modelKey)));
    const retired = retiredChannelModelKeys(channel.retiredModelsJson);

    const missing: string[] = [];
    for (const name of chosen) {
      const key = channelModelActiveKey(name);
      if (known.has(key) || retired.has(key)) continue;
      known.add(key);
      missing.push(name);
    }

    if (missing.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const name of missing) {
          await tx.channelModel.create({
            data: {
              channelId,
              modelKey: normalizeModelKey(name),
              activeKey: channelModelActiveKey(name),
              providerModelKey: name,
              displayName: '未分类',
              // 能力与协议由管理员在渠道模型上声明；导入只建骨架行
              capability: '',
              protocol: '',
              billingMode: 'fixed_request',
              enabled: false,
              priceConfigured: false,
              priceVersion: 1,
            },
          });
        }
      });
    }

    return { models: catalog, added: missing.length };
  }

  private async requireChannel(channelId: string) {
    const id = String(channelId ?? '').trim();
    if (id === '') throw new ModelDomainError('渠道不存在', 40400);
    const channel = await this.prisma.modelChannel.findFirst({ where: { id, scope: 'system', deletedAt: null } });
    if (!channel) throw new ModelDomainError('渠道不存在或已删除', 40400);
    if (String(channel.baseUrl ?? '').trim() === '') throw new ModelDomainError('请先配置渠道 Base URL');
    return channel;
  }

  private channelHeaders(raw: string | null | undefined) {
    const value = String(raw ?? '').trim();
    if (value === '') return [];
    try {
      return parseOutboundHeaders(this.cipher.decrypt(value));
    } catch {
      // 头配置损坏时按「没有自定义头」拉取；真正的校验发生在出站层
      return [];
    }
  }
}
