/**
 * 渠道域投影与归一化 —— 纯函数，不碰数据库。
 *
 * 两条硬规则：
 *   1. 后台投影**永不回显凭证**（系统渠道连 `apiKey` 字段都为空，只给 `hasApiKey`）；
 *   2. `modelsJson` 只是兼容清单，真实来源是 `channel_models` 表中启用的行。
 */

import { badRequest, decodeJsonLoose, normalizeModelKey, uniqueNonEmpty } from '../domain/json';
import { decodeCapabilityConfig } from '../domain/capability-config';
import { decodeSkuSelector } from '../domain/selector';
import type {
  ChannelDefaultModelConfig,
  ChannelModelTag,
  ChannelModelView,
  PublicChannelModelCost,
  PublicModelChannel,
} from './channel.types';
import {
  CHANNEL_MODEL_TAG_COLORS,
  CHANNEL_SCOPE_SYSTEM,
  PRICE_CURRENCY_CREDITS,
  USER_GROUP_BADGE_STYLES,
} from './channel.types';

export function normalizeChannelModelTags(input: ChannelModelTag[] | null | undefined): ChannelModelTag[] {
  const tags = input ?? [];
  if (tags.length > 5) throw badRequest('每个模型最多配置 5 个标签');
  const result: ChannelModelTag[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const text = String(tag?.text ?? '').trim();
    if ([...text].length === 0 || [...text].length > 12) {
      throw badRequest('标签文字须为 1–12 字');
    }
    if (seen.has(text)) throw badRequest('标签文字不能重复');
    const color = String(tag?.color ?? '').trim();
    if (!(CHANNEL_MODEL_TAG_COLORS as readonly string[]).includes(color)) {
      throw badRequest('请选择有效的标签颜色');
    }
    seen.add(text);
    result.push({ text, color });
  }
  return result;
}

export function decodeChannelModelTags(raw: string | null | undefined): ChannelModelTag[] {
  const value = decodeJsonLoose<unknown>(raw, []);
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ChannelModelTag => Boolean(item) && typeof item === 'object')
    .map((item) => ({ text: String(item.text ?? ''), color: String(item.color ?? '') }))
    .filter((item) => item.text !== '');
}

/** 渠道模型标识的库存键：统一小写、去 `models/` 前缀 */
export function channelModelActiveKey(modelKey: string): string {
  return normalizeModelKey(modelKey).toLowerCase();
}

export function retiredChannelModelKeys(raw: string | null | undefined): Set<string> {
  const values = decodeJsonLoose<unknown>(raw, []);
  const result = new Set<string>();
  for (const value of Array.isArray(values) ? values : []) {
    const key = channelModelActiveKey(String(value ?? ''));
    if (key) result.add(key);
  }
  return result;
}

export function channelModelNames(channel: { modelsJson?: string | null }): string[] {
  const values = decodeJsonLoose<unknown>(channel.modelsJson ?? '', []);
  return uniqueNonEmpty(Array.isArray(values) ? values : []).map((value) => normalizeModelKey(value));
}

export function duplicateChannelName(name: string): string {
  const suffix = ' - 副本';
  let base = [...String(name ?? '').trim()].slice(0, 80);
  if (base.length === 0) base = [...'系统渠道'];
  if (base.length + [...suffix].length > 80) {
    base = base.slice(0, 80 - [...suffix].length);
  }
  return base.join('') + suffix;
}

export function normalizePriceCurrency(value: string | null | undefined): string {
  const text = String(value ?? '').trim().toUpperCase();
  if (text === '' || text === 'CREDITS') return PRICE_CURRENCY_CREDITS;
  if (text === 'USD') return 'USD';
  if (text === 'CNY') return 'CNY';
  throw badRequest('计价货币只支持积分、USD 或 CNY');
}

export function normalizeUserGroupBadgeStyle(value: string | null | undefined): string {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === '') return 'none';
  if (!(USER_GROUP_BADGE_STYLES as readonly string[]).includes(text)) {
    throw badRequest('徽章样式无效');
  }
  return text;
}

/* ───────────────────────── 数据库行 → 视图 ───────────────────────── */

/** Prisma 行里 BigInt 字段需要显式转 number —— JSON.stringify 不支持 BigInt */
export function toNumber(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'bigint' ? Number(value) : value;
}

export interface ChannelModelRowLike {
  id: string;
  channelId: string;
  modelKey: string;
  modelGroupKey?: string;
  providerModelKey: string;
  displayName: string;
  channelLabel: string;
  tags: string;
  description: string;
  sortOrder: number;
  icon: string;
  capability: string;
  protocol: string;
  billingMode: string;
  unitPriceMicrocredits: bigint;
  inputTokenPriceMicrocredits: bigint;
  outputTokenPriceMicrocredits: bigint;
  cachedTokenPriceMicrocredits: bigint;
  priceConfigured: boolean;
  priceCurrency: string;
  enabled: boolean;
  priceVersion: number;
  capabilityVersion: number;
  capabilityConfigJson: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PriceTierRowLike {
  id: string;
  selectorKey: string;
  selectorJson: string;
  resolution: string;
  videoSeconds: number;
  providerModelKey: string;
  billingMode: string;
  costConfigured: boolean;
  costUnitPriceMicrocredits: bigint;
  costInputTokenPriceMicrocredits: bigint;
  costOutputTokenPriceMicrocredits: bigint;
  costCachedTokenPriceMicrocredits: bigint;
  unitPriceMicrocredits: bigint;
  inputTokenPriceMicrocredits: bigint;
  outputTokenPriceMicrocredits: bigint;
  cachedTokenPriceMicrocredits: bigint;
  priceConfigured: boolean;
  enabled: boolean;
  priceVersion: number;
}

/**
 * 渠道模型后台视图（含成本价）。
 *
 * ⚠ **只在后台路径使用**：这个投影带 `costPricing`（上游成本价），
 * 公开目录另有 `public-model-catalog.service.ts` 的无成本投影。
 * 参考实现靠 `json:"-"` 在实体层兜底，本仓靠「公开路径不调这个函数」——
 * 新增公开端点时**不要**复用它，否则上游成本会泄漏给普通用户。
 */
export function channelModelView(row: ChannelModelRowLike, tiers: PriceTierRowLike[]): ChannelModelView {
  return {
    id: row.id,
    channelId: row.channelId,
    modelKey: row.modelKey,
    modelGroupKey: row.modelGroupKey ?? '',
    providerModelKey: row.providerModelKey,
    displayName: row.displayName,
    channelLabel: row.channelLabel,
    tags: decodeChannelModelTags(row.tags),
    description: row.description,
    sortOrder: row.sortOrder,
    icon: row.icon,
    capability: row.capability,
    protocol: row.protocol,
    billingMode: row.billingMode,
    unitPriceMicrocredits: toNumber(row.unitPriceMicrocredits),
    inputTokenPriceMicrocredits: toNumber(row.inputTokenPriceMicrocredits),
    outputTokenPriceMicrocredits: toNumber(row.outputTokenPriceMicrocredits),
    cachedTokenPriceMicrocredits: toNumber(row.cachedTokenPriceMicrocredits),
    priceConfigured: row.priceConfigured,
    priceCurrency: row.priceCurrency || PRICE_CURRENCY_CREDITS,
    enabled: row.enabled,
    priceVersion: row.priceVersion,
    capabilityVersion: row.capabilityVersion,
    capabilityConfig: row.capabilityConfigJson ? decodeCapabilityConfig(row.capabilityConfigJson) : null,
    priceTiers: tiers.map((tier) => ({
      id: tier.id,
      selector: tier.selectorJson ? decodeSkuSelector(tier.selectorJson) : decodeSkuSelector(tier.selectorKey),
      resolution: tier.resolution,
      videoSeconds: tier.videoSeconds,
      providerModelKey: tier.providerModelKey,
      billingMode: tier.billingMode,
      costPricing: {
        configured: tier.costConfigured,
        unitPriceMicrocredits: toNumber(tier.costUnitPriceMicrocredits),
        inputTokenPriceMicrocredits: toNumber(tier.costInputTokenPriceMicrocredits),
        outputTokenPriceMicrocredits: toNumber(tier.costOutputTokenPriceMicrocredits),
        cachedTokenPriceMicrocredits: toNumber(tier.costCachedTokenPriceMicrocredits),
      },
      unitPriceMicrocredits: toNumber(tier.unitPriceMicrocredits),
      inputTokenPriceMicrocredits: toNumber(tier.inputTokenPriceMicrocredits),
      outputTokenPriceMicrocredits: toNumber(tier.outputTokenPriceMicrocredits),
      cachedTokenPriceMicrocredits: toNumber(tier.cachedTokenPriceMicrocredits),
      priceConfigured: tier.priceConfigured,
      enabled: tier.enabled,
      priceVersion: tier.priceVersion,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface ChannelRowLike {
  id: string;
  userId: string;
  scope: string;
  enabled: boolean;
  name: string;
  sortOrder: number;
  baseUrl: string;
  apiKey: string;
  secretKey: string;
  apiFormat: string;
  concurrencyLimit: number;
  proxyUrl: string;
  modelsJson: string;
  headersJson: string;
  catalogProviderId: string;
  defaultModelConfigJson: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 渠道投影。
 *
 * `admin=false` 时系统渠道只暴露中转地址（`/api/ai/system/:id`），
 * 上游真实地址与并发配置属于内部拓扑信息，不下发。
 *
 * ## 非管理员视角的脱敏口径
 *
 * 与 `PublicModelCatalogService` 一致：渠道名会泄漏供应商与中转站身份
 * （运营建渠道时填的 `name` 常常就是上游域名），所以非管理员视角下
 * 渠道 `name` 固定空串，前端统一显示为「系统渠道」。同理：
 *
 *   · `catalogProviderId` —— 指向插件清单里的 provider id，等于报出协议与厂商；
 *   · `concurrencyLimit`  —— 并发配额属于内部拓扑；
 *
 * 三者都不下发。`id` / `sortOrder` / `models` / `modelCosts` 保留 ——
 * C 端要用它们选线路、算价格。
 */
export function publicChannel(
  row: ChannelRowLike,
  admin: boolean,
  models: ChannelModelRowLike[],
  defaultModel?: ChannelDefaultModelConfig | null,
): PublicModelChannel {
  const enabledModels = models.filter((item) => item.enabled);
  const names = enabledModels.map((item) => item.modelKey);
  const modelCosts: PublicChannelModelCost[] = [];
  for (const item of enabledModels) {
    if (!item.priceConfigured) continue;
    modelCosts.push({
      model: item.modelKey,
      displayName: item.displayName,
      channelLabel: item.channelLabel,
      tags: decodeChannelModelTags(item.tags),
      description: item.description,
      icon: item.icon,
      capability: item.capability,
      protocol: item.protocol,
      billingMode: item.billingMode,
      unitPriceMicrocredits: toNumber(item.unitPriceMicrocredits),
      inputTokenPriceMicrocredits: toNumber(item.inputTokenPriceMicrocredits),
      outputTokenPriceMicrocredits: toNumber(item.outputTokenPriceMicrocredits),
      cachedTokenPriceMicrocredits: toNumber(item.cachedTokenPriceMicrocredits),
      capabilityConfig: item.capabilityConfigJson ? decodeCapabilityConfig(item.capabilityConfigJson) : null,
    });
  }

  let apiKey = '';
  let baseUrl = row.baseUrl;
  let proxyUrl = '';
  let headers: Array<{ name: string; value: string }> | undefined;
  if (row.scope === CHANNEL_SCOPE_SYSTEM) {
    if (!admin) {
      apiKey = 'system';
      baseUrl = `/api/ai/system/${row.id}`;
    }
    if (admin) headers = decodeJsonLoose(row.headersJson, []);
  } else if (admin) {
    apiKey = row.apiKey;
  }
  if (admin) proxyUrl = row.proxyUrl;

  return {
    id: row.id,
    // 渠道归属人属于内部账号信息，非管理员视角不下发
    userId: admin ? row.userId : '',
    scope: row.scope,
    enabled: row.enabled,
    // 渠道名会泄漏供应商身份：非管理员视角固定空串
    name: admin ? row.name : '',
    sortOrder: row.sortOrder,
    baseUrl,
    apiKey,
    apiFormat: row.apiFormat,
    concurrencyLimit: admin ? row.concurrencyLimit : 0,
    proxyUrl,
    models: names.length > 0 ? names : channelModelNames(row),
    modelCosts,
    headers,
    // 是否配了凭证也是内部拓扑的一部分；对外恒为 false
    hasApiKey: admin && String(row.apiKey ?? '').trim() !== '',
    hasSecretKey: admin && String(row.secretKey ?? '').trim() !== '',
    // provider id 等于报出协议与厂商，非管理员视角不下发
    catalogProviderId: admin ? row.catalogProviderId || undefined : undefined,
    defaultModel: admin ? defaultModel ?? null : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
