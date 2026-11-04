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
exports.UserStatusDto = exports.PageQueryDto = void 0;
exports.buildPage = buildPage;
exports.paginate = paginate;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
/**
 * 分页与排序的公共查询参数。
 *
 * pageSize 上限 100: 无上限时运营可以一次拉全表, 把 SQLite 单写者拖垮,
 * 也让「导出」类操作绕过游标分页的保护。需要大批量时走导出端点。
 */
class PageQueryDto {
}
exports.PageQueryDto = PageQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => (value === undefined ? undefined : Number(value))),
    (0, class_validator_1.IsInt)({ message: 'page 必须是整数' }),
    (0, class_validator_1.Min)(1, { message: 'page 最小为 1' }),
    __metadata("design:type", Number)
], PageQueryDto.prototype, "page", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => (value === undefined ? undefined : Number(value))),
    (0, class_validator_1.IsInt)({ message: 'pageSize 必须是整数' }),
    (0, class_validator_1.Min)(1, { message: 'pageSize 最小为 1' }),
    (0, class_validator_1.Max)(100, { message: 'pageSize 最大为 100' }),
    __metadata("design:type", Number)
], PageQueryDto.prototype, "pageSize", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PageQueryDto.prototype, "sort", void 0);
/**
 * 归一化分页参数。
 *
 * sort 的 field 走白名单校验 —— 用户可控的字段名直接透传给 Prisma 的
 * orderBy 会被拒绝或产生意外行为, 白名单是必要的。
 */
function buildPage(query, sortableFields, defaultSort = 'createdAt:desc') {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [rawField, rawDir] = (query.sort ?? defaultSort).split(':');
    const field = sortableFields.includes(rawField) ? rawField : sortableFields[0];
    const dir = rawDir === 'asc' ? 'asc' : 'desc';
    return {
        page,
        pageSize,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: field ? { [field]: dir } : undefined,
    };
}
/** 组装分页响应 */
function paginate(items, total, page) {
    return {
        items,
        total,
        page: page.page,
        pageSize: page.pageSize,
    };
}
/** 账号状态白名单 (与 User.status 取值一致) */
class UserStatusDto {
}
exports.UserStatusDto = UserStatusDto;
__decorate([
    (0, class_validator_1.IsIn)(['active', 'disabled', 'deleted'], { message: 'status 取值非法' }),
    __metadata("design:type", String)
], UserStatusDto.prototype, "status", void 0);
//# sourceMappingURL=page-query.dto.js.map