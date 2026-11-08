"use strict";
/**
 * 路由目录快照：前台模型 → revision → 线路 → 渠道模型 → 价格档 的内存投影。
 *
 * 移植自 open-ai-canvas `internal/app/model_router.go` 的 `loadRouteCatalog` /
 * `routeCatalogSnapshot`。
 *
 * 三条运行时约束（违背任意一条都会出现「目录显示可用、任务走不到」）：
 *   1. **装载期剔除不可用线路**：渠道或模型停用、`unified+token` 但协议不支持
 *      Token、`channel` 策略但没有任何有效价格档、能力配置非法；
 *   2. **TTL 30s + 最大过期 5min**：数据库短暂不可用时继续用旧快照，
 *      首次装载失败则明确失败（不能拿空目录当「全部不可用」）；
 *   3. **刷新失败冷却 2s**：并发请求不能同时回源，否则数据库抖动会放大成雪崩。
 *
 * 目录版本由 `CatalogVersionService` 维护：本进程写入后即时失效，其他进程
 * 最多滞后一个 TTL。前台模型 / 线路 / 价格 / 分组写入路径都必须递增版本。
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
var RouteCatalogService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteCatalogService = void 0;
exports.buildCachedChannelModel = buildCachedChannelModel;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const catalog_version_service_1 = require("../infra/catalog-version.service");
const selector_1 = require("../domain/selector");
const capability_spec_1 = require("../intent/capability-spec");
const channel_presentation_1 = require("../channels/channel.presentation");
const channel_model_projection_1 = require("../routing/channel-model.projection");
const SNAPSHOT_TTL_MS = 30_000;
const SNAPSHOT_MAX_STALE_MS = 5 * 60_000;
const REFRESH_RETRY_COOLDOWN_MS = 2_000;
let RouteCatalogService = RouteCatalogService_1 = class RouteCatalogService {
    constructor(prisma, catalogVersion) {
        this.prisma = prisma;
        this.catalogVersion = catalogVersion;
        this.log = new common_1.Logger(RouteCatalogService_1.name);
        this.snapshot = null;
        this.refreshing = null;
        this.refreshError = null;
        this.retryAt = 0;
        /** 上一次成功读取到的目录版本；版本读取失败时用它兜底 */
        this.lastVersion = 0;
    }
    onModuleInit() {
        // 本进程写入（渠道/模型/价格/分组）后立即丢弃快照，不等 TTL
        this.catalogVersion.onChange(() => this.invalidateLocal());
    }
    /** 丢弃本地快照；版本号由写入方负责递增 */
    invalidateLocal() {
        this.snapshot = null;
        this.refreshError = null;
        this.retryAt = 0;
    }
    async snapshotNow() {
        return this.snapshotOrThrow();
    }
    /**
     * 按线路 id 取快照里的线路（任务执行期重建请求用）。
     *
     * 任务快照只存 `routeId`，执行时必须回到**同一份合同**：换一条线路的
     * 能力配置重建请求，等于把「按 A 匹配到的参数」发给了 B。
     * 找不到返回 `null`（线路可能刚被删除），由调用方判失败并退款。
     */
    async findRoute(routeId) {
        const key = String(routeId ?? '').trim();
        if (!key)
            return null;
        const snapshot = await this.snapshotOrThrow();
        for (const model of snapshot.models.values()) {
            for (const route of model.routes) {
                if (route.id === key)
                    return route;
            }
        }
        return null;
    }
    /**
     * 取当前快照；必要时回源。
     *
     * 版本号只在 TTL 过期后读取：请求路径上多一次 PK 查询不值得，而本进程写入
     * 已通过监听即时失效；跨进程最多滞后一个 TTL，与设计文档一致。
     */
    async snapshotOrThrow() {
        const now = Date.now();
        const current = this.snapshot;
        if (current && now - current.loadedAt < SNAPSHOT_TTL_MS)
            return current;
        if (this.refreshing)
            return this.refreshing;
        const stale = current && now - current.loadedAt <= SNAPSHOT_MAX_STALE_MS ? current : null;
        if (this.refreshError && now < this.retryAt) {
            if (stale)
                return stale;
            throw this.refreshError;
        }
        this.refreshing = this.refresh()
            .then((loaded) => {
            this.snapshot = loaded;
            this.refreshError = null;
            this.retryAt = 0;
            return loaded;
        })
            .catch((error) => {
            const failure = error instanceof Error ? error : new Error(String(error));
            this.refreshError = failure;
            this.retryAt = Date.now() + REFRESH_RETRY_COOLDOWN_MS;
            this.log.error(`路由目录刷新失败，${REFRESH_RETRY_COOLDOWN_MS}ms 后重试：${failure.message}`);
            if (stale)
                return stale;
            throw failure;
        })
            .finally(() => {
            this.refreshing = null;
        });
        return this.refreshing;
    }
    /** 回源装载一份新快照 */
    async refresh() {
        const startedAt = Date.now();
        const version = await this.readVersion();
        const logicalModels = await this.prisma.logicalModel.findMany({
            where: { enabled: true, archivedAt: null, activeRevisionId: { not: '' } },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });
        const models = new Map();
        const ordered = [];
        if (logicalModels.length === 0) {
            return { models, ordered, loadedAt: startedAt, catalogVersion: version };
        }
        const revisions = await this.prisma.logicalModelRevision.findMany({
            where: { id: { in: logicalModels.map((row) => row.activeRevisionId) } },
        });
        const revisionById = new Map(revisions.map((row) => [row.id, row]));
        const routes = await this.prisma.logicalModelRoute.findMany({
            where: { logicalModelRevisionId: { in: revisions.map((row) => row.id) }, enabled: true },
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        });
        const channelModels = await this.prisma.channelModel.findMany({
            where: {
                id: { in: [...new Set(routes.map((row) => row.channelModelId))] },
                enabled: true,
                deletedAt: null,
            },
        });
        const channelModelById = new Map(channelModels.map((row) => [row.id, row]));
        const tiers = await this.prisma.channelModelPriceTier.findMany({
            where: { channelModelId: { in: [...channelModelById.keys()] }, deletedAt: null },
            orderBy: [{ createdAt: 'asc' }],
        });
        const channels = await this.prisma.modelChannel.findMany({
            where: { id: { in: [...new Set(channelModels.map((row) => row.channelId))] }, enabled: true, deletedAt: null },
            select: { id: true },
        });
        const enabledChannelIds = new Set(channels.map((row) => row.id));
        // 渠道模型 → 快照对象（能力合同非法时剔除并记原因，不阻断整份目录）
        const cachedChannelModels = new Map();
        for (const row of channelModels) {
            if (!enabledChannelIds.has(row.channelId))
                continue;
            try {
                cachedChannelModels.set(row.id, (0, channel_model_projection_1.projectCachedChannelModel)(row, tiers));
            }
            catch (error) {
                this.log.warn(`渠道模型被排除出路由目录 id=${row.id}：能力配置非法（${describe(error)}）`);
            }
        }
        for (const item of logicalModels) {
            const revision = revisionById.get(item.activeRevisionId);
            if (!revision) {
                this.log.warn(`前台模型被排除出路由目录 id=${item.id}：活动 revision 不存在`);
                continue;
            }
            let productSpec;
            try {
                productSpec = (0, capability_spec_1.decodeCapabilitySpec)(revision.capabilitySpecJson);
            }
            catch (error) {
                this.log.warn(`前台模型被排除出路由目录 id=${item.id}：能力合同非法（${describe(error)}）`);
                continue;
            }
            const cachedRoutes = [];
            for (const route of routes) {
                if (route.logicalModelRevisionId !== revision.id)
                    continue;
                const channelModel = cachedChannelModels.get(route.channelModelId);
                if (!channelModel)
                    continue;
                // 统一价 + Token 计费要求线路协议真的支持 Token，否则这条线路永远结算不了
                if (item.pricePolicy === 'unified' && item.billingMode === 'token' && !(0, selector_1.supportsTokenBilling)(item.capability)) {
                    continue;
                }
                if (item.pricePolicy === 'channel' && !channelModel.priceTiers.some((tier) => tier.enabled && tier.priceConfigured)) {
                    continue;
                }
                cachedRoutes.push({
                    id: route.id,
                    channelModelId: route.channelModelId,
                    enabled: route.enabled,
                    priority: route.priority,
                    weight: route.weight,
                    channelModel,
                });
            }
            const enabledSpecs = cachedRoutes
                .filter((route) => route.enabled && route.weight > 0)
                .map((route) => route.channelModel.capabilitySpec);
            const mergedSpec = (0, capability_spec_1.capabilitySpecWithRoutePresets)(productSpec, enabledSpecs);
            let defaults;
            try {
                defaults = (0, capability_spec_1.decodeLogicalDefaults)(revision.defaultOptionsJson, mergedSpec);
            }
            catch (error) {
                this.log.warn(`前台模型被排除出路由目录 id=${item.id}：默认参数非法（${describe(error)}）`);
                continue;
            }
            models.set(item.id, {
                id: item.id,
                code: item.code,
                name: item.name,
                icon: item.icon,
                description: item.description,
                capability: item.capability,
                sortOrder: item.sortOrder,
                enabled: item.enabled,
                pricePolicy: item.pricePolicy,
                billingMode: item.billingMode,
                unitPriceMicrocredits: (0, channel_presentation_1.toNumber)(item.unitPriceMicrocredits),
                inputPriceMicrocredits: (0, channel_presentation_1.toNumber)(item.inputPriceMicrocredits),
                outputPriceMicrocredits: (0, channel_presentation_1.toNumber)(item.outputPriceMicrocredits),
                cachedPriceMicrocredits: (0, channel_presentation_1.toNumber)(item.cachedPriceMicrocredits),
                legacyModelIds: decodeStringArray(item.legacyModelIdsJson),
                revisionId: revision.id,
                revisionVersion: revision.version,
                productSpec: mergedSpec,
                defaults,
                routes: cachedRoutes,
                archivedAt: item.archivedAt ? item.archivedAt.getTime() : null,
            });
            ordered.push(item.id);
        }
        this.log.debug(`路由目录装载完成：${models.size} 个前台模型，${cachedChannelModels.size} 个渠道模型，版本 ${version}`);
        return { models, ordered, loadedAt: startedAt, catalogVersion: version };
    }
    async readVersion() {
        try {
            this.lastVersion = await this.catalogVersion.current();
            return this.lastVersion;
        }
        catch {
            // 版本读取失败不应让目录整体失败：本次用旧版本号，装载结果仍然可用
            return this.lastVersion;
        }
    }
};
exports.RouteCatalogService = RouteCatalogService;
exports.RouteCatalogService = RouteCatalogService = RouteCatalogService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        catalog_version_service_1.CatalogVersionService])
], RouteCatalogService);
function decodeStringArray(raw) {
    try {
        const parsed = JSON.parse(raw || '[]');
        if (!Array.isArray(parsed))
            return [];
        return [...new Set(parsed.map((item) => String(item ?? '').trim()).filter((item) => item !== ''))];
    }
    catch {
        return [];
    }
}
function describe(error) {
    return error instanceof Error ? error.message : String(error);
}
/** 供验收脚本直接构造最小渠道模型快照（不经过数据库） */
function buildCachedChannelModel(input) {
    return {
        id: input.id,
        channelId: input.channelId,
        modelKey: input.modelKey,
        providerModelKey: input.modelKey,
        displayName: input.modelKey,
        capability: input.capability,
        protocol: 'openai',
        priceCurrency: 'credits',
        billingMode: 'fixed_request',
        priceConfigured: (input.priceTiers ?? []).some((tier) => tier.enabled && tier.priceConfigured),
        priceVersion: input.priceVersion ?? 0,
        capabilitySpec: (0, capability_spec_1.capabilitySpecFromModelCapabilityConfig)(input.config, input.capability),
        priceTiers: input.priceTiers ?? [],
    };
}
//# sourceMappingURL=route-catalog.service.js.map