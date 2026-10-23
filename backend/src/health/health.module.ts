import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ProvidersModule } from '../providers/providers.module';

/**
 * 健康检查模块。
 *
 * 依赖 ProvidersModule 只为拿 ChannelRepository（三条通道的调度快照）。
 * 无鉴权守卫 —— 探针必须能匿名访问，否则编排系统还得配凭据。
 * 暴露的信息全是「有几条线路、是否在冷却」，不含地址与凭据。
 */
@Module({
  imports: [ProvidersModule],
  controllers: [HealthController],
})
export class HealthModule {}
