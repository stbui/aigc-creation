"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SandboxAdapter = void 0;
const common_1 = require("@nestjs/common");
/**
 * 沙箱适配器 —— 零凭据、零网络，仅用于开发与冒烟。
 *
 * 与真实渠道的差异被压到最小：它同样走 `createOrder → 站内模拟 → 回调/查单`
 * 的链路，因此编排层、收件箱、worker 在沙箱下也被完整执行；只有「钱」是假的。
 *
 * 生产环境不允许出现沙箱渠道（`PaymentConfigService.available()` 过滤 +
 * 通知验签拒绝），否则任何知道订单号的人都能伪造一条已支付通知白拿积分。
 */
class SandboxAdapter {
    constructor() {
        this.logger = new common_1.Logger(SandboxAdapter.name);
        this.descriptor = {
            id: 'sandbox',
            name: '沙箱（站内模拟）',
            icon: 'sandbox',
            checkoutMode: 'sandbox',
            configFields: [],
            supportedCurrencies: ['CNY'],
            // 沙箱没有渠道账单，对账无从谈起
            supportsReconciliation: false,
        };
    }
    get isProduction() {
        return process.env.NODE_ENV === 'production';
    }
    validateConfig() {
        return [];
    }
    async createOrder(input) {
        return {
            mode: 'sandbox',
            payUrl: `/pay/sandbox?orderId=${encodeURIComponent(input.orderId)}`,
            providerRef: input.orderNo,
            expiresAt: input.expiresAt,
            hint: `沙箱通道：调用 POST /orders/${input.orderId}/pay 并传 scenario=success|failed|timeout 模拟支付结果`,
        };
    }
    async queryOrder(input) {
        // 沙箱没有外部状态：本地是否已支付由订单状态决定，这里只回答「未支付」
        return {
            state: 'pending',
            orderNo: input.orderNo,
            providerStatus: 'SANDBOX_PENDING',
            rawPayload: JSON.stringify({ sandbox: true, orderNo: input.orderNo }),
        };
    }
    async closeOrder(input) {
        return {
            state: 'closed',
            orderNo: input.orderNo,
            providerStatus: 'SANDBOX_CLOSED',
            rawPayload: JSON.stringify({ sandbox: true, closed: input.orderNo }),
        };
    }
    async verifyNotification(input) {
        const raw = input.rawBody.toString('utf8');
        if (this.isProduction) {
            const reason = '沙箱通道在生产环境不接收回调（存在伪造支付风险）';
            this.logger.error(reason);
            return { ok: false, ackSuccess: false, reason, rawPayload: raw };
        }
        const body = input.body ?? {};
        const orderNo = typeof body.orderNo === 'string' ? body.orderNo : '';
        const tradeNo = typeof body.tradeNo === 'string' ? body.tradeNo : '';
        const amountCents = Number(body.amountCents);
        if (!orderNo)
            return { ok: false, ackSuccess: false, reason: '缺少 orderNo', rawPayload: raw };
        if (!tradeNo)
            return { ok: false, ackSuccess: false, reason: '缺少 tradeNo', rawPayload: raw };
        if (!Number.isInteger(amountCents) || amountCents < 0) {
            return { ok: false, ackSuccess: false, reason: 'amountCents 必须是非负整数', rawPayload: raw };
        }
        return {
            ok: true,
            eventId: `sandbox:${tradeNo}`,
            merchantOrderNo: orderNo,
            providerTradeNo: tradeNo,
            amountCents,
            currency: 'CNY',
            state: 'paid',
            paidAt: new Date(),
            providerStatus: 'SANDBOX_PAID',
            ackSuccess: true,
            rawPayload: raw,
        };
    }
    ack(result) {
        const accepted = result.ok ? result.ackSuccess : false;
        return {
            status: accepted ? 200 : 400,
            body: JSON.stringify({ success: accepted, reason: result.ok ? result.reason ?? null : result.reason }),
            contentType: 'application/json; charset=utf-8',
        };
    }
    async refund(input) {
        this.logger.log(`沙箱退款: ${input.orderNo} / ${input.outRefundNo} ${input.amountCents} 分`);
        return { state: 'succeeded', raw: JSON.stringify({ sandbox: true, outRefundNo: input.outRefundNo }) };
    }
    async downloadTradeBill() {
        // 沙箱不提供账单；调用方据此把 run 标为 failed 并提示原因，不伪造数据
        throw new Error('沙箱渠道不提供交易账单');
    }
}
exports.SandboxAdapter = SandboxAdapter;
//# sourceMappingURL=sandbox.adapter.js.map