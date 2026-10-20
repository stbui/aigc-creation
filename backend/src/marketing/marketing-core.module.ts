import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditsModule } from '../credits/credits.module';
import { MarketingService } from './marketing.service';

/**
 * 营销核心模块 —— 只提供 MarketingService, 不挂任何控制器。
 *
 * **存在的理由是打破依赖环**, 不是为了分层好看:
 *
 *   AdminModule ──> OrdersModule ──> MarketingService
 *        ^                                │
 *        └────────────────────────────────┘
 *
 * 若把 MarketingService 注册在 AdminModule, 上面的环就会形成 (NestJS 下
 * require 时拿到 undefined 的 provider, 表现为运行时 undefined 注入而非编译错误,
 * 是最难查的一类缺陷)。
 *
 * 单独抽出后依赖是单向的:
 *   AdminModule ──> MarketingCoreModule ──> CreditsModule
 *   OrdersModule ──> MarketingCoreModule
 */
@Module({
  imports: [PrismaModule, CreditsModule],
  providers: [MarketingService],
  exports: [MarketingService],
})
export class MarketingCoreModule {}