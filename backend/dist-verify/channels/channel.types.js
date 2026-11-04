"use strict";
/**
 * 外部消息通道的公共契约（邮件 / 短信）。
 *
 * 为什么是「适配器 + 控制台兜底」而不是直接接某一家 SDK
 * ---------------------------------------------------
 * 本项目零新增依赖（见 CLAUDE.md「环境注意事项」第 4 条），而邮件服务商
 * 与短信服务商都只是「HTTP POST 一个 JSON」—— 用内置 `fetch` 就够，不必
 * 为每一家引入一棵依赖树。内置两种实现：
 *   - `console` —— 开发/测试默认。不发网络请求，把消息写进 `logs/outbox/`
 *                  并以 WARN 级别说明「未真实投递」。
 *   - `http`    —— 填了 API URL 即启用，按通用 JSON 契约调用服务商接口。
 *
 * 无论哪种实现，返回值都带 `delivered` 标志 —— 调用方（如忘记密码）
 * 必须能区分「邮件真的发出去了」与「只是写进了本地文件」，否则在没配
 * 通道的环境里，用户会看到「重置邮件已发送」而永远收不到信。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.maskPhone = maskPhone;
exports.maskEmail = maskEmail;
/** 手机号脱敏：138****8000。日志与后台展示一律用它，不落完整号码 */
function maskPhone(phone) {
    const p = String(phone || '').trim();
    if (p.length < 7)
        return p ? `${p.slice(0, 1)}****` : '';
    return `${p.slice(0, 3)}****${p.slice(-4)}`;
}
/** 邮箱脱敏：ab***@example.com。用于审计与日志 */
function maskEmail(email) {
    const s = String(email || '').trim();
    const at = s.indexOf('@');
    if (at <= 0)
        return s;
    const head = s.slice(0, at);
    const tail = s.slice(at);
    if (head.length <= 2)
        return `${head[0] || '*'}***${tail}`;
    return `${head.slice(0, 2)}***${tail}`;
}
//# sourceMappingURL=channel.types.js.map