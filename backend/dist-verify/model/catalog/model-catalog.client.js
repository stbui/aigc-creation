"use strict";
/**
 * 上游模型目录客户端（`GET {base}/models`）。
 *
 * 移植自 open-ai-canvas `FetchChannelModelCatalog`。只代理这一个固定的 GET：
 * 渠道凭证由宿主解密后注入，**不经过浏览器、不写日志**；出站仍走统一
 * `outboundRequest`，因此 SSRF、重定向、代理与体积上限全部生效。
 *
 * 只支持 `openai` 与 `gemini` 两种目录形态。其它格式显式拒绝 —— 猜一个
 * 「差不多」的地址只会让管理员看到一个与事实不符的错误。
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelCatalogClient = void 0;
const common_1 = require("@nestjs/common");
const executor_1 = require("../protocol/executor");
const auth_1 = require("../protocol/auth");
const outbound_1 = require("../infra/outbound");
const json_1 = require("../domain/json");
const model_catalog_discovery_1 = require("./model-catalog.discovery");
/** 目录请求超时：目录通常很小，60 秒足够；不沿用生成请求的 5 分钟 */
const CATALOG_TIMEOUT_MS = 60 * 1000;
let ModelCatalogClient = class ModelCatalogClient {
    async fetch(input) {
        const baseUrl = String(input.baseUrl ?? '').trim().replace(/\/+$/, '');
        if (baseUrl === '')
            throw new json_1.ModelDomainError('请先填写 Base URL');
        if (String(input.apiKey ?? '').trim() === '')
            throw new json_1.ModelDomainError('请先填写 API Key');
        const apiFormat = String(input.apiFormat ?? '').trim().toLowerCase() || 'openai';
        if (apiFormat !== 'openai' && apiFormat !== 'gemini') {
            throw new json_1.ModelDomainError('接口协议不支持拉取模型');
        }
        const target = apiFormat === 'gemini' ? geminiModelsUrl(baseUrl) : (0, executor_1.apiUrl)(baseUrl, '/models');
        const headers = {};
        if (apiFormat === 'gemini')
            (0, auth_1.setHeader)(headers, 'x-goog-api-key', input.apiKey);
        else
            (0, auth_1.setHeader)(headers, 'Authorization', `Bearer ${input.apiKey}`);
        for (const header of input.headers ?? []) {
            if (!header?.name)
                continue;
            (0, auth_1.setHeader)(headers, header.name, String(header.value ?? ''));
        }
        if (!(0, auth_1.getHeader)(headers, 'accept'))
            (0, auth_1.setHeader)(headers, 'Accept', 'application/json');
        let response;
        try {
            response = await (0, outbound_1.outboundRequest)(target, {
                method: 'GET',
                headers,
                timeoutMs: input.timeoutMs ?? CATALOG_TIMEOUT_MS,
                proxyUrl: input.proxyUrl ?? null,
            });
        }
        catch (error) {
            throw upstreamError(error);
        }
        if (response.status < 200 || response.status >= 300) {
            throw statusError(response.status);
        }
        let payload;
        try {
            payload = JSON.parse(response.text || '{}');
        }
        catch {
            throw new json_1.ModelDomainError('模型服务返回的不是有效 JSON', 50201);
        }
        if (payload?.error && String(payload.error.message ?? '').trim() !== '') {
            throw new json_1.ModelDomainError('模型服务返回失败，请检查渠道配置', 50201);
        }
        if (payload?.code !== undefined && payload?.code !== null && Number(payload.code) !== 0) {
            throw new json_1.ModelDomainError('模型服务返回失败，请检查渠道配置', 50201);
        }
        const items = Array.isArray(apiFormat === 'gemini' ? payload?.models : payload?.data)
            ? apiFormat === 'gemini'
                ? payload.models
                : payload.data
            : [];
        const catalog = [];
        const seen = new Set();
        for (const item of items) {
            const id = String(item?.id ?? item?.name ?? '')
                .trim()
                .replace(/^models\//, '');
            if (id === '' || seen.has(id))
                continue;
            seen.add(id);
            catalog.push({
                id,
                displayName: String(item?.display_name ?? item?.displayName ?? '').trim() || undefined,
                modelType: normalizeModelType(item?.model_type ?? item?.modelType),
                supportedEndpointTypes: uniqueStrings(item?.supported_endpoint_types ?? item?.supportedEndpointTypes),
                defaultParameters: normalizeDefaultParameters(item?.default_parameters ?? item?.defaultParameters),
                options: normalizeOptions(item?.options),
                supportsImages: boolOrUndefined(item?.supports_images ?? item?.supportsImages),
                minImages: intOrUndefined(item?.min_images ?? item?.minImages),
                maxImages: intOrUndefined(item?.max_images ?? item?.maxImages),
            });
        }
        catalog.sort((left, right) => left.id.localeCompare(right.id));
        const discovery = (0, model_catalog_discovery_1.matchModelCatalogDiscovery)(baseUrl, input.headers ?? []);
        return discovery ? (0, model_catalog_discovery_1.extendCatalog)(catalog, discovery.additionalModels()) : catalog;
    }
};
exports.ModelCatalogClient = ModelCatalogClient;
exports.ModelCatalogClient = ModelCatalogClient = __decorate([
    (0, common_1.Injectable)()
], ModelCatalogClient);
function geminiModelsUrl(baseUrl) {
    const base = baseUrl.toLowerCase().endsWith('/v1beta') ? baseUrl : `${baseUrl}/v1beta`;
    return `${base}/models`;
}
function normalizeModelType(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return ['text', 'image', 'video', 'audio'].includes(normalized) ? normalized : undefined;
}
function normalizeDefaultParameters(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const aspectRatio = String(value.aspect_ratio ?? value.aspectRatio ?? '').trim();
    const durationSeconds = String(value.duration_seconds ?? value.durationSeconds ?? '').trim();
    const resolution = String(value.resolution ?? '').trim();
    if (aspectRatio === '' && durationSeconds === '' && resolution === '')
        return undefined;
    return {
        ...(aspectRatio !== '' ? { aspectRatio } : {}),
        ...(durationSeconds !== '' ? { durationSeconds } : {}),
        ...(resolution !== '' ? { resolution } : {}),
    };
}
function normalizeOptions(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const build = (raw) => {
        if (!Array.isArray(raw))
            return [];
        const seen = new Set();
        const result = [];
        for (const item of raw) {
            const optionValue = String(item?.value ?? '').trim();
            if (optionValue === '' || seen.has(optionValue))
                continue;
            seen.add(optionValue);
            const label = String(item?.label ?? '').trim();
            result.push(label === '' ? { value: optionValue } : { value: optionValue, label });
        }
        return result;
    };
    const aspectRatio = build(value.aspect_ratio ?? value.aspectRatio);
    const durationSeconds = build(value.duration_seconds ?? value.durationSeconds);
    const resolution = build(value.resolution);
    if (aspectRatio.length + durationSeconds.length + resolution.length === 0)
        return undefined;
    return {
        ...(aspectRatio.length > 0 ? { aspectRatio } : {}),
        ...(durationSeconds.length > 0 ? { durationSeconds } : {}),
        ...(resolution.length > 0 ? { resolution } : {}),
    };
}
function uniqueStrings(raw) {
    if (!Array.isArray(raw))
        return undefined;
    const seen = new Set();
    const result = [];
    for (const item of raw) {
        const value = String(item ?? '').trim();
        if (value === '' || seen.has(value))
            continue;
        seen.add(value);
        result.push(value);
    }
    return result.length > 0 ? result : undefined;
}
function boolOrUndefined(value) {
    return typeof value === 'boolean' ? value : undefined;
}
function intOrUndefined(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : undefined;
}
/** 上游连不上：区分配置错误与网络错误，避免「检查地址」掩盖真实原因 */
function upstreamError(error) {
    if (error instanceof json_1.ModelDomainError)
        return error;
    if (error instanceof outbound_1.OutboundError) {
        return new json_1.ModelDomainError(`连接模型服务失败：${error.message}`, 50201);
    }
    return new json_1.ModelDomainError(`连接模型服务失败：${error?.message ?? '未知错误'}`, 50201);
}
function statusError(status) {
    switch (status) {
        case 401:
        case 403:
            return new json_1.ModelDomainError('模型服务鉴权失败，请检查 API Key', 50201);
        case 404:
            return new json_1.ModelDomainError('模型服务未提供 /models 接口', 50201);
        case 429:
            return new json_1.ModelDomainError('模型服务请求过于频繁或额度不足', 50201);
        default:
            return new json_1.ModelDomainError(`模型服务返回 HTTP ${status}`, 50201);
    }
}
//# sourceMappingURL=model-catalog.client.js.map