"use strict";
/**
 * 后台渠道的「上游拉取 / 导入模型」。
 *
 * 移植自 open-ai-canvas `PreviewAdminChannelModels` / `ImportAdminChannelModels`：
 * 拉取只读、导入只增。两条硬规则：
 *
 *   1. **自动发现不能绕过定价边界**。导入的模型一律 `enabled=false`、
 *      `priceConfigured=false`，管理员定价后才能启用 —— 否则一次误点就会让
 *      未定价模型进入可用路由。
 *   2. **已被模型家族吸收的 SKU 不重复创建**。`retiredModelsJson` 记录这些上游键，
 *      拉取与导入都要跳过。普通手动删除不在其中 —— 上游仍存在的模型允许重新导入。
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
exports.ModelCatalogService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const secret_cipher_1 = require("../infra/secret-cipher");
const outbound_1 = require("../infra/outbound");
const json_1 = require("../domain/json");
const channel_presentation_1 = require("../channels/channel.presentation");
const model_catalog_client_1 = require("./model-catalog.client");
const MAX_IMPORT_MODELS = 500;
let ModelCatalogService = class ModelCatalogService {
    constructor(prisma, cipher, client) {
        this.prisma = prisma;
        this.cipher = cipher;
        this.client = client;
    }
    /** 只读取上游目录，不写入任何数据 */
    async preview(channelId) {
        const channel = await this.requireChannel(channelId);
        return this.client.fetch({
            baseUrl: channel.baseUrl,
            apiKey: this.cipher.decrypt(String(channel.apiKey ?? '')),
            apiFormat: channel.apiFormat,
            headers: this.channelHeaders(channel.headersJson),
            proxyUrl: channel.proxyUrl,
        });
    }
    /**
     * 导入管理员勾选的模型。只接受仍在**当前上游目录**里的键：上游已下线的模型
     * 导入进来只会得到一条永远失败的路由。
     */
    async import(channelId, selected) {
        const channel = await this.requireChannel(channelId);
        const catalog = await this.client.fetch({
            baseUrl: channel.baseUrl,
            apiKey: this.cipher.decrypt(String(channel.apiKey ?? '')),
            apiFormat: channel.apiFormat,
            headers: this.channelHeaders(channel.headersJson),
            proxyUrl: channel.proxyUrl,
        });
        const requested = (0, json_1.uniqueNonEmpty)(selected ?? []);
        if (requested.length === 0)
            throw new json_1.ModelDomainError('请至少选择一个要导入的模型');
        if (requested.length > MAX_IMPORT_MODELS) {
            throw new json_1.ModelDomainError(`单次最多导入 ${MAX_IMPORT_MODELS} 个模型`);
        }
        // 上游键不区分大小写比对，但写库保留上游的规范大小写
        const available = new Map();
        for (const item of catalog)
            available.set((0, channel_presentation_1.channelModelActiveKey)(item.id), item.id);
        const chosen = [];
        const seen = new Set();
        for (const raw of requested) {
            const key = (0, channel_presentation_1.channelModelActiveKey)((0, json_1.normalizeModelKey)(raw));
            if (key === '')
                continue;
            const canonical = available.get(key);
            if (!canonical)
                throw new json_1.ModelDomainError(`所选模型不在上游模型目录中：${(0, json_1.normalizeModelKey)(raw)}`);
            if (seen.has(key))
                continue;
            seen.add(key);
            chosen.push(canonical);
        }
        if (chosen.length === 0)
            throw new json_1.ModelDomainError('请至少选择一个有效的模型');
        const existing = await this.prisma.channelModel.findMany({
            where: { channelId, deletedAt: null },
        });
        const known = new Set(existing.map((row) => row.activeKey || (0, channel_presentation_1.channelModelActiveKey)(row.modelKey)));
        const retired = (0, channel_presentation_1.retiredChannelModelKeys)(channel.retiredModelsJson);
        const missing = [];
        for (const name of chosen) {
            const key = (0, channel_presentation_1.channelModelActiveKey)(name);
            if (known.has(key) || retired.has(key))
                continue;
            known.add(key);
            missing.push(name);
        }
        if (missing.length > 0) {
            await this.prisma.$transaction(async (tx) => {
                for (const name of missing) {
                    await tx.channelModel.create({
                        data: {
                            channelId,
                            modelKey: (0, json_1.normalizeModelKey)(name),
                            activeKey: (0, channel_presentation_1.channelModelActiveKey)(name),
                            providerModelKey: name,
                            displayName: '未分类',
                            // 能力与协议由管理员在渠道模型上声明；导入只建骨架行
                            capability: '',
                            protocol: '',
                            billingMode: 'fixed_request',
                            enabled: false,
                            priceConfigured: false,
                            priceVersion: 1,
                        },
                    });
                }
            });
        }
        return { models: catalog, added: missing.length };
    }
    async requireChannel(channelId) {
        const id = String(channelId ?? '').trim();
        if (id === '')
            throw new json_1.ModelDomainError('渠道不存在', 40400);
        const channel = await this.prisma.modelChannel.findFirst({ where: { id, scope: 'system', deletedAt: null } });
        if (!channel)
            throw new json_1.ModelDomainError('渠道不存在或已删除', 40400);
        if (String(channel.baseUrl ?? '').trim() === '')
            throw new json_1.ModelDomainError('请先配置渠道 Base URL');
        return channel;
    }
    channelHeaders(raw) {
        const value = String(raw ?? '').trim();
        if (value === '')
            return [];
        try {
            return (0, outbound_1.parseOutboundHeaders)(this.cipher.decrypt(value));
        }
        catch {
            // 头配置损坏时按「没有自定义头」拉取；真正的校验发生在出站层
            return [];
        }
    }
};
exports.ModelCatalogService = ModelCatalogService;
exports.ModelCatalogService = ModelCatalogService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        secret_cipher_1.SecretCipher,
        model_catalog_client_1.ModelCatalogClient])
], ModelCatalogService);
//# sourceMappingURL=model-catalog.service.js.map