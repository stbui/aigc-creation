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
exports.CreateGenerationDto = void 0;
const class_validator_1 = require("class-validator");
const capability_registry_1 = require("../../capabilities/capability.registry");
/**
 * 白名单来自 capability.registry (SUBMITTABLE_CAPABILITY_IDS = mode 为 real 的能力),
 * planned 能力不在其中, 前端即使硬传也会被 400 拦下。
 */
class CreateGenerationDto {
}
exports.CreateGenerationDto = CreateGenerationDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateGenerationDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsIn)(capability_registry_1.SUBMITTABLE_CAPABILITY_IDS),
    __metadata("design:type", String)
], CreateGenerationDto.prototype, "capability", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(1, 64),
    __metadata("design:type", String)
], CreateGenerationDto.prototype, "logicalModelId", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], CreateGenerationDto.prototype, "inputAssetIds", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], CreateGenerationDto.prototype, "params", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(8, 128),
    (0, class_validator_1.Matches)(/^[A-Za-z0-9._:-]+$/, { message: 'idempotencyKey 格式无效' }),
    __metadata("design:type", String)
], CreateGenerationDto.prototype, "idempotencyKey", void 0);
//# sourceMappingURL=create-generation.dto.js.map