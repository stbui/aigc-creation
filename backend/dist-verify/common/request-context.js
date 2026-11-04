"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUEST_ID_HEADER = void 0;
exports.currentRequestId = currentRequestId;
exports.currentRequestContext = currentRequestContext;
exports.bindRequestUser = bindRequestUser;
exports.requestContextMiddleware = requestContextMiddleware;
/**
 * 请求上下文（requestId 贯穿）。
 *
 * 解决什么问题
 * -----------
 * 用户报障时只有一句话「刚才生成失败了」。日志里有几百条错误，没有一条能和
 * 这次请求对上 —— 前端看到的错误响应、后端落盘的异常、模型通道的调用记录
 * 是三份互不相干的文本。
 *
 * 这里用 `AsyncLocalStorage` 在请求入口生成/透传一个 requestId：
 *   · 响应头 `X-Request-Id` 回写给前端（前端在错误提示里透出）；
 *   · 异常响应体带上 `requestId`；
 *   · 日志行前缀带上 `[rid=...]`；
 *   · 业务代码可用 `currentRequestId()` 取到，无需层层传参。
 *
 * 为什么用 AsyncLocalStorage 而不是把 request 塞进全局
 * -------------------------------------------------
 * 全局变量在并发请求下会串号（A 请求读到 B 的 id），排障时比没有更糟。
 * AsyncLocalStorage 天然按异步调用链隔离，且对现有函数签名零侵入。
 *
 * 客户端传入的 `X-Request-Id` 会做**格式白名单**后采用（便于前后端串联），
 * 但只接受 `[A-Za-z0-9_-]{8,64}` —— 放任任意字符串进日志等于给了日志注入入口。
 */
const node_async_hooks_1 = require("node:async_hooks");
const node_crypto_1 = require("node:crypto");
exports.REQUEST_ID_HEADER = 'x-request-id';
const INCOMING_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const storage = new node_async_hooks_1.AsyncLocalStorage();
function currentRequestId() {
    return storage.getStore()?.requestId;
}
/** 供守卫/日志使用；无上下文时返回 undefined（如脚本、定时任务） */
function currentRequestContext() {
    return storage.getStore();
}
/** 鉴权成功后回填 userId（不产生新上下文，只补充当前这一条） */
function bindRequestUser(userId) {
    const store = storage.getStore();
    if (store)
        store.userId = userId;
}
/** Express 中间件：必须注册在任何路由/守卫之前 */
function requestContextMiddleware(req, res, next) {
    const incoming = req.headers[exports.REQUEST_ID_HEADER];
    const requestId = typeof incoming === 'string' && INCOMING_ID_RE.test(incoming) ? incoming : (0, node_crypto_1.randomUUID)();
    res.setHeader('X-Request-Id', requestId);
    // 暴露给浏览器 JS（跨域时需要显式声明，否则 fetch 读不到）
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, Retry-After');
    req.requestId = requestId;
    storage.run({ requestId, method: req.method, path: req.originalUrl?.split('?')[0] }, () => {
        next();
    });
}
//# sourceMappingURL=request-context.js.map