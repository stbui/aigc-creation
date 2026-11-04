"use strict";
/**
 * 支付适配器契约（2026-11 支付重构）。
 *
 * 与旧 `PaymentProvider` 的差别：
 *   1. **凭据来自数据库配置**，适配器只能读 `PaymentContext.values`，不得读 env；
 *   2. 新增 `queryOrder / closeOrder / downloadTradeBill`，让查单、关单、对账走同一实现；
 *   3. `verifyNotification` 返回归一化结果，不再由编排层理解各渠道报文差异。
 *
 * 状态口径：`failed` 表示「渠道明确报错或网络失败」，`not_found` 表示
 * 「渠道确认查无此单」。两者不可混用 —— 只有 `not_found` 才允许本地关单。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYMENT_CURRENCIES = exports.PAYMENT_PROVIDER_IDS = void 0;
exports.centsToYuan = centsToYuan;
exports.yuanToCents = yuanToCents;
exports.normalizePem = normalizePem;
exports.isAllowedPublicBase = isAllowedPublicBase;
exports.PAYMENT_PROVIDER_IDS = [
    'sandbox',
    'alipay',
    'wechat',
    'paypal',
    'stripe',
    'epay',
    'zpay',
];
exports.PAYMENT_CURRENCIES = ['CNY', 'USD'];
/** 元 / 分转换（金额边界唯一入口，禁止散落的 /100） */
function centsToYuan(cents) {
    return (Math.round(cents) / 100).toFixed(2);
}
function yuanToCents(yuan) {
    const n = typeof yuan === 'number' ? yuan : Number.parseFloat(String(yuan));
    if (!Number.isFinite(n))
        return Number.NaN;
    return Math.round(n * 100);
}
/** PEM 归一化：环境变量/后台粘贴常把换行写成字面 `\n` */
function normalizePem(raw) {
    const value = String(raw ?? '').trim();
    if (!value)
        return '';
    return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}
/**
 * 渠道回调公网地址校验。
 *
 * 生产必须是 HTTPS；开发/测试允许 http://localhost / 127.0.0.1，方便本机联调。
 * 不限制具体域名 —— 这是商户自己的回调域名，平台不替它做白名单。
 */
function isAllowedPublicBase(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:')
            return true;
        if (process.env.NODE_ENV === 'production')
            return false;
        return (parsed.protocol === 'http:' &&
            (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'));
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=types.js.map