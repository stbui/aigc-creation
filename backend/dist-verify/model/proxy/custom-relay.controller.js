"use strict";
/**
 * 用户自定义渠道的两个接口。
 *
 * · `ANY /api/v1/ai/custom` —— 用户自带上游地址与密钥的中转，本系统只转发；
 * · `POST /api/v1/ai/models` —— 用用户自己的地址与密钥拉一次上游模型清单，
 *   供「自定义渠道」表单的模型下拉使用。
 *
 * 为什么 `ai/custom` 要把请求体当原始字节读：多模态请求动辄数 MB（base64
 * 内嵌参考图），全局 JSON body-parser 的 100KB 上限会在业务代码之前就 413。
 * `main.ts` 用 `isProxyRequestPath` 让中转路径跳过全局解析，由这里按
 * `MODEL_PROXY_CUSTOM_REQUEST_MB` 自行读取。
 *
 * `ai/models` 是**普通业务接口**（请求体只有几百字节，走 DTO 校验），
 * 因此被 `isProxyRequestPath` 显式排除在跳过解析的名单之外。
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
exports.CustomRelayController = exports.CustomCatalogDto = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const class_validator_1 = require("class-validator");
const jwt_auth_guard_1 = require("../../common/jwt-auth.guard");
const rate_limit_guard_1 = require("../../common/rate-limit.guard");
const json_1 = require("../domain/json");
const outbound_1 = require("../infra/outbound");
const proxy_config_1 = require("./proxy.config");
const proxy_http_1 = require("./proxy.http");
const custom_relay_service_1 = require("./custom-relay.service");
/** 自定义中转限流（`MODEL_PROXY_CUSTOM_RATE_LIMIT` 可覆盖） */
const CUSTOM_RATE_LIMIT = { limit: 60, windowSec: 60 };
/** 拉取上游模型目录：目录很小，30 次/分足够人工点击与脚本试错 */
const MODELS_RATE_LIMIT = { limit: 30, windowSec: 60 };
/** 用自定义地址拉取上游模型目录的入参 */
class CustomCatalogDto {
}
exports.CustomCatalogDto = CustomCatalogDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2048),
    __metadata("design:type", String)
], CustomCatalogDto.prototype, "baseUrl", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(512),
    __metadata("design:type", String)
], CustomCatalogDto.prototype, "apiKey", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['openai', 'gemini']),
    __metadata("design:type", String)
], CustomCatalogDto.prototype, "apiFormat", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], CustomCatalogDto.prototype, "headers", void 0);
let CustomRelayController = class CustomRelayController {
    constructor(config, relay) {
        this.config = config;
        this.relay = relay;
    }
    /** 自定义渠道中转 */
    async proxy(req, res) {
        const limits = (0, proxy_config_1.readProxyLimits)(this.config);
        let body;
        try {
            body = await (0, proxy_http_1.readProxyBody)(req, limits.customRequestBytes);
        }
        catch (error) {
            if (error instanceof proxy_http_1.ProxyBodyTooLargeError) {
                (0, proxy_http_1.writeProxyError)(res, 413, 40001, `请求体超过自定义渠道上限（${Math.round(limits.customRequestBytes / 1024 / 1024)}MB）`);
                req.resume();
                return;
            }
            (0, proxy_http_1.writeProxyError)(res, 400, 40001, messageOf(error) || '请求体读取失败');
            return;
        }
        await this.relay.relay({
            userId: String(req.user?.id ?? ''),
            method: String(req.method ?? ''),
            headers: req.headers,
            query: new URLSearchParams(String(req.originalUrl ?? '').split('?')[1] ?? ''),
            contentType: headerText(req.headers['content-type']),
            accept: headerText(req.headers['accept']),
            body,
            res,
        });
    }
    /** 拉取自定义渠道的上游模型目录（不落库，仅回显供表单选型） */
    async models(body) {
        const models = await this.relay.listModels({
            baseUrl: String(body?.baseUrl ?? ''),
            apiKey: String(body?.apiKey ?? ''),
            apiFormat: String(body?.apiFormat ?? 'openai'),
            headers: toHeaders(body?.headers),
        });
        return { models };
    }
};
exports.CustomRelayController = CustomRelayController;
__decorate([
    (0, common_1.All)('custom'),
    (0, rate_limit_guard_1.RateLimit)({
        scope: 'user',
        name: 'proxy-custom',
        limitEnv: 'MODEL_PROXY_CUSTOM_RATE_LIMIT',
        ...CUSTOM_RATE_LIMIT,
    }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CustomRelayController.prototype, "proxy", null);
__decorate([
    (0, common_1.Post)('models'),
    (0, common_1.HttpCode)(200),
    (0, rate_limit_guard_1.RateLimit)({ scope: 'user', name: 'proxy-custom-models', ...MODELS_RATE_LIMIT }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CustomCatalogDto]),
    __metadata("design:returntype", Promise)
], CustomRelayController.prototype, "models", null);
exports.CustomRelayController = CustomRelayController = __decorate([
    (0, common_1.Controller)('ai'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [config_1.ConfigService,
        custom_relay_service_1.CustomRelayService])
], CustomRelayController);
/** 附加出站头走统一规范化（拒绝 `host` / `x-forwarded-*` / `x-canvas-*` 等） */
function toHeaders(raw) {
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw))
        throw new json_1.ModelDomainError('headers 必须是 [{name,value}] 数组');
    try {
        return (0, outbound_1.normalizeOutboundHeaders)(raw.map((item) => ({ name: String(item?.name ?? ''), value: String(item?.value ?? '') })));
    }
    catch (error) {
        throw new json_1.ModelDomainError(error instanceof outbound_1.OutboundError ? error.message : '附加请求头无效');
    }
}
function headerText(value) {
    if (Array.isArray(value))
        return String(value[0] ?? '');
    return String(value ?? '');
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error ?? '');
}
//# sourceMappingURL=custom-relay.controller.js.map