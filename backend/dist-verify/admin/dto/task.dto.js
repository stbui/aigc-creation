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
exports.TaskListQueryDto = void 0;
const class_validator_1 = require("class-validator");
const page_query_dto_1 = require("./page-query.dto");
/**
 * 任务监控列表查询 (admin-prd.md B-29 / admin-detailed-design.md §5.1)。
 *
 * ⚠️ 必须**值导入** (不能用 `import type`): `@Query()` 的 DTO 依赖
 * `design:paramtypes` 做实例化与白名单剥离, 用 `import type` 会让
 * Query 类退化成 Function, 查询参数完全绕过校验。
 *
 * status 用白名单而非自由字符串: SQLite 无 enum, 库里的 status 是
 * 裸 String, 不校验就等于开放注入 —— 传错值得到空列表, 传对才有用,
 * 与其让用户猜, 不如直接报「取值非法」。
 */
class TaskListQueryDto extends page_query_dto_1.PageQueryDto {
}
exports.TaskListQueryDto = TaskListQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['queued', 'running', 'succeeded', 'failed', 'cancelled'], { message: 'status 取值非法' }),
    __metadata("design:type", String)
], TaskListQueryDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], TaskListQueryDto.prototype, "capability", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['gateway', 'local', 'pending'], { message: 'provider 取值非法' }),
    __metadata("design:type", String)
], TaskListQueryDto.prototype, "provider", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], TaskListQueryDto.prototype, "userId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], TaskListQueryDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], TaskListQueryDto.prototype, "from", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], TaskListQueryDto.prototype, "to", void 0);
//# sourceMappingURL=task.dto.js.map