/**
 * 价格档选择器：规范化、能力校验、计价校验与档位摘要。
 *
 * 移植自 open-ai-canvas：
 *   · `internal/model/model_sku.go`      —— canonical selector / decode
 *   · `internal/app/channel_models_pricing.go` —— 保存期规范化与校验
 *   · `internal/app/price_validation.go` —— 价格有效性
 *   · `internal/app/model_router.go`     —— 运行期档位匹配
 *
 * 一条铁律：**同一个可购买规格只能有一个价格档**。因此所有值统一成字符串并
 * 以排序键的 JSON 作唯一键 —— `imageCount: 2` 与 `"2"` 不能落成两行。
 */

import {
  type ModelCapabilityConfig,
  containsCapabilityString,
  decodeCapabilityConfig,
  legacyImageResolutionProtocol,
  normalizeLegacyImageResolutionConfig,
  videoDurationSupported,
} from './capability-config';
import { type ImageParameter, validateImageParameterPriceSelector } from './image-parameters';
import { badRequest } from './json';

export type SkuSelector = Record<string, string>;

export interface TierSelectorInput {
  selector?: SkuSelector | null;
  resolution?: string | null;
  videoSeconds?: number | null;
}

export interface NormalizedTierSelector {
  selector: SkuSelector;
  resolution: string;
  videoSeconds: number;
}

export interface TierPricingInput {
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
}

/** 单价上限：1,000,000 积分（微积分） */
const MAX_CREDIT_COST_MICROCREDITS = 1_000_000 * 1_000_000;
const MAX_TOKEN_PRICE_MICROCREDITS = MAX_CREDIT_COST_MICROCREDITS;

const VIDEO_FPS_BANDS = ['le30', 'le60', 'le120'];
const IMAGE_RESOLUTION_TIERS = ['1k', '1.5k', '2k', '4k'];

/* ───────────────────────── canonical selector ───────────────────────── */

function sortedSelector(raw: SkuSelector | null | undefined): SkuSelector {
  const selector: SkuSelector = {};
  for (const key of Object.keys(raw ?? {}).sort()) {
    const name = String(key ?? '').trim();
    const value = String(raw?.[key] ?? '').trim();
    if (!name || !value) continue;
    selector[name] = value;
  }
  return selector;
}

/** 返回规范化选择器与其唯一键（键排序，数字与字符串写法归一） */
export function canonicalSkuSelector(raw: SkuSelector | null | undefined): { selector: SkuSelector; key: string } {
  const selector = sortedSelector(raw);
  return { selector, key: JSON.stringify(selector) };
}

export function decodeSkuSelector(raw: string | null | undefined): SkuSelector {
  const text = String(raw ?? '').trim();
  if (!text) return {};
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const selector: SkuSelector = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      selector[key] = String(item ?? '');
    }
    return selector;
  } catch {
    return {};
  }
}

/* ───────────────────────── 分辨率归一 ───────────────────────── */

/**
 * 视频分辨率档位归一：`low/480/480p → 480p`、`1440/2k → 1440p`、
 * 任意 `NNN` → `NNNp`，其余原样返回。
 */
export function normalizeVqualityResolution(raw: unknown): string {
  const text = String(raw ?? '').trim().toLowerCase();
  switch (text) {
    case 'low':
    case '480':
    case '480p':
      return '480p';
    case '720':
    case '720p':
      return '720p';
    case '1080':
    case '1080p':
      return '1080p';
    case '2k':
    case '1440':
    case '1440p':
      return '1440p';
    case '4k':
    case '2160':
    case '2160p':
      return '2160p';
    default: {
      const pixels = text.replace(/p$/, '');
      if (/^\d+$/.test(pixels) && Number(pixels) > 0) return `${Number(pixels)}p`;
      return text;
    }
  }
}

/** 视频价格档分辨率：空 / `*` / `any` 视为通配 */
export function normalizeTierResolution(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text || text === '*' || text.toLowerCase() === 'any') return '*';
  return normalizeVqualityResolution(text);
}

export function isImageResolutionTier(value: string): boolean {
  return IMAGE_RESOLUTION_TIERS.includes(String(value ?? '').trim().toLowerCase());
}

/* ───────────────────────── 保存期：选择器规范化 ───────────────────────── */

/**
 * @param capability 渠道模型能力（text/image/video/audio）
 * @param input      请求里的价格档
 * @param imageParameters 图片参数合同；传 null/undefined 表示走旧版 size/quality/resolution 路径
 */
export function normalizeChannelModelTierSelector(
  capability: string,
  input: TierSelectorInput,
  imageParameters?: ImageParameter[] | null,
): NormalizedTierSelector {
  // 图片参数合同模式：选择器键必须全部是 pricing 参数，不接受视频规格
  if (capability === 'image' && imageParameters) {
    if ((input.videoSeconds ?? 0) !== 0 || (input.resolution && input.resolution !== '*')) {
      throw badRequest('图片价格不接受视频规格');
    }
    const selector: SkuSelector = {};
    for (const [rawKey, rawValue] of Object.entries(input.selector ?? {})) {
      const key = String(rawKey ?? '').trim();
      const value = String(rawValue ?? '').trim();
      if (!key || !value || value === '*') continue;
      if (Object.prototype.hasOwnProperty.call(selector, key)) {
        throw badRequest(`价格档存在重复规格条件：${key}`);
      }
      selector[key] = value;
    }
    validateImageParameterPriceSelector(imageParameters, selector);
    return { selector: sortedSelector(selector), resolution: '*', videoSeconds: 0 };
  }

  const selector: SkuSelector = {};
  for (const [rawKey, rawValue] of Object.entries(input.selector ?? {})) {
    let key = String(rawKey ?? '').trim();
    let value = String(rawValue ?? '').trim();
    if (!key || !value) continue;
    switch (key) {
      case 'operation':
        value = value.toLowerCase();
        break;
      case 'quality':
      case 'imageResolution':
      case 'size':
        value = value.toLowerCase();
        if (value === 'auto' || value === 'any') value = '*';
        break;
      case 'resoluton':
        // 历史拼写：输入边界即纠正，避免同一规格落成两档
        key = 'imageResolution';
        value = value.toLowerCase();
        if (value === 'auto' || value === 'any') value = '*';
        break;
      case 'vquality':
        value = normalizeTierResolution(value);
        break;
      case 'resolution':
        value = value.toLowerCase();
        break;
      case 'videoSeconds': {
        const seconds = Number(value);
        if (!Number.isInteger(seconds) || seconds < 0) {
          throw badRequest('视频价格档时长必须是非负整数');
        }
        if (seconds === 0) continue;
        value = String(seconds);
        break;
      }
      case 'imageCount': {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 0) {
          throw badRequest('参考图片数量必须是非负整数');
        }
        if (count === 0) continue;
        value = String(count);
        break;
      }
      case 'videoGenerateAudio':
        if (capability !== 'video') {
          throw badRequest('只有视频模型可以按是否生成音频配置价格档');
        }
        value = value.toLowerCase();
        if (value === '*') continue;
        if (value !== 'true' && value !== 'false') {
          throw badRequest('视频价格档音频条件必须为 true、false 或 *');
        }
        break;
      case 'fpsBand':
        if (capability !== 'video') {
          throw badRequest('只有视频模型可以按帧率档配置价格档');
        }
        value = value.toLowerCase();
        if (value === '*') continue;
        if (!VIDEO_FPS_BANDS.includes(value)) {
          throw badRequest('视频价格档帧率条件必须为 le30、le60、le120 或 *');
        }
        break;
      default:
        if (capability !== 'image') {
          throw badRequest(`价格档不支持规格字段：${key}`);
        }
        break;
    }
    if (Object.prototype.hasOwnProperty.call(selector, key) && selector[key] !== value) {
      throw badRequest(`价格档存在重复规格条件：${key}`);
    }
    selector[key] = value;
  }

  if (capability === 'video') {
    if (selector.vquality === undefined) {
      const resolution = normalizeTierResolution(input.resolution);
      if (resolution !== '*') selector.vquality = resolution;
    }
    if (selector.videoSeconds === undefined && (input.videoSeconds ?? 0) > 0) {
      selector.videoSeconds = String(input.videoSeconds);
    }
  } else if (normalizeTierResolution(input.resolution) !== '*') {
    throw badRequest('非视频模型不能使用视频分辨率价格档');
  } else if ((input.videoSeconds ?? 0) !== 0) {
    throw badRequest('非视频模型不能使用视频时长价格档');
  }

  for (const key of ['quality', 'size']) {
    if (selector[key] !== undefined && capability !== 'image') {
      throw badRequest(`只有图片模型可以按 ${key} 配置价格档`);
    }
  }
  if (selector.vquality !== undefined && capability !== 'video') {
    throw badRequest('只有视频模型可以按分辨率配置价格档');
  }
  if (selector.resolution !== undefined && capability !== 'image') {
    throw badRequest('只有图片模型可以按分辨率配置价格档');
  }
  if (selector.videoSeconds !== undefined && capability !== 'video') {
    throw badRequest('只有视频模型可以按时长配置价格档');
  }
  if (selector.imageCount !== undefined && capability !== 'video') {
    throw badRequest('只有视频模型可以按参考图片数量配置价格档');
  }

  const resolution = selector.vquality || '*';
  const videoSeconds = selector.videoSeconds ? Number(selector.videoSeconds) : 0;
  return { selector: sortedSelector(selector), resolution, videoSeconds };
}

/* ───────────────────────── 保存期：能力匹配校验 ───────────────────────── */

export interface TierCapabilityCheck {
  selector: SkuSelector;
  resolution: string;
  videoSeconds: number;
}

/**
 * 校验价格档选择器是否落在渠道模型能力合同之内。
 * 图片走参数合同（若声明）或旧版 size/quality/resolution 路径。
 */
export function validateChannelModelTierCapabilities(
  tiers: TierCapabilityCheck[],
  capabilityConfig: ModelCapabilityConfig | string | null | undefined,
  capability: string,
  protocol: string,
): void {
  const config =
    typeof capabilityConfig === 'string' || capabilityConfig === null || capabilityConfig === undefined
      ? decodeCapabilityConfig(capabilityConfig as string | null | undefined)
      : capabilityConfig;

  if (capability === 'image') {
    if (!config?.image) throw badRequest('图片模型能力配置无效，无法校验价格档规格');
    const image = config.image;
    if (image.parameters) {
      for (const tier of tiers) {
        validateImageParameterPriceSelector(image.parameters, tier.selector);
      }
      return;
    }
    normalizeLegacyImageResolutionConfig(protocol, image);
    for (const tier of tiers) {
      const resolution = String(tier.selector.imageResolution ?? '').trim();
      if (resolution && resolution !== '*') {
        if (!image.resolution.supported) throw badRequest('价格档使用了未启用的图片分辨率条件');
        if (!containsCapabilityString(image.resolution.values, resolution)) {
          throw badRequest(`价格档分辨率不在该图片模型支持范围内：${resolution}`);
        }
      }
      const quality = String(tier.selector.quality ?? '').trim();
      if (quality && quality !== '*') {
        if (image.quality.supported) {
          if (!containsCapabilityString(image.quality.values, quality)) {
            throw badRequest(`价格档质量不在该图片模型支持范围内：${quality}`);
          }
        } else if (
          !legacyImageResolutionProtocol(protocol) ||
          !image.resolution.supported ||
          !containsCapabilityString(image.resolution.values, quality)
        ) {
          throw badRequest('价格档使用了未启用的图片质量条件');
        }
      }
    }
    return;
  }

  if (capability !== 'video') return;
  if (!config?.video) throw badRequest('视频模型能力配置无效，无法校验价格档规格');
  const video = config.video;
  const resolutionSupported = new Set<string>();
  for (const resolution of video.resolutions) resolutionSupported.add(normalizeTierResolution(resolution));
  for (const resolution of video.fixedScreenSpec?.resolutions ?? []) {
    resolutionSupported.add(normalizeTierResolution(resolution));
  }
  const durationSupported = new Set(video.duration.values ?? []);
  for (const tier of tiers) {
    if (tier.resolution !== '*' && !resolutionSupported.has(normalizeTierResolution(tier.resolution))) {
      throw badRequest(`价格档分辨率不在该视频模型支持范围内：${tier.resolution}`);
    }
    if (!tier.videoSeconds) continue;
    if (!videoDurationSupported(video)) continue;
    if (video.duration.selection === 'enum' && !durationSupported.has(tier.videoSeconds)) {
      throw badRequest(`价格档时长 ${tier.videoSeconds} 秒不在该视频模型支持范围内`);
    }
    if (video.duration.selection === 'range') {
      const min = video.duration.min ?? 0;
      const max = video.duration.max ?? 0;
      const step = video.duration.step ?? 0;
      if (tier.videoSeconds < min || tier.videoSeconds > max || (step > 0 && (tier.videoSeconds - min) % step !== 0)) {
        throw badRequest(`价格档时长 ${tier.videoSeconds} 秒不在该视频模型支持范围内`);
      }
    }
  }
}

/* ───────────────────────── 保存期：计价校验 ───────────────────────── */

export function validateTokenPrices(
  capability: string,
  inputPrice: number,
  outputPrice: number,
  cachedPrice: number,
): void {
  if (inputPrice < 0 || outputPrice < 0 || cachedPrice < 0) {
    throw badRequest('模型积分价格不能小于 0');
  }
  if (capability === 'video' && (inputPrice !== 0 || cachedPrice !== 0)) {
    throw badRequest('视频 Token 仅按视频用量计费，输入和缓存 Token 价格必须为 0');
  }
  if (
    inputPrice > MAX_TOKEN_PRICE_MICROCREDITS ||
    outputPrice > MAX_TOKEN_PRICE_MICROCREDITS ||
    cachedPrice > MAX_TOKEN_PRICE_MICROCREDITS
  ) {
    throw badRequest('Token 每百万用量价格不能超过 1,000,000 积分');
  }
}

export interface CreditCostPricingInput extends TierPricingInput {
  /** 成本价是否已填写（全 0 且未勾选 = 未配置，跳过 Token 组合校验） */
  configured: boolean;
}

/** 成本价校验：仅管理员可见，与售价分开，未配置时不校验 Token 组合 */
export function validateCreditCostPricing(
  capability: string,
  billingMode: string,
  cost: CreditCostPricingInput,
): void {
  for (const price of [
    cost.unitPriceMicrocredits,
    cost.inputTokenPriceMicrocredits,
    cost.outputTokenPriceMicrocredits,
    cost.cachedTokenPriceMicrocredits,
  ]) {
    if (price < 0 || price > MAX_CREDIT_COST_MICROCREDITS) {
      throw badRequest('积分成本价必须在 0 到 1000000 积分之间');
    }
  }
  if (!cost.configured) return;
  const scope = billingMode === 'token' ? capability : '';
  validateTokenPrices(scope, cost.inputTokenPriceMicrocredits, cost.outputTokenPriceMicrocredits, cost.cachedTokenPriceMicrocredits);
}

/** 校验价格档售价：计费方式、单价非负、Token 价格组合 */
export function validateChannelModelTierPricing(
  capability: string,
  billingMode: string,
  prices: TierPricingInput,
  cost?: CreditCostPricingInput,
): void {
  if (cost) validateCreditCostPricing(capability, billingMode, cost);
  if (!['fixed_request', 'per_second', 'token'].includes(billingMode)) {
    throw badRequest('模型计费方式仅支持按次、按秒或 Token');
  }
  if (billingMode === 'per_second' && capability !== 'video' && capability !== 'audio') {
    throw badRequest('只有视频或音频模型可以按秒计费');
  }
  if (billingMode === 'token' && !supportsTokenBilling(capability)) {
    throw badRequest('Token 计费仅支持文本和视频模型');
  }
  if (
    prices.unitPriceMicrocredits < 0 ||
    prices.inputTokenPriceMicrocredits < 0 ||
    prices.outputTokenPriceMicrocredits < 0 ||
    prices.cachedTokenPriceMicrocredits < 0
  ) {
    throw badRequest('模型积分价格不能小于 0');
  }
  if (billingMode === 'token') {
    validateTokenPrices(
      capability,
      prices.inputTokenPriceMicrocredits,
      prices.outputTokenPriceMicrocredits,
      prices.cachedTokenPriceMicrocredits,
    );
    return;
  }
  validateTokenPrices('', prices.inputTokenPriceMicrocredits, prices.outputTokenPriceMicrocredits, prices.cachedTokenPriceMicrocredits);
}

export function supportsTokenBilling(capability: string): boolean {
  return capability === 'text' || capability === 'video';
}

/** 按计费方式判断价格是否已配置（价格全 0 视为「免费且有效」） */
export function validateChannelModelPrice(billingMode: string, prices: TierPricingInput): boolean {
  switch (billingMode) {
    case 'fixed_request':
    case 'per_second':
      return prices.unitPriceMicrocredits >= 0;
    case 'token': {
      try {
        validateTokenPrices(
          '',
          prices.inputTokenPriceMicrocredits,
          prices.outputTokenPriceMicrocredits,
          prices.cachedTokenPriceMicrocredits,
        );
        return true;
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/* ───────────────────────── 档位摘要回填 ───────────────────────── */

export interface TierSummarySource {
  enabled: boolean;
  priceConfigured: boolean;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  resolution?: string;
  videoSeconds?: number;
}

/** 回填到渠道模型行上的价格摘要字段（与后台列表 / 目录展示同口径） */
export interface TierSummaryFields {
  priceConfigured: boolean;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
}

/**
 * 把价格档汇总回渠道模型行（后台列表与目录展示用）。
 * 汇总档优先取「通配规格」那一档（resolution='*' 且 videoSeconds=0）。
 */
export function applyChannelModelPriceTierSummary<T extends TierSummaryFields>(
  item: T,
  tiers: TierSummarySource[],
): T {
  item.priceConfigured = false;
  item.billingMode = 'fixed_request';
  item.unitPriceMicrocredits = 0;
  item.inputTokenPriceMicrocredits = 0;
  item.outputTokenPriceMicrocredits = 0;
  item.cachedTokenPriceMicrocredits = 0;
  let summary: TierSummarySource | null = null;
  for (const tier of tiers) {
    if (tier.enabled && tier.priceConfigured) item.priceConfigured = true;
    if (!summary || ((tier.resolution ?? '*') === '*' && (tier.videoSeconds ?? 0) === 0)) {
      summary = tier;
    }
  }
  if (!summary) return item;
  item.billingMode = summary.billingMode;
  item.unitPriceMicrocredits = summary.unitPriceMicrocredits;
  item.inputTokenPriceMicrocredits = summary.inputTokenPriceMicrocredits;
  item.outputTokenPriceMicrocredits = summary.outputTokenPriceMicrocredits;
  item.cachedTokenPriceMicrocredits = summary.cachedTokenPriceMicrocredits;
  return item;
}

/* ───────────────────────── 运行期：档位匹配 ───────────────────────── */

/** 把一行价格档还原成选择器（空选择器回落到 resolution / videoSeconds 列） */
export function skuSelectorForTier(tier: TierSummarySource & { selector?: SkuSelector; selectorJson?: string }): SkuSelector {
  const selector: SkuSelector = tier.selector
    ? { ...tier.selector }
    : decodeSkuSelector(tier.selectorJson);
  const quality = String(selector.quality ?? '').trim().toLowerCase();
  if (isImageResolutionTier(quality) && !String(selector.resolution ?? '').trim()) {
    selector.resolution = quality;
    delete selector.quality;
  }
  if (Object.keys(selector).length === 0) {
    const resolution = normalizeTierResolution(tier.resolution);
    if (resolution !== '*') selector.vquality = resolution;
    if ((tier.videoSeconds ?? 0) > 0) selector.videoSeconds = String(tier.videoSeconds);
  }
  return selector;
}

/**
 * 「精确规格优先、通配兜底」匹配。
 * 1.5K 请求在只配了 1K / 2K 档时按相邻档命中，保证旧定价继续可用。
 */
export function matchSkuSelector(tier: SkuSelector, requested: SkuSelector): { matched: boolean; score: number } {
  let score = 0;
  for (const [key, rawExpected] of Object.entries(tier)) {
    const expected = String(rawExpected ?? '').trim();
    if (!expected || expected === '*') continue;
    const actual = String(requested[key] ?? '');
    if (actual !== expected) {
      const adjacent =
        (key === 'quality' || key === 'resolution' || key === 'imageResolution') &&
        actual.trim().toLowerCase() === '1.5k' &&
        (expected === '2k' || expected === '1k');
      if (!adjacent) return { matched: false, score: 0 };
      continue;
    }
    score += 1;
  }
  return { matched: true, score };
}

/** 选出最高分的启用档；没有则返回 null */
export function pickPriceTier<T extends TierSummarySource & { selector?: SkuSelector; selectorJson?: string }>(
  tiers: T[],
  requested: SkuSelector,
  imageParameters?: ImageParameter[] | null,
): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const tier of tiers) {
    if (!tier.enabled || !tier.priceConfigured) continue;
    const tierSelector = imageParameters ? (tier.selector ?? decodeSkuSelector(tier.selectorJson)) : skuSelectorForTier(tier);
    if (imageParameters) {
      try {
        validateImageParameterPriceSelector(imageParameters, tierSelector);
      } catch {
        continue;
      }
    }
    const result = matchSkuSelector(tierSelector, requested);
    if (!result.matched) continue;
    if (result.score > bestScore) {
      best = tier;
      bestScore = result.score;
    }
  }
  return best;
}

/** 目录发现用：只要给定条件与某个启用档兼容即可 */
export function hasCompatiblePriceTier<T extends TierSummarySource & { selector?: SkuSelector; selectorJson?: string }>(
  tiers: T[],
  requested: SkuSelector,
  imageParameters?: ImageParameter[] | null,
): boolean {
  for (const tier of tiers) {
    if (!tier.enabled || !tier.priceConfigured) continue;
    const tierSelector = imageParameters ? (tier.selector ?? decodeSkuSelector(tier.selectorJson)) : skuSelectorForTier(tier);
    if (imageParameters) {
      try {
        validateImageParameterPriceSelector(imageParameters, tierSelector);
      } catch {
        continue;
      }
    }
    let compatible = true;
    for (const [key, rawExpected] of Object.entries(tierSelector)) {
      const expected = String(rawExpected ?? '').trim();
      if (!expected || expected === '*') continue;
      const actual = requested[key];
      if (actual !== undefined && actual !== expected) {
        compatible = false;
        break;
      }
    }
    if (compatible) return true;
  }
  return false;
}

/** 图片参数合同的定价选择器（参数名 → 请求值），跳过非 pricing 参数 */
export function imagePriceSelectorForParameters(
  parameters: ImageParameter[],
  options: Record<string, unknown>,
): SkuSelector {
  const selector: SkuSelector = {};
  for (const parameter of parameters) {
    if (!(parameter.enabled === undefined || parameter.enabled === null || parameter.enabled === true)) continue;
    if (!parameter.pricing) continue;
    const value = options[parameter.name];
    if (value === undefined || value === null || value === '') continue;
    selector[parameter.name] = String(value);
  }
  return selector;
}
