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
exports.CreateInvoiceDto = void 0;
const class_validator_1 = require("class-validator");
/**
 * 开票申请。
 *
 * `kind` 决定 `taxNo` 是否必填 —— 企业抬头缺税号开出来的票无法报销,
 * 这里只做格式约束, 「企业必须有税号」的联动校验在 service 里
 * (class-validator 的联动需要自定义装饰器, 为一条规则不值当)。
 */
class CreateInvoiceDto {
}
exports.CreateInvoiceDto = CreateInvoiceDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: '请选择订单' }),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "orderId", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['personal', 'company'], { message: '开票类型只能是 personal 或 company' }),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "kind", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: '请填写发票抬头' }),
    (0, class_validator_1.MaxLength)(80, { message: '发票抬头最多 80 个字符' }),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "title", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^[0-9A-Za-z]{15,20}$/, { message: '纳税人识别号格式不正确' }),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "taxNo", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEmail)({}, { message: '接收邮箱格式不正确' }),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], CreateInvoiceDto.prototype, "content", void 0);
//# sourceMappingURL=create-invoice.dto.js.map