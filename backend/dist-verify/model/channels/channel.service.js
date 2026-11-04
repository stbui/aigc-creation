"use strict";
/**
 * 系统渠道服务 —— 后台渠道 CRUD、复制、排序、导入导出。
 *
 * 三条与参考实现一致、但容易在移植时丢掉的语义：
 *   1. **凭证只写不回显**：后台投影对系统渠道永远不下发 `apiKey` / `secretKey`，
 *      只给 `hasApiKey` / `hasSecretKey`；请求里字段为空 = 保持库中原值。
 *   2. **Base URL 只在真正变化时才做出站校验**：只改价格或启停时，上游域名
 *      当前是否可解析不该阻塞保存（临时 DNS 故障不能让人改不了价格）。
 *   3. **删除是软删除并清空凭证**：历史账单与调用日志仍要能关联渠道 id。
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
exports.ChannelService = void 0;
const common_1 = require("@nestjs/common");
const app_exception_1 = require("../../common/app.exception");
const prisma_service_1 = require("../../prisma/prisma.service");
const json_1 = require("../domain/json");
const catalog_version_service_1 = require("../infra/catalog-version.service");
const outbound_1 = require("../infra/outbound");
const secret_cipher_1 = require("../infra/secret-cipher");
const channel_model_service_1 = require("./channel-model.service");
const channel_model_repository_1 = require("./channel-model.repository");
const channel_presentation_1 = require("./channel.presentation");
const channel_types_1 = require("./channel.types");
/** 渠道不存在（软删除后等同不存在） */
function channelNotFound() {
    return new app_exception_1.AppError(40400, '系统渠道不存在或已删除', common_1.HttpStatus.NOT_FOUND);
}
/** 排序列表已变化 */
function orderConflict() {
    return new app_exception_1.AppError(40900, '排序列表已变化，请重新加载后再保存', common_1.HttpStatus.CONFLICT);
}
/** 出站校验错误统一映射成 40001，不透出内部错误类型 */
function rethrowOutbound(error) {
    if (error instanceof outbound_1.OutboundError)
        throw (0, json_1.badRequest)(error.message);
    throw error;
}
let ChannelService = class ChannelService {
    constructor(prisma, cipher, catalogVersion, channelModels) {
        this.prisma = prisma;
        this.cipher = cipher;
        this.catalogVersion = catalogVersion;
        this.channelModels = channelModels;
    }
    /* ───────────────────────── 查询 ───────────────────────── */
    async list(query) {
        const page = query.page && query.page > 0 ? Math.trunc(query.page) : 1;
        let limit = query.limit && query.limit > 0 ? Math.trunc(query.limit) : 20;
        if (limit > 100)
            limit = 20;
        const keyword = String(query.keyword ?? '').trim();
        const status = String(query.status ?? '').trim().toLowerCase();
        const where = { scope: channel_types_1.CHANNEL_SCOPE_SYSTEM, deletedAt: null };
        if (keyword)
            where.OR = [{ name: { contains: keyword } }, { baseUrl: { contains: keyword } }];
        if (status === 'enabled')
            where.enabled = true;
        else if (status === 'disabled')
            where.enabled = false;
        const [total, rows] = await this.prisma.$transaction([
            this.prisma.modelChannel.count({ where }),
            this.prisma.modelChannel.findMany({
                where,
                orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);
        const channels = [];
        for (const row of rows) {
            channels.push(await this.project(row, true));
        }
        return { channels, total, page, limit };
    }
    async get(id) {
        const row = await this.requireChannel(id);
        return this.project(row, true);
    }
    /** 前台系统渠道目录：不含凭证、不含上游地址 */
    async publicSystemChannels() {
        const rows = await this.prisma.modelChannel.findMany({
            where: { scope: channel_types_1.CHANNEL_SCOPE_SYSTEM, enabled: true, deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });
        const result = [];
        for (const row of rows)
            result.push(await this.project(row, false));
        return result;
    }
    /**
     * 管理员视角的系统渠道目录：含渠道真实名称与上游地址。
     *
     * 凭证仍然不下发 —— `publicChannel(row, true)` 对系统渠道恒给 `apiKey: ''`，
     * 只保留 `hasApiKey` / `hasSecretKey` 标记（后台投影的既有约定）。
     */
    async adminSystemChannels() {
        const rows = await this.prisma.modelChannel.findMany({
            where: { scope: channel_types_1.CHANNEL_SCOPE_SYSTEM, enabled: true, deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });
        const result = [];
        for (const row of rows)
            result.push(await this.project(row, true));
        return result;
    }
    /* ───────────────────────── 写入 ───────────────────────── */
    async create(req) {
        const { fields, models } = await this.buildChannelFields(req, {
            baseUrl: '',
            apiKey: '',
            secretKey: '',
            concurrencyLimit: 0,
            enabled: true,
            headersJson: '',
        });
        const created = await this.prisma.$transaction(async (tx) => {
            const channel = await tx.modelChannel.create({
                data: {
                    ...fields,
                    apiKey: fields.apiKey ?? '',
                    secretKey: fields.secretKey ?? '',
                    scope: channel_types_1.CHANNEL_SCOPE_SYSTEM,
                    userId: '',
                    headersJson: fields.headersJson,
                },
            });
            await this.channelModels.syncInitialChannelModels(channel, models, tx);
            return channel;
        });
        await this.catalogVersion.invalidate();
        return this.project(created, true);
    }
    async update(id, req) {
        const channel = await this.requireChannel(id);
        const modelsProvided = req.models !== undefined && req.models !== null;
        const merged = this.mergeRequest(req, channel);
        const { fields, models } = await this.buildChannelFields(merged, channel);
        const updated = await this.prisma.$transaction(async (tx) => {
            const row = await tx.modelChannel.update({
                where: { id: channel.id },
                data: {
                    ...fields,
                    // 空串表示「请求没提交凭证」，沿用库里的密文，避免把密钥清空
                    apiKey: fields.apiKey ?? channel.apiKey,
                    secretKey: fields.secretKey ?? channel.secretKey,
                },
            });
            if (modelsProvided) {
                await this.channelModels.syncInitialChannelModels(row, models, tx);
            }
            return row;
        });
        await this.catalogVersion.invalidate();
        return this.project(updated, true);
    }
    /**
     * 软删除渠道：清空凭证、停用并删除其渠道模型。
     * 不物理删除 —— 账单、调用日志、审计都还引用这个 id。
     */
    async remove(id) {
        const channel = await this.requireChannel(id);
        const now = new Date();
        await this.prisma.$transaction(async (tx) => {
            await tx.modelChannel.update({
                where: { id: channel.id },
                data: { apiKey: '', secretKey: '', enabled: false, headersJson: '', deletedAt: now },
            });
            const models = await tx.channelModel.findMany({
                where: { channelId: channel.id, deletedAt: null },
                select: { id: true },
            });
            if (models.length > 0) {
                const ids = models.map((row) => row.id);
                await tx.channelModelPriceTier.updateMany({
                    where: { channelModelId: { in: ids }, deletedAt: null },
                    data: { deletedAt: now, activeKey: null, enabled: false },
                });
                await tx.channelModel.updateMany({
                    where: { channelId: channel.id, deletedAt: null },
                    data: { deletedAt: now, activeKey: null, enabled: false },
                });
            }
        });
        await this.catalogVersion.invalidate();
    }
    /** 复制渠道：连同渠道模型与价格档一起复制，新渠道默认停用由管理员确认 */
    async duplicate(id, actorId = '') {
        const source = await this.requireChannel(id);
        const sourceModels = await this.prisma.channelModel.findMany({
            where: { channelId: source.id, deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });
        const sourceTiers = sourceModels.length > 0
            ? await this.prisma.channelModelPriceTier.findMany({
                where: { channelModelId: { in: sourceModels.map((row) => row.id) }, deletedAt: null },
            })
            : [];
        // 兼容旧数据：只配了 `modelsJson` 名单、没有渠道模型行的渠道，复制时按名单补
        // 停用骨架行。否则下面的 refreshChannelModelNames 会把名单覆写成 []，副本看
        // 起来「一个模型都没有」。与上游 admin_channels.go 的复制语义一致。
        const skeletonNames = sourceModels.length === 0 ? (0, channel_presentation_1.channelModelNames)(source) : [];
        const created = await this.prisma.$transaction(async (tx) => {
            const channel = await tx.modelChannel.create({
                data: {
                    // 归属人 = 执行复制的管理员：审计与追责链要能查到「这条渠道是谁建的」
                    userId: actorId,
                    scope: channel_types_1.CHANNEL_SCOPE_SYSTEM,
                    enabled: source.enabled,
                    name: (0, channel_presentation_1.duplicateChannelName)(source.name),
                    sortOrder: source.sortOrder,
                    baseUrl: source.baseUrl,
                    apiKey: source.apiKey,
                    secretKey: source.secretKey,
                    apiFormat: source.apiFormat,
                    concurrencyLimit: source.concurrencyLimit,
                    proxyUrl: source.proxyUrl,
                    modelsJson: source.modelsJson,
                    retiredModelsJson: source.retiredModelsJson,
                    headersJson: source.headersJson,
                    catalogProviderId: source.catalogProviderId,
                },
            });
            if (sourceModels.length === 0) {
                for (const [index, name] of skeletonNames.entries()) {
                    await tx.channelModel.create({
                        data: {
                            channelId: channel.id,
                            modelKey: name,
                            activeKey: name.toLowerCase(),
                            providerModelKey: name,
                            displayName: name,
                            capability: '',
                            protocol: '',
                            billingMode: 'fixed_request',
                            enabled: false,
                            priceVersion: 1,
                            sortOrder: index,
                        },
                    });
                }
            }
            else {
                for (const model of sourceModels) {
                    const copy = await tx.channelModel.create({
                        data: {
                            channelId: channel.id,
                            modelKey: model.modelKey,
                            activeKey: model.activeKey,
                            providerModelKey: model.providerModelKey,
                            displayName: model.displayName,
                            channelLabel: model.channelLabel,
                            tags: model.tags,
                            description: model.description,
                            sortOrder: model.sortOrder,
                            icon: model.icon,
                            capability: model.capability,
                            protocol: model.protocol,
                            billingMode: model.billingMode,
                            unitPriceMicrocredits: model.unitPriceMicrocredits,
                            inputTokenPriceMicrocredits: model.inputTokenPriceMicrocredits,
                            outputTokenPriceMicrocredits: model.outputTokenPriceMicrocredits,
                            cachedTokenPriceMicrocredits: model.cachedTokenPriceMicrocredits,
                            priceConfigured: model.priceConfigured,
                            enabled: model.enabled,
                            priceVersion: model.priceVersion,
                            priceCurrency: model.priceCurrency,
                            capabilityConfigJson: model.capabilityConfigJson,
                            capabilityVersion: model.capabilityVersion,
                            catalogModelKey: model.catalogModelKey,
                        },
                    });
                    for (const tier of sourceTiers.filter((row) => row.channelModelId === model.id)) {
                        await tx.channelModelPriceTier.create({
                            data: {
                                channelModelId: copy.id,
                                activeKey: tier.activeKey,
                                selectorKey: tier.selectorKey,
                                selectorJson: tier.selectorJson,
                                resolution: tier.resolution,
                                videoSeconds: tier.videoSeconds,
                                providerModelKey: tier.providerModelKey,
                                billingMode: tier.billingMode,
                                costConfigured: tier.costConfigured,
                                costUnitPriceMicrocredits: tier.costUnitPriceMicrocredits,
                                costInputTokenPriceMicrocredits: tier.costInputTokenPriceMicrocredits,
                                costOutputTokenPriceMicrocredits: tier.costOutputTokenPriceMicrocredits,
                                costCachedTokenPriceMicrocredits: tier.costCachedTokenPriceMicrocredits,
                                unitPriceMicrocredits: tier.unitPriceMicrocredits,
                                inputTokenPriceMicrocredits: tier.inputTokenPriceMicrocredits,
                                outputTokenPriceMicrocredits: tier.outputTokenPriceMicrocredits,
                                cachedTokenPriceMicrocredits: tier.cachedTokenPriceMicrocredits,
                                priceConfigured: tier.priceConfigured,
                                enabled: tier.enabled,
                                priceVersion: tier.priceVersion,
                            },
                        });
                    }
                }
                await (0, channel_model_repository_1.refreshChannelModelNames)(tx, channel.id);
            }
            return channel;
        });
        await this.catalogVersion.invalidate();
        return this.project(created, true);
    }
    /* ───────────────────────── 排序 ───────────────────────── */
    /** `channelId` 为空串表示渠道之间的排序 */
    async order(channelId) {
        if (!channelId) {
            const rows = await this.prisma.modelChannel.findMany({
                where: { scope: channel_types_1.CHANNEL_SCOPE_SYSTEM, deletedAt: null },
                orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
                select: { id: true, name: true, enabled: true },
            });
            return rows.map((row) => ({ id: row.id, name: row.name, enabled: row.enabled }));
        }
        const channel = await this.requireChannel(channelId);
        const rows = await this.prisma.channelModel.findMany({
            where: { channelId: channel.id, deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true, modelKey: true, displayName: true, enabled: true },
        });
        return rows.map((row) => ({
            id: row.id,
            name: String(row.displayName ?? '').trim() || row.modelKey,
            enabled: row.enabled,
        }));
    }
    async saveOrder(channelId, ids, expectedIds) {
        if (!Array.isArray(ids) || !Array.isArray(expectedIds)) {
            throw (0, json_1.badRequest)('请重新加载完整排序列表');
        }
        if (ids.length > 10000)
            throw (0, json_1.badRequest)('请重新加载完整排序列表');
        if (channelId)
            await this.requireChannel(channelId);
        try {
            await this.prisma.$transaction(async (tx) => {
                await (0, channel_model_repository_1.saveChannelOrder)(tx, channelId, ids, expectedIds);
            });
        }
        catch (error) {
            if (error instanceof channel_model_repository_1.ChannelOrderChangedError)
                throw orderConflict();
            if (error instanceof channel_model_repository_1.ChannelNotFoundError)
                throw channelNotFound();
            throw error;
        }
        await this.catalogVersion.invalidate();
    }
    /* ───────────────────────── 导入导出 ───────────────────────── */
    /** 导出不含任何凭证：API Key / Secret Key / 自定义头 / 代理地址 */
    async exportChannels(ids) {
        const wanted = new Set((0, json_1.uniqueNonEmpty)(ids ?? []));
        const rows = await this.prisma.modelChannel.findMany({
            where: { scope: channel_types_1.CHANNEL_SCOPE_SYSTEM, deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });
        const channels = [];
        for (const row of rows) {
            if (wanted.size > 0 && !wanted.has(row.id))
                continue;
            const models = await this.prisma.channelModel.findMany({
                where: { channelId: row.id, deletedAt: null },
                orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
            });
            const tiers = models.length > 0
                ? await this.prisma.channelModelPriceTier.findMany({
                    where: { channelModelId: { in: models.map((item) => item.id) }, deletedAt: null },
                })
                : [];
            const exportedModels = [];
            for (const model of models) {
                exportedModels.push({
                    ...this.modelToRequest(model, tiers.filter((tier) => tier.channelModelId === model.id)),
                    sortOrder: model.sortOrder,
                });
            }
            channels.push({
                name: row.name,
                baseUrl: row.baseUrl,
                sortOrder: row.sortOrder,
                enabled: row.enabled,
                concurrencyLimit: row.concurrencyLimit,
                catalogProviderId: row.catalogProviderId || undefined,
                models: exportedModels,
            });
        }
        return {
            format: channel_types_1.SYSTEM_CHANNEL_EXPORT_FORMAT,
            version: channel_types_1.SYSTEM_CHANNEL_EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            channels,
        };
    }
    /**
     * 按渠道名称合并导入。
     *
     * 已有渠道只更新地址与并发、保留目标环境凭证与启停状态；新渠道以停用状态创建，
     * 等管理员补齐密钥再启用 —— 导入文件本来就不含凭证，直接启用只会得到一条必然失败的线路。
     * 单个模型失败不影响其余模型，失败原因逐条返回。
     */
    async importChannels(payload) {
        const data = payload;
        if (!data || data.format !== channel_types_1.SYSTEM_CHANNEL_EXPORT_FORMAT) {
            throw (0, json_1.badRequest)('不是系统渠道导出文件');
        }
        if (data.version !== channel_types_1.SYSTEM_CHANNEL_EXPORT_VERSION) {
            throw (0, json_1.badRequest)(`不支持的导出文件版本：${data.version}`);
        }
        const channels = Array.isArray(data.channels) ? data.channels : [];
        if (channels.length === 0)
            throw (0, json_1.badRequest)('导出文件中没有渠道');
        if (channels.length > channel_types_1.MAX_IMPORTED_SYSTEM_CHANNELS) {
            throw (0, json_1.badRequest)(`一次最多导入 ${channel_types_1.MAX_IMPORTED_SYSTEM_CHANNELS} 个渠道`);
        }
        const seenNames = new Set();
        for (const channel of channels) {
            const name = String(channel.name ?? '').trim();
            if (!name)
                throw (0, json_1.badRequest)('导出文件中存在未命名的渠道');
            if (seenNames.has(name))
                throw (0, json_1.badRequest)(`导出文件中渠道名称重复：${name}`);
            seenNames.add(name);
            if ((channel.models ?? []).length > channel_types_1.MAX_IMPORTED_CHANNEL_MODELS) {
                throw (0, json_1.badRequest)(`渠道 ${name} 的模型超过 ${channel_types_1.MAX_IMPORTED_CHANNEL_MODELS} 个`);
            }
        }
        const existing = await this.prisma.modelChannel.findMany({
            where: { scope: channel_types_1.CHANNEL_SCOPE_SYSTEM, deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });
        const byName = new Map();
        for (const row of existing)
            if (!byName.has(row.name))
                byName.set(row.name, row);
        const result = {
            createdChannels: [],
            updatedChannels: [],
            savedModels: 0,
            errors: [],
        };
        for (const imported of channels) {
            const name = String(imported.name ?? '').trim();
            let channelId = '';
            let created = false;
            try {
                const saved = await this.importChannel(imported, byName);
                channelId = saved.id;
                created = saved.created;
            }
            catch (error) {
                result.errors.push(`渠道 ${name}：${this.messageOf(error)}`);
                continue;
            }
            if (created)
                result.createdChannels.push(name);
            else
                result.updatedChannels.push(name);
            for (const importedModel of imported.models ?? []) {
                try {
                    await this.importModel(channelId, importedModel);
                    result.savedModels += 1;
                }
                catch (error) {
                    result.errors.push(`渠道 ${name} 模型 ${String(importedModel.modelKey ?? '')}：${this.messageOf(error)}`);
                }
            }
        }
        await this.catalogVersion.invalidate();
        return result;
    }
    async importChannel(imported, byName) {
        const name = String(imported.name ?? '').trim();
        const sortOrder = Number.isInteger(imported.sortOrder) ? imported.sortOrder : 0;
        const useGlobal = !(Number(imported.concurrencyLimit) > 0);
        const request = {
            name,
            baseUrl: imported.baseUrl,
            sortOrder,
            useGlobalConcurrency: useGlobal,
            concurrencyLimit: useGlobal ? undefined : imported.concurrencyLimit,
        };
        const current = byName.get(name);
        if (current) {
            // 不传 models：导出文件之外的模型保持原状；不传凭证：保留目标环境密钥
            await this.update(current.id, request);
            return { id: current.id, created: false };
        }
        const created = await this.create({ ...request, enabled: false });
        return { id: created.id, created: true };
    }
    async importModel(channelId, imported) {
        const modelKey = String(imported.modelKey ?? '').trim().replace(/^models\//, '');
        if (!modelKey)
            throw (0, json_1.badRequest)('缺少模型标识');
        const current = await this.channelModels.findByKey(channelId, modelKey);
        const request = { ...imported, modelKey };
        const saved = await this.channelModels.save(channelId, current?.id ?? '', request);
        const sortOrder = Number(imported.sortOrder);
        if (Number.isInteger(sortOrder) && sortOrder >= 0 && sortOrder <= channel_types_1.MAX_SORT_ORDER && sortOrder !== saved.sortOrder) {
            await this.channelModels.updateSort(channelId, saved.id, sortOrder);
        }
    }
    modelToRequest(model, tiers) {
        const priceTiers = tiers.map((tier) => ({
            costPricing: {
                configured: tier.costConfigured,
                unitPriceMicrocredits: (0, channel_presentation_1.toNumber)(tier.costUnitPriceMicrocredits),
                inputTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(tier.costInputTokenPriceMicrocredits),
                outputTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(tier.costOutputTokenPriceMicrocredits),
                cachedTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(tier.costCachedTokenPriceMicrocredits),
            },
            selector: decodeSelector(tier.selectorJson),
            resolution: tier.resolution,
            videoSeconds: tier.videoSeconds,
            providerModelKey: tier.providerModelKey,
            billingMode: tier.billingMode,
            unitPriceMicrocredits: (0, channel_presentation_1.toNumber)(tier.unitPriceMicrocredits),
            inputTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(tier.inputTokenPriceMicrocredits),
            outputTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(tier.outputTokenPriceMicrocredits),
            cachedTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(tier.cachedTokenPriceMicrocredits),
            priceConfigured: tier.priceConfigured,
            enabled: tier.enabled,
        }));
        return {
            modelKey: model.modelKey,
            providerModelKey: model.providerModelKey,
            displayName: model.displayName,
            channelLabel: model.channelLabel,
            tags: JSON.parse(model.tags || '[]'),
            description: model.description,
            icon: model.icon,
            capability: model.capability,
            protocol: model.protocol,
            billingMode: model.billingMode,
            unitPriceMicrocredits: (0, channel_presentation_1.toNumber)(model.unitPriceMicrocredits),
            inputTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(model.inputTokenPriceMicrocredits),
            outputTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(model.outputTokenPriceMicrocredits),
            cachedTokenPriceMicrocredits: (0, channel_presentation_1.toNumber)(model.cachedTokenPriceMicrocredits),
            priceConfigured: model.priceConfigured,
            priceCurrency: model.priceCurrency || 'credits',
            enabled: model.enabled,
            capabilityConfig: model.capabilityConfigJson ? JSON.parse(model.capabilityConfigJson) : null,
            priceTiers,
        };
    }
    /* ───────────────────────── 内部：请求 → 列 ───────────────────────── */
    mergeRequest(req, channel) {
        return {
            ...req,
            name: String(req.name ?? '').trim() || channel.name,
            baseUrl: String(req.baseUrl ?? '').trim() || channel.baseUrl,
            models: req.models === undefined || req.models === null ? (0, channel_presentation_1.channelModelNames)(channel) : req.models,
            headers: req.headers === undefined || req.headers === null ? parseSafeHeaders(channel.headersJson) : req.headers,
            proxyUrl: req.proxyUrl === undefined || req.proxyUrl === null ? channel.proxyUrl : req.proxyUrl,
        };
    }
    async buildChannelFields(req, current) {
        const name = String(req.name ?? '').trim();
        if (!name)
            throw (0, json_1.badRequest)('请填写渠道名称');
        const baseUrl = String(req.baseUrl ?? '').trim();
        if (!baseUrl)
            throw (0, json_1.badRequest)('请填写 Base URL');
        const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
        const connectionChanged = normalizedBaseUrl !== String(current.baseUrl ?? '').replace(/\/+$/, '');
        if (connectionChanged) {
            try {
                await (0, outbound_1.validateOutboundUrl)(normalizedBaseUrl);
            }
            catch (error) {
                rethrowOutbound(error);
            }
        }
        const fields = {
            name,
            baseUrl: normalizedBaseUrl,
            apiFormat: 'openai',
            concurrencyLimit: current.concurrencyLimit,
            modelsJson: JSON.stringify((0, json_1.uniqueNonEmpty)(req.models ?? [])),
            headersJson: current.headersJson,
            // 代理：undefined/null 已在 mergeRequest 中回填为渠道现有值；空串 = 显式清空
            proxyUrl: String(req.proxyUrl ?? '').trim(),
            enabled: req.enabled === undefined || req.enabled === null ? current.enabled : Boolean(req.enabled),
        };
        try {
            (0, outbound_1.validateProxyUrl)(fields.proxyUrl);
        }
        catch (error) {
            rethrowOutbound(error);
        }
        // 凭证：非空才覆盖并加密；空 = 沿用库里的密文
        const apiKey = String(req.apiKey ?? '').trim();
        if (apiKey)
            fields.apiKey = this.cipher.encrypt(apiKey);
        const secretKey = String(req.secretKey ?? '').trim();
        if (secretKey)
            fields.secretKey = this.cipher.encrypt(secretKey);
        if (req.sortOrder !== undefined && req.sortOrder !== null) {
            const sortOrder = Number(req.sortOrder);
            if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > channel_types_1.MAX_SORT_ORDER) {
                throw (0, json_1.badRequest)('排序值必须是 0-999999 的整数，数值越小越靠前');
            }
            fields.sortOrder = sortOrder;
        }
        if (req.useGlobalConcurrency === true) {
            fields.concurrencyLimit = 0;
        }
        else if (req.concurrencyLimit !== undefined && req.concurrencyLimit !== null) {
            const limit = Number(req.concurrencyLimit);
            if (!Number.isInteger(limit) || limit < channel_types_1.MIN_CHANNEL_CONCURRENCY || limit > channel_types_1.MAX_CHANNEL_CONCURRENCY) {
                throw (0, json_1.badRequest)('最大并发数必须是 1-999 的整数');
            }
            fields.concurrencyLimit = limit;
        }
        else if (req.useGlobalConcurrency === false) {
            throw (0, json_1.badRequest)('请填写渠道最大并发数');
        }
        if (req.headers !== undefined && req.headers !== null) {
            try {
                fields.headersJson = (0, outbound_1.encodeOutboundHeaders)(req.headers);
            }
            catch (error) {
                rethrowOutbound(error);
            }
        }
        return { fields, models: (0, json_1.uniqueNonEmpty)(req.models ?? []) };
    }
    /* ───────────────────────── 内部：投影 ───────────────────────── */
    async requireChannel(id) {
        const channelId = String(id ?? '').trim();
        if (!channelId)
            throw channelNotFound();
        const row = await this.prisma.modelChannel.findFirst({
            where: { id: channelId, scope: channel_types_1.CHANNEL_SCOPE_SYSTEM, deletedAt: null },
        });
        if (!row)
            throw channelNotFound();
        return row;
    }
    async project(row, admin) {
        const models = await this.prisma.channelModel.findMany({
            where: { channelId: row.id, deletedAt: null, ...(admin ? {} : { enabled: true }) },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });
        return (0, channel_presentation_1.publicChannel)(row, admin, models);
    }
    messageOf(error) {
        if (error instanceof app_exception_1.AppError)
            return String(error.getResponse()?.message ?? error.message);
        if (error instanceof Error)
            return error.message;
        return String(error);
    }
};
exports.ChannelService = ChannelService;
exports.ChannelService = ChannelService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        secret_cipher_1.SecretCipher,
        catalog_version_service_1.CatalogVersionService,
        channel_model_service_1.ChannelModelService])
], ChannelService);
/** 解码导出用的选择器；损坏的 JSON 视为空选择器（导出不应因历史脏数据中断） */
function decodeSelector(raw) {
    try {
        const value = JSON.parse(raw || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return {};
        const selector = {};
        for (const [key, item] of Object.entries(value))
            selector[key] = String(item ?? '');
        return selector;
    }
    catch {
        return {};
    }
}
/** 解析历史自定义头；损坏时返回空数组，让管理员重新填写 */
function parseSafeHeaders(raw) {
    try {
        return (0, outbound_1.parseOutboundHeaders)(raw);
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=channel.service.js.map