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
var HealthController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
/**
 * 健康检查。
 *
 * 两个端点，用途不同，**不要合并**：
 *   · `GET /health`        —— 给人看的诊断面板：数据库、存储、三种模态的模型线路
 *                            各自的状态与冷却情况。永远返回 200（除非进程起不来），
 *                            部分降级时 `status='degraded'`。
 *   · `GET /health/ready`  —— 给编排系统看的就绪探针：只有「关键依赖可用」
 *                            才返回 200，否则 503。Docker/K8s 据此决定
 *                            要不要把流量打进来。
 *
 * 关键依赖只有数据库：模型线路全部不可用时，生成任务会明确失败并退款，
 * 但后台管理与排障入口仍应可用。存储不可用时上传/生成同样会失败 ——
 * 这些属于业务降级，不该让整个实例被摘除。容器探针走 `/health/ready`，
 * 不受线路状态影响。
 *
 * 存储探测带 30 秒缓存：OSS/MinIO 的连通性探测要发网络请求，
 * 探针 5 秒一次会把一个纯读接口变成对外部服务的压力源。
 */
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../prisma/prisma.service");
const storage_service_1 = require("../storage/storage.service");
const route_health_service_1 = require("../model/routing/route-health.service");
const app_exception_1 = require("../common/app.exception");
const request_context_1 = require("../common/request-context");
const STORAGE_PROBE_TTL_MS = 30_000;
const MODALITIES = ['image', 'text', 'video'];
function pkgVersion() {
    try {
        // dist/health/health.controller.js → ../../package.json = backend/package.json
        return String(require('../../package.json').version ?? '0.0.0');
    }
    catch {
        return 'unknown';
    }
}
let HealthController = HealthController_1 = class HealthController {
    constructor(prisma, storage, routeHealth, config) {
        this.prisma = prisma;
        this.storage = storage;
        this.routeHealth = routeHealth;
        this.config = config;
        this.logger = new common_1.Logger(HealthController_1.name);
        this.storageCache = null;
        this.startedAt = Date.now();
    }
    async health() {
        const [db, storage, channels] = await Promise.all([
            this.checkDb(),
            this.checkStorage(),
            this.checkChannels(),
        ]);
        const degraded = !db.ok || !storage.ok || MODALITIES.some((m) => channels[m]?.ok === false);
        return {
            status: degraded ? 'degraded' : 'ok',
            version: pkgVersion(),
            env: this.config.get('app.env') ?? process.env.NODE_ENV ?? 'development',
            uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
            timestamp: new Date().toISOString(),
            requestId: (0, request_context_1.currentRequestId)() ?? null,
            checks: { db, storage, channels },
        };
    }
    async ready() {
        const db = await this.checkDb();
        if (!db.ok) {
            // 503 由统一异常过滤器包成 { code, data: null, message }
            throw new app_exception_1.AppError(50301, `数据库不可用: ${db.message ?? '未知原因'}`, 503);
        }
        return { ready: true, db, timestamp: new Date().toISOString() };
    }
    async checkDb() {
        const start = Date.now();
        try {
            // 真实走一次库：连接池/文件锁/wal 的问题只有发查询才暴露，
            // 用进程内标记判断等于自欺欺人
            await this.prisma.user.findFirst({ select: { id: true } });
            return { ok: true, latencyMs: Date.now() - start };
        }
        catch (e) {
            this.logger.error(`数据库健康检查失败: ${e.message}`);
            return { ok: false, latencyMs: Date.now() - start, message: e.message };
        }
    }
    async checkStorage() {
        // getActive() 对「配置了但没就绪」的后端会抛错 (拒绝静默回落本地盘),
        // 健康检查要能如实报出这条原因, 而不是自己 500。
        let backend;
        try {
            backend = this.storage.getActive().backend;
        }
        catch (e) {
            // latencyMs 用 0: 这里没真的探测存储, 是配置/依赖缺失直接判死
            return { ok: false, latencyMs: 0, message: e.message };
        }
        if (this.storageCache && Date.now() - this.storageCache.at < STORAGE_PROBE_TTL_MS) {
            return { ...this.storageCache.value, backend, cached: true };
        }
        const start = Date.now();
        let value;
        try {
            const probe = await this.storage.getActive().probe();
            value = { ok: probe.ok, latencyMs: probe.latencyMs ?? Date.now() - start, message: probe.message };
        }
        catch (e) {
            value = { ok: false, latencyMs: Date.now() - start, message: e.message };
        }
        this.storageCache = { at: Date.now(), value };
        return { ...value, backend, cached: false };
    }
    /**
     * 三种模态的线路概况。
     *
     * 口径与调度器一致：**渠道模型是线路的最小单位**，渠道停用即其下所有模型不可用；
     * 冷却中的键来自 `RouteHealthService`（进程内，只反映本实例）。
     * 没有任何可用线路不算进程级故障，但该模态能力会不可提交 / 失败并退款 ——
     * 这里只如实汇报「可用的有几条」，由调用方判断这对当前部署意味着什么。
     */
    async checkChannels() {
        const out = {};
        try {
            const blocked = new Set(this.routeHealth.snapshot().map((block) => block.key));
            const [channels, models] = await Promise.all([
                this.prisma.modelChannel.findMany({
                    where: { enabled: true, deletedAt: null },
                    select: { id: true },
                }),
                this.prisma.channelModel.findMany({
                    where: { deletedAt: null },
                    select: { id: true, channelId: true, capability: true, enabled: true },
                }),
            ]);
            const liveChannelIds = new Set(channels.map((row) => row.id));
            for (const modality of MODALITIES) {
                const rows = models.filter((row) => row.capability === modality);
                const live = rows.filter((row) => liveChannelIds.has(row.channelId));
                const cooling = live.filter((row) => blocked.has(`channel:${row.channelId}`) || blocked.has(`channel-model:${row.id}`));
                const usable = live.filter((row) => row.enabled &&
                    !blocked.has(`channel:${row.channelId}`) &&
                    !blocked.has(`channel-model:${row.id}`));
                out[modality] = {
                    ok: usable.length > 0,
                    total: rows.length,
                    enabled: live.filter((row) => row.enabled).length,
                    available: usable.length,
                    cooling: cooling.length,
                };
            }
        }
        catch (e) {
            for (const modality of MODALITIES) {
                out[modality] = {
                    ok: false,
                    total: 0,
                    enabled: 0,
                    available: 0,
                    cooling: 0,
                    message: e.message,
                };
            }
        }
        return out;
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "health", null);
__decorate([
    (0, common_1.Get)('ready'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "ready", null);
exports.HealthController = HealthController = HealthController_1 = __decorate([
    (0, common_1.Controller)('health'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        storage_service_1.StorageService,
        route_health_service_1.RouteHealthService,
        config_1.ConfigService])
], HealthController);
//# sourceMappingURL=health.controller.js.map