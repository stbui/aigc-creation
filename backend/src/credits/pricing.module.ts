import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditPriceService } from './credit-price.service';

/**
 * 运行时定价模块。
 *
 * `CreditPriceService` 只负责限时免费的运行时判定，被三处使用：
 *   · 能力清单下发（CapabilitiesModule）；
 *   · 生成准入与模型报价（ModelModule）；
 *   · 换线重建账单（TaskWorker）。
 *
 * 独立成模块而不放在 CreditsModule，是为了让 ModelModule 能直接注入它，
 * 同时避免 `ModelModule → CreditsModule → ModelModule` 的循环依赖。全进程
 * 只有一个实例，活动变更后的 `invalidate()` 才能同时命中所有调用方。
 */
@Module({
  imports: [PrismaModule],
  providers: [CreditPriceService],
  exports: [CreditPriceService],
})
export class PricingModule {}
