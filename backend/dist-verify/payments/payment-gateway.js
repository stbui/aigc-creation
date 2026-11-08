"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PaymentGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentGateway = void 0;
const common_1 = require("@nestjs/common");
const payment_config_service_1 = require("./payment-config.service");
const adapters_1 = require("./adapters");
/**
 * 订单域访问支付能力的**窄接口**。
 *
 * 为什么需要它：退款由 `OrderService` 发起（状态机与积分回收都在订单域），
 * 但渠道凭据在支付域。直接让 `OrdersModule` import `PaymentsModule` 会形成
 * `PaymentsModule → OrdersModule → PaymentsModule` 的循环。
 *
 * 本类只依赖 `PaymentConfigService`（其依赖只有 Prisma + ConfigModule），
 * 因此可以随 `PaymentCoreModule` 一起被两边安全引用，依赖方向保持单向：
 *
 *   PaymentsModule ─┐
 *                   ├─→ PaymentCoreModule (配置 + 适配器 + 本网关)
 *   OrdersModule ───┘
 */
let PaymentGateway = PaymentGateway_1 = class PaymentGateway {
    constructor(configs) {
        this.configs = configs;
        this.logger = new common_1.Logger(PaymentGateway_1.name);
    }
    /** 订单绑定的渠道配置（历史单回落到同渠道最新版） */
    async contextForOrder(order) {
        const config = await this.configs.resolveForOrder(order);
        if (!config)
            return null;
        return {
            providerId: config.providerId,
            configId: config.id,
            configVersion: config.version,
            values: config.values,
        };
    }
    /**
     * 原路退款。
     *
     * 契约：**不抛异常**，失败一律以 `state:'failed'` 返回，让调用方把退款单
     * 置 failed 并保留「结果未知」语义。凭据缺失同样返回 failed，绝不降级沙箱。
     */
    async refund(input) {
        const adapter = (0, adapters_1.getAdapter)(input.order.channel);
        if (!adapter)
            return { state: 'failed', error: `未知支付渠道: ${input.order.channel}` };
        let config;
        try {
            config = await this.contextForOrder(input.order);
        }
        catch (e) {
            return { state: 'failed', error: `支付配置读取失败: ${e.message}` };
        }
        if (!config) {
            return { state: 'failed', error: `支付渠道 ${input.order.channel} 未完成配置，无法退款` };
        }
        const missing = adapter.validateConfig(config.values);
        if (missing.length > 0) {
            return { state: 'failed', error: `支付渠道 ${input.order.channel} 配置不完整（缺少 ${missing.join(', ')}）` };
        }
        const payload = {
            config,
            orderNo: input.orderNo,
            outRefundNo: input.outRefundNo,
            amountCents: input.amountCents,
            totalCents: input.totalCents,
            reason: input.reason,
            providerRef: input.providerRef,
            providerTradeNo: input.providerTradeNo,
        };
        try {
            return await adapter.refund(payload);
        }
        catch (e) {
            return { state: 'failed', error: `渠道退款调用异常: ${e.message || e}` };
        }
    }
};
exports.PaymentGateway = PaymentGateway;
exports.PaymentGateway = PaymentGateway = PaymentGateway_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [payment_config_service_1.PaymentConfigService])
], PaymentGateway);
//# sourceMappingURL=payment-gateway.js.map