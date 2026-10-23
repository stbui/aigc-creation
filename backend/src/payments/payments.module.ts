import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentCoreModule } from './payment-core.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * 支付模块。
 *
 * 依赖 OrdersModule 的 OrderService —— 入账 (发积分 / 激活会员 / 状态迁移)
 * 只有一条路径, 支付层不自己写订单状态, 否则「沙箱支付」与「真实回调」
 * 会演化出两套互相打架的规则。
 */
@Module({
  imports: [ConfigModule, PrismaModule, OrdersModule, PaymentCoreModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  /*
   * 重导出 PaymentCoreModule: 后台「支付渠道」页与其它模块一直是
   * `import PaymentsModule` 后注入 PaymentProviderFactory 的,
   * 不能因为工厂挪了位置就让它们一起改。
   */
  exports: [PaymentsService, PaymentCoreModule],
})
export class PaymentsModule {}
