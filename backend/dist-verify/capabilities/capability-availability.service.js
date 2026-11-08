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
var CapabilityAvailabilityService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CapabilityAvailabilityService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const route_catalog_service_1 = require("../model/catalog/route-catalog.service");
const capability_registry_1 = require("./capability.registry");
const app_exception_1 = require("../common/app.exception");
/**
 * 管控记录的短缓存。
 *
 * 生成链路的每个任务都要查一次 —— 直接打库会把「一次生成」变成两次查询。
 * 3 秒与本项目其它运行时配置保持同一个量级：后台改完最多 3 秒生效，
 * 后台写入时主动失效。
 */
const CONTROL_TTL_MS = 3000;
/** 可用性缓存：与管控记录同量级；路由目录自身另有 30s TTL 与版本失效 */
const REMOTE_TTL_MS = 3000;
let CapabilityAvailabilityService = CapabilityAvailabilityService_1 = class CapabilityAvailabilityService {
    constructor(prisma, catalog) {
        this.prisma = prisma;
        this.catalog = catalog;
        this.log = new common_1.Logger(CapabilityAvailabilityService_1.name);
        this.cache = null;
        /** 每项能力的线路可用性缓存（能力 id → 结论） */
        this.remoteCache = new Map();
    }
    /**
     * 某项能力当前是否有可用线路。
     *
     * 判定条件是「目录里有该能力的前台模型，且至少一条启用且权重 > 0 的线路」——
     * 与 `RouterService` 选路用的是同一份快照，不会出现口径分歧。
     */
    async remoteOf(capabilityId) {
        const hit = this.remoteCache.get(capabilityId);
        if (hit && Date.now() - hit.at < REMOTE_TTL_MS)
            return hit.info;
        let info = { available: false, label: '' };
        try {
            const snapshot = await this.catalog.snapshotOrThrow();
            for (const id of snapshot.ordered) {
                const model = snapshot.models.get(id);
                if (!model || model.capability !== capabilityId)
                    continue;
                const route = model.routes.find((item) => item.enabled && item.weight > 0);
                if (!route)
                    continue;
                info = {
                    available: true,
                    label: `模型线路可用（${model.name} · ${route.channelModel.displayName}）`,
                };
                break;
            }
        }
        catch (e) {
            // 目录读失败只影响「预期徽标」，不能让 /capabilities 整个 500
            this.log.warn(`读取路由目录失败, ${capabilityId} 按无可用线路处理 — ${e.message}`);
        }
        this.remoteCache.set(capabilityId, { at: Date.now(), info });
        return info;
    }
    /** 清空缓存（后台写入后调用，避免「刚下线还能提交」的 3 秒空窗） */
    invalidate() {
        this.cache = null;
        this.remoteCache.clear();
    }
    async controls() {
        if (this.cache && Date.now() - this.cache.at < CONTROL_TTL_MS)
            return this.cache.rows;
        const rows = await this.prisma.capabilityControl.findMany();
        const map = new Map(rows.map((r) => [r.capabilityId, { capabilityId: r.capabilityId, enabled: r.enabled, reason: r.reason }]));
        this.cache = { at: Date.now(), rows: map };
        return map;
    }
    /** 单项能力的运行时状态 */
    async runtimeOf(capabilityId) {
        const def = (0, capability_registry_1.getCapability)(capabilityId);
        if (!def)
            return null;
        const map = await this.controls();
        const remote = await this.remoteOf(def.id);
        return this.compose(remote, map.get(capabilityId));
    }
    /** 全量能力的运行时状态（`GET /capabilities` 用） */
    async runtimeAll() {
        const map = await this.controls();
        const out = {};
        for (const def of capability_registry_1.CAPABILITIES) {
            out[def.id] = this.compose(await this.remoteOf(def.id), map.get(def.id));
        }
        return out;
    }
    /**
     * 合成运行时结论。
     *
     * 先看运营下线状态，再看有没有可用线路。两者都不改写下发内容：
     * 下线就是 `disabled`，没有线路就是 `unavailable`，绝不静默改走别的路。
     */
    compose(remote, control) {
        const remoteAvailable = remote.available;
        const enabled = control ? control.enabled : true;
        let effective;
        let reason;
        if (!enabled) {
            effective = 'disabled';
            reason = control?.reason || '该能力已暂时下线';
        }
        else if (remoteAvailable) {
            effective = 'remote';
            reason = remote.label;
        }
        else {
            effective = 'unavailable';
            reason = '该能力需要真实模型才能生成，当前暂不可用';
        }
        return { enabled, remoteAvailable, effective, reason };
    }
    /** 后台列表：每项能力 + 管控记录 + 运行时结论（含未落行的默认值） */
    async adminList() {
        const runtime = await this.runtimeAll();
        const rows = await this.prisma.capabilityControl.findMany();
        const byId = new Map(rows.map((r) => [r.capabilityId, r]));
        return capability_registry_1.CAPABILITIES.map((c) => {
            const row = byId.get(c.id);
            return {
                capabilityId: c.id,
                name: c.name,
                group: c.group,
                modality: c.modality,
                mode: c.mode,
                enabled: row ? row.enabled : true,
                reason: row?.reason ?? null,
                updatedBy: row?.updatedBy ?? null,
                updatedAt: row?.updatedAt ?? null,
                runtime: runtime[c.id],
            };
        });
    }
    /**
     * 上下线。
     *
     * 两条硬规则：
     * 1. **下架必须填原因** —— 用户在工作台看到的是一句「已下线」，没有原因
     *    就只能去问客服；原因同时进审计。
     * 2. 未知能力 id 直接拒绝（不做「先建行后校验」），否则一个拼写错误会在表里
     *    留下一条永远不生效的记录。
     */
    async setEnabled(capabilityId, enabled, reason, actor) {
        const def = (0, capability_registry_1.getCapability)(capabilityId);
        if (!def) {
            throw new app_exception_1.AppError(40001, `未知能力: ${capabilityId}`, 400);
        }
        const trimmed = (reason ?? '').trim();
        if (!enabled && !trimmed) {
            throw new app_exception_1.AppError(40001, '下架能力必须填写原因', 400);
        }
        const row = await this.prisma.capabilityControl.upsert({
            where: { capabilityId },
            create: { capabilityId, enabled, reason: enabled ? null : trimmed, updatedBy: actor },
            update: { enabled, reason: enabled ? null : trimmed, updatedBy: actor },
        });
        this.invalidate();
        this.log.log(`能力 ${capabilityId} ${enabled ? '上线' : '下线'}（${actor}）`);
        return row;
    }
};
exports.CapabilityAvailabilityService = CapabilityAvailabilityService;
exports.CapabilityAvailabilityService = CapabilityAvailabilityService = CapabilityAvailabilityService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        route_catalog_service_1.RouteCatalogService])
], CapabilityAvailabilityService);
//# sourceMappingURL=capability-availability.service.js.map