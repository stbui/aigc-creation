/**
 * 创作端渠道模型目录（`/model-catalog*`）。
 *
 * 移植自 open-ai-canvas `internal/app/model_catalog.go`。与 `/models*` 的区别：
 *   · `/models*` 发布的是**前台模型**（产品视角，已经收敛了线路与能力合同）；
 *   · `/model-catalog*` 发布的是**渠道模型**（供应视角），`models` 恒为空数组，
 *     真实模型在 `channels[].models` 内 —— 参考实现的 C 端选型从这个形状读取。
 *
 * 四条脱敏 / 一致性约束：
 *   1. 不下发渠道名称、上游地址、凭证、并发配置；渠道 `name` / `displayName` 固定空串，
 *      前端统一显示为「系统模型」（渠道名会泄漏供应商与中转站身份）；
 *   2. 价格档单价必须先按计价货币换算成微积分、再叠分组倍率，与建单顺序一致；
 *   3. 单个模型能力合同损坏时**隔离该模型并跳过**，不让整份目录失败，
 *      但仓库查询失败必须整体报错 —— 空目录会被当成「全部不可用」；
 *   4. `available` 只由「存在有效价格档」决定，不回退旧标量价制造可用假象。
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { decodeCapabilityConfig, normalizeCapability } from '../domain/capability-config';
import { badRequest } from '../domain/json';
import { decodeSkuSelector, validateChannelModelPrice, type SkuSelector } from '../domain/selector';
import { validateImageParameterPriceSelector } from '../domain/image-parameters';
import { creditAmount, convertCurrencyPrice, toSafeNumber } from '../infra/microcredits';
import { capabilitySpecFromModelCapabilityConfig, decodeLogicalDefaults } from '../intent/capability-spec';
import { matchCapability } from '../intent/capability-match';
import { resolveModelRequestIntent } from '../intent/model-intent';
import type { ModelRequestIntent } from '../intent/spec-types';
import type { CachedChannelModel, CachedPriceTier } from '../routing/routing.types';
import { toNumber } from '../channels/channel.presentation';
import {
  ChannelModelMetricsService,
  type ChannelModelHealthRow,
} from '../channels/channel-model-metrics.service';
import { QuoteService, type ModelQuote } from './quote.service';
import type { UserGroupAccess } from '../user-groups/user-group.service';

/** 公开价格档：已换算为当前分组实际扣费的微积分 */
export interface PublicCatalogPriceTier {
  id: string;
  selector: SkuSelector;
  resolution: string;
  videoSeconds: number;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
}

/**
 * 公开目录里的可用性摘要。
 *
 * 参考实现（open-ai-canvas `app/model_catalog.go`）在公开目录里带
 * `availability{ rate24h, sampleCount24h, trend7d, recentResults, dataState }`，
 * C 端据此把不稳定或正在冷却的线路置灰。
 *
 * 本仓此前只有 `available`（= 有有效价格档），C 端无法区分
 * 「这条线最近在挂」和「这条线只是没配价」。
 */
export interface PublicCatalogAvailability {
  /** 24 小时成功率（0–1）；无样本为 null */
  rate24h: number | null;
  /** 24 小时终态样本数 */
  sampleCount24h: number;
  /** 7 天成功率（0–1）；无样本为 null */
  rate7d: number | null;
  /** 数据状态：'ok' 有样本 / 'no_data' 无样本 */
  dataState: 'ok' | 'no_data';
}

/** 公开渠道模型（脱敏） */
export interface PublicCatalogModel {
  id: string;
  modelKey: string;
  channelLabel: string;
  tags: Array<{ text: string; color: string }>;
  description: string;
  displayName: string;
  sortOrder: number;
  icon: string;
  capability: string;
  protocol: string;
  capabilityConfig: Record<string, unknown> | null;
  defaultOptions: Record<string, unknown>;
  priceTiers: PublicCatalogPriceTier[];
  pricingMode: string;
  displayPrice: number | null;
  priceLabel: string;
  available: boolean;
  /** 可用性摘要（24h / 7d 成功率）；无数据时 dataState='no_data' */
  availability: PublicCatalogAvailability;
}

/** 公开渠道目录（名称恒为空串） */
export interface PublicCatalogChannel {
  id: string;
  name: string;
  displayName: string;
  sortOrder: number;
  models: PublicCatalogModel[];
}

export interface PublicModelCatalogResult {
  source: 'system';
  /** 恒为空：模型在 `channels[].models` 内，保留字段以对齐参考实现 */
  models: never[];
  channels: PublicCatalogChannel[];
}

@Injectable()
export class PublicModelCatalogService {
  private readonly log = new Logger(PublicModelCatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: QuoteService,
    private readonly metrics: ChannelModelMetricsService,
  ) {}

  /** 目录：按分组可见渠道投影，`intent` 给出时只保留能承接该意图的模型 */
  async catalog(access: UserGroupAccess, intent?: ModelRequestIntent): Promise<PublicModelCatalogResult> {
    const channels = await this.prisma.modelChannel.findMany({
      where: { scope: 'system', enabled: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const visible = channels.filter((channel) => access.allowsChannel(channel.id));
    if (visible.length === 0) return { source: 'system', models: [], channels: [] };

    const models = await this.prisma.channelModel.findMany({
      where: { channelId: { in: visible.map((channel) => channel.id) }, enabled: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const tiers = await this.prisma.channelModelPriceTier.findMany({
      where: { channelModelId: { in: models.map((model) => model.id) }, deletedAt: null },
    });

    const result: PublicCatalogChannel[] = [];
    /*
     * 可用性摘要：一次取回全部线路的 24h / 7d 成功率，投影进公开目录。
     * 失败不影响目录本身（可用性是辅助信息，不能因为它拿不到就让整个目录挂掉）。
     */
    const availabilityById = await this.availabilityIndex();
    for (const channel of visible) {
      const projected: PublicCatalogModel[] = [];
      for (const model of models.filter((row) => row.channelId === channel.id)) {
        const view = this.projectModel(
          access,
          model,
          tiers.filter((tier) => tier.channelModelId === model.id),
          intent,
          availabilityById,
        );
        if (view) projected.push(view);
      }
      if (projected.length === 0) continue;
      result.push({
        id: channel.id,
        // 渠道名属于内部部署信息，普通用户目录不下发
        name: '',
        displayName: '',
        sortOrder: channel.sortOrder,
        models: projected,
      });
    }
    return { source: 'system', models: [], channels: result };
  }

  /** 渠道模型报价：目录里没有前台模型，价格档由意图直接选中 */
  async quote(
    access: UserGroupAccess,
    channelId: string,
    modelKey: string,
    intent: ModelRequestIntent,
  ): Promise<ModelQuote> {
    const id = String(channelId ?? '').trim();
    const key = String(modelKey ?? '').trim();
    if (id === '' || key === '') throw badRequest('报价必须指定系统渠道和模型');
    const channelModel = await this.loadChannelModel(access, id, key);
    const resolved = this.resolveIntent(channelModel, intent);
    const match = matchCapability(channelModel.capabilitySpec, resolved);
    if (!match.matched) throw badRequest(describeMatchFailure(match));
    return this.quotes.quoteChannelModel(access, channelModel, resolved);
  }

  /**
   * 线路可用性索引（id → 健康行）。
   *
   * 取不到就返回空表：可用性是辅助信息，拿不到时目录照常可用，
   * 只是 `availability.dataState` 变成 `no_data`。
   */
  private async availabilityIndex(): Promise<Map<string, ChannelModelHealthRow>> {
    try {
      const rows = await this.metrics.list();
      return new Map(rows.map((row) => [row.id, row]));
    } catch (error) {
      this.log.warn(`读取线路可用性失败，公开目录不带可用性摘要：${describe(error)}`);
      return new Map();
    }
  }

  /* ───────────────────────── 内部 ───────────────────────── */

  /** 目录投影：能力合同损坏时隔离该模型并记一次告警，不影响其它模型 */
  private projectModel(
    access: UserGroupAccess,
    row: ChannelModelRow,
    tierRows: PriceTierRow[],
    intent?: ModelRequestIntent,
    availabilityById?: Map<string, ChannelModelHealthRow>,
  ): PublicCatalogModel | null {
    try {
      const cached = this.toCachedChannelModel(row, tierRows);
      const resolved = intent ? this.resolveIntent(cached, intent) : null;
      if (resolved) {
        if (!matchCapability(cached.capabilitySpec, resolved).matched) return null;
        if (normalizeCapability(cached.capability) !== normalizeCapability(resolved.capability)) return null;
      }
      const priceTiers = publicTiers(access, cached, tierRows);
      if (!priceTiers) return null;
      const display = priceDisplay(priceTiers);
      return {
        id: cached.id,
        modelKey: cached.modelKey,
        channelLabel: firstNonEmpty(row.channelLabel, row.providerModelKey, row.modelKey),
        tags: decodeTags(row.tags),
        description: row.description,
        displayName: row.displayName || row.modelKey,
        sortOrder: row.sortOrder,
        icon: row.icon,
        capability: normalizeCapability(row.capability),
        protocol: row.protocol,
        capabilityConfig: row.capabilityConfigJson
          ? (decodeCapabilityConfig(row.capabilityConfigJson) as unknown as Record<string, unknown> | null)
          : null,
        defaultOptions: decodeLogicalDefaults('{}', cached.capabilitySpec),
        priceTiers,
        pricingMode: display.pricingMode,
        displayPrice: display.displayPrice,
        priceLabel: display.priceLabel,
        available: priceTiers.length > 0,
        availability: availabilityOf(availabilityById.get(cached.id) ?? null),
      };
    } catch (error) {
      this.log.warn(`渠道模型被排除出公开目录 id=${row.id}：${describe(error)}`);
      return null;
    }
  }

  /** 取一条渠道模型（含能力合同与价格档）；渠道不可见或模型不存在返回 400 */
  private async loadChannelModel(
    access: UserGroupAccess,
    channelId: string,
    modelKey: string,
  ): Promise<CachedChannelModel> {
    const channel = await this.prisma.modelChannel.findFirst({
      where: { id: channelId, scope: 'system', enabled: true, deletedAt: null },
    });
    if (!channel) throw badRequest('所选系统渠道不存在或已停用');
    access.requireChannel(channel.id);
    const row = await this.prisma.channelModel.findFirst({
      where: { channelId, activeKey: modelKey.toLowerCase(), enabled: true, deletedAt: null },
    });
    if (!row) throw badRequest('所选模型不存在或已停用');
    const tiers = await this.prisma.channelModelPriceTier.findMany({
      where: { channelModelId: row.id, deletedAt: null },
    });
    try {
      return this.toCachedChannelModel(row, tiers);
    } catch (error) {
      throw badRequest(`所选模型能力配置无效：${describe(error)}`);
    }
  }

  /** 数据库行 → 路由快照形状（价格档不过滤：过滤在选档时做） */
  private toCachedChannelModel(row: ChannelModelRow, tierRows: PriceTierRow[]): CachedChannelModel {
    const spec = capabilitySpecFromModelCapabilityConfig(
      decodeCapabilityConfig(row.capabilityConfigJson),
      row.capability,
      row.protocol,
    );
    return {
      id: row.id,
      channelId: row.channelId,
      modelKey: row.modelKey,
      providerModelKey: row.providerModelKey || row.modelKey,
      displayName: row.displayName || row.modelKey,
      capability: row.capability,
      protocol: row.protocol,
      priceCurrency: row.priceCurrency || 'credits',
      billingMode: row.billingMode,
      priceConfigured: row.priceConfigured,
      priceVersion: row.priceVersion,
      capabilitySpec: spec,
      priceTiers: tierRows.map(
        (tier): CachedPriceTier => ({
          id: tier.id,
          selector: decodeSkuSelector(tier.selectorJson || tier.selectorKey),
          selectorJson: tier.selectorJson,
          resolution: tier.resolution,
          videoSeconds: tier.videoSeconds,
          providerModelKey: tier.providerModelKey,
          billingMode: tier.billingMode,
          unitPriceMicrocredits: toNumber(tier.unitPriceMicrocredits),
          inputTokenPriceMicrocredits: toNumber(tier.inputTokenPriceMicrocredits),
          outputTokenPriceMicrocredits: toNumber(tier.outputTokenPriceMicrocredits),
          cachedTokenPriceMicrocredits: toNumber(tier.cachedTokenPriceMicrocredits),
          priceConfigured: tier.priceConfigured,
          enabled: tier.enabled,
          priceVersion: tier.priceVersion,
        }),
      ),
    };
  }

  /** 合并渠道模型默认参数后解析意图（与路由匹配用同一份合同） */
  private resolveIntent(channelModel: CachedChannelModel, intent: ModelRequestIntent): ModelRequestIntent {
    const defaults = decodeLogicalDefaults('{}', channelModel.capabilitySpec);
    return resolveModelRequestIntent(channelModel.capabilitySpec, intent, defaults);
  }
}

/* ────────────────────────── 纯函数 ────────────────────────── */

interface ChannelModelRow {
  id: string;
  channelId: string;
  modelKey: string;
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
  priceConfigured: boolean;
  priceCurrency: string;
  priceVersion: number;
  capabilityConfigJson: string;
}

interface PriceTierRow {
  id: string;
  selectorKey: string;
  selectorJson: string;
  resolution: string;
  videoSeconds: number;
  providerModelKey: string;
  billingMode: string;
  unitPriceMicrocredits: bigint;
  inputTokenPriceMicrocredits: bigint;
  outputTokenPriceMicrocredits: bigint;
  cachedTokenPriceMicrocredits: bigint;
  priceConfigured: boolean;
  enabled: boolean;
  priceVersion: number;
}

/**
 * 公开价格档：只保留启用且已配置的档，并按分组换算。
 * 分组缺少该计价货币的兑换比例时返回 null（整个模型不发布，而不是给一个 0 价）。
 */
function publicTiers(
  access: UserGroupAccess,
  channelModel: CachedChannelModel,
  tierRows: PriceTierRow[],
): PublicCatalogPriceTier[] | null {
  let pricing: ReturnType<UserGroupAccess['pricing']>;
  try {
    pricing = access.pricing(channelModel.priceCurrency, [channelModel.modelKey]);
  } catch {
    return null;
  }
  const result: PublicCatalogPriceTier[] = [];
  const seen = new Set<string>();
  for (const row of tierRows) {
    if (!row.enabled || !row.priceConfigured) continue;
    const pricingValid = validateChannelModelPrice(row.billingMode, {
      billingMode: row.billingMode,
      unitPriceMicrocredits: toNumber(row.unitPriceMicrocredits),
      inputTokenPriceMicrocredits: toNumber(row.inputTokenPriceMicrocredits),
      outputTokenPriceMicrocredits: toNumber(row.outputTokenPriceMicrocredits),
      cachedTokenPriceMicrocredits: toNumber(row.cachedTokenPriceMicrocredits),
    });
    if (!pricingValid) continue;
    const selector = decodeSkuSelector(row.selectorJson || row.selectorKey);
    const imageParameters = channelModel.capabilitySpec.imageParameters;
    if (imageParameters) {
      try {
        validateImageParameterPriceSelector(imageParameters, selector);
      } catch {
        continue;
      }
    }
    const tier: PublicCatalogPriceTier = {
      id: row.id,
      selector,
      resolution: row.resolution,
      videoSeconds: row.videoSeconds,
      billingMode: row.billingMode,
      unitPriceMicrocredits: applyMultiplier(
        toSafeNumber(convertCurrencyPrice(toNumber(row.unitPriceMicrocredits), pricing.rateMicrocredits)),
        pricing.multiplierBasisPoints,
      ),
      inputTokenPriceMicrocredits: applyMultiplier(
        toSafeNumber(convertCurrencyPrice(toNumber(row.inputTokenPriceMicrocredits), pricing.rateMicrocredits)),
        pricing.multiplierBasisPoints,
      ),
      outputTokenPriceMicrocredits: applyMultiplier(
        toSafeNumber(convertCurrencyPrice(toNumber(row.outputTokenPriceMicrocredits), pricing.rateMicrocredits)),
        pricing.multiplierBasisPoints,
      ),
      cachedTokenPriceMicrocredits: applyMultiplier(
        toSafeNumber(convertCurrencyPrice(toNumber(row.cachedTokenPriceMicrocredits), pricing.rateMicrocredits)),
        pricing.multiplierBasisPoints,
      ),
    };
    const key = JSON.stringify({
      selector,
      billingMode: tier.billingMode,
      unit: tier.unitPriceMicrocredits,
      input: tier.inputTokenPriceMicrocredits,
      output: tier.outputTokenPriceMicrocredits,
      cached: tier.cachedTokenPriceMicrocredits,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tier);
  }
  return result;
}

function applyMultiplier(price: number, multiplierBasisPoints: bigint): number {
  if (price <= 0) return price;
  return toSafeNumber(creditAmount(price, 1, multiplierBasisPoints));
}

/**
 * 健康行 → 公开目录的可用性摘要。
 *
 * 「没调用过」（无样本）与「全失败」要分得开：无样本时 rate 为 null、
 * dataState='no_data'，C 端不能因此把线路判成不可用。
 */
export function availabilityOf(row: ChannelModelHealthRow | null): PublicCatalogAvailability {
  if (!row) {
    return { rate24h: null, sampleCount24h: 0, rate7d: null, dataState: 'no_data' };
  }
  const day = row.windows.day;
  const week = row.windows.week;
  const samples = day?.samples ?? 0;
  return {
    rate24h: day?.successRate ?? null,
    sampleCount24h: samples,
    rate7d: week?.successRate ?? null,
    dataState: samples > 0 ? 'ok' : 'no_data',
  };
}

/**
 * 展示价：单档且单价 > 0 时直接给数字；多档不猜测用户最终规格，只标注「按渠道规格计费」。
 * 没有任何有效档位必须明确「未配置」—— 绝不能回退标量价显示成有价可用。
 */
export function priceDisplay(tiers: PublicCatalogPriceTier[]): {
  pricingMode: string;
  displayPrice: number | null;
  priceLabel: string;
} {
  if (tiers.length === 0) return { pricingMode: 'provider', displayPrice: null, priceLabel: '未配置' };
  if (tiers.length === 1) {
    const unit = tierDisplayPrice(tiers[0]);
    if (unit > 0) return { pricingMode: 'provider', displayPrice: unit, priceLabel: '' };
  }
  return { pricingMode: 'provider', displayPrice: null, priceLabel: '按渠道规格计费' };
}

function tierDisplayPrice(tier: PublicCatalogPriceTier): number {
  if (tier.billingMode === 'fixed_request' || tier.billingMode === 'per_second') return tier.unitPriceMicrocredits;
  if (tier.outputTokenPriceMicrocredits > 0) return tier.outputTokenPriceMicrocredits;
  if (tier.inputTokenPriceMicrocredits > 0) return tier.inputTokenPriceMicrocredits;
  return 0;
}

function decodeTags(raw: string): Array<{ text: string; color: string }> {
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({ text: String(item?.text ?? '').trim(), color: String(item?.color ?? '').trim() }))
      .filter((item) => item.text !== '');
  } catch {
    return [];
  }
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function describeMatchFailure(match: { reasons: string[] }): string {
  const reasons = (match.reasons ?? []).map((item) => String(item ?? '').trim()).filter((item) => item !== '');
  return reasons.length > 0 ? reasons.join('；') : '所选模型暂时无法满足这组输入和参数';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
