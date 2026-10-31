/**
 * 前台模型报价：不建任务、不扣费，只回答「这组参数现在要多少积分」。
 *
 * 移植自 open-ai-canvas `logical_model_quote.go`。报价与任务创建**必须走同一套**
 * 解析（`RouterService.resolve`）、同一套价格档选择（`PriceTierService`）与
 * 同一套换算（货币 → 微积分 → 分组倍率），否则用户确认的价格与账单会对不上。
 *
 * Token 计费的边界（P3）：
 *   · 文本：按请求 JSON 长度估算输入 Token、按 `maxOutputTokens` 取输出 Token，
 *     报价标记 `estimated: true`；实际结算以 P4 的用量为准。
 *   · 视频：Token 用量取决于真实输出尺寸/帧率/参考素材时长，P3 不给金额
 *     （`amountMicrocredits: null`），避免给出一个会与账单明显不符的数字。
 */

import { Injectable } from '@nestjs/common';
import { badRequest } from '../domain/json';
import { normalizeCapability } from '../domain/capability-config';
import { creditAmount, convertCurrencyPrice, toSafeNumber, tokenAmount } from '../infra/microcredits';
import { PriceTierService } from '../routing/price-tier.service';
import { RouterService } from '../routing/router.service';
import type { CachedChannelModel, CachedPriceTier } from '../routing/routing.types';
import type { UserGroupAccess } from '../user-groups/user-group.service';
import type { ModelRequestIntent } from '../intent/spec-types';

export interface ModelQuote {
  logicalModelId: string;
  code: string;
  billingMode: string;
  quantity: number;
  amountMicrocredits: number | null;
  /** Token / 视频用量类报价尚未结算：金额按估算给出或暂不给出 */
  estimated: boolean;
  priceTierId: string;
  priceSelector: Record<string, string>;
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

/**
 * 预授权数量：按请求参数推导的计费单位数。
 * 视频/音频按时长；音频输出时长在请求时未知，最少按 1 秒预授权。
 */
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
    private readonly priceTiers: PriceTierService,
  ) {}

  async quoteLogicalModel(
    access: UserGroupAccess,
    logicalModelId: string,
    intent: ModelRequestIntent,
  ): Promise<ModelQuote> {
    validateQuoteIntent(intent);
    const routed = await this.router.resolve(access, logicalModelId, intent);
    const capability = normalizeCapability(routed.intent.capability);
    const modelKeys = [routed.logicalModel.code, routed.channelModel.modelKey];

    if (routed.logicalModel.pricePolicy === 'channel') {
      const tier = routed.priceTier;
      if (!tier) throw badRequest('当前模型尚未配置所选规格的价格');
      return this.channelTierQuote(access, {
        logicalModelId: routed.logicalModel.id,
        code: routed.logicalModel.code,
        modelKeys,
        channelModel: routed.channelModel,
        tier,
        intent: routed.intent,
        capability,
        forceToken: routed.logicalModel.billingMode === 'token',
      });
    }

    if (routed.logicalModel.pricePolicy !== 'unified') {
      throw badRequest('当前模型价格策略无效');
    }
    const pricing = access.pricing('credits', modelKeys);
    const model = routed.logicalModel;
    switch (model.billingMode) {
      case 'fixed_request': {
        const amount = toSafeNumber(creditAmount(model.unitPriceMicrocredits, 1, pricing.multiplierBasisPoints));
        return {
          logicalModelId: model.id,
          code: model.code,
          billingMode: model.billingMode,
          quantity: 1,
          amountMicrocredits: amount,
          estimated: false,
          priceTierId: '',
          priceSelector: {},
          note: amount > 0 ? '' : '当前模型尚未配置有效的用户价格',
        };
      }
      case 'per_second': {
        const quantity = requestedBillingQuantity(capability, routed.intent.options);
        if (quantity <= 0) throw badRequest('当前模型按时长计费，但请求未提供有效时长');
        const amount = toSafeNumber(creditAmount(model.unitPriceMicrocredits, quantity, pricing.multiplierBasisPoints));
        return {
          logicalModelId: model.id,
          code: model.code,
          billingMode: model.billingMode,
          quantity,
          amountMicrocredits: amount,
          estimated: false,
          priceTierId: '',
          priceSelector: {},
          note: '',
        };
      }
      case 'token':
        return this.tokenQuote(
          model.id,
          model.code,
          'token',
          capability,
          routed.intent,
          {
            input: model.inputPriceMicrocredits,
            output: model.outputPriceMicrocredits,
            cached: model.cachedPriceMicrocredits,
          },
          pricing.multiplierBasisPoints,
          '',
          {},
        );
      default:
        throw badRequest('当前模型计费方式暂不支持');
    }
  }

  /**
   * 渠道模型报价（`POST /model-catalog/quote`）：不经前台模型，直接按渠道模型选档。
   *
   * 渠道模型目录里没有前台模型，价格策略恒为「渠道价」；价格档选择、货币换算与
   * 倍率必须与建单（`BillingService.buildDraft`）走同一套，否则目录价与账单会分叉。
   */
  quoteChannelModel(
    access: UserGroupAccess,
    channelModel: CachedChannelModel,
    intent: ModelRequestIntent,
  ): ModelQuote {
    validateQuoteIntent(intent);
    const capability = normalizeCapability(channelModel.capability);
    if (normalizeCapability(intent.capability) !== capability) {
      throw badRequest('所选模型不支持该能力类型');
    }
    access.requireChannel(channelModel.channelId);
    const tier = this.priceTiers.tierForIntent(channelModel, intent);
    if (!tier) throw badRequest('当前模型尚未配置所选规格的价格');
    return this.channelTierQuote(access, {
      logicalModelId: '',
      code: channelModel.modelKey,
      modelKeys: [channelModel.modelKey],
      channelModel,
      tier,
      intent,
      capability,
      forceToken: false,
    });
  }

  /** 渠道价档报价：单一实现，前台模型报价与渠道模型报价都走这里 */
  private channelTierQuote(
    access: UserGroupAccess,
    input: {
      logicalModelId: string;
      code: string;
      modelKeys: string[];
      channelModel: CachedChannelModel;
      tier: CachedPriceTier;
      intent: ModelRequestIntent;
      capability: string;
      forceToken: boolean;
    },
  ): ModelQuote {
    const { tier } = input;
    const pricing = access.pricing(input.channelModel.priceCurrency, input.modelKeys);
    if (tier.billingMode === 'token' || input.forceToken) {
      return this.tokenQuote(
        input.logicalModelId,
        input.code,
        'token',
        input.capability,
        input.intent,
        {
          input: toSafeNumber(convertCurrencyPrice(tier.inputTokenPriceMicrocredits, pricing.rateMicrocredits)),
          output: toSafeNumber(convertCurrencyPrice(tier.outputTokenPriceMicrocredits, pricing.rateMicrocredits)),
          cached: toSafeNumber(convertCurrencyPrice(tier.cachedTokenPriceMicrocredits, pricing.rateMicrocredits)),
        },
        pricing.multiplierBasisPoints,
        tier.id,
        tier.selector,
      );
    }
    const quantity = requestedBillingQuantity(input.capability, input.intent.options);
    if (tier.billingMode === 'per_second' && quantity <= 0) {
      throw badRequest('当前模型按时长计费，但请求未提供有效时长');
    }
    const unit = toSafeNumber(convertCurrencyPrice(tier.unitPriceMicrocredits, pricing.rateMicrocredits));
    if (unit <= 0) throw badRequest('当前模型尚未配置所选规格的价格');
    const amount = toSafeNumber(
      creditAmount(unit, tier.billingMode === 'per_second' ? quantity : 1, pricing.multiplierBasisPoints),
    );
    return {
      logicalModelId: input.logicalModelId,
      code: input.code,
      billingMode: tier.billingMode,
      quantity: tier.billingMode === 'per_second' ? quantity : 1,
      amountMicrocredits: amount,
      estimated: false,
      priceTierId: tier.id,
      priceSelector: tier.selector,
      note: '',
    };
  }

  /** Token 报价：文本按估算给金额，视频等用量类给出 pending 说明 */
  private tokenQuote(
    logicalModelId: string,
    code: string,
    billingMode: string,
    capability: string,
    intent: ModelRequestIntent,
    prices: { input: number; output: number; cached: number },
    multiplierBasisPoints: bigint,
    priceTierId: string,
    priceSelector: Record<string, string>,
  ): ModelQuote {
    if (capability === 'video') {
      if (prices.input > 0 || prices.cached > 0) {
        throw badRequest('视频 Token 仅按视频用量定价，请将输入与缓存价格设为 0');
      }
      return {
        logicalModelId,
        code,
        billingMode,
        quantity: 0,
        amountMicrocredits: null,
        estimated: true,
        priceTierId,
        priceSelector,
        note: '视频 Token 用量取决于实际输出尺寸与时长，任务创建时按用量预留',
      };
    }
    if (capability !== 'text') {
      throw badRequest('当前供应线路不支持该能力的 Token 计费方式');
    }
    if (prices.output <= 0) throw badRequest('当前模型尚未配置输出 Token 价格');
    const estimate = estimateTextTokens(intent);
    const amount = toSafeNumber(
      tokenAmount(
        {
          inputTokens: estimate.inputTokens,
          outputTokens: estimate.outputTokens,
          inputTokenPriceMicrocredits: prices.input,
          outputTokenPriceMicrocredits: prices.output,
          cachedTokenPriceMicrocredits: prices.cached,
        },
        multiplierBasisPoints,
      ),
    );
    return {
      logicalModelId,
      code,
      billingMode,
      quantity: estimate.inputTokens + estimate.outputTokens,
      amountMicrocredits: amount,
      estimated: true,
      priceTierId,
      priceSelector,
      note: '按估算 Token 用量报价，实际结算以用量为准',
    };
  }
}
