import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ModelModule } from '../model/model.module';

/**
 * 健康检查模块。
 *
 * 依赖 ModelModule 只为拿 RouteHealthService（本进程内冷却中的渠道 / 渠道模型），
 * 线路清单本身直接读 `modelChannel` / `channelModel` 两张表。
 * 无鉴权守卫 —— 探针必须能匿名访问，否则编排系统还得配凭据。
 * 暴露的信息全是「有几条线路、是否在冷却」，不含地址与凭据。
 */
@Module({
  imports: [PrismaModule, StorageModule, ModelModule],
  controllers: [HealthController],
})
export class HealthModule {}
