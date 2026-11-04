"use strict";
/**
 * 中转调用记录。
 *
 * 与任务路径共用 `ApiCallLog` 表（后台「调用记录」页看的是同一张表），区别只在
 * `source`（`system-channel` / `custom-relay`）与 `requestKind='proxy'`。
 *
 * 两条纪律：
 *   1. **写日志永不抛错**（返回布尔）：调用已经发生，日志写失败不能把成功请求
 *      变成失败响应；但计费侧必须知道结果 —— 日志缺失时 Token 账单无法结算，
 *      调用方据此转 `uncertain` 而不是按预授权金额结清；
 *   2. 请求 / 响应报文先过 `sanitizeCallPayload`：密钥与内嵌媒体不进库。
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
var ProxyCallLogService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProxyCallLogService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const request_context_1 = require("../../common/request-context");
const proxy_payload_1 = require("./proxy.payload");
let ProxyCallLogService = ProxyCallLogService_1 = class ProxyCallLogService {
    constructor(prisma) {
        this.prisma = prisma;
        this.log = new common_1.Logger(ProxyCallLogService_1.name);
    }
    /**
     * 写入一条调用记录。
     *
     * @returns 是否成功落库；调用方在成功请求里用它决定是否能按用量结算
     */
    async record(entry) {
        const usage = entry.usage !== undefined && entry.usage !== null
            ? entry.usage
            : entry.responseBodyBuffer
                ? (0, proxy_payload_1.extractProxyUsage)(entry.responseBodyBuffer, Boolean(entry.streamed))
                : null;
        const mediaCount = entry.responseBodyBuffer ? (0, proxy_payload_1.extractMediaCount)(entry.responseBodyBuffer) : 0;
        const providerRequestId = entry.responseBodyBuffer ? (0, proxy_payload_1.extractProviderRequestId)(entry.responseBodyBuffer) : '';
        try {
            await this.prisma.apiCallLog.create({
                data: {
                    userId: entry.userId,
                    requestId: (0, request_context_1.currentRequestId)() ?? '',
                    channelId: entry.channelId,
                    channelName: entry.channelName,
                    channelModelId: entry.channelModelId ?? '',
                    billingOrderId: entry.billingOrderId ?? '',
                    source: entry.source,
                    capability: entry.capability,
                    operation: 'proxy',
                    requestKind: 'proxy',
                    billable: entry.billable,
                    apiFormat: entry.apiFormat,
                    method: entry.method,
                    path: truncate(entry.path, 500),
                    model: entry.model,
                    status: entry.status,
                    statusCode: entry.statusCode,
                    durationMs: Math.max(0, Math.trunc(entry.durationMs)),
                    inputTokens: usage?.inputTokens ?? 0n,
                    outputTokens: usage?.outputTokens ?? 0n,
                    cachedTokens: usage?.cachedTokens ?? 0n,
                    usageAvailable: usage !== null,
                    mediaCount,
                    providerRequestId,
                    errorCode: entry.errorCode ?? '',
                    error: truncate(entry.error ?? '', 1000),
                    concurrencyLimit: entry.concurrencyLimit,
                    upstreamUrl: truncate(entry.upstreamUrl, 2000),
                    requestContentType: truncate(entry.requestContentType ?? '', 200),
                    requestBody: entry.requestBody,
                    responseBody: entry.responseBody,
                    startedAt: new Date(Date.now() - Math.max(0, Math.trunc(entry.durationMs))),
                },
            });
            return true;
        }
        catch (error) {
            this.log.error(`调用记录写入失败：${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
};
exports.ProxyCallLogService = ProxyCallLogService;
exports.ProxyCallLogService = ProxyCallLogService = ProxyCallLogService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ProxyCallLogService);
function truncate(value, max) {
    const text = String(value ?? '');
    return text.length <= max ? text : text.slice(0, max);
}
//# sourceMappingURL=proxy-call-log.service.js.map