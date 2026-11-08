"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StripeAdapter = void 0;
exports.verifyStripeSignature = verifyStripeSignature;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const types_1 = require("./types");
const DEFAULT_API_BASE = 'https://api.stripe.com';
const WEBHOOK_TOLERANCE_SECONDS = 300;
/**
 * Stripe Checkout 适配器。
 *
 * Checkout Session 既能承载一次性支付，也能把支付方式交给 Stripe 托管，
 * 因此这里不需要处理卡号等敏感信息。查单、关单、退款都以 Session 或
 * PaymentIntent 的渠道 id 为准，商户订单号只用于业务关联。
 */
class StripeAdapter {
    constructor() {
        this.logger = new common_1.Logger(StripeAdapter.name);
        this.descriptor = {
            id: 'stripe',
            name: 'Stripe',
            icon: 'stripe',
            checkoutMode: 'redirect',
            supportedCurrencies: ['CNY', 'USD'],
            supportsReconciliation: false,
            configFields: [
                {
                    name: 'secretKey',
                    label: 'Secret Key',
                    type: 'password',
                    required: true,
                    secret: true,
                    maxLength: 512,
                    description: 'Stripe Secret Key（sk_live_... 或 sk_test_...）',
                },
                {
                    name: 'webhookSecret',
                    label: 'Webhook Secret',
                    type: 'password',
                    required: true,
                    secret: true,
                    maxLength: 256,
                    description: 'Stripe Webhook Endpoint 的 whsec_... 签名密钥',
                },
                {
                    name: 'apiBase',
                    label: 'API 地址',
                    type: 'url',
                    required: false,
                    default: DEFAULT_API_BASE,
                    description: '固定使用 https://api.stripe.com；测试模式由 sk_test_ 密钥决定',
                },
                {
                    name: 'publicBaseUrl',
                    label: '回调公网地址（可选）',
                    type: 'url',
                    required: false,
                    default: '',
                    description: '例如 https://pay.example.com；留空使用 PAYMENT_NOTIFY_BASE',
                },
            ],
        };
    }
    validateConfig(values) {
        const invalid = [];
        if (!values.secretKey?.trim())
            invalid.push('secretKey');
        if (!values.webhookSecret?.trim())
            invalid.push('webhookSecret');
        const apiBase = values.apiBase?.trim();
        if (apiBase && apiBase.replace(/\/$/, '') !== DEFAULT_API_BASE)
            invalid.push('apiBase');
        const publicBaseUrl = values.publicBaseUrl?.trim();
        if (publicBaseUrl && !(0, types_1.isAllowedPublicBase)(publicBaseUrl))
            invalid.push('publicBaseUrl');
        return Array.from(new Set(invalid));
    }
    async createOrder(input) {
        const params = new URLSearchParams();
        params.set('mode', 'payment');
        params.set('client_reference_id', input.orderNo);
        params.set('metadata[orderNo]', input.orderNo);
        params.set('payment_intent_data[metadata][orderNo]', input.orderNo);
        params.set('line_items[0][quantity]', '1');
        params.set('line_items[0][price_data][currency]', input.currency.toLowerCase());
        params.set('line_items[0][price_data][unit_amount]', String(input.amountCents));
        params.set('line_items[0][price_data][product_data][name]', input.subject.slice(0, 127));
        params.set('success_url', input.returnUrl);
        params.set('cancel_url', input.returnUrl);
        // Stripe 要求 expires_at 至少比当前时间晚 30 分钟；不足时交给 Stripe 默认有效期。
        const expiresSeconds = Math.floor(input.expiresAt.getTime() / 1000);
        if (expiresSeconds >= Math.floor(Date.now() / 1000) + 30 * 60) {
            params.set('expires_at', String(expiresSeconds));
        }
        const session = await this.request(input.config, 'POST', '/v1/checkout/sessions', params);
        const id = asString(session.id);
        const payUrl = asString(session.url);
        if (!id)
            throw new Error('Stripe 下单未返回 Checkout Session id');
        if (!payUrl)
            throw new Error('Stripe 下单未返回收银台地址');
        return {
            mode: 'redirect',
            payUrl,
            providerRef: id,
            expiresAt: numberOrUndefined(session.expires_at)
                ? new Date(numberOrUndefined(session.expires_at) * 1000)
                : input.expiresAt,
            hint: '请在 Stripe 收银台完成支付；Webhook 需订阅 checkout.session.* 事件。',
        };
    }
    async queryOrder(input) {
        const providerRef = input.providerRef?.trim();
        if (!providerRef) {
            return failed(input.orderNo, '缺少 Stripe Checkout Session id，无法查单；请重新发起支付');
        }
        try {
            const params = new URLSearchParams();
            params.append('expand[]', 'payment_intent');
            const session = await this.request(input.config, 'GET', `/v1/checkout/sessions/${encodeURIComponent(providerRef)}`, params);
            return mapSession(input.orderNo, session);
        }
        catch (e) {
            return failed(input.orderNo, `Stripe 查单失败: ${e.message}`);
        }
    }
    async closeOrder(input) {
        const providerRef = input.providerRef?.trim();
        if (!providerRef) {
            return failed(input.orderNo, '缺少 Stripe Checkout Session id，无法关闭');
        }
        try {
            const session = await this.request(input.config, 'POST', `/v1/checkout/sessions/${encodeURIComponent(providerRef)}/expire`);
            return mapSession(input.orderNo, session);
        }
        catch (e) {
            return failed(input.orderNo, `Stripe 关闭 Checkout Session 失败: ${e.message}`);
        }
    }
    async verifyNotification(input) {
        const raw = input.rawBody.toString('utf8');
        const secret = input.config.values.webhookSecret?.trim();
        if (!secret) {
            return { ok: false, ackSuccess: false, reason: 'Stripe Webhook Secret 未配置', rawPayload: raw };
        }
        const signature = header(input.headers, 'stripe-signature');
        if (!signature || !verifyStripeSignature(input.rawBody, signature, secret)) {
            return { ok: false, ackSuccess: false, reason: 'Stripe Webhook 验签失败', rawPayload: raw };
        }
        const event = input.body;
        const eventType = asString(event.type);
        const eventId = asString(event.id) || `stripe:${hash(raw)}`;
        const data = asObject(event.data);
        const session = asObject(data?.object);
        if (!session) {
            return { ok: false, ackSuccess: false, reason: 'Stripe 事件缺少 session 数据', rawPayload: raw };
        }
        const merchantOrderNo = asString(session.client_reference_id) ||
            asString(asObject(session.metadata)?.orderNo);
        const providerRef = asString(session.id);
        const providerTradeNo = paymentIntentId(session.payment_intent) || providerRef;
        const amountCents = numberOrUndefined(session.amount_total);
        const currency = currencyOf(session.currency);
        const providerStatus = `${eventType}:${asString(session.payment_status) || asString(session.status)}`;
        if (!merchantOrderNo) {
            return { ok: false, ackSuccess: false, reason: 'Stripe 回调缺少商户订单号', rawPayload: raw };
        }
        if (eventType === 'checkout.session.completed' || eventType === 'checkout.session.async_payment_succeeded') {
            const paymentStatus = asString(session.payment_status);
            const paid = paymentStatus === 'paid' || paymentStatus === 'no_payment_required';
            if (paid) {
                if (!providerTradeNo || amountCents === undefined || !currency) {
                    return { ok: false, ackSuccess: false, reason: 'Stripe 支付回调字段不完整', rawPayload: raw };
                }
                return {
                    ok: true,
                    eventId,
                    merchantOrderNo,
                    providerTradeNo,
                    providerRef,
                    amountCents,
                    currency,
                    state: 'paid',
                    paidAt: eventCreatedAt(event),
                    providerStatus,
                    ackSuccess: true,
                    rawPayload: raw,
                };
            }
            // Checkout 完成不等于钱已到账。异步支付方式可能稍后才成功。
            return {
                ok: true,
                eventId,
                merchantOrderNo,
                providerTradeNo,
                providerRef,
                amountCents: amountCents ?? 0,
                currency: currency ?? 'CNY',
                state: 'pending',
                providerStatus,
                ackSuccess: true,
                reason: 'Stripe Checkout 已完成，等待异步支付结果',
                rawPayload: raw,
            };
        }
        if (eventType === 'checkout.session.async_payment_failed') {
            return {
                ok: true,
                eventId,
                merchantOrderNo,
                providerTradeNo,
                providerRef,
                amountCents: amountCents ?? 0,
                currency: currency ?? 'CNY',
                state: 'failed',
                providerStatus,
                ackSuccess: true,
                reason: 'Stripe 异步支付失败',
                rawPayload: raw,
            };
        }
        if (eventType === 'checkout.session.expired') {
            return {
                ok: true,
                eventId,
                merchantOrderNo,
                providerTradeNo,
                providerRef,
                amountCents: amountCents ?? 0,
                currency: currency ?? 'CNY',
                state: 'closed',
                providerStatus,
                ackSuccess: true,
                reason: 'Stripe Checkout Session 已过期',
                rawPayload: raw,
            };
        }
        return {
            ok: false,
            ackSuccess: false,
            reason: `Stripe 事件未处理: ${eventType || 'unknown'}`,
            rawPayload: raw,
        };
    }
    ack(result) {
        const accepted = result.ok ? result.ackSuccess : false;
        return {
            status: accepted ? 200 : 400,
            body: accepted ? 'ok' : (result.ok ? result.reason : result.reason).slice(0, 200),
            contentType: 'text/plain; charset=utf-8',
        };
    }
    async refund(input) {
        try {
            let paymentIntent = input.providerTradeNo?.trim() || '';
            if (!paymentIntent && input.providerRef?.trim()) {
                const params = new URLSearchParams();
                params.append('expand[]', 'payment_intent');
                const session = await this.request(input.config, 'GET', `/v1/checkout/sessions/${encodeURIComponent(input.providerRef.trim())}`, params);
                paymentIntent = paymentIntentId(session.payment_intent);
            }
            if (!paymentIntent) {
                return { state: 'failed', error: '缺少 Stripe PaymentIntent id，无法退款' };
            }
            const params = new URLSearchParams();
            params.set('payment_intent', paymentIntent);
            params.set('amount', String(input.amountCents));
            params.set('metadata[refundNo]', input.outRefundNo);
            if (input.reason)
                params.set('metadata[reason]', input.reason.slice(0, 500));
            const result = await this.request(input.config, 'POST', '/v1/refunds', params, input.outRefundNo);
            const id = asString(result.id);
            const status = asString(result.status);
            if (status === 'succeeded')
                return { state: 'succeeded', providerRefundId: id, raw: safeJson(result) };
            if (status === 'pending' || status === 'requires_action') {
                return { state: 'processing', providerRefundId: id, raw: safeJson(result) };
            }
            return {
                state: 'failed',
                providerRefundId: id,
                error: `Stripe 退款状态: ${status || 'unknown'}`,
                raw: safeJson(result),
            };
        }
        catch (e) {
            return { state: 'failed', error: `Stripe 退款失败: ${e.message}` };
        }
    }
    async request(config, method, path, params, idempotencyKey) {
        const apiBase = (config.values.apiBase?.trim() || DEFAULT_API_BASE).replace(/\/$/, '');
        const query = method === 'GET' && params?.size ? `?${params.toString()}` : '';
        const res = await fetch(`${apiBase}${path}${query}`, {
            method,
            headers: {
                Authorization: `Bearer ${config.values.secretKey}`,
                Accept: 'application/json',
                ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
                ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey.slice(0, 255) } : {}),
            },
            ...(method === 'POST' ? { body: params?.toString() ?? '' } : {}),
            signal: AbortSignal.timeout(15000),
        });
        const text = await res.text();
        const json = parseJsonObject(text);
        if (!res.ok) {
            const error = asObject(json?.error);
            const message = asString(error?.message) || asString(json?.message) || `HTTP ${res.status}`;
            this.logger.warn(`Stripe API 失败 (${method} ${path}): ${message}`);
            throw new Error(message);
        }
        if (!json)
            throw new Error('Stripe 响应不是合法 JSON');
        return json;
    }
}
exports.StripeAdapter = StripeAdapter;
function verifyStripeSignature(rawBody, signatureHeader, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
    const pairs = signatureHeader.split(',').map((part) => part.trim()).filter(Boolean);
    let timestamp = '';
    const signatures = [];
    for (const pair of pairs) {
        const index = pair.indexOf('=');
        if (index <= 0)
            continue;
        const key = pair.slice(0, index);
        const value = pair.slice(index + 1);
        if (key === 't')
            timestamp = value;
        if (key === 'v1')
            signatures.push(value);
    }
    if (!/^\d+$/.test(timestamp) || signatures.length === 0)
        return false;
    if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS)
        return false;
    const expected = (0, node_crypto_1.createHmac)('sha256', secret)
        .update(`${timestamp}.`)
        .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8'))
        .digest();
    return signatures.some((signature) => {
        if (!/^[a-f0-9]{64}$/i.test(signature))
            return false;
        const actual = Buffer.from(signature, 'hex');
        return actual.length === expected.length && (0, node_crypto_1.timingSafeEqual)(actual, expected);
    });
}
function mapSession(orderNo, session) {
    const raw = safeJson(session);
    const paymentStatus = asString(session.payment_status);
    const sessionStatus = asString(session.status);
    const currency = currencyOf(session.currency);
    const amountCents = numberOrUndefined(session.amount_total);
    const tradeNo = paymentIntentId(session.payment_intent) || undefined;
    const providerStatus = paymentStatus || sessionStatus || 'UNKNOWN';
    if (paymentStatus === 'paid' || paymentStatus === 'no_payment_required') {
        return {
            state: 'paid',
            orderNo,
            tradeNo,
            amountCents,
            currency: currency ?? undefined,
            providerStatus,
            rawPayload: raw,
        };
    }
    if (sessionStatus === 'expired') {
        return { state: 'closed', orderNo, tradeNo, amountCents, currency: currency ?? undefined, providerStatus, rawPayload: raw };
    }
    if (sessionStatus === 'open' || (sessionStatus === 'complete' && paymentStatus === 'unpaid')) {
        return { state: 'pending', orderNo, tradeNo, amountCents, currency: currency ?? undefined, providerStatus, rawPayload: raw };
    }
    return {
        state: 'failed',
        orderNo,
        tradeNo,
        amountCents,
        currency: currency ?? undefined,
        providerStatus,
        error: `Stripe 未知状态: ${sessionStatus || 'unknown'}/${paymentStatus || 'unknown'}`,
        rawPayload: raw,
    };
}
function paymentIntentId(value) {
    if (typeof value === 'string')
        return value;
    return asString(asObject(value)?.id);
}
function currencyOf(value) {
    const code = asString(value).toUpperCase();
    return code === 'CNY' || code === 'USD' ? code : undefined;
}
function eventCreatedAt(event) {
    const seconds = numberOrUndefined(event.created);
    return seconds ? new Date(seconds * 1000) : undefined;
}
function failed(orderNo, error) {
    return { state: 'failed', orderNo, error, providerStatus: 'CLIENT_ERROR', rawPayload: '' };
}
function header(headers, name) {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? (value[0] ?? '').trim() : String(value ?? '').trim();
}
function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function asString(value) {
    return typeof value === 'string' ? value : '';
}
function numberOrUndefined(value) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : undefined;
}
function parseJsonObject(text) {
    try {
        return asObject(JSON.parse(text));
    }
    catch {
        return null;
    }
}
function safeJson(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return '';
    }
}
function hash(value) {
    return (0, node_crypto_1.createHmac)('sha256', 'stripe-event').update(value).digest('hex');
}
//# sourceMappingURL=stripe.adapter.js.map