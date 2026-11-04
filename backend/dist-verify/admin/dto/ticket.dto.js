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
exports.AdminTicketExportQueryDto = exports.AdminTicketReplyDto = exports.AdminTicketUpdateDto = exports.AdminTicketListQueryDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
/**
 * 工单列表查询（后台）。
 *
 * `assigneeId=unassigned` 表示只看未指派 —— 这是客服主管每天的第一个动作：
 * 把没人认领的单分下去。用字面量而不是再加一个布尔参数，少一个可配错的东西。
 */
class AdminTicketListQueryDto {
}
exports.AdminTicketListQueryDto = AdminTicketListQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["open", "processing", "resolved", "closed"], {
        message: "status 取值非法",
    }),
    __metadata("design:type", String)
], AdminTicketListQueryDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["bug", "complaint", "consultation", "invoice", "other"], {
        message: "type 取值非法",
    }),
    __metadata("design:type", String)
], AdminTicketListQueryDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["low", "normal", "high"], { message: "priority 取值非法" }),
    __metadata("design:type", String)
], AdminTicketListQueryDto.prototype, "priority", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], AdminTicketListQueryDto.prototype, "assigneeId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], AdminTicketListQueryDto.prototype, "q", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], AdminTicketListQueryDto.prototype, "limit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], AdminTicketListQueryDto.prototype, "offset", void 0);
/**
 * 工单处理。
 *
 * `assigneeId` 显式传 null = 取消指派；不传 = 不改。
 * 这两种语义必须可区分，否则「取消指派」无法表达。
 */
class AdminTicketUpdateDto {
}
exports.AdminTicketUpdateDto = AdminTicketUpdateDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["open", "processing", "resolved", "closed"], {
        message: "status 取值非法",
    }),
    __metadata("design:type", String)
], AdminTicketUpdateDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["low", "normal", "high"], { message: "priority 取值非法" }),
    __metadata("design:type", String)
], AdminTicketUpdateDto.prototype, "priority", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], AdminTicketUpdateDto.prototype, "assigneeId", void 0);
class AdminTicketReplyDto {
}
exports.AdminTicketReplyDto = AdminTicketReplyDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1, { message: "回复内容不能为空" }),
    (0, class_validator_1.MaxLength)(2000, { message: "回复最多 2000 个字" }),
    __metadata("design:type", String)
], AdminTicketReplyDto.prototype, "content", void 0);
/** 导出可带上与列表相同的筛选条件 */
class AdminTicketExportQueryDto extends AdminTicketListQueryDto {
}
exports.AdminTicketExportQueryDto = AdminTicketExportQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(5000),
    __metadata("design:type", Number)
], AdminTicketExportQueryDto.prototype, "limit", void 0);
//# sourceMappingURL=ticket.dto.js.map