"use strict";
/**
 * 渠道模型数据库行 → 运行期快照投影。
 *
 * 路由目录（`RouteCatalogService`）与中转计费（`src/model/proxy/**`）都按
 * 这一份规则把 `ChannelModel` + 价格档转成 `CachedChannelModel`：两处各写一次
 * 的结果就是「目录价」与「中转账单」在改价后对不上，且很难判断哪一边是旧的。
 *
 * 能力配置非法时**抛错**（不吞掉）：调用方决定是剔除这条线路还是拒绝本次请求，
 * 投影层不替它做选择。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectCachedPriceTier = projectCachedPriceTier;
exports.projectCachedChannelModel = projectCachedChannelModel;
const capability_config_1 = require("../domain/capability-config");
const selector_1 = require("../domain/selector");
const capability_spec_1 = require("../intent/capability-spec");
const channel_presentation_1 = require("../channels/channel.presentation");
/** 价格档投影：BigInt 金额转 number（快照只读，后续计价都读这一份） */
function projectCachedPriceTier(row) {
    return {
        id: row.id,
        selector: (0, selector_1.decodeSkuSelector)(row.selectorJson),
        selectorJson: row.selectorJson,
        resolution: row.resolution,
        videoSeconds: row.videoSeconds,
        providerModelKey: row.providerModelKey,
        billingMode: row.billingMode,
        unitPriceMicrocredits: (0, channel_presentation_1.toNumber)(row.unitPriceMicrocredits),
        inputTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(row.inputTokenPriceMicrocredits),
        outputTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(row.outputTokenPriceMicrocredits),
        cachedTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(row.cachedTokenPriceMicrocredits),
        priceConfigured: row.priceConfigured,
        enabled: row.enabled,
        priceVersion: row.priceVersion,
        // 成本价随价格档一起快照；不叠倍率、不参与售价
        costConfigured: row.costConfigured,
        costUnitPriceMicrocredits: (0, channel_presentation_1.toNumber)(row.costUnitPriceMicrocredits),
        costInputTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(row.costInputTokenPriceMicrocredits),
        costOutputTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(row.costOutputTokenPriceMicrocredits),
        costCachedTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(row.costCachedTokenPriceMicrocredits),
    };
}
/** 渠道模型投影；能力合同非法时抛错，由调用方决定剔除或拒绝 */
function projectCachedChannelModel(row, tiers) {
    const spec = (0, capability_spec_1.capabilitySpecFromModelCapabilityConfig)((0, capability_config_1.decodeCapabilityConfig)(row.capabilityConfigJson), row.capability);
    return {
        id: row.id,
        channelId: row.channelId,
        modelKey: row.modelKey,
        providerModelKey: row.providerModelKey,
        displayName: row.displayName,
        capability: row.capability,
        protocol: row.protocol,
        priceCurrency: row.priceCurrency,
        billingMode: row.billingMode,
        priceConfigured: row.priceConfigured,
        priceVersion: row.priceVersion,
        capabilitySpec: spec,
        priceTiers: tiers.filter((tier) => tier.channelModelId === row.id).map(projectCachedPriceTier),
    };
}
//# sourceMappingURL=channel-model.projection.js.map