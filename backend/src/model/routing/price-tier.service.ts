/**
 * 价格档匹配：请求意图 → SKU 选择器 → 命中档。
 *
 * 移植自 open-ai-canvas `model_router.go` 的 `channelModelPriceTierForIntent` /
 * `channelModelHasCompatiblePriceTier`。匹配规则（精确优先、通配兜底、
 * 1.5K 相邻档）在 `domain/selector.ts` 已实现，这里只负责把意图投影成选择器。
 *
 * 图片模型一旦声明了参数合同，选择器**只认 pricing 参数**：
 * 用旧的 quality/resolution/size 去匹配参数合同的价格档，会命中到错误档
 * （或永远命中通配档），这是「后台改了参数价、前台没变」的常见成因。
 */

import { Injectable } from '@nestjs/common';
import {
  hasCompatiblePriceTier,
  imagePriceSelectorForParameters,
  pickPriceTier,
  type SkuSelector,
} from '../domain/selector';
import { skuSelectorForIntent } from '../intent/model-intent';
import type { ModelRequestIntent } from '../intent/spec-types';
import type { CachedChannelModel, CachedPriceTier } from './routing.types';

/** 该线路当前是否配置了任意启用且已配置价格的档位 */
export function hasActivePriceTier(channelModel: CachedChannelModel): boolean {
  return channelModel.priceTiers.some((tier) => tier.enabled && tier.priceConfigured);
}

@Injectable()
export class PriceTierService {
  /**
   * 意图 → 选择器。图片参数合同存在时只取 pricing 参数（并补 operation），
   * 其余能力走通用投影。
   */
  requestedSelector(channelModel: CachedChannelModel, intent: ModelRequestIntent): SkuSelector {
    const parameters = channelModel.capabilitySpec.imageParameters;
    if (!parameters) return skuSelectorForIntent(intent);
    const selector: SkuSelector = {
      operation: (intent.inputs?.image ?? 0) > 0 ? 'image_to_image' : 'text_to_image',
      ...imagePriceSelectorForParameters(parameters, intent.options ?? {}),
    };
    return selector;
  }

  /** 命中「精确规格优先、通配兜底」的启用档；没有返回 null */
  tierForIntent(channelModel: CachedChannelModel, intent: ModelRequestIntent): CachedPriceTier | null {
    const requested = this.requestedSelector(channelModel, intent);
    const parameters = channelModel.capabilitySpec.imageParameters ?? null;
    return pickPriceTier(channelModel.priceTiers, requested, parameters);
  }

  /**
   * 目录发现用：只要求「已提供的选择器值与某个启用档兼容」。
   * 未提供的维度仍是一组可选值，不能据此判定不可用。
   */
  hasCompatibleTier(channelModel: CachedChannelModel, intent: ModelRequestIntent): boolean {
    const requested = this.requestedSelector(channelModel, intent);
    const parameters = channelModel.capabilitySpec.imageParameters ?? null;
    return hasCompatiblePriceTier(channelModel.priceTiers, requested, parameters);
  }
}
