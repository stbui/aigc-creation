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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminTicketsController = void 0;
const common_1 = require("@nestjs/common");
const admin_decorator_1 = require("./admin.decorator");
const permissions_1 = require("./permissions");
const csv_response_1 = require("../common/csv-response");
const tickets_service_1 = require("../tickets/tickets.service");
const ticket_dto_1 = require("./dto/ticket.dto");
/**
 * 工单处理（后台）。
 *
 * 权限: 读 `ticket.read`，处理（回复 / 流转 / 指派）`ticket.handle`。
 * 两者分开是因为「能看用户投诉」与「能以平台身份回复用户」不是一回事 ——
 * 回复会直接推到用户站内消息里，是一次对外发言。
 *
 * 关联订单只做只读跳转，退款 / 补发积分仍回订单与积分模块：那里有退款
 * 时间窗、可退上限、积分回收一整套规则，在工单页再开一条「顺手退款」的
 * 捷径，等于让同一件事有两套规则。
 */
let AdminTicketsController = class AdminTicketsController {
    constructor(tickets) {
        this.tickets = tickets;
    }
    /** 各状态计数（侧栏角标与看板卡片用） */
    stats() {
        return this.tickets.stats();
    }
    /**
     * 导出（CSV）。
     *
     * ⚠️ 路由必须声明在 `:id` 之前，否则 `export` 会被当成工单 id。
     */
    async export(query, res) {
        const csv = await this.tickets.exportCsv(query);
        (0, csv_response_1.sendCsv)(res, "tickets", csv);
    }
    list(query) {
        return this.tickets.adminList(query);
    }
    detail(id) {
        return this.tickets.adminDetail(id);
    }
    /** 客服回复。回复即受理，会推送站内消息给用户 */
    reply(id, dto, actor) {
        return this.tickets.adminReply(id, actor, dto.content);
    }
    /** 状态流转 / 改优先级 / 指派 */
    update(id, dto, actor) {
        return this.tickets.adminUpdate(id, dto, actor);
    }
};
exports.AdminTicketsController = AdminTicketsController;
__decorate([
    (0, common_1.Get)("stats"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.ticketRead),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminTicketsController.prototype, "stats", null);
__decorate([
    (0, common_1.Get)("export"),
    (0, admin_decorator_1.RequireAllPermissions)(permissions_1.PERMISSIONS.ticketRead, permissions_1.PERMISSIONS.dataExport),
    (0, admin_decorator_1.AuditAction)("data.export"),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ticket_dto_1.AdminTicketListQueryDto, Object]),
    __metadata("design:returntype", Promise)
], AdminTicketsController.prototype, "export", null);
__decorate([
    (0, common_1.Get)(),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.ticketRead),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ticket_dto_1.AdminTicketListQueryDto]),
    __metadata("design:returntype", void 0)
], AdminTicketsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.ticketRead),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminTicketsController.prototype, "detail", null);
__decorate([
    (0, common_1.Post)(":id/replies"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.ticketHandle),
    (0, admin_decorator_1.AuditAction)("ticket.reply"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ticket_dto_1.AdminTicketReplyDto, Object]),
    __metadata("design:returntype", void 0)
], AdminTicketsController.prototype, "reply", null);
__decorate([
    (0, common_1.Patch)(":id"),
    (0, admin_decorator_1.RequirePermission)(permissions_1.PERMISSIONS.ticketHandle),
    (0, admin_decorator_1.AuditAction)("ticket.update"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, admin_decorator_1.AdminUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ticket_dto_1.AdminTicketUpdateDto, Object]),
    __metadata("design:returntype", void 0)
], AdminTicketsController.prototype, "update", null);
exports.AdminTicketsController = AdminTicketsController = __decorate([
    (0, common_1.Controller)("admin/tickets"),
    __metadata("design:paramtypes", [tickets_service_1.TicketsService])
], AdminTicketsController);
//# sourceMappingURL=tickets-admin.controller.js.map