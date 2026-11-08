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
exports.MyTicketListQueryDto = exports.ReplyTicketDto = exports.CreateTicketDto = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const tickets_service_1 = require("../tickets.service");
/**
 * 新建工单。
 *
 * subject 上限 80 / content 上限 2000：与详情页与列表的展示宽度对齐，
 * 也避免用户把整篇文章贴进来（客服在手机上根本读不完）。
 */
class CreateTicketDto {
}
exports.CreateTicketDto = CreateTicketDto;
__decorate([
    (0, class_validator_1.IsIn)(tickets_service_1.TICKET_TYPES, { message: 'type 取值非法' }),
    __metadata("design:type", String)
], CreateTicketDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2, { message: '标题至少 2 个字' }),
    (0, class_validator_1.MaxLength)(80, { message: '标题最多 80 个字' }),
    __metadata("design:type", String)
], CreateTicketDto.prototype, "subject", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(5, { message: '问题描述至少 5 个字' }),
    (0, class_validator_1.MaxLength)(2000, { message: '问题描述最多 2000 个字' }),
    __metadata("design:type", String)
], CreateTicketDto.prototype, "content", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(tickets_service_1.TICKET_PRIORITIES, { message: 'priority 取值非法' }),
    __metadata("design:type", String)
], CreateTicketDto.prototype, "priority", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], CreateTicketDto.prototype, "orderId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], CreateTicketDto.prototype, "assetId", void 0);
class ReplyTicketDto {
}
exports.ReplyTicketDto = ReplyTicketDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1, { message: '回复内容不能为空' }),
    (0, class_validator_1.MaxLength)(2000, { message: '回复最多 2000 个字' }),
    __metadata("design:type", String)
], ReplyTicketDto.prototype, "content", void 0);
class MyTicketListQueryDto {
}
exports.MyTicketListQueryDto = MyTicketListQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['open', 'processing', 'resolved', 'closed'], { message: 'status 取值非法' }),
    __metadata("design:type", String)
], MyTicketListQueryDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], MyTicketListQueryDto.prototype, "limit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], MyTicketListQueryDto.prototype, "offset", void 0);
//# sourceMappingURL=ticket.dto.js.map