import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { PromptsController } from './prompts.controller';
import { PromptsService } from './prompts.service';

/**
 * 提示词库模块。
 *
 * 提示词是独立的文本资产，不参与模型选路与计费链路，因此不 import 任何业务模块。
 * 配图上传用到的 StorageService / SettingImageService / SettingsService 由全局的
 * StorageModule / CommonModule 提供，无需在此重复 imports。
 */
@Module({
  imports: [PrismaModule],
  controllers: [PromptsController],
  providers: [PromptsService],
  exports: [PromptsService],
})
export class PromptsModule {}
