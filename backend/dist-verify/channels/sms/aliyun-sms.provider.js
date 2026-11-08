"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AliyunSmsProvider = void 0;
const http_client_1 = require("../http-client");
const aliyun_signature_1 = require("../aliyun-signature");
/**
 * 阿里云短信（SendSms，2017-05-25）。
 *
 * 为什么不复用 `HttpSmsProvider`：阿里云的签名是 RPC 签名（HMAC-SHA1 over
 * canonical query），通用网关契约（Bearer + JSON）对它完全无效。两者只能并存。
 *
 * 模板短信的三件必填：签名（`ALIYUN_SMS_SIGN_NAME`）、模板号
 * （`ALIYUN_SMS_TEMPLATE_CODE`）、模板变量（这里是 `{"code":"123456"}`）。
 * 文档默认模板变量名是 `code`；换成 `verifyCode` 之类的模板时，
 * 短信内容会以「变量缺失」失败 —— 那属于模板配置错，不在这里猜。
 *
 * 凭据缺失的处理在 `SmsService`：告警 + 回落控制台，**不抛异常**
 * （短信不是核心链路，但 `status().delivers` 会如实报 false）。
 */
class AliyunSmsProvider {
    constructor(accessKeyId, accessKeySecret, sign, templateCode, endpoint, regionId) {
        this.accessKeyId = accessKeyId;
        this.accessKeySecret = accessKeySecret;
        this.sign = sign;
        this.templateCode = templateCode;
        this.endpoint = endpoint;
        this.regionId = regionId;
        this.name = 'aliyun-sms';
        this.delivers = true;
    }
    async send(message) {
        const req = (0, aliyun_signature_1.buildRpcRequest)({
            action: 'SendSms',
            version: '2017-05-25',
            accessKeyId: this.accessKeyId,
            accessKeySecret: this.accessKeySecret,
            regionId: this.regionId,
            extra: {
                PhoneNumbers: message.to,
                SignName: this.sign,
                TemplateCode: this.templateCode,
                // 模板变量只传验证码本身：正文由阿里云模板渲染，服务端不拼完整文案
                TemplateParam: JSON.stringify({ code: message.code }),
            },
        });
        const res = await (0, http_client_1.postForm)({ url: this.endpoint, body: req.body });
        const parsed = (0, aliyun_signature_1.parseRpcResult)(res.bodyText, res.status, res.ok);
        if (!parsed.ok) {
            return { ok: false, provider: this.name, delivered: false, error: parsed.error };
        }
        return { ok: true, provider: this.name, delivered: true, messageId: parsed.messageId };
    }
}
exports.AliyunSmsProvider = AliyunSmsProvider;
//# sourceMappingURL=aliyun-sms.provider.js.map