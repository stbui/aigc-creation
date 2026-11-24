import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { MarketingCoreModule } from '../marketing/marketing-core.module';
import { MembershipModule } from '../membership/membership.module';
import { PaymentCoreModule } from '../payments/payment-core.module';
import { OrderService } from './order.service';
import { OrderCheckoutService } from './order-checkout.service';
import { OrderPaymentService } from './order-payment.service';
import { OrderRefundService } from './order-refund.service';
import { OrderRefundPolicyService } from './order-refund-policy.service';
import { OrdersController } from './orders.controller';

/**
 * 订单模块。依赖 CreditsModule 发放/回收积分, MarketingCoreModule 做券/活动优惠结算,
 * PaymentCoreModule 提供渠道退款实现（2026-10-22：退款必须真的打回渠道）。
 *
 * 依赖 PaymentCoreModule 而**不是** PaymentsModule: 后者 import 了本模块,
 * 直接反向依赖会形成循环。PaymentCoreModule 只含无依赖的通道工厂, 是叶子。
 *
 * 订单域内部按生命周期拆分，但只导出 `OrderService` 门面：外部模块不直接
 * 依赖 checkout / payment / refund 实现。
 */
@Module({
  imports: [CreditsModule, MarketingCoreModule, MembershipModule, PaymentCoreModule],
  controllers: [OrdersController],
  providers: [
    OrderService,
    OrderCheckoutService,
    OrderPaymentService,
    OrderRefundService,
    OrderRefundPolicyService,
  ],
  exports: [OrderService],
})
export class OrdersModule {}
