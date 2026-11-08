"use strict";
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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PublicModelCatalogService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicModelCatalogService = void 0;
exports.availabilityOf = availabilityOf;
exports.priceDisplay = priceDisplay;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const capability_config_1 = require("../domain/capability-config");
const json_1 = require("../domain/json");
const selector_1 = require("../domain/selector");
const image_parameters_1 = require("../domain/image-parameters");
const microcredits_1 = require("../infra/microcredits");
const capability_spec_1 = require("../intent/capability-spec");
const capability_match_1 = require("../intent/capability-match");
const model_intent_1 = require("../intent/model-intent");
const channel_presentation_1 = require("../channels/channel.presentation");
const channel_model_metrics_service_1 = require("../channels/channel-model-metrics.service");
const quote_service_1 = require("./quote.service");
let PublicModelCatalogService = PublicModelCatalogService_1 = class PublicModelCatalogService {
    constructor(prisma, quotes, metrics) {
        this.prisma = prisma;
        this.quotes = quotes;
        this.metrics = metrics;
        this.log = new common_1.Logger(PublicModelCatalogService_1.name);
    }
    /** 目录：按分组可见渠道投影，`intent` 给出时只保留能承接该意图的模型 */
    async catalog(access, intent) {
        const channels = await this.prisma.modelChannel.findMany({
            where: { scope: 'system', enabled: true, deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });
        const visible = channels.filter((channel) => access.allowsChannel(channel.id));
        if (visible.length === 0)
            return { source: 'system', models: [], channels: [] };
        const models = await this.prisma.channelModel.findMany({
            where: { channelId: { in: visible.map((channel) => channel.id) }, enabled: true, deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });
        const tiers = await this.prisma.channelModelPriceTier.findMany({
            where: { channelModelId: { in: models.map((model) => model.id) }, deletedAt: null },
        });
        const result = [];
        /*
         * 可用性摘要：一次取回全部线路的 24h / 7d 成功率，投影进公开目录。
         * 失败不影响目录本身（可用性是辅助信息，不能因为它拿不到就让整个目录挂掉）。
         */
        const availabilityById = await this.availabilityIndex();
        for (const channel of visible) {
            const projected = [];
            for (const model of models.filter((row) => row.channelId === channel.id)) {
                const view = this.projectModel(access, model, tiers.filter((tier) => tier.channelModelId === model.id), intent, availabilityById);
                if (view)
                    projected.push(view);
            }
            if (projected.length === 0)
                continue;
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
    async quote(access, channelId, modelKey, intent) {
        const id = String(channelId ?? '').trim();
        const key = String(modelKey ?? '').trim();
        if (id === '' || key === '')
            throw (0, json_1.badRequest)('报价必须指定系统渠道和模型');
        const channelModel = await this.loadChannelModel(access, id, key);
        const resolved = this.resolveIntent(channelModel, intent);
        const match = (0, capability_match_1.matchCapability)(channelModel.capabilitySpec, resolved);
        if (!match.matched)
            throw (0, json_1.badRequest)(describeMatchFailure(match));
        return this.quotes.quoteChannelModel(access, channelModel, resolved);
    }
    /**
     * 线路可用性索引（id → 健康行）。
     *
     * 取不到就返回空表：可用性是辅助信息，拿不到时目录照常可用，
     * 只是 `availability.dataState` 变成 `no_data`。
     */
    async availabilityIndex() {
        try {
            const rows = await this.metrics.list();
            return new Map(rows.map((row) => [row.id, row]));
        }
        catch (error) {
            this.log.warn(`读取线路可用性失败，公开目录不带可用性摘要：${describe(error)}`);
            return new Map();
        }
    }
    /* ───────────────────────── 内部 ───────────────────────── */
    /** 目录投影：能力合同损坏时隔离该模型并记一次告警，不影响其它模型 */
    projectModel(access, row, tierRows, intent, availabilityById) {
        try {
            const cached = this.toCachedChannelModel(row, tierRows);
            const resolved = intent ? this.resolveIntent(cached, intent) : null;
            if (resolved) {
                if (!(0, capability_match_1.matchCapability)(cached.capabilitySpec, resolved).matched)
                    return null;
                if ((0, capability_config_1.normalizeCapability)(cached.capability) !== (0, capability_config_1.normalizeCapability)(resolved.capability))
                    return null;
            }
            const priceTiers = publicTiers(access, cached, tierRows);
            if (!priceTiers)
                return null;
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
                capability: (0, capability_config_1.normalizeCapability)(row.capability),
                protocol: row.protocol,
                capabilityConfig: row.capabilityConfigJson
                    ? (0, capability_config_1.decodeCapabilityConfig)(row.capabilityConfigJson)
                    : null,
                defaultOptions: (0, capability_spec_1.decodeLogicalDefaults)('{}', cached.capabilitySpec),
                priceTiers,
                pricingMode: display.pricingMode,
                displayPrice: display.displayPrice,
                priceLabel: display.priceLabel,
                available: priceTiers.length > 0,
                availability: availabilityOf(availabilityById.get(cached.id) ?? null),
            };
        }
        catch (error) {
            this.log.warn(`渠道模型被排除出公开目录 id=${row.id}：${describe(error)}`);
            return null;
        }
    }
    /** 取一条渠道模型（含能力合同与价格档）；渠道不可见或模型不存在返回 400 */
    async loadChannelModel(access, channelId, modelKey) {
        const channel = await this.prisma.modelChannel.findFirst({
            where: { id: channelId, scope: 'system', enabled: true, deletedAt: null },
        });
        if (!channel)
            throw (0, json_1.badRequest)('所选系统渠道不存在或已停用');
        access.requireChannel(channel.id);
        const row = await this.prisma.channelModel.findFirst({
            where: { channelId, activeKey: modelKey.toLowerCase(), enabled: true, deletedAt: null },
        });
        if (!row)
            throw (0, json_1.badRequest)('所选模型不存在或已停用');
        const tiers = await this.prisma.channelModelPriceTier.findMany({
            where: { channelModelId: row.id, deletedAt: null },
        });
        try {
            return this.toCachedChannelModel(row, tiers);
        }
        catch (error) {
            throw (0, json_1.badRequest)(`所选模型能力配置无效：${describe(error)}`);
        }
    }
    /** 数据库行 → 路由快照形状（价格档不过滤：过滤在选档时做） */
    toCachedChannelModel(row, tierRows) {
        const spec = (0, capability_spec_1.capabilitySpecFromModelCapabilityConfig)((0, capability_config_1.decodeCapabilityConfig)(row.capabilityConfigJson), row.capability);
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
            priceTiers: tierRows.map((tier) => ({
                id: tier.id,
                selector: (0, selector_1.decodeSkuSelector)(tier.selectorJson || tier.selectorKey),
                selectorJson: tier.selectorJson,
                resolution: tier.resolution,
                videoSeconds: tier.videoSeconds,
                providerModelKey: tier.providerModelKey,
                billingMode: tier.billingMode,
                unitPriceMicrocredits: (0, channel_presentation_1.toNumber)(tier.unitPriceMicrocredits),
                inputTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(tier.inputTokenPriceMicrocredits),
                outputTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(tier.outputTokenPriceMicrocredits),
                cachedTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(tier.cachedTokenPriceMicrocredits),
                priceConfigured: tier.priceConfigured,
                enabled: tier.enabled,
                priceVersion: tier.priceVersion,
            })),
        };
    }
    /** 合并渠道模型默认参数后解析意图（与路由匹配用同一份合同） */
    resolveIntent(channelModel, intent) {
        const defaults = (0, capability_spec_1.decodeLogicalDefaults)('{}', channelModel.capabilitySpec);
        return (0, model_intent_1.resolveModelRequestIntent)(channelModel.capabilitySpec, intent, defaults);
    }
};
exports.PublicModelCatalogService = PublicModelCatalogService;
exports.PublicModelCatalogService = PublicModelCatalogService = PublicModelCatalogService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        quote_service_1.QuoteService,
        channel_model_metrics_service_1.ChannelModelMetricsService])
], PublicModelCatalogService);
/**
 * 公开价格档：只保留启用且已配置的档，并按分组换算。
 * 分组缺少该计价货币的兑换比例时返回 null（整个模型不发布，而不是给一个 0 价）。
 */
function publicTiers(access, channelModel, tierRows) {
    let pricing;
    try {
        pricing = access.pricing(channelModel.priceCurrency, [channelModel.modelKey]);
    }
    catch {
        return null;
    }
    const result = [];
    const seen = new Set();
    for (const row of tierRows) {
        if (!row.enabled || !row.priceConfigured)
            continue;
        const pricingValid = (0, selector_1.validateChannelModelPrice)(row.billingMode, {
            billingMode: row.billingMode,
            unitPriceMicrocredits: (0, channel_presentation_1.toNumber)(row.unitPriceMicrocredits),
            inputTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(row.inputTokenPriceMicrocredits),
            outputTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(row.outputTokenPriceMicrocredits),
            cachedTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(row.cachedTokenPriceMicrocredits),
        });
        if (!pricingValid)
            continue;
        const selector = (0, selector_1.decodeSkuSelector)(row.selectorJson || row.selectorKey);
        const imageParameters = channelModel.capabilitySpec.imageParameters;
        if (imageParameters) {
            try {
                (0, image_parameters_1.validateImageParameterPriceSelector)(imageParameters, selector);
            }
            catch {
                continue;
            }
        }
        const tier = {
            id: row.id,
            selector,
            resolution: row.resolution,
            videoSeconds: row.videoSeconds,
            billingMode: row.billingMode,
            unitPriceMicrocredits: applyMultiplier((0, microcredits_1.toSafeNumber)((0, microcredits_1.convertCurrencyPrice)((0, channel_presentation_1.toNumber)(row.unitPriceMicrocredits), pricing.rateMicrocredits)), pricing.multiplierBasisPoints),
            inputTokenPriceMicrocredits: applyMultiplier((0, microcredits_1.toSafeNumber)((0, microcredits_1.convertCurrencyPrice)((0, channel_presentation_1.toNumber)(row.inputTokenPriceMicrocredits), pricing.rateMicrocredits)), pricing.multiplierBasisPoints),
            outputTokenPriceMicrocredits: applyMultiplier((0, microcredits_1.toSafeNumber)((0, microcredits_1.convertCurrencyPrice)((0, channel_presentation_1.toNumber)(row.outputTokenPriceMicrocredits), pricing.rateMicrocredits)), pricing.multiplierBasisPoints),
            cachedTokenPriceMicrocredits: applyMultiplier((0, microcredits_1.toSafeNumber)((0, microcredits_1.convertCurrencyPrice)((0, channel_presentation_1.toNumber)(row.cachedTokenPriceMicrocredits), pricing.rateMicrocredits)), pricing.multiplierBasisPoints),
        };
        const key = JSON.stringify({
            selector,
            billingMode: tier.billingMode,
            unit: tier.unitPriceMicrocredits,
            input: tier.inputTokenPriceMicrocredits,
            output: tier.outputTokenPriceMicrocredits,
            cached: tier.cachedTokenPriceMicrocredits,
        });
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(tier);
    }
    return result;
}
function applyMultiplier(price, multiplierBasisPoints) {
    if (price <= 0)
        return price;
    return (0, microcredits_1.toSafeNumber)((0, microcredits_1.creditAmount)(price, 1, multiplierBasisPoints));
}
/**
 * 健康行 → 公开目录的可用性摘要。
 *
 * 「没调用过」（无样本）与「全失败」要分得开：无样本时 rate 为 null、
 * dataState='no_data'，C 端不能因此把线路判成不可用。
 */
function availabilityOf(row) {
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
function priceDisplay(tiers) {
    if (tiers.length === 0)
        return { pricingMode: 'provider', displayPrice: null, priceLabel: '未配置' };
    if (tiers.length === 1) {
        const unit = tierDisplayPrice(tiers[0]);
        if (unit > 0)
            return { pricingMode: 'provider', displayPrice: unit, priceLabel: '' };
    }
    return { pricingMode: 'provider', displayPrice: null, priceLabel: '按渠道规格计费' };
}
function tierDisplayPrice(tier) {
    if (tier.billingMode === 'fixed_request' || tier.billingMode === 'per_second')
        return tier.unitPriceMicrocredits;
    if (tier.outputTokenPriceMicrocredits > 0)
        return tier.outputTokenPriceMicrocredits;
    if (tier.inputTokenPriceMicrocredits > 0)
        return tier.inputTokenPriceMicrocredits;
    return 0;
}
function decodeTags(raw) {
    try {
        const parsed = JSON.parse(String(raw ?? '[]'));
        if (!Array.isArray(parsed))
            return [];
        return parsed
            .map((item) => ({ text: String(item?.text ?? '').trim(), color: String(item?.color ?? '').trim() }))
            .filter((item) => item.text !== '');
    }
    catch {
        return [];
    }
}
function firstNonEmpty(...values) {
    for (const value of values) {
        const text = String(value ?? '').trim();
        if (text)
            return text;
    }
    return '';
}
function describeMatchFailure(match) {
    const reasons = (match.reasons ?? []).map((item) => String(item ?? '').trim()).filter((item) => item !== '');
    return reasons.length > 0 ? reasons.join('；') : '所选模型暂时无法满足这组输入和参数';
}
function describe(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=public-model-catalog.service.js.map