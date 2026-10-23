import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditsModule } from '../credits/credits.module';
import { MembershipModule } from '../membership/membership.module';
import { MarketingCoreModule } from '../marketing/marketing-core.module';
import { PaymentCoreModule } from '../payments/payment-core.module';
import { OrdersController } from './orders.controller';
import { OrderService } from './order.service';

/**
 * 订单模块。依赖 CreditsModule 发放/回收积分, MarketingCoreModule 做券/活动优惠结算,
 * PaymentCoreModule 提供渠道退款实现（2026-10-22：退款必须真的打回渠道）。
 *
 * 依赖 PaymentCoreModule 而**不是** PaymentsModule: 后者 import 了本模块,
 * 直接反向依赖会形成循环。PaymentCoreModule 只含无依赖的通道工厂, 是叶子。
 */
@Module({
  imports: [PrismaModule, CreditsModule, MarketingCoreModule, MembershipModule, PaymentCoreModule],
  controllers: [OrdersController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrdersModule {}
