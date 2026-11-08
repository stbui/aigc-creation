"use strict";
/**
 * 自定义渠道中转：用户自带上游地址与密钥，本系统只做「安全的转发」。
 *
 * 与系统渠道中转的三处本质差异：
 *   1. **不计费** —— 上游费用由用户自己的 Key 承担，所以没有账单、没有结算；
 *   2. **目标与凭证都来自请求头** —— 因此出站校验用更严的 `strictRelay`
 *      （禁止 HTTP、禁止重定向、拒绝保留网段），否则这个接口就是一台开放代理；
 *   3. **响应必须脱敏** —— 用户把 Key 交给我们转发，上游错误信息经常原样回显它；
 *      不脱敏等于把用户的密钥写进他自己的浏览器控制台与我们的日志。
 *
 * 为什么密钥走 `x-canvas-upstream-key` 而不是 `Authorization`：本系统的鉴权
 * 占用了 `Authorization: Bearer <本系统令牌>`，两者不能共用一个头。
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
var CustomRelayService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomRelayService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const outbound_1 = require("../infra/outbound");
const model_catalog_client_1 = require("../catalog/model-catalog.client");
const json_1 = require("../domain/json");
const proxy_paths_1 = require("./proxy.paths");
const proxy_constants_1 = require("./proxy.constants");
const proxy_config_1 = require("./proxy.config");
const custom_relay_slot_service_1 = require("./custom-relay-slot.service");
const proxy_upstream_1 = require("./proxy.upstream");
const proxy_http_1 = require("./proxy.http");
/** 上游失败时最多透传多少错误正文（够看清原因，又不至于把大响应变成放大器） */
const MAX_ERROR_BODY_BYTES = 64 * 1024;
const MAX_API_KEY_LENGTH = 512;
/** 允许二进制透传的路径族：视频内容下载与语音合成 */
const VIDEO_CONTENT_PATH = /(?:^|\/)videos\/[^/]+\/content$/;
let CustomRelayService = CustomRelayService_1 = class CustomRelayService {
    constructor(config, slots, catalog) {
        this.config = config;
        this.slots = slots;
        this.catalog = catalog;
        this.log = new common_1.Logger(CustomRelayService_1.name);
    }
    /** 转发一次自定义渠道请求 */
    async relay(input) {
        const res = input.res;
        const limits = (0, proxy_config_1.readProxyLimits)(this.config);
        if (!limits.enabled) {
            (0, proxy_http_1.writeProxyError)(res, 503, 50303, '中转服务已关闭');
            return;
        }
        const method = String(input.method ?? '').toUpperCase();
        // 1. 目标地址：自定义渠道用严格判定（禁重定向、禁 HTTP、禁保留网段）
        let target;
        try {
            target = await (0, outbound_1.validateCustomRelayUrl)(String(input.headers[proxy_constants_1.CUSTOM_RELAY_URL_HEADER] ?? ''));
        }
        catch (error) {
            (0, proxy_http_1.writeProxyError)(res, 403, 40301, outboundMessage(error));
            return;
        }
        // 2. 格式与路径授权
        const format = String(input.headers[proxy_constants_1.CUSTOM_RELAY_FORMAT_HEADER] ?? '').trim().toLowerCase() || 'openai';
        if (!isSupportedFormat(format)) {
            (0, proxy_http_1.writeProxyError)(res, 400, 40001, '自定义渠道调用格式仅支持 openai / gemini / claude');
            return;
        }
        try {
            // 先规范化再判定：解码百分号、拒绝反斜杠/NUL、要求 path.Clean 不变形，
            // 与系统渠道入口共用同一套语义；自定义入口额外限制路径长度。
            const relayPath = (0, proxy_paths_1.normalizeProxyPath)(target.pathname);
            if (Buffer.byteLength(relayPath, 'utf8') > 2048)
                throw new Error('请求路径过长');
            (0, proxy_paths_1.authorizeCustomRelay)({
                method,
                path: relayPath,
                query: target.searchParams,
                format,
                contentType: input.contentType,
            });
        }
        catch (error) {
            (0, proxy_http_1.writeProxyError)(res, 403, 40301, messageOf(error));
            return;
        }
        // 3. 上游密钥与自定义头
        const apiKey = String(input.headers[proxy_constants_1.CUSTOM_RELAY_KEY_HEADER] ?? '');
        if (!isValidApiKey(apiKey)) {
            (0, proxy_http_1.writeProxyError)(res, 401, 40101, '自定义渠道 API Key 无效');
            return;
        }
        let outboundHeaders;
        try {
            outboundHeaders = decodeRelayHeaders(input.headers[proxy_constants_1.CUSTOM_RELAY_HEADERS_HEADER]);
        }
        catch (error) {
            (0, proxy_http_1.writeProxyError)(res, 400, 40001, messageOf(error));
            return;
        }
        // 4. 体积与请求形态
        if (method === 'GET' && input.body.length > 0) {
            (0, proxy_http_1.writeProxyError)(res, 400, 40001, '模型列表请求不允许携带请求体');
            return;
        }
        // 5. 按用户并发槽（拿不到直接 429，不排队）
        const release = this.slots.acquire(input.userId, limits.customConcurrency);
        if (!release) {
            (0, proxy_http_1.writeProxyError)(res, 429, 42901, '自定义渠道并发请求过多，请等待已有请求完成');
            return;
        }
        try {
            const headers = {};
            if (input.contentType)
                headers['Content-Type'] = input.contentType;
            headers['Accept'] = input.accept || 'application/json';
            for (const header of outboundHeaders)
                headers[header.name] = header.value;
            (0, proxy_upstream_1.applyProxyAuth)(headers, format, apiKey);
            let upstream;
            try {
                upstream = await (0, outbound_1.outboundRequest)(target.toString(), {
                    method,
                    headers,
                    body: method === 'GET' ? undefined : input.body,
                    timeoutMs: limits.customTimeoutMs,
                    strictRelay: true,
                    stream: true,
                });
            }
            catch (error) {
                (0, proxy_http_1.writeProxyError)(res, 502, 50201, '自定义渠道上游连接失败');
                this.log.warn(`自定义中转上游连接失败：${messageOf(error)}`);
                return;
            }
            await this.writeResponse(res, upstream, apiKey, target.pathname, limits.customResponseBytes);
        }
        finally {
            release();
        }
    }
    /** 拉取用户自定义渠道的上游模型目录（`POST /ai/models`） */
    async listModels(input) {
        try {
            return await this.catalog.fetch({
                baseUrl: input.baseUrl,
                apiKey: input.apiKey,
                apiFormat: input.apiFormat,
                headers: input.headers,
            });
        }
        catch (error) {
            if (error instanceof json_1.ModelDomainError)
                throw error;
            throw new json_1.ModelDomainError(messageOf(error) || '拉取上游模型目录失败', 50201);
        }
    }
    // ── 响应 ────────────────────────────────────────────────────────────
    async writeResponse(res, upstream, apiKey, upstreamPath, responseLimit) {
        const statusCode = upstream.statusCode ?? 0;
        const streamed = (0, proxy_http_1.isEventStream)(upstream.headers);
        if (statusCode < 200 || statusCode >= 300) {
            await this.writeUpstreamError(res, upstream, apiKey, statusCode);
            return;
        }
        if (streamed) {
            (0, proxy_http_1.copyProxyResponseHeaders)(res, upstream.headers);
            (0, proxy_http_1.beginEventStream)(res, statusCode);
            const result = await (0, proxy_http_1.copyRedactedStream)(upstream, res, responseLimit, new proxy_http_1.RelayStreamRedactor(apiKey));
            if (result.exceeded)
                this.log.warn('自定义中转流式响应超过上限，已中断');
            return;
        }
        let body;
        try {
            body = await (0, proxy_http_1.readUpstreamBody)(upstream, responseLimit);
        }
        catch (error) {
            (0, proxy_http_1.writeProxyError)(res, 502, 50201, '自定义渠道响应读取失败');
            return;
        }
        if (body === null) {
            (0, proxy_http_1.writeProxyError)(res, 502, 50201, '自定义渠道上游返回了过大的响应');
            return;
        }
        const contentType = headerText(upstream.headers['content-type']);
        const mediaType = (0, proxy_paths_1.mediaTypeOf)(contentType);
        if (allowsBinary(upstreamPath) && (0, proxy_http_1.allowsBinaryResponse)(mediaType)) {
            (0, proxy_http_1.writeProxyResponse)(res, { statusCode, contentType, body });
            return;
        }
        if (mediaType !== 'application/json' && !mediaType.endsWith('+json')) {
            (0, proxy_http_1.writeProxyError)(res, 502, 50201, '自定义渠道上游返回了不支持的内容类型');
            return;
        }
        const redacted = Buffer.from((0, proxy_http_1.redactSecret)(body.toString('utf8'), apiKey), 'utf8');
        (0, proxy_http_1.writeProxyResponse)(res, { statusCode, contentType: 'application/json; charset=utf-8', body: redacted });
    }
    /** 上游明确失败：尽量透传原始错误（已脱敏），并只读不超 64KB */
    async writeUpstreamError(res, upstream, apiKey, statusCode) {
        let body;
        try {
            body = await (0, proxy_http_1.readUpstreamBody)(upstream, MAX_ERROR_BODY_BYTES);
        }
        catch {
            body = null;
        }
        if (body === null) {
            (0, proxy_http_1.writeProxyError)(res, 502, 50201, '自定义渠道上游请求失败');
            return;
        }
        const text = (0, proxy_http_1.redactSecret)(body.toString('utf8'), apiKey).trim();
        const contentType = headerText(upstream.headers['content-type']);
        if (isJsonLike(contentType) && isJson(text)) {
            (0, proxy_http_1.writeProxyResponse)(res, {
                statusCode,
                contentType: 'application/json; charset=utf-8',
                body: Buffer.from(text, 'utf8'),
            });
            return;
        }
        const snippet = text.length > 200 ? `${text.slice(0, 200)}...` : text;
        (0, proxy_http_1.writeProxyError)(res, statusCode, 50201, snippet === '' ? '自定义渠道上游请求失败' : `自定义渠道上游请求失败：${snippet}`);
    }
};
exports.CustomRelayService = CustomRelayService;
exports.CustomRelayService = CustomRelayService = CustomRelayService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        custom_relay_slot_service_1.CustomRelaySlotService,
        model_catalog_client_1.ModelCatalogClient])
], CustomRelayService);
// ── 小工具 ────────────────────────────────────────────────────────────
function isSupportedFormat(value) {
    return value === 'openai' || value === 'gemini' || value === 'claude';
}
/** 密钥形态：非空、限长、不含换行（否则可以注入额外的请求头） */
function isValidApiKey(value) {
    const key = String(value ?? '').trim();
    return key !== '' && key.length <= MAX_API_KEY_LENGTH && !/[\r\n]/.test(key);
}
/** 自定义出站头：base64(JSON `[{name,value}]`)，再走统一的规范化校验 */
function decodeRelayHeaders(encoded) {
    const text = String(encoded ?? '').trim();
    if (text === '')
        return [];
    let json;
    try {
        json = Buffer.from(text, 'base64').toString('utf8');
    }
    catch {
        throw new Error('自定义请求头编码无效');
    }
    try {
        return (0, outbound_1.parseOutboundHeaders)(json);
    }
    catch (error) {
        throw new Error(`自定义请求头无效：${messageOf(error)}`);
    }
}
function allowsBinary(path) {
    return VIDEO_CONTENT_PATH.test(path) || path.endsWith('/audio/speech');
}
function isJsonLike(contentType) {
    const mediaType = (0, proxy_paths_1.mediaTypeOf)(contentType);
    return mediaType === 'application/json' || mediaType.endsWith('+json');
}
function isJson(text) {
    if (text === '')
        return false;
    try {
        JSON.parse(text);
        return true;
    }
    catch {
        return false;
    }
}
function outboundMessage(error) {
    if (error instanceof outbound_1.OutboundError)
        return error.message;
    return messageOf(error) || '自定义渠道地址无效';
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error ?? '');
}
function headerText(value) {
    if (Array.isArray(value))
        return value[0] ?? '';
    return String(value ?? '');
}
//# sourceMappingURL=custom-relay.service.js.map