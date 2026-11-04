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
exports.ProjectListQueryDto = exports.AssetListQueryDto = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const storage_provider_1 = require("../../storage/storage.provider");
const page_query_dto_1 = require("./page-query.dto");
/**
 * 素材/项目列表查询。
 *
 * ⚠ 必须用真正的 DTO 而不是 `Record<string, unknown>`:
 *   全局 ValidationPipe 配了 transform:true, 负责把 query string 转成 number。
 *   若走 Record<string, unknown>, pageSize 会保持字符串 "20" 直接透传给
 *   Prisma, 报 `take: Invalid value. Expected Int, provided String` —— 500。
 */
class AssetListQueryDto extends page_query_dto_1.PageQueryDto {
}
exports.AssetListQueryDto = AssetListQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], AssetListQueryDto.prototype, "keyword", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['original', 'generated']),
    __metadata("design:type", String)
], AssetListQueryDto.prototype, "kind", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], AssetListQueryDto.prototype, "capability", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['visible', 'hidden']),
    __metadata("design:type", String)
], AssetListQueryDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AssetListQueryDto.prototype, "ownerId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AssetListQueryDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(storage_provider_1.STORAGE_BACKENDS),
    __metadata("design:type", String)
], AssetListQueryDto.prototype, "backend", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => (value === undefined ? undefined : new Date(value))),
    __metadata("design:type", Date)
], AssetListQueryDto.prototype, "from", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => (value === undefined ? undefined : new Date(value))),
    __metadata("design:type", Date)
], AssetListQueryDto.prototype, "to", void 0);
class ProjectListQueryDto extends page_query_dto_1.PageQueryDto {
}
exports.ProjectListQueryDto = ProjectListQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], ProjectListQueryDto.prototype, "keyword", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ProjectListQueryDto.prototype, "ownerId", void 0);
//# sourceMappingURL=asset.dto.js.map