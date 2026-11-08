"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsoleSmsProvider = void 0;
const common_1 = require("@nestjs/common");
const channel_types_1 = require("../channel.types");
const console_outbox_1 = require("../console-outbox");
/**
 * 控制台短信实现 —— 把验证码写进 `logs/outbox/sms-<日期>.log` 并打一条日志。
 *
 * 控制台日志里**完整打印验证码**（手机号仍打码）：这是开发/测试环境唯一
 * 能拿到验证码的途径，否则短信登录在本地完全无法自测。真实投递由
 * `SMS_PROVIDER=http` 负责，那时不会有任何验证码进入日志。
 */
class ConsoleSmsProvider {
    constructor(sign) {
        this.sign = sign;
        this.name = 'console';
        this.delivers = false;
        this.logger = new common_1.Logger(ConsoleSmsProvider.name);
    }
    async send(message) {
        (0, console_outbox_1.writeOutbox)({
            channel: 'sms',
            to: message.to,
            subject: this.sign,
            body: message.text,
            provider: this.name,
            at: new Date().toISOString(),
        });
        /*
         * 生产环境**不打印验证码**：控制台通道意味着「没配短信服务商」，
         * 此时把验证码写进日志等于让任何能读日志的人登录任意手机号。
         * 开发/测试打印是为了能自测短信登录。
         */
        const showCode = process.env.NODE_ENV !== 'production';
        this.logger.warn(`[控制台短信] ${(0, channel_types_1.maskPhone)(message.to)} ${showCode ? `验证码 ${message.code}` : '验证码已生成(不打印)'}` +
            '（未真实投递，见 logs/outbox/sms-*.log）');
        return { ok: true, provider: this.name, delivered: false };
    }
}
exports.ConsoleSmsProvider = ConsoleSmsProvider;
//# sourceMappingURL=console-sms.provider.js.map