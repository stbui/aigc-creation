import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { ProvidersModule } from '../providers/providers.module';
import { CapabilitiesController } from './capabilities.controller';
import { CapabilityAvailabilityService } from './capability-availability.service';

/**
 * 能力清单模块。
 *
 * 导入 CreditsModule 是为了拿到 CreditPriceService —— 下发时要报**运行时生效价**
 * 而不是 registry 默认值, 否则后台改价对前端展示不生效 (用户看到的价与实扣的价不符)。
 * CreditsModule 不反向依赖本模块, 无循环。
 *
 * 导入 ProvidersModule 是为了拿到 ChannelRepository —— `runtime.remoteAvailable`
 * 必须按**线路表**判定。只看旧版 gateway.<modality>.* 配置会把「已配好多渠道线路、
 * 生成也走了云端」报成「未配置云端通道」，界面徽标与实际行为相反。
 * ProvidersModule 只依赖 PrismaModule，不反向依赖本模块，无循环。
 */
@Module({
  imports: [CreditsModule, ProvidersModule],
  controllers: [CapabilitiesController],
  providers: [CapabilityAvailabilityService],
  exports: [CapabilityAvailabilityService],
})
export class CapabilitiesModule {}