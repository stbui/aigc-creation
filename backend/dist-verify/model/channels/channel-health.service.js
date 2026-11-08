"use strict";
/**
 * 渠道健康投影 —— 后台「值班塔」与渠道工作台的一行一条线路视图。
 *
 * ## 为什么按渠道模型出表
 *
 * 新模型层里**渠道模型才是线路最小单位**：同一渠道下的模型可以各自停用，
 * 404 也只冷却那一个模型，不连坐整条渠道。按渠道聚合会把「这家有一条模型
 * 挂了」显示成「这家坏了」，值班时按错的地方去按。
 *
 * ## 冷却来自进程内存
 *
 * `RouteHealthService` 只在当前实例内存里记冷却（本仓没有 Redis）。多实例
 * 部署时这里只反映本实例看到的那部分 —— 如实呈现，不做跨实例聚合的假象。
 *
 * ## 协议未知 = 一定失败
 *
 * 渠道模型保存时就会校验协议，但插件卸载后存量行会指向不存在的协议。
 * 这里用注册表现查，让「协议未实现」在值班塔上可见，而不是等任务失败
 * 再去翻调用记录。
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
exports.ChannelHealthService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const registry_1 = require("../protocol/registry");
const route_health_service_1 = require("../routing/route-health.service");
let ChannelHealthService = class ChannelHealthService {
    constructor(prisma, health, protocols) {
        this.prisma = prisma;
        this.health = health;
        this.protocols = protocols;
    }
    /** 全量线路健康（未删除的渠道与渠道模型） */
    async list() {
        const now = Date.now();
        const cooling = new Map(this.health.snapshot(now).map((block) => [block.key, block.until]));
        const [channels, models] = await Promise.all([
            this.prisma.modelChannel.findMany({
                where: { deletedAt: null },
                select: { id: true, name: true, enabled: true },
            }),
            this.prisma.channelModel.findMany({
                where: { deletedAt: null },
                select: {
                    id: true,
                    channelId: true,
                    modelKey: true,
                    displayName: true,
                    capability: true,
                    protocol: true,
                    enabled: true,
                },
            }),
        ]);
        const channelById = new Map(channels.map((row) => [row.id, row]));
        const rows = [];
        for (const model of models) {
            const channel = channelById.get(model.channelId);
            if (!channel)
                continue;
            // 两个冷却键取较晚的那个：渠道级（401/403/429）与模型级（404）都可能命中
            const until = Math.max(cooling.get(`channel:${channel.id}`) ?? 0, cooling.get(`channel-model:${model.id}`) ?? 0);
            rows.push({
                id: model.id,
                channelId: channel.id,
                channelName: channel.name,
                name: model.displayName || model.modelKey,
                capability: model.capability,
                enabled: channel.enabled && model.enabled,
                protocolKnown: this.protocols.has(model.protocol),
                coolingUntil: until > now ? new Date(until).toISOString() : null,
            });
        }
        return rows.sort((left, right) => left.channelName.localeCompare(right.channelName) || left.name.localeCompare(right.name));
    }
};
exports.ChannelHealthService = ChannelHealthService;
exports.ChannelHealthService = ChannelHealthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        route_health_service_1.RouteHealthService,
        registry_1.ProtocolRegistry])
], ChannelHealthService);
//# sourceMappingURL=channel-health.service.js.map