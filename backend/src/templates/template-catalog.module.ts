import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { TemplateAdminController } from './template-admin.controller';
import { TemplateCatalogController } from './template-catalog.controller';
import { TemplateCatalogService } from './template-catalog.service';

/**
 * 写真模板目录模块。
 *
 * 公开读（C 端模板页）与后台 CRUD 共用一份服务；存储与签名图片服务
 * 由全局的 StorageModule / CommonModule 提供，无需重复 import。
 */
@Module({
  imports: [PrismaModule],
  controllers: [TemplateCatalogController, TemplateAdminController],
  providers: [TemplateCatalogService],
  exports: [TemplateCatalogService],
})
export class TemplateCatalogModule {}
