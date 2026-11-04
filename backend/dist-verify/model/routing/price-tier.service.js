"use strict";
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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PriceTierService = void 0;
exports.hasActivePriceTier = hasActivePriceTier;
const common_1 = require("@nestjs/common");
const selector_1 = require("../domain/selector");
const model_intent_1 = require("../intent/model-intent");
/** 该线路当前是否配置了任意启用且已配置价格的档位 */
function hasActivePriceTier(channelModel) {
    return channelModel.priceTiers.some((tier) => tier.enabled && tier.priceConfigured);
}
let PriceTierService = class PriceTierService {
    /**
     * 意图 → 选择器。图片参数合同存在时只取 pricing 参数（并补 operation），
     * 其余能力走通用投影。
     */
    requestedSelector(channelModel, intent) {
        const parameters = channelModel.capabilitySpec.imageParameters;
        if (!parameters)
            return (0, model_intent_1.skuSelectorForIntent)(intent);
        const selector = {
            operation: (intent.inputs?.image ?? 0) > 0 ? 'image_to_image' : 'text_to_image',
            ...(0, selector_1.imagePriceSelectorForParameters)(parameters, intent.options ?? {}),
        };
        return selector;
    }
    /** 命中「精确规格优先、通配兜底」的启用档；没有返回 null */
    tierForIntent(channelModel, intent) {
        const requested = this.requestedSelector(channelModel, intent);
        const parameters = channelModel.capabilitySpec.imageParameters ?? null;
        return (0, selector_1.pickPriceTier)(channelModel.priceTiers, requested, parameters);
    }
    /**
     * 目录发现用：只要求「已提供的选择器值与某个启用档兼容」。
     * 未提供的维度仍是一组可选值，不能据此判定不可用。
     */
    hasCompatibleTier(channelModel, intent) {
        const requested = this.requestedSelector(channelModel, intent);
        const parameters = channelModel.capabilitySpec.imageParameters ?? null;
        return (0, selector_1.hasCompatiblePriceTier)(channelModel.priceTiers, requested, parameters);
    }
};
exports.PriceTierService = PriceTierService;
exports.PriceTierService = PriceTierService = __decorate([
    (0, common_1.Injectable)()
], PriceTierService);
//# sourceMappingURL=price-tier.service.js.map