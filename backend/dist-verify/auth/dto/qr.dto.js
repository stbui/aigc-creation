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
exports.QrStatusQueryDto = exports.QrConfirmDto = exports.QrTicketDto = void 0;
const class_validator_1 = require("class-validator");
/**
 * 扫码登录的票据。
 *
 * 长度下限设 32 是为了挡住「随手传一个短串」的探测: 真实票据是 64 位十六进制
 * (32 字节随机)。不做格式强校验 (仅 hex) —— 票据是服务端签发的, 格式错与
 * 「不存在」对调用方是同一种结果, 区分二者只会多给探测者一位信息。
 */
class QrTicketDto {
}
exports.QrTicketDto = QrTicketDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(32),
    (0, class_validator_1.MaxLength)(128),
    __metadata("design:type", String)
], QrTicketDto.prototype, "ticket", void 0);
/** 手机端确认。`approve=false` 表示明确拒绝, 桌面端应立即停止轮询 */
class QrConfirmDto extends QrTicketDto {
}
exports.QrConfirmDto = QrConfirmDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], QrConfirmDto.prototype, "approve", void 0);
/** 轮询入参。**走 query 而非 body**, 便于前端用 GET 轮询 */
class QrStatusQueryDto {
}
exports.QrStatusQueryDto = QrStatusQueryDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(32),
    (0, class_validator_1.MaxLength)(128),
    __metadata("design:type", String)
], QrStatusQueryDto.prototype, "ticket", void 0);
//# sourceMappingURL=qr.dto.js.map