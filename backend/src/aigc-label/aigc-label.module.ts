import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AigcLabelService } from './aigc-label.service';
import { AdminAigcLabelController, AigcLabelController } from './aigc-label.controller';

/**
 * AIGC 可见标识配置（2026-10-21）。
 *
 * 不设 @Global：只有生成链路（GenerateModule）与后台页面用它，
 * 全局模块会让「谁依赖了标识配置」变得不可见。
 */
@Module({
  imports: [PrismaModule],
  controllers: [AigcLabelController, AdminAigcLabelController],
  providers: [AigcLabelService],
  exports: [AigcLabelService],
})
export class AigcLabelModule {}
