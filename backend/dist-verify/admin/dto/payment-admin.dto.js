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
exports.ReconciliationImportDto = exports.ReconciliationItemsQueryDto = exports.ReconciliationListQueryDto = exports.ReconciliationRunDto = exports.PaymentOrderListQueryDto = exports.PaymentProductSaveDto = exports.PaymentSettingsUpdateDto = exports.PaymentProviderConfigUpdateDto = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const page_query_dto_1 = require("./page-query.dto");
const types_1 = require("../../payments/adapters/types");
class PaymentProviderConfigUpdateDto {
}
exports.PaymentProviderConfigUpdateDto = PaymentProviderConfigUpdateDto;
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], PaymentProviderConfigUpdateDto.prototype, "enabled", void 0);
__decorate([
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(5),
    (0, class_validator_1.Max)(1440),
    __metadata("design:type", Number)
], PaymentProviderConfigUpdateDto.prototype, "closeAfterMinutes", void 0);
__decorate([
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], PaymentProviderConfigUpdateDto.prototype, "values", void 0);
class PaymentSettingsUpdateDto {
}
exports.PaymentSettingsUpdateDto = PaymentSettingsUpdateDto;
__decorate([
    (0, class_validator_1.IsIn)(["CNY", "USD"], { message: "币种只支持 CNY / USD" }),
    __metadata("design:type", String)
], PaymentSettingsUpdateDto.prototype, "defaultCurrency", void 0);
class PaymentProductSaveDto {
}
exports.PaymentProductSaveDto = PaymentProductSaveDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(60),
    __metadata("design:type", String)
], PaymentProductSaveDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], PaymentProductSaveDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsIn)(["credits"], { message: "目前只支持积分商品" }),
    __metadata("design:type", String)
], PaymentProductSaveDto.prototype, "kind", void 0);
__decorate([
    (0, class_validator_1.IsIn)(["CNY", "USD"], { message: "币种只支持 CNY / USD" }),
    __metadata("design:type", String)
], PaymentProductSaveDto.prototype, "currency", void 0);
__decorate([
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1, { message: "售价最低 1 分" }),
    __metadata("design:type", Number)
], PaymentProductSaveDto.prototype, "priceCents", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], PaymentProductSaveDto.prototype, "originalPriceCents", void 0);
__decorate([
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1, { message: "积分最低 1" }),
    __metadata("design:type", Number)
], PaymentProductSaveDto.prototype, "credits", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], PaymentProductSaveDto.prototype, "creditsValidDays", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["immediate", "manual"]),
    __metadata("design:type", String)
], PaymentProductSaveDto.prototype, "grantType", void 0);
__decorate([
    (0, class_validator_1.IsIn)(["active", "offline"]),
    __metadata("design:type", String)
], PaymentProductSaveDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], PaymentProductSaveDto.prototype, "sortOrder", void 0);
__decorate([
    (0, class_validator_1.IsIn)(["unlimited", "periodic", "inventory", "timed"]),
    __metadata("design:type", String)
], PaymentProductSaveDto.prototype, "saleStrategy", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], PaymentProductSaveDto.prototype, "periodDays", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], PaymentProductSaveDto.prototype, "periodPurchaseLimit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], PaymentProductSaveDto.prototype, "stockTotal", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PaymentProductSaveDto.prototype, "saleStartAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PaymentProductSaveDto.prototype, "saleEndAt", void 0);
class PaymentOrderListQueryDto extends page_query_dto_1.PageQueryDto {
}
exports.PaymentOrderListQueryDto = PaymentOrderListQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PaymentOrderListQueryDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], PaymentOrderListQueryDto.prototype, "keyword", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PaymentOrderListQueryDto.prototype, "providerId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(["created", "paid", "credited"]),
    __metadata("design:type", String)
], PaymentOrderListQueryDto.prototype, "timeField", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PaymentOrderListQueryDto.prototype, "from", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], PaymentOrderListQueryDto.prototype, "to", void 0);
class ReconciliationRunDto {
}
exports.ReconciliationRunDto = ReconciliationRunDto;
__decorate([
    (0, class_validator_1.IsIn)(types_1.PAYMENT_PROVIDER_IDS, { message: "渠道非法" }),
    __metadata("design:type", String)
], ReconciliationRunDto.prototype, "providerId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReconciliationRunDto.prototype, "billDate", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ReconciliationRunDto.prototype, "retryFailed", void 0);
class ReconciliationListQueryDto extends page_query_dto_1.PageQueryDto {
}
exports.ReconciliationListQueryDto = ReconciliationListQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReconciliationListQueryDto.prototype, "providerId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReconciliationListQueryDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReconciliationListQueryDto.prototype, "from", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReconciliationListQueryDto.prototype, "to", void 0);
class ReconciliationItemsQueryDto extends page_query_dto_1.PageQueryDto {
}
exports.ReconciliationItemsQueryDto = ReconciliationItemsQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReconciliationItemsQueryDto.prototype, "result", void 0);
class ReconciliationImportDto {
}
exports.ReconciliationImportDto = ReconciliationImportDto;
__decorate([
    (0, class_validator_1.IsIn)(types_1.PAYMENT_PROVIDER_IDS, { message: "渠道非法" }),
    __metadata("design:type", String)
], ReconciliationImportDto.prototype, "providerId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReconciliationImportDto.prototype, "billDate", void 0);
//# sourceMappingURL=payment-admin.dto.js.map