"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrdersModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("../prisma/prisma.module");
const credits_module_1 = require("../credits/credits.module");
const membership_module_1 = require("../membership/membership.module");
const marketing_core_module_1 = require("../marketing/marketing-core.module");
const payment_core_module_1 = require("../payments/payment-core.module");
const orders_controller_1 = require("./orders.controller");
const order_service_1 = require("./order.service");
/**
 * 订单模块。依赖 CreditsModule 发放/回收积分, MarketingCoreModule 做券/活动优惠结算,
 * PaymentCoreModule 提供渠道退款实现（2026-10-22：退款必须真的打回渠道）。
 *
 * 依赖 PaymentCoreModule 而**不是** PaymentsModule: 后者 import 了本模块,
 * 直接反向依赖会形成循环。PaymentCoreModule 只含无依赖的通道工厂, 是叶子。
 */
let OrdersModule = class OrdersModule {
};
exports.OrdersModule = OrdersModule;
exports.OrdersModule = OrdersModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, credits_module_1.CreditsModule, marketing_core_module_1.MarketingCoreModule, membership_module_1.MembershipModule, payment_core_module_1.PaymentCoreModule],
        controllers: [orders_controller_1.OrdersController],
        providers: [order_service_1.OrderService],
        exports: [order_service_1.OrderService],
    })
], OrdersModule);
//# sourceMappingURL=orders.module.js.map