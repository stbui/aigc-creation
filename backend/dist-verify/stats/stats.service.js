"use strict";
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
exports.StatsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const capability_registry_1 = require("../capabilities/capability.registry");
const signed_url_service_1 = require("../common/signed-url.service");
/**
 * 数据中心聚合。
 *
 * 全部用真实表统计, 不编造"积分/消耗"这类尚不存在的概念 —— 账号数据区展示的是
 * 累计生成次数 / 成功率 / 素材量 / 近 7 天产出。
 */
let StatsService = class StatsService {
    constructor(prisma, signedUrl) {
        this.prisma = prisma;
        this.signedUrl = signedUrl;
    }
    async overview(ownerId) {
        const now = new Date();
        const since = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
        const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const [taskGroups, assetGroups, projectCount, recentTasks, weekTasks] = await Promise.all([
            this.prisma.generationTask.groupBy({ by: ['capability', 'status'], where: { ownerId }, _count: { _all: true } }),
            // 素材统计与素材库同口径: 只算 status='visible'。
            // 若把后台已下架的也算进来, 数据中心「素材总量 / 生成图」会比素材库
            // 的「共 N 个素材」多出看不见的条目, 用户无法核对。
            this.prisma.asset.groupBy({
                by: ['kind'],
                where: { ownerId, status: 'visible' },
                _count: { _all: true },
            }),
            this.prisma.project.count({ where: { ownerId } }),
            this.prisma.generationTask.findMany({
                where: { ownerId },
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: {
                    id: true,
                    capability: true,
                    status: true,
                    createdAt: true,
                    outputAsset: { select: { id: true, sourceUrl: true, status: true } },
                },
            }),
            this.prisma.generationTask.findMany({
                where: { ownerId, createdAt: { gte: since } },
                select: { createdAt: true, status: true },
            }),
        ]);
        // 任务汇总
        const tasks = { total: 0, succeeded: 0, failed: 0, running: 0, queued: 0 };
        const byCapabilityMap = new Map();
        for (const g of taskGroups) {
            const n = g._count._all;
            tasks.total += n;
            if (tasks[g.status] !== undefined)
                tasks[g.status] += n;
            const cur = byCapabilityMap.get(g.capability) ?? { total: 0, succeeded: 0 };
            cur.total += n;
            if (g.status === 'succeeded')
                cur.succeeded += n;
            byCapabilityMap.set(g.capability, cur);
        }
        const assets = { total: 0, original: 0, generated: 0 };
        for (const g of assetGroups) {
            const n = g._count._all;
            assets.total += n;
            if (assets[g.kind] !== undefined)
                assets[g.kind] += n;
        }
        // 近 7 天: 补齐没有产出的日期, 前端直接画折线
        const dailyMap = new Map();
        for (let i = 6; i >= 0; i--) {
            dailyMap.set(dayKey(new Date(now.getTime() - i * 24 * 3600 * 1000)), 0);
        }
        for (const t of weekTasks) {
            const k = dayKey(new Date(t.createdAt));
            if (dailyMap.has(k))
                dailyMap.set(k, (dailyMap.get(k) ?? 0) + 1);
        }
        const finished = tasks.succeeded + tasks.failed;
        // 每项能力取最近一次成功产出, 作为工作台卡片的示例图 (真实产出优先, 没有则前端用设计化占位)
        const capabilityThumbs = new Map();
        for (const t of await this.prisma.generationTask.findMany({
            where: { ownerId, status: 'succeeded', outputAssetId: { not: null } },
            orderBy: { createdAt: 'desc' },
            select: {
                capability: true,
                createdAt: true,
                outputAsset: { select: { sourceUrl: true, status: true } },
            },
        })) {
            // 下架产出不拿来当示例图: 素材库看不到它, 这里却展示会让用户点开 404
            const url = t.outputAsset?.status === 'visible' ? t.outputAsset.sourceUrl : null;
            if (url && !capabilityThumbs.has(t.capability)) {
                capabilityThumbs.set(t.capability, { url, createdAt: t.createdAt });
            }
        }
        return {
            totals: {
                tasks: tasks.total,
                succeeded: tasks.succeeded,
                failed: tasks.failed,
                // 「进行中」= 执行中 + 排队中：对用户而言两者都是还没出结果
                running: tasks.running + tasks.queued,
                assets: assets.total,
                originals: assets.original,
                generated: assets.generated,
                projects: projectCount,
                successRate: finished > 0 ? Math.round((tasks.succeeded / finished) * 100) : null,
            },
            byCapability: [...byCapabilityMap.entries()]
                .map(([capability, v]) => ({
                capability,
                name: (0, capability_registry_1.getCapability)(capability)?.name ?? capability,
                mode: (0, capability_registry_1.getCapability)(capability)?.mode ?? 'planned',
                total: v.total,
                succeeded: v.succeeded,
                // 展示专用: 开启 ASSET_SIGNING_SECRET 后必须签名, 否则 <img> 403
                thumbnailUrl: this.signedUrl.displayUrl(capabilityThumbs.get(capability)?.url),
            }))
                .sort((a, b) => b.total - a.total),
            last7Days: [...dailyMap.entries()].map(([date, count]) => ({ date, count })),
            recentTasks: recentTasks.map((t) => ({
                id: t.id,
                capability: t.capability,
                name: (0, capability_registry_1.getCapability)(t.capability)?.name ?? t.capability,
                status: t.status,
                createdAt: t.createdAt,
                // 下架产出不给缩略图 (与素材库同口径: 用户看不到它)
                thumbnailUrl: this.signedUrl.displayUrl(t.outputAsset?.status === 'visible' ? t.outputAsset.sourceUrl : null),
            })),
        };
    }
};
exports.StatsService = StatsService;
exports.StatsService = StatsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        signed_url_service_1.SignedUrlService])
], StatsService);
//# sourceMappingURL=stats.service.js.map