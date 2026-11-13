import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { PricingModule } from '../credits/pricing.module';
import { ModelModule } from '../model/model.module';
import { CapabilitiesController } from './capabilities.controller';
import { ShoppableCarouselController } from './shoppable-carousel.controller';
import { CapabilityAvailabilityService } from './capability-availability.service';
import { PromptPreviewService } from './prompt-preview.service';

/**
 * 能力清单模块。
 *
 * 导入 CreditsModule 是为了拿到 CreditPriceService —— 下发时要叠加**限时免费**
 * 的运行时判定；基础售价本身来自 `CapabilityPricing` 投影，不回读代码默认值。
 * CreditsModule 不反向依赖本模块, 无循环。
 *
 * 导入 ModelModule 是为了拿到 RouterService —— `runtime.remoteAvailable`
 * 必须按**能力目录**判定, 与调度器共用同一份快照与过滤逻辑。另查一张表会出现
 * 「界面说可用、提交后 42204」这类反复失败却亮绿灯的按钮。ModelModule 不反向依赖
 * 本模块, 无循环。
 */
@Module({
  imports: [CreditsModule, PricingModule, ModelModule],
  controllers: [CapabilitiesController, ShoppableCarouselController],
  providers: [CapabilityAvailabilityService, PromptPreviewService],
  exports: [CapabilityAvailabilityService, PromptPreviewService],
})
export class CapabilitiesModule {}
