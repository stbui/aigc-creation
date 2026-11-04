"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentsModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_module_1 = require("../prisma/prisma.module");
const orders_module_1 = require("../orders/orders.module");
const payment_core_module_1 = require("./payment-core.module");
const payments_controller_1 = require("./payments.controller");
const payment_order_service_1 = require("./payment-order.service");
const payment_notification_service_1 = require("./payment-notification.service");
const payment_reconciliation_service_1 = require("./payment-reconciliation.service");
const payment_worker_service_1 = require("./payment-worker.service");
/**
 * 支付模块。
 *
 * 依赖 OrdersModule 的 OrderService —— 入账 (发积分 / 激活会员 / 状态迁移)
 * 只有一条路径, 支付层不自己写订单状态, 否则「沙箱支付」与「真实回调」
 * 会演化出两套互相打架的规则。
 *
 * 重导出 PaymentCoreModule: 后台「支付充值」页与订单模块一直是
 * `import PaymentsModule` 后注入配置服务的, 不能因为模块拆分就让它们一起改。
 */
let PaymentsModule = class PaymentsModule {
};
exports.PaymentsModule = PaymentsModule;
exports.PaymentsModule = PaymentsModule = __decorate([
    (0, common_1.Module)({
        imports: [config_1.ConfigModule, prisma_module_1.PrismaModule, orders_module_1.OrdersModule, payment_core_module_1.PaymentCoreModule],
        controllers: [payments_controller_1.PaymentsController, payments_controller_1.OrderCancelController],
        providers: [
            payment_order_service_1.PaymentOrderService,
            payment_notification_service_1.PaymentNotificationService,
            payment_reconciliation_service_1.PaymentReconciliationService,
            payment_worker_service_1.PaymentWorkerService,
        ],
        exports: [
            payment_order_service_1.PaymentOrderService,
            payment_notification_service_1.PaymentNotificationService,
            payment_reconciliation_service_1.PaymentReconciliationService,
            payment_core_module_1.PaymentCoreModule,
        ],
    })
], PaymentsModule);
//# sourceMappingURL=payments.module.js.map