import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ProvidersModule } from '../providers/providers.module';
import { PromptToolsService } from './prompt-tools.service';
import { PromptToolsController } from './prompt-tools.controller';

/**
 * 提示词工具模块 —— AI 润色 / 图片转提示词。
 *
 * 依赖: Prisma (读素材) + Storage (读素材字节) + Providers (文生文通道)。
 * 均不反向依赖本模块, 无循环。
 */
@Module({
  imports: [PrismaModule, StorageModule, ProvidersModule],
  controllers: [PromptToolsController],
  providers: [PromptToolsService],
})
export class PromptToolsModule {}
