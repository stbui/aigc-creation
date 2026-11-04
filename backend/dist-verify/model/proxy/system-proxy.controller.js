"use strict";
/**
 * 系统渠道中转的两个入口。
 *
 * · `ANY /api/v1/ai/system/:channelId/*path` —— 显式入口，路径里带渠道 id；
 * · `ANY /api/v1/:channelId/*path`          —— 短路径，兼容「把 base URL 配成
 *   `https://host/api/v1/{channelId}`」的第三方 SDK。
 *
 * 为什么用 `@All` + 原始 `@Res()`：中转要原样透传上游状态码、`text/event-stream`
 * 与二进制响应体，而全局 `ResponseInterceptor` 会把返回值包成
 * `{code,data,message}`。拿到原始响应对象后由 service 自行结束连接，
 * 与参考实现的 `c.Writer` 直写等价（见 `proxy.http.ts` 顶部说明）。
 *
 * 注册顺序：`ProxyModule` 在 `AppModule` 中最后一个导入，短路径 catch-all
 * 因此排在全部业务路由之后 —— 业务路由永远优先匹配。
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShortProxyController = exports.SystemProxyController = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_auth_guard_1 = require("../../common/jwt-auth.guard");
const rate_limit_guard_1 = require("../../common/rate-limit.guard");
const proxy_constants_1 = require("./proxy.constants");
const proxy_paths_1 = require("./proxy.paths");
const proxy_http_1 = require("./proxy.http");
const proxy_config_1 = require("./proxy.config");
const system_proxy_service_1 = require("./system-proxy.service");
/** 系统中转的限流配额（每条渠道共用；`MODEL_PROXY_SYSTEM_RATE_LIMIT` 可覆盖） */
const SYSTEM_RATE_LIMIT = { limit: 120, windowSec: 60 };
let SystemProxyController = class SystemProxyController {
    constructor(config, proxy) {
        this.config = config;
        this.proxy = proxy;
    }
    /** 显式入口：`/ai/system/:channelId/...` */
    async relay(channelId, req, res) {
        await relaySystem(this.config, this.proxy, req, res, channelId, wildcardPath(req.params.path));
    }
};
exports.SystemProxyController = SystemProxyController;
__decorate([
    (0, common_1.All)('system/:channelId/*path'),
    (0, rate_limit_guard_1.RateLimit)({
        scope: 'user',
        name: 'proxy-system',
        limitEnv: 'MODEL_PROXY_SYSTEM_RATE_LIMIT',
        ...SYSTEM_RATE_LIMIT,
    }),
    __param(0, (0, common_1.Param)('channelId')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], SystemProxyController.prototype, "relay", null);
exports.SystemProxyController = SystemProxyController = __decorate([
    (0, common_1.Controller)('ai'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [config_1.ConfigService,
        system_proxy_service_1.SystemProxyService])
], SystemProxyController);
/**
 * 短路径入口：`/api/v1/:channelId/...`。
 *
 * 只有「两段及以上、且首段不是保留前缀」才可能是中转；保留前缀（`tasks`、
 * `admin`、`models` 等）说明这是业务路由，回 404 交给标准信封 ——
 * **不能**把业务路由的错误吞成上游连接失败。
 */
let ShortProxyController = class ShortProxyController {
    constructor(config, proxy) {
        this.config = config;
        this.proxy = proxy;
    }
    async relay(channelId, req, res) {
        if ((0, proxy_paths_1.isReservedApiPrefix)(channelId)) {
            // 与未匹配路由同样的 404，不泄漏「这里其实有个中转入口」
            (0, proxy_http_1.writeProxyError)(res, 404, 40401, '接口不存在');
            return;
        }
        await relaySystem(this.config, this.proxy, req, res, channelId, wildcardPath(req.params.path));
    }
};
exports.ShortProxyController = ShortProxyController;
__decorate([
    (0, common_1.All)(':channelId/*path'),
    (0, rate_limit_guard_1.RateLimit)({
        scope: 'user',
        name: 'proxy-system',
        limitEnv: 'MODEL_PROXY_SYSTEM_RATE_LIMIT',
        ...SYSTEM_RATE_LIMIT,
    }),
    __param(0, (0, common_1.Param)('channelId')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], ShortProxyController.prototype, "relay", null);
exports.ShortProxyController = ShortProxyController = __decorate([
    (0, common_1.Controller)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [config_1.ConfigService,
        system_proxy_service_1.SystemProxyService])
], ShortProxyController);
// ── 共享处理 ──────────────────────────────────────────────────────────
/**
 * 两个入口的唯一差别是渠道 id 从哪来，其余（读体、配额、透传）必须完全一致 ——
 * 否则修好一个入口的 bug 会漏掉另一个。
 */
async function relaySystem(config, proxy, req, res, channelId, providerPath) {
    const limits = (0, proxy_config_1.readProxyLimits)(config);
    let body;
    try {
        body = await (0, proxy_http_1.readProxyBody)(req, limits.systemRequestBytes);
    }
    catch (error) {
        if (error instanceof proxy_http_1.ProxyBodyTooLargeError) {
            (0, proxy_http_1.writeProxyError)(res, 413, 40001, `请求体超过中转上限（${Math.round(limits.systemRequestBytes / 1024 / 1024)}MB）`);
            // 剩余字节必须丢弃，否则连接会因未读完请求体而挂住
            req.resume();
            return;
        }
        (0, proxy_http_1.writeProxyError)(res, 400, 40001, messageOf(error) || '请求体读取失败');
        return;
    }
    await proxy.proxy({
        userId: String(req.user?.id ?? ''),
        channelId: String(channelId ?? ''),
        method: String(req.method ?? ''),
        providerPath,
        query: queryOf(req),
        contentType: headerText(req.headers['content-type']),
        accept: headerText(req.headers['accept']),
        scene: headerText(req.headers[proxy_constants_1.PROXY_SCENE_HEADER]).trim() || proxy_constants_1.PROXY_SCENE,
        idempotencyKey: headerText(req.headers[proxy_constants_1.PROXY_IDEMPOTENCY_HEADER]).trim(),
        body,
        res,
    });
}
/**
 * Express 5 的通配参数是**分段数组**（`['v1','chat','completions']`），
 * 需要还原成带前导斜杠的路径交给 `normalizeProxyPath` 做点段归一。
 */
function wildcardPath(value) {
    if (Array.isArray(value))
        return `/${value.map((part) => String(part)).join('/')}`;
    return `/${String(value ?? '')}`;
}
/** 查询串从 `originalUrl` 取：`req.query` 已被 Express 解析并可能改形（数组/嵌套） */
function queryOf(req) {
    const raw = String(req.originalUrl ?? req.url ?? '');
    const index = raw.indexOf('?');
    return new URLSearchParams(index >= 0 ? raw.slice(index + 1) : '');
}
function headerText(value) {
    if (Array.isArray(value))
        return String(value[0] ?? '');
    return String(value ?? '');
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error ?? '');
}
//# sourceMappingURL=system-proxy.controller.js.map