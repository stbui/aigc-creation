import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { MembershipModule } from '../membership/membership.module';
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
 *   MarketingCoreModule ──> MembershipModule (结算试算需要会员折扣,
 *   MembershipModule 不反向依赖本模块, 无环)
 */
@Module({
  imports: [CreditsModule, MembershipModule],
  providers: [MarketingService],
  exports: [MarketingService],
})
export class MarketingCoreModule {}