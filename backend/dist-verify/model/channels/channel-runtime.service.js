"use strict";
/**
 * 渠道执行环境装配 —— 把一条渠道模型的数据库行变成「可以发请求」的三件套。
 *
 * 移植自 open-ai-canvas `internal/app/provider_protocol_request.go` 的渠道解析部分。
 *
 * 为什么单独一层：协议适配器拿不到数据库，凭证也不该出现在任务快照里。
 * 每次派发都按 `channelModelId` 现读渠道（含软删除与启用状态）解密凭证，
 * 这样后台停用渠道 / 清空凭证会**立刻**对下一次派发生效，而不用等缓存过期。
 *
 * 失败语义：渠道或模型已停用 → 抛 `ChannelUnavailableError`。调度器据此判定
 * 本次尝试「未被发送」，可以安全切线；与「请求已发出但失败」严格区分开。
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChannelRuntimeService = exports.ChannelUnavailableError = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const secret_cipher_1 = require("../infra/secret-cipher");
const outbound_1 = require("../infra/outbound");
const registry_1 = require("../protocol/registry");
const executor_1 = require("../protocol/executor");
/** 渠道在派发前就不可用：请求**没有**发出去，切线是安全的 */
class ChannelUnavailableError extends Error {
    constructor(message, 
    /** 'channel_disabled' | 'model_disabled' | 'protocol_missing' | 'channel_deleted' */
    reason) {
        super(message);
        this.reason = reason;
        this.name = 'ChannelUnavailableError';
    }
}
exports.ChannelUnavailableError = ChannelUnavailableError;
let ChannelRuntimeService = class ChannelRuntimeService {
    constructor(prisma, cipher, registry) {
        this.prisma = prisma;
        this.cipher = cipher;
        this.registry = registry;
    }
    async prepare(channelModelId) {
        const model = await this.prisma.channelModel.findUnique({ where: { id: channelModelId } });
        if (!model || model.deletedAt) {
            throw new ChannelUnavailableError('渠道模型已停用或删除', 'model_disabled');
        }
        if (!model.enabled) {
            throw new ChannelUnavailableError('渠道模型已停用', 'model_disabled');
        }
        const channel = await this.prisma.modelChannel.findUnique({ where: { id: model.channelId } });
        if (!channel || channel.deletedAt) {
            throw new ChannelUnavailableError('渠道已删除', 'channel_deleted');
        }
        if (!channel.enabled) {
            throw new ChannelUnavailableError('渠道已停用', 'channel_disabled');
        }
        const baseUrl = String(channel.baseUrl ?? '').trim();
        if (baseUrl === '')
            throw new ChannelUnavailableError('渠道未配置 Base URL', 'channel_disabled');
        const protocol = String(model.protocol ?? '').trim();
        const adapter = protocol ? this.registry.resolve(protocol) : null;
        if (!adapter) {
            throw new ChannelUnavailableError(`协议 ${protocol || '(空)'} 尚未注册执行器`, 'protocol_missing');
        }
        return {
            channelId: channel.id,
            channelName: channel.name,
            channelModelId: model.id,
            modelKey: model.modelKey,
            providerModelKey: String(model.providerModelKey ?? '').trim() || model.modelKey,
            capability: model.capability,
            protocol,
            concurrencyLimit: Math.max(0, Math.trunc(channel.concurrencyLimit ?? 0)),
            adapter,
            runtime: {
                baseUrl,
                credentials: {
                    apiKey: this.cipher.decrypt(String(channel.apiKey ?? '')),
                    secretKey: this.cipher.decrypt(String(channel.secretKey ?? '')),
                },
                headers: this.parseHeaders(channel.headersJson),
                proxyUrl: String(channel.proxyUrl ?? '').trim() || null,
                timeoutMs: executor_1.PROVIDER_HTTP_TIMEOUT_MS,
            },
        };
    }
    /**
     * 渠道自定义头是加密 JSON；配置损坏时按「没有自定义头」处理。
     * 不抛错的原因：凭证正确但头配置写坏时，让请求照常发出比整体失败更容易排障；
     * 出站层对每个头还会再校验一次。
     */
    parseHeaders(raw) {
        const value = String(raw ?? '').trim();
        if (value === '')
            return [];
        try {
            return (0, outbound_1.parseOutboundHeaders)(this.cipher.decrypt(value));
        }
        catch {
            return [];
        }
    }
};
exports.ChannelRuntimeService = ChannelRuntimeService;
exports.ChannelRuntimeService = ChannelRuntimeService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        secret_cipher_1.SecretCipher,
        registry_1.ProtocolRegistry])
], ChannelRuntimeService);
//# sourceMappingURL=channel-runtime.service.js.map