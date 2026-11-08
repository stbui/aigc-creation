"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WechatAdapter = void 0;
exports.rfc3339 = rfc3339;
exports.digestOf = digestOf;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const types_1 = require("./types");
const csv_1 = require("../../common/csv");
/**
 * 微信支付 API v3（Native 扫码）适配器。
 *
 * 与支付宝的三处关键差异：
 *   1. 请求签名覆盖「方法 + 路径 + 时间戳 + 随机串 + 报文」五行，不是排序拼接；
 *   2. 回调报文是 AES-256-GCM 加密的，验签通过后还要用 APIv3 密钥解密；
 *   3. 回执是 JSON（`{"code":"SUCCESS"}`），不是纯文本。
 *
 * 回调必须校验时间戳新鲜度（5 分钟）：签名不含随机挑战，时间窗是防重放唯一截面。
 */
class WechatAdapter {
    constructor() {
        this.logger = new common_1.Logger(WechatAdapter.name);
        this.descriptor = {
            id: 'wechat',
            name: '微信支付',
            icon: 'wechat',
            checkoutMode: 'qrcode',
            supportedCurrencies: ['CNY'],
            supportsReconciliation: true,
            configFields: [
                { name: 'appId', label: 'AppID', type: 'text', required: true, identity: true, maxLength: 64 },
                { name: 'mchId', label: '商户号', type: 'text', required: true, identity: true, maxLength: 64 },
                { name: 'merchantSerialNo', label: '商户证书序列号', type: 'text', required: true, maxLength: 64 },
                { name: 'merchantPrivateKey', label: '商户私钥（PEM）', type: 'textarea', required: true, secret: true },
                {
                    name: 'apiV3Key',
                    label: 'APIv3 密钥',
                    type: 'password',
                    required: true,
                    secret: true,
                    description: '32 字节',
                },
                {
                    name: 'wechatPayPublicKey',
                    label: '微信支付公钥（PEM）',
                    type: 'textarea',
                    required: true,
                    secret: true,
                    description: '用于验签回调与网关响应',
                },
                {
                    name: 'apiBase',
                    label: 'API 地址',
                    type: 'url',
                    required: false,
                    default: 'https://api.mch.weixin.qq.com',
                    description: '只允许官方域名',
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
        const missing = [];
        for (const field of this.descriptor.configFields) {
            if (field.required && !values[field.name]?.trim())
                missing.push(field.name);
        }
        if (values.apiV3Key && Buffer.from(values.apiV3Key, 'utf8').length !== 32) {
            missing.push('apiV3Key');
        }
        const base = values.apiBase?.trim();
        if (base && !isAllowedApiBase(base))
            missing.push('apiBase');
        const publicBaseUrl = values.publicBaseUrl?.trim();
        if (publicBaseUrl && !(0, types_1.isAllowedPublicBase)(publicBaseUrl))
            missing.push('publicBaseUrl');
        return Array.from(new Set(missing));
    }
    async createOrder(input) {
        const v = input.config.values;
        const payload = JSON.stringify({
            appid: v.appId,
            mchid: v.mchId,
            description: input.subject.slice(0, 127),
            out_trade_no: input.orderNo,
            time_expire: rfc3339(input.expiresAt),
            notify_url: input.notifyUrl,
            amount: { total: input.amountCents, currency: 'CNY' },
        });
        const { text } = await this.request(v, 'POST', '/v3/pay/transactions/native', payload, '微信预下单');
        let codeUrl = '';
        try {
            codeUrl = JSON.parse(text).code_url ?? '';
        }
        catch {
            throw new Error('微信预下单响应不是合法 JSON');
        }
        if (!codeUrl)
            throw new Error('微信预下单未返回 code_url');
        return { mode: 'qrcode', codeUrl, providerRef: input.orderNo, expiresAt: input.expiresAt };
    }
    async queryOrder(input) {
        const v = input.config.values;
        const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(input.orderNo)}?mchid=${encodeURIComponent(v.mchId)}`;
        try {
            const { text } = await this.request(v, 'GET', path, '', '微信查单');
            const json = JSON.parse(text);
            const state = mapTradeState(json.trade_state);
            return {
                state,
                orderNo: input.orderNo,
                tradeNo: json.transaction_id,
                amountCents: json.amount?.total,
                currency: 'CNY',
                paidAt: json.success_time ? new Date(json.success_time) : state === 'paid' ? new Date() : undefined,
                providerStatus: json.trade_state,
                rawPayload: text,
            };
        }
        catch (e) {
            const err = e;
            if (err.code === 'ORDER_NOT_EXIST' || err.httpStatus === 404) {
                return { state: 'not_found', orderNo: input.orderNo, providerStatus: 'ORDER_NOT_EXIST', rawPayload: '' };
            }
            return { state: 'failed', orderNo: input.orderNo, error: err.message, rawPayload: '' };
        }
    }
    async closeOrder(input) {
        const v = input.config.values;
        const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(input.orderNo)}/close`;
        try {
            await this.request(v, 'POST', path, JSON.stringify({ mchid: v.mchId }), '微信关单');
            return { state: 'closed', orderNo: input.orderNo, providerStatus: 'CLOSED', rawPayload: '' };
        }
        catch (e) {
            const err = e;
            if (err.code === 'ORDER_NOT_EXIST' || err.httpStatus === 404) {
                return { state: 'not_found', orderNo: input.orderNo, providerStatus: 'ORDER_NOT_EXIST', rawPayload: '' };
            }
            return { state: 'failed', orderNo: input.orderNo, error: err.message, rawPayload: '' };
        }
    }
    async verifyNotification(input) {
        const raw = input.rawBody.toString('utf8');
        const v = input.config.values;
        const h = (name) => {
            const val = input.headers?.[name];
            return Array.isArray(val) ? String(val[0] ?? '') : String(val ?? '');
        };
        const timestamp = h('wechatpay-timestamp');
        const nonce = h('wechatpay-nonce');
        const signature = h('wechatpay-signature');
        if (!timestamp || !nonce || !signature) {
            return { ok: false, ackSuccess: false, reason: '缺少微信回调签名头', rawPayload: raw };
        }
        if (!isFresh(timestamp)) {
            return { ok: false, ackSuccess: false, reason: '回调时间戳超出 5 分钟窗口（疑似重放）', rawPayload: raw };
        }
        const message = `${timestamp}\n${nonce}\n${raw}\n`;
        const verifier = (0, node_crypto_1.createVerify)('RSA-SHA256');
        verifier.update(message, 'utf8');
        verifier.end();
        let verified = false;
        try {
            verified = verifier.verify((0, types_1.normalizePem)(v.wechatPayPublicKey), signature, 'base64');
        }
        catch {
            verified = false;
        }
        if (!verified)
            return { ok: false, ackSuccess: false, reason: '回调验签失败', rawPayload: raw };
        let payload;
        try {
            const body = input.body;
            const resource = body.resource;
            if (!resource?.ciphertext || !resource?.nonce) {
                return { ok: false, ackSuccess: false, reason: '回调缺少 resource', rawPayload: raw };
            }
            payload = decryptResource(v.apiV3Key, {
                ciphertext: resource.ciphertext,
                nonce: resource.nonce,
                associated_data: resource.associated_data,
            });
        }
        catch (e) {
            return { ok: false, ackSuccess: false, reason: `回调解密失败: ${e.message}`, rawPayload: raw };
        }
        const orderNo = payload.out_trade_no ?? '';
        const tradeNo = payload.transaction_id ?? '';
        const eventId = h('wechatpay-serial') ? `${tradeNo || orderNo}` : tradeNo || orderNo;
        const state = mapTradeState(payload.trade_state);
        if (state === 'paid') {
            if (!orderNo || !tradeNo || !Number.isInteger(payload.amount?.total)) {
                return { ok: false, ackSuccess: false, reason: '回调字段不完整', rawPayload: raw };
            }
            return {
                ok: true,
                eventId,
                merchantOrderNo: orderNo,
                providerTradeNo: tradeNo,
                amountCents: payload.amount.total,
                currency: 'CNY',
                state: 'paid',
                paidAt: payload.success_time ? new Date(payload.success_time) : new Date(),
                providerStatus: payload.trade_state ?? 'SUCCESS',
                ackSuccess: true,
                rawPayload: raw,
            };
        }
        if (state === 'closed') {
            return {
                ok: true,
                eventId,
                merchantOrderNo: orderNo,
                providerTradeNo: tradeNo || orderNo,
                amountCents: payload.amount?.total ?? 0,
                currency: 'CNY',
                state: 'closed',
                providerStatus: payload.trade_state ?? 'CLOSED',
                ackSuccess: true,
                reason: '交易已关闭',
                rawPayload: raw,
            };
        }
        return {
            ok: false,
            ackSuccess: false,
            reason: `交易状态非成功: ${payload.trade_state ?? 'unknown'}`,
            rawPayload: raw,
        };
    }
    ack(result) {
        const accepted = result.ok ? result.ackSuccess : false;
        const body = accepted
            ? { code: 'SUCCESS', message: '成功' }
            : { code: 'FAIL', message: (result.ok ? result.reason ?? '处理失败' : result.reason).slice(0, 200) };
        return {
            status: accepted ? 200 : 500,
            body: JSON.stringify(body),
            contentType: 'application/json; charset=utf-8',
        };
    }
    async refund(input) {
        const v = input.config.values;
        const payload = JSON.stringify({
            out_trade_no: input.orderNo,
            out_refund_no: input.outRefundNo,
            reason: input.reason?.slice(0, 80),
            notify_url: undefined,
            amount: { refund: input.amountCents, total: input.totalCents, currency: 'CNY' },
        });
        try {
            const { text } = await this.request(v, 'POST', '/v3/refund/domestic/refunds', payload, '微信退款');
            const json = JSON.parse(text);
            const status = String(json.status ?? '');
            if (status === 'SUCCESS')
                return { state: 'succeeded', providerRefundId: json.refund_id, raw: text.slice(0, 1000) };
            if (status === 'PROCESSING')
                return { state: 'processing', providerRefundId: json.refund_id, raw: text.slice(0, 1000) };
            return {
                state: 'failed',
                providerRefundId: json.refund_id,
                error: `微信退款状态: ${status || 'unknown'}`,
                raw: text.slice(0, 1000),
            };
        }
        catch (e) {
            return {
                state: 'failed',
                error: `请求未完成（${e.message}）—— 结果未知, 请用同一退款单号重试或到商户后台核对`,
            };
        }
    }
    /**
     * 下载交易账单（`GET /v3/bill/tradebill`）。
     *
     * 微信先返回一个带签名的临时下载链接，再下载 CSV（GZIP）。任一步失败都抛错，
     * 由对账服务把 run 置 failed —— 空数组会被读成「当天没有交易」。
     */
    async downloadTradeBill(config, billDate) {
        const v = config.values;
        const path = `/v3/bill/tradebill?bill_date=${encodeURIComponent(billDate)}&bill_type=ALL`;
        const { text } = await this.request(v, 'GET', path, '', '微信账单');
        let url = '';
        try {
            url = JSON.parse(text).download_url ?? '';
        }
        catch {
            throw new Error('微信账单响应不是合法 JSON');
        }
        if (!url)
            throw new Error('微信账单未返回 download_url');
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok)
            throw new Error(`微信账单下载失败: HTTP ${res.status}`);
        const text2 = await res.text();
        return parseWechatBillCsv(text2);
    }
    /** 统一 v3 请求：签名 → 发送 → 出站响应验签 */
    async request(values, method, path, payload, label) {
        const apiBase = values.apiBase?.trim() || 'https://api.mch.weixin.qq.com';
        const timestamp = String(Math.floor(Date.now() / 1000));
        const nonce = (0, node_crypto_1.randomUUID)().replace(/-/g, '');
        const signature = signRequest((0, types_1.normalizePem)(values.merchantPrivateKey), method, path, timestamp, nonce, payload);
        const res = await fetch(`${apiBase}${path}`, {
            method,
            headers: {
                Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${values.mchId}",nonce_str="${nonce}",` +
                    `signature="${signature}",timestamp="${timestamp}",serial_no="${values.merchantSerialNo}"`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            ...(payload ? { body: payload } : {}),
            signal: AbortSignal.timeout(15000),
        });
        const text = await res.text();
        if (!res.ok) {
            let code = '';
            let message = text.slice(0, 200);
            try {
                const e = JSON.parse(text);
                code = e.code ?? '';
                message = `${e.code ?? ''} ${e.message ?? ''}`.trim() || message;
            }
            catch {
                /* 非 JSON 错误体原样透出 */
            }
            const err = new Error(`${label}失败 (HTTP ${res.status}): ${message}`);
            err.httpStatus = res.status;
            err.code = code;
            throw err;
        }
        verifyResponse(res.headers, text, (0, types_1.normalizePem)(values.wechatPayPublicKey), label);
        return { text, headers: res.headers };
    }
}
exports.WechatAdapter = WechatAdapter;
function signRequest(privateKey, method, path, timestamp, nonce, body) {
    const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
    const signer = (0, node_crypto_1.createSign)('RSA-SHA256');
    signer.update(message, 'utf8');
    signer.end();
    return signer.sign(privateKey, 'base64');
}
function verifyResponse(headers, body, publicKey, label) {
    const timestamp = headers.get('wechatpay-timestamp') ?? '';
    const nonce = headers.get('wechatpay-nonce') ?? '';
    const signature = headers.get('wechatpay-signature') ?? '';
    if (!timestamp || !nonce || !signature) {
        throw new Error(`${label}响应缺少验签头，无法确认来源`);
    }
    if (!isFresh(timestamp))
        throw new Error(`${label}响应时间戳超出 5 分钟窗口（疑似重放）`);
    const message = `${timestamp}\n${nonce}\n${body}\n`;
    const verifier = (0, node_crypto_1.createVerify)('RSA-SHA256');
    verifier.update(message, 'utf8');
    verifier.end();
    let verified = false;
    try {
        verified = verifier.verify(publicKey, signature, 'base64');
    }
    catch {
        verified = false;
    }
    if (!verified)
        throw new Error(`${label}响应验签失败（公钥不匹配或报文被篡改）`);
}
function decryptResource(apiV3Key, resource) {
    const key = Buffer.from(apiV3Key, 'utf8');
    if (key.length !== 32)
        throw new Error('APIv3 密钥必须是 32 字节');
    const raw = Buffer.from(resource.ciphertext, 'base64');
    const authTag = raw.subarray(raw.length - 16);
    const data = raw.subarray(0, raw.length - 16);
    const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'));
    decipher.setAuthTag(authTag);
    if (resource.associated_data)
        decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(plain);
}
function mapTradeState(state) {
    switch (state) {
        case 'SUCCESS':
            return 'paid';
        case 'NOTPAY':
        case 'USERPAYING':
            return 'pending';
        case 'CLOSED':
        case 'REVOKED':
        case 'PAYERROR':
            return 'closed';
        default:
            return 'failed';
    }
}
function parseWechatBillCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2)
        return [];
    const header = lines[0].replace(/^\uFEFF/, '').split(',').map((h) => h.replace(/`/g, '').trim());
    const col = (name) => header.findIndex((h) => h.includes(name));
    const iOrderNo = col('商户订单号');
    const iTradeNo = col('微信订单号');
    const iAmount = col('订单金额');
    const iStatus = col('交易状态');
    const iPaidAt = col('支付时间');
    if (iOrderNo < 0 || iTradeNo < 0 || iAmount < 0)
        throw new Error('微信账单表头无法识别');
    const rows = (0, csv_1.parseCsv)(lines.slice(1).join('\n'));
    const out = [];
    for (const row of rows) {
        const status = iStatus >= 0 ? (row[iStatus] ?? '').replace(/`/g, '').trim() : 'SUCCESS';
        if (status && status !== 'SUCCESS')
            continue;
        const merchantOrderNo = (row[iOrderNo] ?? '').replace(/`/g, '').trim();
        const providerTradeNo = (row[iTradeNo] ?? '').replace(/`/g, '').trim();
        const amountCents = (0, types_1.yuanToCents)((row[iAmount] ?? '').replace(/`/g, '').trim());
        if (!merchantOrderNo || !providerTradeNo || !Number.isFinite(amountCents))
            continue;
        const paidRaw = iPaidAt >= 0 ? (row[iPaidAt] ?? '').replace(/`/g, '').trim() : '';
        out.push({
            merchantOrderNo,
            providerTradeNo,
            amountCents,
            currency: 'CNY',
            paidAt: paidRaw ? new Date(paidRaw.replace(' ', 'T') + '+08:00') : new Date(),
            providerStatus: status || 'SUCCESS',
        });
    }
    return out;
}
function isFresh(timestamp) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts))
        return false;
    return Math.abs(Date.now() / 1000 - ts) <= 300;
}
function isAllowedApiBase(url) {
    try {
        const u = new URL(url);
        if (u.protocol !== 'https:')
            return false;
        return u.hostname === 'api.mch.weixin.qq.com' || (process.env.NODE_ENV !== 'production' && u.hostname === 'localhost');
    }
    catch {
        return false;
    }
}
/** 微信要求的 RFC3339 时间（带 +08:00 偏移） */
function rfc3339(d) {
    const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return (`${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
        `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}+08:00`);
}
function digestOf(raw) {
    return (0, node_crypto_1.createHash)('sha256').update(raw).digest('hex');
}
//# sourceMappingURL=wechat.adapter.js.map