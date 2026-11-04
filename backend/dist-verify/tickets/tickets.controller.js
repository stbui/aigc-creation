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
exports.TicketsController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../common/jwt-auth.guard");
const current_user_decorator_1 = require("../common/current-user.decorator");
const rate_limit_guard_1 = require("../common/rate-limit.guard");
const tickets_service_1 = require("./tickets.service");
const ticket_dto_1 = require("./dto/ticket.dto");
/**
 * 新建工单限流: 5 次/分/用户。
 *
 * 工单本身不产生外部成本，但每张工单都会进入客服队列 —— 无限刷单
 * 等于把客服的人力成本交给任何一个注册用户。回复不限流：正常会话
 * 频率天然低，而卡住一条「还要多久」的追问体验代价更高。
 */
const RL_TICKET_CREATE = {
    name: 'ticket-create',
    limit: 5,
    windowSec: 60,
    scope: 'user',
};
/**
 * C 端工单。
 *
 * 所有查询都在 service 层按 `userId` 过滤（不是先查再比对），
 * 越权访问一律 404：不泄露「这个工单号存在」。
 */
let TicketsController = class TicketsController {
    constructor(tickets) {
        this.tickets = tickets;
    }
    list(user, q) {
        return this.tickets.listMine(user.id, q);
    }
    create(user, dto) {
        return this.tickets.create(user.id, dto);
    }
    detail(user, id) {
        return this.tickets.detailMine(user.id, id);
    }
    reply(user, id, dto) {
        return this.tickets.replyAsUser(user.id, id, dto.content);
    }
    /** 用户主动关闭（问题自己解决了） */
    close(user, id) {
        return this.tickets.closeAsUser(user.id, id);
    }
};
exports.TicketsController = TicketsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ticket_dto_1.MyTicketListQueryDto]),
    __metadata("design:returntype", void 0)
], TicketsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, rate_limit_guard_1.RateLimit)(RL_TICKET_CREATE),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ticket_dto_1.CreateTicketDto]),
    __metadata("design:returntype", void 0)
], TicketsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TicketsController.prototype, "detail", null);
__decorate([
    (0, common_1.Post)(':id/replies'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, ticket_dto_1.ReplyTicketDto]),
    __metadata("design:returntype", void 0)
], TicketsController.prototype, "reply", null);
__decorate([
    (0, common_1.Post)(':id/close'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TicketsController.prototype, "close", null);
exports.TicketsController = TicketsController = __decorate([
    (0, common_1.Controller)('tickets'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [tickets_service_1.TicketsService])
], TicketsController);
//# sourceMappingURL=tickets.controller.js.map