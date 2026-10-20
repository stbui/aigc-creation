import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { MobileUploadService } from './mobile-upload.service';
import { MobileUploadController } from './mobile-upload.controller';

/**
 * 手机上传模块。
 *
 * 依赖: Prisma (落素材记录) + Storage (存文件)。均不反向依赖本模块, 无循环。
 */
@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [MobileUploadController],
  providers: [MobileUploadService],
})
export class MobileUploadModule {}
