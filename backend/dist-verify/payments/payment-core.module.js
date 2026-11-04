"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentCoreModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_module_1 = require("../prisma/prisma.module");
const payment_cipher_1 = require("./payment-cipher");
const payment_config_service_1 = require("./payment-config.service");
const payment_gateway_1 = require("./payment-gateway");
/**
 * 支付域的**叶子模块**（2026-11 支付重构）。
 *
 * 只包含不依赖订单/后台的组件：配置加密、渠道配置服务、适配器网关。
 * 因此 `PaymentsModule` 与 `OrdersModule` 都可以安全 import 本模块，
 * 而不会形成 `PaymentsModule → OrdersModule → PaymentsModule` 的循环。
 *
 * 依赖方向保持单向：
 *
 *   PaymentsModule ─┐
 *                   ├─→ PaymentCoreModule (配置 + 适配器 + 网关)
 *   OrdersModule ───┘
 */
let PaymentCoreModule = class PaymentCoreModule {
};
exports.PaymentCoreModule = PaymentCoreModule;
exports.PaymentCoreModule = PaymentCoreModule = __decorate([
    (0, common_1.Module)({
        imports: [config_1.ConfigModule, prisma_module_1.PrismaModule],
        providers: [payment_cipher_1.PaymentCipher, payment_config_service_1.PaymentConfigService, payment_gateway_1.PaymentGateway],
        exports: [payment_cipher_1.PaymentCipher, payment_config_service_1.PaymentConfigService, payment_gateway_1.PaymentGateway],
    })
], PaymentCoreModule);
//# sourceMappingURL=payment-core.module.js.map