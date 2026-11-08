"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsoleEmailProvider = void 0;
const console_outbox_1 = require("../console-outbox");
/**
 * 控制台邮件实现 —— 不发网络请求，把正文写进 `logs/outbox/email-<日期>.log`。
 *
 * `delivers` 恒为 false：任何「已发送」的用户提示都必须据此区分真实投递，
 * 否则在没配通道的环境里用户会一直等一封永远不会到的邮件。
 */
class ConsoleEmailProvider {
    constructor(from) {
        this.from = from;
        this.name = 'console';
        this.delivers = false;
    }
    async send(message) {
        (0, console_outbox_1.writeOutbox)({
            channel: 'email',
            to: message.to,
            subject: message.subject,
            body: message.text,
            provider: this.name,
            at: new Date().toISOString(),
        });
        return { ok: true, provider: this.name, delivered: false };
    }
}
exports.ConsoleEmailProvider = ConsoleEmailProvider;
//# sourceMappingURL=console-email.provider.js.map