"use strict";
/**
 * 公开的系统渠道连接信息（`/api/v1/channels/system`）。
 *
 * 设计文档 §4.1 列了这个端点，语义是「系统渠道连接信息（**非管理员不下发**）」。
 * 本仓的落地口径：
 *
 *   1. **匿名 / 普通用户**：只给「有哪些系统渠道、有哪些模型、中转入口在哪」。
 *      凭证恒为 `'system'`（由服务端注入），上游真实地址改写成中转入口
 *      `/api/v1/ai/system/{channelId}` —— 这是 `publicChannel(row, false)`
 *      已经实现的投影；
 *   2. **管理员**：额外拿到渠道真实名称与上游地址。管理员在后台本来就看得到
 *      这些，多给一份不会扩大泄漏面，但省去「切到后台才能看到怎么连」的来回。
 *      **凭证（apiKey / secretKey）任何情况下都不下发** —— 后台投影里也从不回显。
 *   3. **判定实时查库**：角色是可变状态（降权 / 停用），不信 JWT 载荷。
 *
 * 为什么单独开一个端点而不是复用 `/admin/channels`：后台列表带完整模型与
 * 价格档（管理视角），C 端只需要「有哪些模型、怎么连」这一层。
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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicChannelsController = void 0;
const common_1 = require("@nestjs/common");
const optional_jwt_auth_guard_1 = require("../../common/optional-jwt-auth.guard");
const prisma_service_1 = require("../../prisma/prisma.service");
const permissions_1 = require("../../admin/permissions");
const channel_service_1 = require("./channel.service");
let PublicChannelsController = class PublicChannelsController {
    constructor(channels, prisma) {
        this.channels = channels;
        this.prisma = prisma;
    }
    /** 系统渠道连接信息：渠道 id、中转入口、可用模型与售价口径 */
    async system(req) {
        const admin = await this.isAdmin(req.user?.id);
        const rows = admin
            ? await this.channels.adminSystemChannels()
            : await this.channels.publicSystemChannels();
        return { channels: rows };
    }
    /**
     * 是否为后台角色。
     *
     * 实时查库而不是信 token 里的 role —— 降权与停用必须立即生效。
     * 查库失败按「非管理员」处理：宁可少给上游地址，也不能因为一次数据库
     * 抖动就把内部拓扑暴露给匿名访客。
     */
    async isAdmin(userId) {
        if (!userId)
            return false;
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
                select: { role: true, status: true },
            });
            return Boolean(user && user.status === 'active' && (0, permissions_1.isAdminRole)(user.role));
        }
        catch {
            return false;
        }
    }
};
exports.PublicChannelsController = PublicChannelsController;
__decorate([
    (0, common_1.Get)('system'),
    (0, common_1.UseGuards)(optional_jwt_auth_guard_1.OptionalJwtAuthGuard),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PublicChannelsController.prototype, "system", null);
exports.PublicChannelsController = PublicChannelsController = __decorate([
    (0, common_1.Controller)('channels'),
    __metadata("design:paramtypes", [channel_service_1.ChannelService,
        prisma_service_1.PrismaService])
], PublicChannelsController);
//# sourceMappingURL=public-channels.controller.js.map