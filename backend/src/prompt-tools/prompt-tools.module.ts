import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ModelModule } from '../model/model.module';
import { PromptToolsService } from './prompt-tools.service';
import { PromptToolsController } from './prompt-tools.controller';

/**
 * 提示词工具模块 —— AI 润色 / 图片转提示词。
 *
 * 依赖: Prisma (读素材) + Storage (读素材字节) + Model (text 能力选路与协议调用)。
 * ModelModule 只依赖 Prisma, 不反向依赖本模块, 无循环。
 */
@Module({
  imports: [PrismaModule, StorageModule, ModelModule],
  controllers: [PromptToolsController],
  providers: [PromptToolsService],
  exports: [PromptToolsService],
})
export class PromptToolsModule {}
