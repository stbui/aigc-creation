"use strict";
/**
 * 上游请求的最后一段装配：目标 URL 与凭证注入。
 *
 * 为什么不能直接用 `applyProtocolAuth`：那条路径要求手上有一份 `ManifestAuth`
 * （插件声明的鉴权方式），而中转只有**客户端发来的原始报文**，没有清单上下文。
 * 中转的鉴权族由 `protocolProxyRule` 归类为五种（openai / claude / gemini /
 * minimax-video / agnes），每族的凭证头是固定的三选一 —— 在没有签名的前提下
 * 这就是全部可能，签名类协议已在白名单层被拒绝。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyProxyAuth = applyProxyAuth;
exports.proxyTargetUrl = proxyTargetUrl;
exports.appendQuery = appendQuery;
const executor_1 = require("../protocol/executor");
const auth_1 = require("../protocol/auth");
/**
 * 按协议族写入凭证头。
 *
 * 三处差异是上游厂商的硬事实，不是可配置项：
 *   · Gemini 只认 `x-goog-api-key`，写 Bearer 会 400；
 *   · Claude 只认 `x-api-key`，且必须带 `anthropic-version`；
 *   · 其余（OpenAI 兼容 / MiniMax / Agnes）走 `Authorization: Bearer`。
 */
function applyProxyAuth(headers, family, apiKey) {
    const secret = String(apiKey ?? '');
    if (family === 'gemini') {
        (0, auth_1.setHeader)(headers, 'x-goog-api-key', secret);
        return;
    }
    if (family === 'claude') {
        (0, auth_1.setHeader)(headers, 'x-api-key', secret);
        if (!(0, auth_1.getHeader)(headers, 'anthropic-version'))
            (0, auth_1.setHeader)(headers, 'anthropic-version', '2023-06-01');
        return;
    }
    (0, auth_1.setHeader)(headers, 'Authorization', `Bearer ${secret}`);
}
/**
 * 拼接上游目标地址。
 *
 * Agnes 的查询接口是**渠道域名下的固定路径**（`/agnesapi`），与 baseURL 上
 * 残留的版本前缀无关，因此单独按 origin 处理；其余按协议默认前缀走
 * `apiUrlWithPrefix`（Gemini `/v1beta`，OpenAI 兼容 `/v1`）。
 */
function proxyTargetUrl(baseUrl, path, family, defaultPrefix) {
    if (family === 'agnes' && path.startsWith('/agnesapi')) {
        const base = new URL(String(baseUrl ?? '').trim());
        base.pathname = path;
        base.search = '';
        base.hash = '';
        return base.toString();
    }
    return (0, executor_1.apiUrlWithPrefix)(baseUrl, path, defaultPrefix);
}
/** 把查询串追加到已拼好的目标地址（不覆盖已有查询串） */
function appendQuery(target, query) {
    const text = String(query ?? '');
    if (text === '')
        return target;
    return `${target}${target.includes('?') ? '&' : '?'}${text}`;
}
//# sourceMappingURL=proxy.upstream.js.map