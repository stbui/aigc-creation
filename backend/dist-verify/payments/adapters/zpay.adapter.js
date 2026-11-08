"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZpayAdapter = void 0;
exports.zpaySign = zpaySign;
exports.verifyZpaySign = verifyZpaySign;
const node_crypto_1 = require("node:crypto");
const types_1 = require("./types");
const DEFAULT_API_BASE = 'https://zpayz.cn';
const REQUEST_TIMEOUT_MS = 15_000;
/**
 * ZPay 聚合支付适配器。
 *
 * 协议来源：https://zpayz.cn/doc.html
 *   · 创建订单：POST /mapi.php（multipart form-data）；
 *   · 查单：GET /api.php?act=order；
 *   · 退款：POST /api.php?act=refund；
 *   · 异步通知：GET，返回纯文本 success 才算接收成功。
 *
 * 下单必须带用户真实 IP。这里只接受编排层从 `req.ip` 注入的 `clientIp`，
 * 绝不接受前端自报值。回调验签后再主动查单确认，避免伪造通知造成入账。
 */
class ZpayAdapter {
    constructor() {
        this.descriptor = {
            id: 'zpay',
            name: 'ZPay',
            icon: 'zpay',
            checkoutMode: 'redirect',
            supportedCurrencies: ['CNY'],
            supportsReconciliation: false,
            configFields: [
                {
                    name: 'apiBase',
                    label: 'API 地址',
                    type: 'url',
                    required: false,
                    default: DEFAULT_API_BASE,
                    maxLength: 512,
                    description: `默认 ${DEFAULT_API_BASE}；适配器自动拼接 /mapi.php 与 /api.php`,
                },
                {
                    name: 'pid',
                    label: '商户 ID（pid）',
                    type: 'text',
                    required: true,
                    identity: true,
                    maxLength: 128,
                    description: 'ZPay 商户后台的商户 ID',
                },
                {
                    name: 'key',
                    label: '商户密钥',
                    type: 'password',
                    required: true,
                    secret: true,
                    maxLength: 512,
                    description: '用于订单签名、回调验签及查单/退款接口认证',
                },
                {
                    name: 'type',
                    label: '支付方式',
                    type: 'select',
                    required: true,
                    default: 'alipay',
                    options: [
                        { value: 'alipay', label: '支付宝' },
                        { value: 'wxpay', label: '微信支付' },
                    ],
                    description: '文档取值：支付宝 alipay，微信支付 wxpay',
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
        if (!configPid(values))
            invalid.push('pid');
        if (!values.key?.trim())
            invalid.push('key');
        if (!configType(values))
            invalid.push('type');
        const apiBase = values.apiBase?.trim();
        if (apiBase && !(0, types_1.isAllowedPublicBase)(apiBase))
            invalid.push('apiBase');
        const publicBaseUrl = values.publicBaseUrl?.trim();
        if (publicBaseUrl && !(0, types_1.isAllowedPublicBase)(publicBaseUrl))
            invalid.push('publicBaseUrl');
        return Array.from(new Set(invalid));
    }
    async createOrder(input) {
        const values = input.config.values;
        const pid = configPid(values);
        const type = configType(values);
        const key = values.key?.trim() ?? '';
        const clientIp = input.clientIp?.trim() ?? '';
        if (!pid || !type || !key)
            throw new Error('ZPay 商户 ID、商户密钥或支付方式不完整');
        if (!clientIp)
            throw new Error('ZPay 下单缺少用户 IP，无法创建支付');
        if (input.currency !== 'CNY')
            throw new Error('ZPay 仅支持 CNY');
        const unsigned = {
            pid,
            type,
            out_trade_no: input.orderNo,
            notify_url: input.notifyUrl,
            name: input.subject.slice(0, 100),
            money: (0, types_1.centsToYuan)(input.amountCents),
            clientip: clientIp,
            device: 'pc',
            param: input.orderNo,
            sign_type: 'MD5',
        };
        const params = { ...unsigned, sign: zpaySign(unsigned, key) };
        const response = await this.request(apiEndpoint(values.apiBase, 'mapi.php'), {
            method: 'POST',
            body: toFormData(params),
        });
        const payUrl = firstHttpUrl(response.payurl, response.payurl2, response.qrcode, response.img);
        if (!payUrl)
            throw new Error('ZPay 下单响应缺少有效支付地址');
        const tradeNo = asString(response.trade_no).trim();
        const orderId = asString(response.O_id).trim();
        const qrcode = firstHttpUrl(response.qrcode);
        const directPayUrl = firstHttpUrl(response.payurl, response.payurl2);
        return {
            mode: directPayUrl ? 'redirect' : qrcode ? 'qrcode' : 'redirect',
            payUrl: directPayUrl || (!qrcode ? payUrl : undefined),
            codeUrl: !directPayUrl && qrcode ? qrcode : undefined,
            providerRef: tradeNo || orderId || undefined,
            expiresAt: input.expiresAt,
            hint: '请在 ZPay 收银台完成支付；支付结果以验签回调和主动查单为准。',
        };
    }
    async queryOrder(input) {
        const values = input.config.values;
        const pid = configPid(values);
        const key = values.key?.trim() ?? '';
        if (!pid || !key)
            return failedQuery(input.orderNo, 'ZPay 缺少商户 ID 或商户密钥，无法查单');
        try {
            const url = apiEndpoint(values.apiBase, 'api.php');
            url.searchParams.set('act', 'order');
            url.searchParams.set('pid', pid);
            url.searchParams.set('key', key);
            url.searchParams.set('out_trade_no', input.orderNo);
            const response = await this.request(url, { method: 'GET' });
            const returnedOrderNo = asString(response.out_trade_no).trim();
            if (returnedOrderNo !== input.orderNo) {
                return failedQuery(input.orderNo, 'ZPay 查单返回的商户订单号不匹配');
            }
            const returnedTradeNo = asString(response.trade_no).trim();
            const expectedTradeNo = input.providerRef?.trim() ?? '';
            if (expectedTradeNo && returnedTradeNo && returnedTradeNo !== expectedTradeNo) {
                return failedQuery(input.orderNo, 'ZPay 查单返回的渠道订单号不匹配');
            }
            const status = asInteger(response.status);
            if (status === null)
                return failedQuery(input.orderNo, 'ZPay 查单响应缺少有效订单状态');
            if (status === 1) {
                const amountCents = parseMoneyCents(asString(response.money));
                if (amountCents === null) {
                    return failedQuery(input.orderNo, 'ZPay 已支付订单的金额无效');
                }
                if (!returnedTradeNo)
                    return failedQuery(input.orderNo, 'ZPay 已支付订单缺少渠道订单号');
                return {
                    state: 'paid',
                    orderNo: input.orderNo,
                    tradeNo: returnedTradeNo,
                    amountCents,
                    currency: 'CNY',
                    providerStatus: 'ZPAY_STATUS_1',
                    rawPayload: JSON.stringify(response),
                };
            }
            if (status === 0) {
                return {
                    state: 'pending',
                    orderNo: input.orderNo,
                    tradeNo: returnedTradeNo || expectedTradeNo || undefined,
                    currency: 'CNY',
                    providerStatus: 'ZPAY_STATUS_0',
                    rawPayload: JSON.stringify(response),
                };
            }
            return failedQuery(input.orderNo, `ZPay 返回未知订单状态: ${status}`);
        }
        catch (e) {
            return failedQuery(input.orderNo, `ZPay 查单失败: ${e.message}`);
        }
    }
    async closeOrder(input) {
        return {
            state: 'failed',
            orderNo: input.orderNo,
            providerStatus: 'UNSUPPORTED',
            error: 'ZPay 文档没有关单接口；不能确认渠道订单已关闭，禁止本地关单',
            rawPayload: '',
        };
    }
    async verifyNotification(input) {
        const raw = input.rawBody.toString('utf8');
        const values = stringRecord(input.body ?? {});
        const pid = configPid(input.config.values);
        const key = input.config.values.key?.trim() ?? '';
        const expectedType = configType(input.config.values);
        if (!pid || !key || !expectedType) {
            return { ok: false, ackSuccess: false, reason: 'ZPay 渠道配置不完整', rawPayload: raw };
        }
        if (values.pid?.trim() !== pid) {
            return { ok: false, ackSuccess: false, reason: 'ZPay 回调商户 ID 不匹配', rawPayload: raw };
        }
        if (values.type && configType({ type: values.type }) !== expectedType) {
            return { ok: false, ackSuccess: false, reason: 'ZPay 回调支付方式不匹配', rawPayload: raw };
        }
        if (values.sign_type && values.sign_type.trim().toUpperCase() !== 'MD5') {
            return { ok: false, ackSuccess: false, reason: 'ZPay 回调签名类型不是 MD5', rawPayload: raw };
        }
        const tradeNo = values.trade_no?.trim() ?? '';
        const merchantOrderNo = values.out_trade_no?.trim() ?? '';
        const money = values.money?.trim() ?? '';
        const tradeStatus = values.trade_status?.trim() ?? '';
        if (!tradeNo || !merchantOrderNo || !money || !values.name?.trim()) {
            return { ok: false, ackSuccess: false, reason: 'ZPay 回调字段不完整', rawPayload: raw };
        }
        const amountCents = parseMoneyCents(money);
        if (amountCents === null) {
            return { ok: false, ackSuccess: false, reason: 'ZPay 回调金额格式无效', rawPayload: raw };
        }
        if (!verifyZpaySign(values, key)) {
            return { ok: false, ackSuccess: false, reason: 'ZPay 回调验签失败', rawPayload: raw };
        }
        if (tradeStatus !== 'TRADE_SUCCESS') {
            return { ok: false, ackSuccess: false, reason: `ZPay 回调不是成功状态: ${tradeStatus || 'empty'}`, rawPayload: raw };
        }
        // 文档明确建议收到通知后再查单确认，防止仅凭通知内容产生假入账。
        const queried = await this.queryOrder({
            config: input.config,
            orderNo: merchantOrderNo,
            providerRef: tradeNo,
        });
        if (queried.state !== 'paid') {
            return {
                ok: false,
                ackSuccess: false,
                reason: `ZPay 回调主动查单未确认支付: ${queried.error || queried.providerStatus || queried.state}`,
                rawPayload: raw,
            };
        }
        if (queried.amountCents !== amountCents) {
            return { ok: false, ackSuccess: false, reason: 'ZPay 回调金额与查单金额不一致', rawPayload: raw };
        }
        if (queried.tradeNo && queried.tradeNo !== tradeNo) {
            return { ok: false, ackSuccess: false, reason: 'ZPay 回调订单号与查单结果不一致', rawPayload: raw };
        }
        return {
            ok: true,
            eventId: `zpay:${tradeNo}:paid`,
            merchantOrderNo,
            providerTradeNo: tradeNo,
            providerRef: tradeNo,
            amountCents,
            currency: 'CNY',
            state: 'paid',
            providerStatus: tradeStatus,
            ackSuccess: true,
            rawPayload: raw,
        };
    }
    ack(result) {
        const accepted = result.ok ? result.ackSuccess : false;
        return {
            status: accepted ? 200 : 400,
            body: accepted ? 'success' : 'fail',
            contentType: 'text/plain; charset=utf-8',
        };
    }
    async refund(input) {
        const values = input.config.values;
        const pid = configPid(values);
        const key = values.key?.trim() ?? '';
        if (!pid || !key)
            return { state: 'failed', error: 'ZPay 缺少商户 ID 或商户密钥，无法退款' };
        const tradeNo = input.providerTradeNo?.trim() || input.providerRef?.trim() || '';
        const params = {
            pid,
            key,
            money: (0, types_1.centsToYuan)(input.amountCents),
            ...(tradeNo ? { trade_no: tradeNo } : { out_trade_no: input.orderNo }),
        };
        try {
            const url = apiEndpoint(values.apiBase, 'api.php');
            url.searchParams.set('act', 'refund');
            const response = await this.request(url, { method: 'POST', body: toFormData(params) });
            return { state: 'succeeded', raw: JSON.stringify(response) };
        }
        catch (e) {
            return { state: 'failed', error: `ZPay 退款失败: ${e.message}` };
        }
    }
    async request(url, init) {
        const res = await fetch(url, {
            ...init,
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const raw = await res.text();
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            throw new Error(`ZPay 响应不是合法 JSON (HTTP ${res.status})`);
        }
        if (!isRecord(parsed))
            throw new Error(`ZPay 响应格式无效 (HTTP ${res.status})`);
        const response = parsed;
        if (!res.ok) {
            throw new Error(`ZPay HTTP ${res.status}: ${asString(response.msg) || '请求失败'}`);
        }
        const code = asInteger(response.code);
        if (code !== 1) {
            throw new Error(asString(response.msg) || `ZPay API 返回 code=${String(response.code)}`);
        }
        return response;
    }
}
exports.ZpayAdapter = ZpayAdapter;
/** ZPay MD5 签名：参数名 ASCII 升序，排除 sign/sign_type/空值，末尾直接拼密钥。 */
function zpaySign(params, key) {
    const content = Object.keys(params)
        .filter((name) => name !== 'sign' && name !== 'sign_type')
        .filter((name) => params[name] !== undefined && params[name] !== null && params[name] !== '')
        .sort()
        .map((name) => `${name}=${params[name]}`)
        .join('&');
    return (0, node_crypto_1.createHash)('md5').update(`${content}${key ?? ''}`, 'utf8').digest('hex').toLowerCase();
}
function verifyZpaySign(params, key) {
    const actual = params.sign?.trim().toLowerCase() ?? '';
    if (!/^[a-f0-9]{32}$/.test(actual))
        return false;
    const expected = Buffer.from(zpaySign(params, key), 'hex');
    const provided = Buffer.from(actual, 'hex');
    return expected.length === provided.length && (0, node_crypto_1.timingSafeEqual)(expected, provided);
}
function configPid(values) {
    return values.pid?.trim() ?? '';
}
function configType(values) {
    const normalized = (values.type ?? '').trim().toLowerCase();
    if (['alipay', 'ali'].includes(normalized))
        return 'alipay';
    if (['wxpay', 'wx', 'wechat', 'weixin'].includes(normalized))
        return 'wxpay';
    return '';
}
function apiEndpoint(apiBase, endpoint) {
    const url = new URL(apiBase?.trim() || DEFAULT_API_BASE);
    let path = url.pathname.replace(/\/+$/, '');
    if (/\/(?:mapi|api|submit)\.php$/i.test(path)) {
        path = path.replace(/\/[^/]+$/, `/${endpoint}`);
    }
    else if (!path) {
        path = `/${endpoint}`;
    }
    else {
        path = `${path}/${endpoint}`;
    }
    url.pathname = path;
    url.search = '';
    url.hash = '';
    return url;
}
function toFormData(params) {
    const form = new FormData();
    for (const [name, value] of Object.entries(params))
        form.set(name, value);
    return form;
}
function firstHttpUrl(...values) {
    for (const value of values) {
        const normalized = asString(value).trim().replace(/\\u003d/gi, '=');
        if (!normalized)
            continue;
        try {
            const url = new URL(normalized);
            if (url.protocol === 'http:' || url.protocol === 'https:')
                return normalized;
        }
        catch {
            // 继续尝试下一个候选字段
        }
    }
    return '';
}
function parseMoneyCents(value) {
    const normalized = value.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized))
        return null;
    const cents = (0, types_1.yuanToCents)(normalized);
    return Number.isFinite(cents) ? cents : null;
}
function failedQuery(orderNo, error) {
    return {
        state: 'failed',
        orderNo,
        providerStatus: 'QUERY_FAILED',
        error,
        rawPayload: '',
    };
}
function stringRecord(body) {
    const out = {};
    for (const [key, value] of Object.entries(body)) {
        if (value === null || value === undefined)
            continue;
        if (typeof value === 'string')
            out[key] = value;
        else if (typeof value === 'number' || typeof value === 'boolean')
            out[key] = String(value);
    }
    return out;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function asString(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function asInteger(value) {
    if (typeof value === 'number')
        return Number.isInteger(value) ? value : null;
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim()))
        return Number.parseInt(value, 10);
    return null;
}
//# sourceMappingURL=zpay.adapter.js.map