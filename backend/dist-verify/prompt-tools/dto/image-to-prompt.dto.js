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
exports.ImageToPromptDto = void 0;
const class_validator_1 = require("class-validator");
/**
 * 图片转提示词请求。
 *
 * 传的是**站内素材 id**而非图片 URL 或 base64:
 *   - 传 id → 后端自己从存储层取字节, 不会因为"用户传了个外链"而把本站
 *     变成任意 URL 代理 (SSRF 面)。
 *   - 传 id → 天然带归属校验 (素材属于当前用户才可读)。
 *   - 传 id → 前端不必把大图 base64 塞进请求体。
 */
class ImageToPromptDto {
}
exports.ImageToPromptDto = ImageToPromptDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64, { message: '素材 id 不合法' }),
    __metadata("design:type", String)
], ImageToPromptDto.prototype, "assetId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200, { message: '补充要求不超过 200 字' }),
    __metadata("design:type", String)
], ImageToPromptDto.prototype, "extra", void 0);
//# sourceMappingURL=image-to-prompt.dto.js.map