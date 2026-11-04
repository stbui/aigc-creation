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
exports.PolishPromptDto = void 0;
const class_validator_1 = require("class-validator");
/**
 * AI 润色请求。
 *
 * ⚠️ `text` 的长度上限 4000 与前端提示词框的 maxlength=4000 一致 ——
 * 两处独立写死会漂移, 故这里写死上限、前端也写死上限, 由前端先拦一道;
 * 后端这层是**兜底** (前端可被绕过, 直接打接口)。
 */
class PolishPromptDto {
}
exports.PolishPromptDto = PolishPromptDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1, { message: '提示词不能为空' }),
    (0, class_validator_1.MaxLength)(4000, { message: '提示词不超过 4000 字' }),
    __metadata("design:type", String)
], PolishPromptDto.prototype, "text", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], PolishPromptDto.prototype, "textOnly", void 0);
//# sourceMappingURL=polish-prompt.dto.js.map