import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditsModule } from '../credits/credits.module';
import { MembershipModule } from '../membership/membership.module';
import { MarketingCoreModule } from '../marketing/marketing-core.module';
import { OrdersController } from './orders.controller';
import { OrderService } from './order.service';

/**
 * 订单模块。依赖 CreditsModule 发放/回收积分, MarketingCoreModule 做券/活动优惠结算。
 * 两个依赖都不反向依赖本模块, 因此无循环。
 */
@Module({
  imports: [PrismaModule, CreditsModule, MarketingCoreModule, MembershipModule],
  controllers: [OrdersController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrdersModule {}
