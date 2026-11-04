"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreditsModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../prisma/prisma.module");
const model_module_1 = require("../model/model.module");
const credits_controller_1 = require("./credits.controller");
const credit_service_1 = require("./credit.service");
const credit_price_service_1 = require("./credit-price.service");
/**
 * 积分模块。
 *
 * CreditService 被 OrderService(发积分/退款扣回) 与 GenerateService(生成扣费) 共用,
 * 因此导出 —— 多实例会导致两处看到不同的余额快照。
 * CreditPriceService 同样导出: 生成链路要在建任务前取价, 改价链路在后台。
 *
 * 批次与流水由 `ModelModule` 导出的 `CreditWalletService` 落账（微积分口径），
 * 本模块不再直接写 `CreditLot` / `CreditLedgerEntry`。
 */
let CreditsModule = class CreditsModule {
};
exports.CreditsModule = CreditsModule;
exports.CreditsModule = CreditsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, model_module_1.ModelModule],
        controllers: [credits_controller_1.CreditsController],
        providers: [credit_service_1.CreditService, credit_price_service_1.CreditPriceService],
        exports: [credit_service_1.CreditService, credit_price_service_1.CreditPriceService],
    })
], CreditsModule);
//# sourceMappingURL=credits.module.js.map