import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ModelModule } from '../model/model.module';
import { CreditsController } from './credits.controller';
import { CreditService } from './credit.service';
import { PricingModule } from './pricing.module';

/**
 * 积分模块。
 *
 * CreditService 被 OrderService(发积分/退款扣回) 与 GenerateService(生成扣费) 共用,
 * 因此导出 —— 多实例会导致两处看到不同的余额快照。
 * CreditPriceService 同样导出: 生成链路在准入与报价时判定限时免费。
 *
 * 批次与流水由 `ModelModule` 导出的 `CreditWalletService` 落账（微积分口径），
 * 本模块不再直接写 `CreditLot` / `CreditLedgerEntry`。
 */
@Module({
  imports: [PrismaModule, ModelModule, PricingModule],
  controllers: [CreditsController],
  providers: [CreditService],
  // 转出 PricingModule：既有调用方（后台调价、能力下发）仍只依赖 CreditsModule
  exports: [CreditService, PricingModule],
})
export class CreditsModule {}
