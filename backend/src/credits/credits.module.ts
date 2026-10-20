import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditsController } from './credits.controller';
import { CreditService } from './credit.service';
import { CreditPriceService } from './credit-price.service';

/**
 * 积分模块。
 *
 * CreditService 被 OrderService(发积分/退款扣回) 与 GenerateService(生成扣费) 共用,
 * 因此导出 —— 多实例会导致两处看到不同的余额快照。
 * CreditPriceService 同样导出: 生成链路要在建任务前取价, 改价链路在后台。
 */
@Module({
  imports: [PrismaModule],
  controllers: [CreditsController],
  providers: [CreditService, CreditPriceService],
  exports: [CreditService, CreditPriceService],
})
export class CreditsModule {}
