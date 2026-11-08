"use strict";
/**
 * 渠道模型连通性测试（后台「测试」按钮）。
 *
 * 移植自 open-ai-canvas `TestAdminChannelModel`：测试复用**真实协议、真实出站
 * 策略与真实凭证**，但**不创建用户任务、不产生计费订单**。区别只在于测试
 * 请求用固定的最小参数（一张图 / 一段短视频），避免测试本身花掉大额费用。
 *
 * 无论成功或失败都必须落 `ApiCallLog`：这张表是「刚才到底请求了哪里、用了
 * 哪个模型、上游返回了什么」的唯一证据，排障与对账都依赖它。测试记录
 * `billable=false`、`source='admin'`、`requestKind='task'`。
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
var ProtocolTestService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProtocolTestService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const secret_cipher_1 = require("../infra/secret-cipher");
const json_1 = require("../domain/json");
const outbound_1 = require("../infra/outbound");
const capability_config_1 = require("../domain/capability-config");
const image_parameters_1 = require("../domain/image-parameters");
const protocol_catalog_service_1 = require("./protocol-catalog.service");
const registry_1 = require("./registry");
const executor_1 = require("./executor");
const TEST_PROMPTS = {
    text: 'Reply with OK.',
    image: 'A simple gray circle on a white background.',
    video: 'A static gray circle on a white background.',
    audio: 'Model test.',
};
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_POLL_TIMEOUT_MS = 5 * 60 * 1000;
const BODY_PREVIEW_CHARS = 4000;
let ProtocolTestService = ProtocolTestService_1 = class ProtocolTestService {
    constructor(prisma, cipher, executor, registry, catalog) {
        this.prisma = prisma;
        this.cipher = cipher;
        this.executor = executor;
        this.registry = registry;
        this.catalog = catalog;
        this.log = new common_1.Logger(ProtocolTestService_1.name);
    }
    async test(channelId, input, actorId) {
        const channel = await this.prisma.modelChannel.findFirst({
            where: { id: channelId, scope: 'system', deletedAt: null },
        });
        if (!channel)
            throw (0, json_1.badRequest)('系统渠道不存在或已删除', 40400);
        if (String(channel.baseUrl ?? '').trim() === '')
            throw (0, json_1.badRequest)('请先在渠道中配置 Base URL');
        if (String(channel.apiKey ?? '').trim() === '')
            throw (0, json_1.badRequest)('请先在渠道中配置 API Key');
        // 已保存的模型：表单未改动的字段以库内配置为准（后台列表直接点「测试」的场景）
        const saved = input.modelId
            ? await this.prisma.channelModel.findFirst({ where: { id: input.modelId, channelId, deletedAt: null } })
            : null;
        if (input.modelId && !saved)
            throw (0, json_1.badRequest)('渠道模型不存在或已删除', 40400);
        const capability = String(input.capability ?? saved?.capability ?? '').trim();
        const protocolId = String(input.protocol ?? saved?.protocol ?? '').trim();
        if (!capability)
            throw (0, json_1.badRequest)('测试需要指定能力');
        if (!protocolId)
            throw (0, json_1.badRequest)('测试需要指定协议');
        // 保存期同一套校验：未知协议、处理类协议、能力不匹配都在发请求之前拒绝
        this.catalog.require(protocolId, capability);
        const adapter = this.registry.resolve(protocolId);
        if (!adapter)
            throw (0, json_1.badRequest)(`协议 ${protocolId} 尚未注册执行器`);
        const providerModelKey = String(input.providerModelKey ?? saved?.providerModelKey ?? input.modelKey ?? '').trim();
        if (!providerModelKey)
            throw (0, json_1.badRequest)('测试需要指定上游模型键');
        const runtime = {
            baseUrl: String(channel.baseUrl ?? '').trim(),
            credentials: {
                apiKey: this.cipher.decrypt(String(channel.apiKey ?? '')),
                secretKey: this.cipher.decrypt(String(channel.secretKey ?? '')),
            },
            headers: this.parseHeaders(channel.headersJson),
            proxyUrl: String(channel.proxyUrl ?? '').trim() || null,
        };
        const rawConfig = input.capabilityConfig !== undefined && input.capabilityConfig !== null
            ? JSON.stringify(input.capabilityConfig)
            : String(saved?.capabilityConfigJson ?? '');
        const config = (0, capability_config_1.decodeCapabilityConfig)(rawConfig) ?? null;
        const request = this.buildRequest(adapter, capability, providerModelKey, config);
        const startedAt = new Date();
        const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS);
        const waitForResult = input.waitForResult !== false;
        let spec = { method: '', path: '', contentType: '' };
        let pollCount = 0;
        let statusCode = 0;
        let providerStatus = '';
        let errorCode = '';
        let error = '';
        let upstreamUrl = '';
        let responsePreview = '';
        let requestPreview = '';
        let createResult = null;
        let finalResult = null;
        let status = 'failed';
        let taskId = '';
        try {
            const createSpec = await adapter.buildCreate({ baseUrl: runtime.baseUrl, request });
            spec = { method: createSpec.method, path: createSpec.path, contentType: createSpec.contentType };
            requestPreview = truncate(safeJson(createSpec.body));
            const response = await this.executor.send(createSpec, runtime);
            statusCode = response.status;
            upstreamUrl = response.url;
            responsePreview = truncate(response.text);
            if (response.status < 200 || response.status >= 300) {
                errorCode = 'upstream_http_error';
                throw new Error(`上游返回 HTTP ${response.status}：${upstreamErrorText(response.text)}`);
            }
            createResult = await adapter.parseCreate(response.body, request);
            status = createResult.status;
            providerStatus = createResult.status ?? '';
            taskId = createResult.taskId ?? '';
            finalResult = createResult.result ?? null;
            if (createResult.status === 'failed') {
                errorCode = 'upstream_failed';
                error = createResult.message || '上游返回失败状态';
            }
            if (waitForResult && (status === 'pending' || status === 'processing') && adapter.buildPoll && taskId) {
                while (Date.now() < deadline) {
                    await sleep(DEFAULT_POLL_INTERVAL_MS);
                    pollCount += 1;
                    const pollSpec = await adapter.buildPoll({
                        baseUrl: runtime.baseUrl,
                        model: providerModelKey,
                        request,
                        taskId,
                        metadata: undefined,
                    });
                    spec = { method: pollSpec.method, path: pollSpec.path, contentType: pollSpec.contentType };
                    const pollResponse = await this.executor.send(pollSpec, runtime);
                    statusCode = pollResponse.status;
                    upstreamUrl = pollResponse.url;
                    responsePreview = truncate(pollResponse.text);
                    if (pollResponse.status < 200 || pollResponse.status >= 300) {
                        errorCode = 'upstream_http_error';
                        throw new Error(`轮询返回 HTTP ${pollResponse.status}：${upstreamErrorText(pollResponse.text)}`);
                    }
                    const pollResult = await adapter.parsePoll({ baseUrl: runtime.baseUrl, model: providerModelKey, request, taskId }, pollResponse.body);
                    status = pollResult.status;
                    providerStatus = pollResult.status;
                    if (pollResult.result)
                        finalResult = pollResult.result;
                    if (pollResult.taskId)
                        taskId = pollResult.taskId;
                    if (pollResult.status === 'failed') {
                        errorCode = 'upstream_failed';
                        error = pollResult.message || '上游返回失败状态';
                    }
                    if (status !== 'pending' && status !== 'processing')
                        break;
                }
            }
        }
        catch (caught) {
            error = caught.message;
            if (caught instanceof outbound_1.OutboundError)
                errorCode = `outbound_${caught.code}`;
            else if (errorCode === '')
                errorCode = 'test_failed';
        }
        const mediaCount = (finalResult?.images?.length ?? 0) + (finalResult?.videos?.length ?? 0) + (finalResult?.audios?.length ?? 0);
        const text = String(finalResult?.text ?? '');
        const durationMs = Date.now() - startedAt.getTime();
        const logStatus = status === 'succeeded' ? 'success' : status === 'pending' || status === 'processing' ? 'pending' : 'failed';
        const logRow = await this.prisma.apiCallLog.create({
            data: {
                userId: actorId,
                channelId,
                channelName: String(channel.name ?? ''),
                // 线路级健康指标的归属键：能定位到已保存的渠道模型就记它的 id
                channelModelId: String(saved?.id ?? ''),
                source: 'admin',
                capability,
                operation: 'admin_model_test',
                requestKind: 'task',
                billable: false,
                apiFormat: String(channel.apiFormat ?? ''),
                method: spec.method,
                path: spec.path,
                model: String(input.modelKey ?? saved?.modelKey ?? providerModelKey),
                status: logStatus,
                statusCode,
                durationMs,
                pollCount,
                providerStatus,
                mediaCount,
                providerRequestId: taskId,
                errorCode,
                error: truncate(error, 1000),
                concurrencyLimit: channel.concurrencyLimit,
                upstreamUrl,
                requestContentType: spec.contentType,
                requestBody: requestPreview,
                responseBody: responsePreview,
                startedAt,
            },
        });
        if (error !== '')
            this.log.warn(`渠道模型测试失败（${channelId}/${providerModelKey}）：${error}`);
        return {
            status: status === 'succeeded' ? 'succeeded' : status === 'pending' || status === 'processing' ? 'pending' : 'failed',
            providerStatus,
            durationMs,
            pollCount,
            taskId,
            mediaCount,
            text: truncate(text, 500),
            message: createResult?.message ?? '',
            errorCode,
            error,
            request: { ...spec, model: providerModelKey, protocol: protocolId },
            result: {
                images: finalResult?.images?.length ?? 0,
                videos: finalResult?.videos?.length ?? 0,
                audios: finalResult?.audios?.length ?? 0,
                text: truncate(text, 200),
            },
            responsePreview,
            logId: logRow.id,
        };
    }
    /**
     * 组装测试请求：取模型声明的默认值（比例 / 分辨率 / 时长），
     * 不写死通用 1K 值 —— 固定分辨率的 SKU 会被通用测试值误伤。
     */
    buildRequest(adapter, capability, providerModelKey, config) {
        const request = {
            capability: capability,
            model: providerModelKey,
            prompt: TEST_PROMPTS[capability] ?? 'Model test.',
            imageCount: 1,
            extra: { audioFormat: 'mp3', audioVoice: 'alloy', audioSpeed: '1' },
        };
        if (capability === 'image') {
            const image = config?.image;
            const definitions = adapter.metadata.imageParameters ?? [];
            const configured = image?.parameters ?? [];
            const resolved = definitions.length > 0 ? (0, image_parameters_1.resolveImageParameters)(definitions, configured, providerModelKey) : [];
            const values = {};
            for (const parameter of resolved) {
                if (!(0, image_parameters_1.isImageParameterEnabled)(parameter) || !(0, image_parameters_1.imageParameterAppliesTo)(parameter, providerModelKey))
                    continue;
                const fallback = parameter.default ?? (parameter.values?.length ? parameter.values[0] : undefined);
                if (fallback !== undefined && fallback !== null)
                    values[parameter.name] = fallback;
            }
            if (Object.keys(values).length > 0)
                request.imageParameters = values;
            if (image?.size && image.size.parameter !== 'none')
                request.aspectRatio = image.size.default;
            if (image?.resolution?.supported)
                request.resolution = image.resolution.default;
            if (image?.quality?.supported)
                request.quality = image.quality.default;
        }
        if (capability === 'video') {
            const video = config?.video;
            request.duration = video?.duration?.default ?? 6;
            request.aspectRatio = video?.defaultRatio ?? '16:9';
            request.resolution = video?.defaultResolution ?? '720';
            request.generateAudio = false;
            request.watermark = false;
            request.operation = video?.defaultOperation ?? '';
        }
        return request;
    }
    parseHeaders(raw) {
        const value = String(raw ?? '').trim();
        if (value === '')
            return [];
        try {
            return (0, outbound_1.parseOutboundHeaders)(this.cipher.decrypt(value));
        }
        catch {
            // 渠道头配置损坏不应让测试整体失败；出站层会再次校验
            return [];
        }
    }
};
exports.ProtocolTestService = ProtocolTestService;
exports.ProtocolTestService = ProtocolTestService = ProtocolTestService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        secret_cipher_1.SecretCipher,
        executor_1.ProtocolExecutor,
        registry_1.ProtocolRegistry,
        protocol_catalog_service_1.ProtocolCatalogService])
], ProtocolTestService);
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** 请求体预览：Buffer 只报体积，data URL 的内联字节折叠掉，避免把整段二进制写进调用记录 */
function safeJson(value) {
    if (value === undefined || value === null)
        return '';
    if (Buffer.isBuffer(value))
        return `<binary ${value.length} bytes>`;
    try {
        return JSON.stringify(value).replace(/(data:[^;"]+;base64,)[A-Za-z0-9+/=]{64,}/g, '$1…');
    }
    catch {
        return String(value);
    }
}
function truncate(value, limit = BODY_PREVIEW_CHARS) {
    const text = String(value ?? '');
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
/** 从上游错误响应里提取可读原因：常见字段优先，最后退回原文截断 */
function upstreamErrorText(body) {
    const text = String(body ?? '').trim();
    if (text === '')
        return '上游没有返回响应体';
    try {
        const payload = JSON.parse(text);
        for (const path of ['error.message', 'error.msg', 'message', 'msg', 'error', 'base_resp.status_msg', 'data.message']) {
            const value = path.split('.').reduce((current, key) => (current && typeof current === 'object' ? current[key] : undefined), payload);
            if (value !== undefined && value !== null && String(value).trim() !== '')
                return truncate(String(value), 500);
        }
    }
    catch {
        // 非 JSON 响应按原文返回
    }
    return truncate(text, 500);
}
//# sourceMappingURL=protocol-test.service.js.map