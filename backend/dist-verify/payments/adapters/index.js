"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAdapter = getAdapter;
exports.requireAdapter = requireAdapter;
exports.allAdapters = allAdapters;
const types_1 = require("./types");
const sandbox_adapter_1 = require("./sandbox.adapter");
const alipay_adapter_1 = require("./alipay.adapter");
const wechat_adapter_1 = require("./wechat.adapter");
const paypal_adapter_1 = require("./paypal.adapter");
const stripe_adapter_1 = require("./stripe.adapter");
const epay_adapter_1 = require("./epay.adapter");
const zpay_adapter_1 = require("./zpay.adapter");
/**
 * 适配器注册表。唯一事实源是这里 —— 新增渠道只改这一处 + 一个 adapter 文件，
 * 后台「支付渠道」页的字段清单由 `descriptor.configFields` 直接驱动。
 */
const ADAPTERS = {
    sandbox: new sandbox_adapter_1.SandboxAdapter(),
    alipay: new alipay_adapter_1.AlipayAdapter(),
    wechat: new wechat_adapter_1.WechatAdapter(),
    paypal: new paypal_adapter_1.PaypalAdapter(),
    stripe: new stripe_adapter_1.StripeAdapter(),
    epay: new epay_adapter_1.EpayAdapter(),
    zpay: new zpay_adapter_1.ZpayAdapter(),
};
function getAdapter(providerId) {
    if (!types_1.PAYMENT_PROVIDER_IDS.includes(providerId))
        return null;
    return ADAPTERS[providerId];
}
function requireAdapter(providerId) {
    const adapter = getAdapter(providerId);
    if (!adapter)
        throw new Error(`未知支付渠道: ${providerId}`);
    return adapter;
}
function allAdapters() {
    return types_1.PAYMENT_PROVIDER_IDS.map((id) => ADAPTERS[id]);
}
__exportStar(require("./types"), exports);
//# sourceMappingURL=index.js.map