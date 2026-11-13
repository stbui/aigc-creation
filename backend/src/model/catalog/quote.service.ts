/**
 * 能力报价：不建任务、不扣费，只回答「这组参数现在要多少积分」。
 *
 * 售价在能力级：报价与建任务共用 `CapabilityPricing`、分组倍率与货币换算，
 * 切换线路不改价。Token 计费按请求估算，标记 `estimated: true`。
 */

import { Injectable } from '@nestjs/common';
import { CreditPriceService } from '../../credits/credit-price.service';
import { badRequest } from '../domain/json';
import { getCapability } from '../../capabilities/capability.registry';
import { normalizeCapability } from '../domain/capability-config';
import { creditAmount, convertCurrencyPrice, tokenAmount } from '../infra/microcredits';
import { RouterService } from '../routing/router.service';
import { CapabilityCatalogService } from './capability-catalog.service';
import { PriceTierService } from '../routing/price-tier.service';
import type { UserGroupAccess } from '../user-groups/user-group.service';
import type { ModelRequestIntent } from '../intent/spec-types';

export interface CapabilityQuote {
  capabilityId: string;
  modelKey: string;
  billingMode: string;
  quantity: number;
  amountMicrocredits: number | null;
  estimated: boolean;
  note: string;
}

const MAX_OUTPUT_TOKENS = 131_072;
const DEFAULT_OUTPUT_TOKENS = 4_096;

/** 报价意图校验：能力白名单与参考素材上限 */
export function validateQuoteIntent(intent: ModelRequestIntent): void {
  const capability = normalizeCapability(intent.capability);
  if (!['text', 'image', 'video', 'audio'].includes(capability)) {
    throw badRequest('报价请求缺少有效的模型能力类型');
  }
  for (const count of Object.values(intent.inputs ?? {})) {
    if (!Number.isInteger(count) || count < 0 || count > 128) {
      throw badRequest('报价参考素材数量必须为 0 到 128 的整数');
    }
  }
}

/** 预授权数量：按请求参数推导的计费单位数。 */
export function requestedBillingQuantity(capability: string, options: Record<string, unknown> | undefined): number {
  const kind = normalizeCapability(capability);
  const seconds = Math.trunc(Number(options?.videoSeconds ?? 0));
  if (kind === 'video') return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  if (kind === 'audio') {
    const audioSeconds = Math.trunc(Number(options?.audioSeconds ?? 0));
    if (Number.isFinite(audioSeconds) && audioSeconds > 0) return audioSeconds;
    return 1;
  }
  return 1;
}

/** 文本 Token 估算：字符数 / 4，输出取 max_tokens 类参数并限幅 */
export function estimateTextTokens(intent: ModelRequestIntent): { inputTokens: number; outputTokens: number } {
  const payload = JSON.stringify(intent ?? {});
  const inputTokens = Math.max(1, Math.ceil([...payload].length / 4));
  const option = intent.options ?? {};
  const raw = option.maxOutputTokens ?? option.max_output_tokens ?? option.max_tokens;
  const parsed = Number(raw);
  const outputTokens =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(MAX_OUTPUT_TOKENS, Math.trunc(parsed))
      : DEFAULT_OUTPUT_TOKENS;
  return { inputTokens, outputTokens };
}

@Injectable()
export class QuoteService {
  constructor(
    private readonly router: RouterService,
    private readonly catalog: CapabilityCatalogService,
    private readonly price: CreditPriceService,
    private readonly priceTiers: PriceTierService,
  ) {}

  /**
   * 供应视角报价（`/model-catalog/quote`）：按渠道价格档报价。
   *
   * 这是公开渠道目录的只读报价，不参与生成任务扣费；生成链路一律走
   * `quoteCapability` 的能力级售价。保留它是因为 `/model-catalog*` 仍在
   * 对外提供供应视角目录，报价口径必须与目录展示的档位一致。
   */
  async quoteChannelModel(
    access: UserGroupAccess,
    channelModel: import('../routing/routing.types').CachedChannelModel,
    intent: ModelRequestIntent,
  ): Promise<CapabilityQuote> {
    validateQuoteIntent(intent);
    const tier = this.priceTiers.tierForIntent(channelModel, intent);
    if (!tier) throw badRequest('当前模型尚未配置所选规格的价格');
    const pricing = access.pricing(channelModel.priceCurrency, [channelModel.modelKey]);
    const bps = pricing.multiplierBasisPoints;
    const unit = convertCurrencyPrice(tier.unitPriceMicrocredits, pricing.rateMicrocredits);
    const inputPrice = convertCurrencyPrice(tier.inputTokenPriceMicrocredits, pricing.rateMicrocredits);
    const outputPrice = convertCurrencyPrice(tier.outputTokenPriceMicrocredits, pricing.rateMicrocredits);
    const cachedPrice = convertCurrencyPrice(tier.cachedTokenPriceMicrocredits, pricing.rateMicrocredits);
    if (tier.billingMode === 'token') {
      const usage = estimateTextTokens(intent);
      return {
        capabilityId: '',
        modelKey: channelModel.modelKey,
        billingMode: 'token',
        quantity: usage.inputTokens + usage.outputTokens,
        amountMicrocredits: Number(
          tokenAmount(
            {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cachedTokens: 0,
              inputTokenPriceMicrocredits: inputPrice,
              outputTokenPriceMicrocredits: outputPrice,
              cachedTokenPriceMicrocredits: cachedPrice,
            },
            bps,
          ),
        ),
        estimated: true,
        note: '按估算用量计价，结算以上游用量为准',
      };
    }
    const quantity = tier.billingMode === 'per_second' ? requestedBillingQuantity(intent.capability, intent.options) : 1;
    if (quantity <= 0) throw badRequest('请求未提供有效时长');
    return {
      capabilityId: '',
      modelKey: channelModel.modelKey,
      billingMode: tier.billingMode,
      quantity,
      amountMicrocredits: Number(creditAmount(unit, quantity, bps)),
      estimated: false,
      note: '',
    };
  }

  async quoteCapability(
    access: UserGroupAccess,
    capabilityId: string,
    modelKey: string,
    intent: ModelRequestIntent,
    userId?: string,
  ): Promise<CapabilityQuote> {
    const definition = getCapability(String(capabilityId ?? '').trim());
    if (!definition) throw badRequest('所选模型不可用', 40005);
    const capabilityIntent: ModelRequestIntent = {
      ...intent,
      capability: normalizeCapability(definition.model.capability),
    };
    validateQuoteIntent(capabilityIntent);
    const capability = await this.catalog.findCapability(capabilityId);
    if (!capability) throw badRequest('所选模型不可用', 40005);
    if (!capability.pricing.configured) throw badRequest('当前能力尚未配置售价');
    if (modelKey && !capability.groups.has(modelKey)) throw badRequest('所选模型不可用', 40005);

    // 报价是估算：未带输入数量时按分组合同的最小输入补齐，避免所有需要上传图片的工具都报价失败
    const groupKey = modelKey || capability.orderedGroupKeys[0] || '';
    const group = capability.groups.get(groupKey);
    if (!group) throw badRequest('当前能力没有可用模型', 40005);
    const quoteIntent = this.withMinimumInputs(group.lines[0]?.channelModel.capabilitySpec, capabilityIntent);
    const routed = await this.router.resolve(access, capabilityId, groupKey, quoteIntent);
    const pricing = routed.pricing;

    const freeCampaignId = await this.price.freeCampaignIdOf(capabilityId, userId);
    if (freeCampaignId) {
      return {
        capabilityId,
        modelKey: groupKey,
        billingMode: pricing.billingMode,
        quantity: requestedBillingQuantity(capabilityIntent.capability, capabilityIntent.options),
        amountMicrocredits: 0,
        estimated: false,
        note: '限时免费',
      };
    }

    const groupPricing = access.pricing('credits', [capabilityId]);
    const bps = groupPricing.multiplierBasisPoints;

    if (pricing.billingMode === 'fixed_request') {
      const amount = Number(creditAmount(pricing.unitPriceMicrocredits, 1, bps));
      return {
        capabilityId,
        modelKey: groupKey,
        billingMode: pricing.billingMode,
        quantity: 1,
        amountMicrocredits: amount,
        estimated: false,
        note: '',
      };
    }

    if (pricing.billingMode === 'per_second') {
      const quantity = requestedBillingQuantity(capabilityIntent.capability, capabilityIntent.options);
      if (quantity <= 0) {
        return {
          capabilityId,
          modelKey: groupKey,
          billingMode: pricing.billingMode,
          quantity: 0,
          amountMicrocredits: null,
          estimated: true,
          note: '请求未提供有效时长',
        };
      }
      return {
        capabilityId,
        modelKey: groupKey,
        billingMode: pricing.billingMode,
        quantity,
        amountMicrocredits: Number(creditAmount(pricing.unitPriceMicrocredits, quantity, bps)),
        estimated: false,
        note: '',
      };
    }

    if (pricing.billingMode === 'token') {
      if (normalizeCapability(capabilityIntent.capability) !== 'text') {
        return {
          capabilityId,
          modelKey: groupKey,
          billingMode: pricing.billingMode,
          quantity: 0,
          amountMicrocredits: null,
          estimated: true,
          note: '该能力暂不支持 Token 报价',
        };
      }
      const usage = estimateTextTokens(capabilityIntent);
      const amount = Number(
        tokenAmount(
          {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedTokens: 0,
            inputTokenPriceMicrocredits: pricing.inputTokenPriceMicrocredits,
            outputTokenPriceMicrocredits: pricing.outputTokenPriceMicrocredits,
            cachedTokenPriceMicrocredits: pricing.cachedTokenPriceMicrocredits,
          },
          bps,
        ),
      );
      return {
        capabilityId,
        modelKey: groupKey,
        billingMode: pricing.billingMode,
        quantity: usage.inputTokens + usage.outputTokens,
        amountMicrocredits: amount,
        estimated: true,
        note: '按估算用量计价，结算以上游用量为准',
      };
    }

    throw badRequest('当前能力计费方式暂不支持');
  }

  private withMinimumInputs(
    spec: { inputs?: { image?: { min?: number; max?: number }; video?: { min?: number; max?: number } } } | undefined,
    intent: ModelRequestIntent,
  ): ModelRequestIntent {
    if (!spec?.inputs) return intent;
    const inputs = { ...(intent.inputs ?? {}) };
    for (const key of ['image', 'video'] as const) {
      const rule = spec.inputs[key];
      if (!rule) continue;
      const current = inputs[key];
      const min = Number(rule.min ?? 0);
      if (!Number.isFinite(current) || (current as number) < min) inputs[key] = min;
    }
    return { ...intent, inputs };
  }
}

/** 供应视角报价的形状与能力报价一致（public-model-catalog 的历史名称） */
export type ModelQuote = CapabilityQuote;
