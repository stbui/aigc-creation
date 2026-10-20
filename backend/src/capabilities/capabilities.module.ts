import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { CapabilitiesController } from './capabilities.controller';

/**
 * 能力清单模块。
 *
 * 导入 CreditsModule 是为了拿到 CreditPriceService —— 下发时要报**运行时生效价**
 * 而不是 registry 默认值, 否则后台改价对前端展示不生效 (用户看到的价与实扣的价不符)。
 * CreditsModule 不反向依赖本模块, 无循环。
 */
@Module({
  imports: [CreditsModule],
  controllers: [CapabilitiesController],
})
export class CapabilitiesModule {}