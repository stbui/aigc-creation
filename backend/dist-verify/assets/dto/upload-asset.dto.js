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
exports.UploadAssetDto = void 0;
const class_validator_1 = require("class-validator");
/**
 * `POST /assets/upload` 的 multipart 表单字段 (文件本身走 `file` 字段, 不在 DTO 内)。
 *
 * 来源三字段由浏览器扩展采集时提交, 人类用户从素材库直接上传时全部省略。
 * 这里只做**长度**校验; 协议与形态的宽松校验在 `AssetsService.normalizeSource`:
 * 采集来的元数据不该让整次上传失败 (图才是用户意图), 非法值按「未提供」处理。
 */
class UploadAssetDto {
}
exports.UploadAssetDto = UploadAssetDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    __metadata("design:type", String)
], UploadAssetDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], UploadAssetDto.prototype, "sourceSite", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], UploadAssetDto.prototype, "sourceTitle", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2048),
    __metadata("design:type", String)
], UploadAssetDto.prototype, "sourcePageUrl", void 0);
//# sourceMappingURL=upload-asset.dto.js.map