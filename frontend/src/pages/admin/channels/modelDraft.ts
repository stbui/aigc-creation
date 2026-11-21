import { parseCredits, toCreditsInput } from '../../../lib/microcredits';

import {
  EMPTY_DEFAULT_MODEL_DRAFT,
  EMPTY_TIER,
  type ChannelDraft,
  type DefaultModelDraft,
  type ModelDraft,
  type TierDraft,
} from './constants';
import { formatSelector, hasNonZeroCredit, parseSelector, priceOf } from './selectors';
import { createDefaultTextCapabilityConfigJson } from './textCapability';
import type { AdminChannelModelView, AdminChannelView, ChannelModelPriceTierView } from './types';

/** 渠道实体 → 表单草稿；凭证不回读，留空表示不修改 */
export function toChannelDraft(channel: AdminChannelView): ChannelDraft {
  const defaults = channel.defaultModel;
  return {
    name: channel.name,
    baseUrl: channel.baseUrl,
    apiKey: '',
    secretKey: '',
    proxyUrl: channel.proxyUrl,
    // 并发 0 表示跟随全局上限
    useGlobalConcurrency: channel.concurrencyLimit === 0,
    concurrencyLimit: String(channel.concurrencyLimit || 8),
    enabled: channel.enabled,
    sortOrder: String(channel.sortOrder ?? 0),
    headers: channel.headers ?? [],
    defaultModel: defaults
      ? {
          capability: defaults.capability,
          protocol: defaults.protocol,
          billingMode: defaults.billingMode,
          unit: toCreditsInput(defaults.unitPriceMicrocredits),
          input: toCreditsInput(defaults.inputTokenPriceMicrocredits),
          output: toCreditsInput(defaults.outputTokenPriceMicrocredits),
          cached: toCreditsInput(defaults.cachedTokenPriceMicrocredits),
          enabled: defaults.enabled,
        }
      : { ...EMPTY_DEFAULT_MODEL_DRAFT },
  };
}

/**
 * 默认商品配置草稿 → 接口载荷。
 *
 * 未选类型 = 显式清空（保存 `null`）。选了类型就必须有接入方式与售价：
 * 半份默认配置会让导入出来的商品看似可用、实际缺价，比不配更难排查。
 */
export function buildDefaultModelPayload(
  draft: DefaultModelDraft,
): { value: Record<string, unknown> | null } | { error: string } {
  if (!draft.capability) return { value: null };
  if (!draft.protocol) return { error: '默认商品配置：请选择接入方式' };
  const unit = parseCredits(draft.unit);
  const input = parseCredits(draft.input);
  const output = parseCredits(draft.output);
  const cached = parseCredits(draft.cached);
  if ([unit, input, output, cached].some((value) => value === null)) {
    return { error: '默认商品售价必须是数字，最多 6 位小数' };
  }
  if (draft.billingMode === 'token' && !draft.output.trim()) {
    return { error: '默认商品配置：请填写输出 Token 价格' };
  }
  if (draft.billingMode !== 'token' && !draft.unit.trim()) {
    return { error: '默认商品配置：请填写售价' };
  }
  return {
    value: {
      capability: draft.capability,
      protocol: draft.protocol,
      billingMode: draft.billingMode,
      unitPriceMicrocredits: unit ?? 0,
      inputTokenPriceMicrocredits: input ?? 0,
      outputTokenPriceMicrocredits: output ?? 0,
      cachedTokenPriceMicrocredits: cached ?? 0,
      enabled: draft.enabled,
    },
  };
}

export function tierToDraft(tier: ChannelModelPriceTierView): TierDraft {
  return {
    selector: formatSelector(tier.selector),
    resolution: tier.resolution || '*',
    videoSeconds: String(tier.videoSeconds ?? 0),
    providerModelKey: tier.providerModelKey,
    billingMode: tier.billingMode,
    unit: toCreditsInput(tier.unitPriceMicrocredits),
    input: toCreditsInput(tier.inputTokenPriceMicrocredits),
    output: toCreditsInput(tier.outputTokenPriceMicrocredits),
    cached: toCreditsInput(tier.cachedTokenPriceMicrocredits),
    costConfigured: tier.costPricing?.configured ?? false,
    costUnit: toCreditsInput(tier.costPricing?.unitPriceMicrocredits ?? 0),
    costInput: toCreditsInput(tier.costPricing?.inputTokenPriceMicrocredits ?? 0),
    costOutput: toCreditsInput(tier.costPricing?.outputTokenPriceMicrocredits ?? 0),
    costCached: toCreditsInput(tier.costPricing?.cachedTokenPriceMicrocredits ?? 0),
    priceConfigured: tier.priceConfigured,
    enabled: tier.enabled,
  };
}

/**
 * 价格档的前端硬校验（与后端 `validateChannelModelTierPricing` 同口径）。
 *
 * 后端会兜住，但只在保存时报错。运营填完一整屏再被拒是浪费；
 * 这里在提交前先拦下最常见的三类问题：
 *   1. 多个「通配规格」（selector 为空）默认档 —— 选价时不知道命中哪个；
 *   2. 计费方式与产出能力不匹配（图片按秒、图像按 Token）；
 *   3. Token 计费缺输出价（必然报 0 价）。
 */
export function validateModelTiers(
  capability: string,
  tiers: Array<{ selector: string; billingMode: string; enabled: boolean; output: string }>,
): string | null {
  const active = tiers.filter((tier) => tier.enabled);
  if (active.length === 0) return '至少保留一个启用的售价方案';

  const wildcards = active.filter((tier) => tier.selector.trim() === '');
  if (wildcards.length > 1) {
    return '只能有一个默认适用规格：其余方案请填写适用规格';
  }

  for (const tier of active) {
    const mode = tier.billingMode;
    if (mode === 'per_second' && capability !== 'video' && capability !== 'audio') {
      return '按时长计价仅适用于视频或音频模型';
    }
    if (mode === 'token') {
      if (capability !== 'text') {
        return '按用量计价目前仅适用于文本模型';
      }
      if (!tier.output || tier.output.trim() === '0') {
        return '按用量计价必须填写输出用量价格';
      }
    }
  }
  return null;
}

/** 价格档提交体：金额已从「积分」换算为微积分 */
export interface PriceTierPayload {
  selector: Record<string, string>;
  resolution: string;
  videoSeconds: number;
  providerModelKey: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  priceConfigured: boolean;
  enabled: boolean;
  costPricing: {
    configured: boolean;
    unitPriceMicrocredits: number;
    inputTokenPriceMicrocredits: number;
    outputTokenPriceMicrocredits: number;
    cachedTokenPriceMicrocredits: number;
  } | null;
}

/**
 * 草稿里的价格档 → 提交体。
 *
 * 校验与换算放在一处：先过 `validateModelTiers`（计费方式 / 通配档），
 * 再逐档换算微积分。任一价格格式错误都把文案原样返回，由页面提示。
 */
export function buildPriceTiers(
  draft: ModelDraft,
): { error: string } | { tiers: PriceTierPayload[] } {
  const tierError = validateModelTiers(draft.capability, draft.tiers);
  if (tierError) return { error: tierError };

  const modelKey = draft.modelKey.trim();
  try {
    const tiers = draft.tiers
      .filter((tier) => tier.enabled || tier.unit !== '0' || tier.output !== '0')
      .map((tier) => {
        /*
         * 填了非零售价即视为已定价，不再要求额外勾“价格已核对”。
         * 0 积分免费商品由高级区的「按 0 积分免费提供」显式声明；
         * 这样漏勾只会让免费商品保持未定价，不会让正常售价静默失效。
         */
        const priceConfigured =
          tier.priceConfigured ||
          hasNonZeroCredit(tier.unit) ||
          hasNonZeroCredit(tier.input) ||
          hasNonZeroCredit(tier.output) ||
          hasNonZeroCredit(tier.cached);
        const costConfigured =
          tier.costConfigured ||
          hasNonZeroCredit(tier.costUnit) ||
          hasNonZeroCredit(tier.costInput) ||
          hasNonZeroCredit(tier.costOutput) ||
          hasNonZeroCredit(tier.costCached);
        return {
          selector: parseSelector(tier.selector),
          resolution: tier.resolution.trim() || '*',
          videoSeconds: Number(tier.videoSeconds) || 0,
          providerModelKey: tier.providerModelKey.trim() || draft.providerModelKey.trim() || modelKey,
          billingMode: tier.billingMode,
          unitPriceMicrocredits: priceOf(tier.unit, '价格'),
          inputTokenPriceMicrocredits: priceOf(tier.input, '输入用量价格'),
          outputTokenPriceMicrocredits: priceOf(tier.output, '输出用量价格'),
          cachedTokenPriceMicrocredits: priceOf(tier.cached, '缓存内容价格'),
          priceConfigured,
          enabled: tier.enabled,
          costPricing: costConfigured
            ? {
                configured: true,
                unitPriceMicrocredits: priceOf(tier.costUnit, '成本单价'),
                inputTokenPriceMicrocredits: priceOf(tier.costInput, '输入用量成本'),
                outputTokenPriceMicrocredits: priceOf(tier.costOutput, '输出用量成本'),
                cachedTokenPriceMicrocredits: priceOf(tier.costCached, '缓存内容成本'),
              }
            : null,
        };
      });
    return { tiers };
  } catch (e) {
    return { error: e instanceof Error ? e.message : '价格格式不正确' };
  }
}

/** 渠道模型实体 → 表单草稿；没有价格档时给一条继承上游键的通配档 */
export function toModelDraft(model: AdminChannelModelView): ModelDraft {
  return {
    modelKey: model.modelKey,
    modelGroupKey: model.modelGroupKey ?? '',
    providerModelKey: model.providerModelKey,
    displayName: model.displayName,
    channelLabel: model.channelLabel,
    description: model.description,
    icon: model.icon,
    capability: model.capability || 'image',
    protocol: model.protocol,
    priceCurrency: model.priceCurrency || 'credits',
    tags: (model.tags ?? []).map((tag) => ({ text: tag.text, color: tag.color })),
    capabilityConfig: model.capabilityConfig
      ? JSON.stringify(model.capabilityConfig, null, 2)
      : model.capability === 'text'
        ? createDefaultTextCapabilityConfigJson()
        : '',
    enabled: model.enabled,
    tiers:
      model.priceTiers.length > 0
        ? model.priceTiers.map(tierToDraft)
        : [{ ...EMPTY_TIER, providerModelKey: model.providerModelKey }],
  };
}

/**
 * 档位仍指向旧上游模型 key 的档位。
 *
 * 模型级上游键改名后，档位级的 `providerModelKey` 不会自动跟随 ——
 * 请求仍会发到旧的上游 SKU。用户表现为「改了上游却不生效」，且界面
 * 没有任何提示。参考实现（open-ai-canvas `channel-model-price-tier-fields.tsx`）
 * 会算出这批档位并给出「清除并跟随模型」的入口。
 *
 * 只有「档位上游键 == 旧模型上游键」这种**隐式跟随**才算过时；
 * 管理员显式配的其它上游 SKU 不受影响。
 */
export function staleTierUpstream(
  draft: ModelDraft,
  previousProviderModelKey: string,
): number[] {
  const previous = previousProviderModelKey.trim();
  if (!previous) return [];
  const current = draft.providerModelKey.trim();
  if (!current || current === previous) return [];
  return draft.tiers
    .map((tier, index) => (tier.providerModelKey.trim() === previous ? index : -1))
    .filter((index) => index >= 0);
}

/** 把这批档位的上游键清空，改回「跟随模型默认」 */
export function clearStaleTierUpstream(draft: ModelDraft, indexes: number[]): ModelDraft {
  return {
    ...draft,
    tiers: draft.tiers.map((tier, index) =>
      indexes.includes(index) ? { ...tier, providerModelKey: '' } : tier,
    ),
  };
}
