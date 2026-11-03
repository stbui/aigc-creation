import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { ModelModule } from '../model/model.module';
import { CapabilitiesController } from './capabilities.controller';
import { ShoppableCarouselController } from './shoppable-carousel.controller';
import { CapabilityAvailabilityService } from './capability-availability.service';

/**
 * 能力清单模块。
 *
 * 导入 CreditsModule 是为了拿到 CreditPriceService —— 下发时要报**运行时生效价**
 * 而不是 registry 默认值, 否则后台改价对前端展示不生效 (用户看到的价与实扣的价不符)。
 * CreditsModule 不反向依赖本模块, 无循环。
 *
 * 导入 ModelModule 是为了拿到 RouteCatalogService —— `runtime.remoteAvailable`
 * 必须按**路由目录**判定, 与调度器看同一份快照。另查一张表会出现「界面说可用、
 * 提交后 42204」这类反复失败却亮绿灯的按钮。ModelModule 只依赖 PrismaModule,
 * 不反向依赖本模块, 无循环。
 */
@Module({
  imports: [CreditsModule, ModelModule],
  controllers: [CapabilitiesController, ShoppableCarouselController],
  providers: [CapabilityAvailabilityService],
  exports: [CapabilityAvailabilityService],
})
export class CapabilitiesModule {}
