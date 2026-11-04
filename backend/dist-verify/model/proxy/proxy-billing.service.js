"use strict";
/**
 * 中转计费：仅 POST 预留 → running → 结算 / 退款 / 待核对。
 *
 * 与任务路径共用 `BillingService` 的状态机与钱包，差异只有两点：
 *   · 没有前台模型与线路快照 —— 价格档直接按渠道模型 + 请求体选；
 *   · 请求体本身就是意图：Token 估算读真实 messages，按秒计费读 `seconds` /
 *     `duration`，图像选档读 `size` / `quality` 等上游原字段。
 *
 * 幂等：客户端可用 `X-Idempotency-Key` 重放同一笔请求；没有时每次生成新键，
 * 不做「按用户 + 分钟」之类的猜测性去重 —— 那会把合法重试当成重放。
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProxyBillingService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const billing_service_1 = require("../billing/billing.service");
const price_tier_service_1 = require("../routing/price-tier.service");
const user_group_service_1 = require("../user-groups/user-group.service");
const json_1 = require("../domain/json");
const proxy_constants_1 = require("./proxy.constants");
let ProxyBillingService = class ProxyBillingService {
    constructor(billing, priceTiers, groups) {
        this.billing = billing;
        this.priceTiers = priceTiers;
        this.groups = groups;
    }
    /**
     * 把上游请求体投影成计价意图。
     *
     * `options` 直接放整段请求体：报价 / 选档 / Token 估算读的都是上游原字段
     * （`size`、`quality`、`messages`、`max_tokens`），再做一层字段映射只会
     * 让「同一参数在中转与任务上算出的钱不同」。
     */
    buildIntent(channelModel, body) {
        const payload = parseJsonObject(body);
        const images = countImages(payload);
        const seconds = positiveInt(payload.seconds ?? payload.duration);
        const options = { ...payload };
        if (seconds > 0) {
            // 按秒计费读固定键名（`requestedBillingQuantity`），上游字段名不统一
            options.videoSeconds = seconds;
            options.audioSeconds = seconds;
        }
        return {
            capability: channelModel.capability,
            operation: String(payload.operation ?? '').trim() || undefined,
            inputs: images > 0 ? { image: images } : {},
            options,
        };
    }
    /**
     * 预留积分并置为运行中。
     *
     * 调用方必须在**槽位已占用之后**调用：没有拿到槽位就等于请求不会发出，
     * 此时建单再退款会污染账单与对账。
     */
    async reserve(input) {
        const access = await this.groups.accessForUser(input.userId);
        const intent = this.buildIntent(input.channelModel, input.body);
        const tier = this.priceTiers.tierForIntent(input.channelModel.cached, intent);
        if (!tier)
            throw (0, json_1.badRequest)('当前模型尚未配置所选规格的价格，暂不能通过中转调用');
        const draft = this.billing.buildChannelDraft(access, input.channelModel.cached, tier, intent, input.scene || proxy_constants_1.PROXY_SCENE);
        const key = `proxy:${String(input.idempotencyKey ?? '').trim() || (0, crypto_1.randomUUID)()}`;
        const reserved = await this.billing.reserveTaskBilling({
            userId: input.userId,
            taskId: '',
            idempotencyKey: key,
            draft,
        });
        if (!reserved.idempotentHit)
            await this.billing.markRunning(reserved.order.id);
        return { order: reserved.order, idempotentHit: reserved.idempotentHit };
    }
    /** 上游成功且调用记录已落库 → 结算 */
    async settle(orderId) {
        await this.billing.settle(orderId);
    }
    /** 上游明确失败（请求确实发出过）→ 原额退款 */
    async refund(orderId, reason) {
        await this.billing.refund(orderId, reason, 'failure');
    }
    /** 结果不明 / 本地写入失败 → 转人工，不自动退款 */
    async uncertain(orderId, reason) {
        await this.billing.markUncertain(orderId, reason);
    }
};
exports.ProxyBillingService = ProxyBillingService;
exports.ProxyBillingService = ProxyBillingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [billing_service_1.BillingService,
        price_tier_service_1.PriceTierService,
        user_group_service_1.UserGroupService])
], ProxyBillingService);
function parseJsonObject(body) {
    if (!body || body.length === 0)
        return {};
    try {
        const parsed = JSON.parse(body.toString('utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
/** 图像参考图数量：`images` / `image` 两种上游写法都要认，决定选档的 operation */
function countImages(payload) {
    if (Array.isArray(payload.images))
        return payload.images.length;
    if (Array.isArray(payload.image))
        return payload.image.length;
    if (payload.image !== undefined && payload.image !== null && payload.image !== '')
        return 1;
    return 0;
}
function positiveInt(value) {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
//# sourceMappingURL=proxy-billing.service.js.map