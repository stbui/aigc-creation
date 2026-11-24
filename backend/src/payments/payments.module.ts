import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentAttemptService } from './payment-attempt.service';
import { PaymentCloseService } from './payment-close.service';
import { PaymentCoreModule } from './payment-core.module';
import { PaymentIntentService } from './payment-intent.service';
import { PaymentNotificationService } from './payment-notification.service';
import { PaymentOrderService } from './payment-order.service';
import { PaymentOrderLifecycleService } from './payment-order-lifecycle.service';
import { PaymentQueryService } from './payment-query.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PaymentSettlementService } from './payment-settlement.service';
import { PaymentWorkerService } from './payment-worker.service';
import {
  OrderCancelController,
  PaymentsController,
  PaymentWebhookController,
} from './payments.controller';

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
@Module({
  imports: [OrdersModule, PaymentCoreModule],
  controllers: [PaymentsController, PaymentWebhookController, OrderCancelController],
  providers: [
    PaymentOrderService,
    PaymentOrderLifecycleService,
    PaymentSettlementService,
    PaymentAttemptService,
    PaymentIntentService,
    PaymentQueryService,
    PaymentCloseService,
    PaymentNotificationService,
    PaymentReconciliationService,
    PaymentWorkerService,
  ],
  exports: [
    PaymentOrderService,
    PaymentNotificationService,
    PaymentReconciliationService,
    PaymentCoreModule,
  ],
})
export class PaymentsModule {}
