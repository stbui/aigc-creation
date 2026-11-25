import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { RequirePermission } from '../admin/admin.decorator';
import { PERMISSIONS } from '../admin/permissions';
import { deploymentUploadMaxBytes } from '../common/image-formats';
import {
  CreateTemplateCategoryDto,
  CreateTemplateGroupDto,
  CreateTemplateItemDto,
  UpdateTemplateCategoryDto,
  UpdateTemplateGroupDto,
  UpdateTemplateItemDto,
} from './dto';
import { TemplateCatalogService } from './template-catalog.service';

/**
 * 后台写真模板管理。
 *
 * 三个层级各自 CRUD：一级分类（文章/主题）→ 二级分类（风格/场景）→ 模板（图 + 提示词 + 标签）。
 * 删除一级/二级分类会级联删除其下内容，页面在确认弹窗里必须列出影响面。
 */
@Controller('admin/templates')
export class TemplateAdminController {
  constructor(private readonly catalog: TemplateCatalogService) {}

  @Get('catalog')
  @RequirePermission(PERMISSIONS.templateRead)
  list() {
    return this.catalog.adminCatalog();
  }

  // ── 一级分类 ──

  @Post('categories')
  @RequirePermission(PERMISSIONS.templateWrite)
  createCategory(@Body() dto: CreateTemplateCategoryDto) {
    // DTO → 领域入参显式映射: DTO 实例不流入 service
    return this.catalog.createCategory({
      slug: dto.slug,
      name: dto.name,
      sourceUrl: dto.sourceUrl,
      description: dto.description,
      sortOrder: dto.sortOrder,
      enabled: dto.enabled,
    });
  }

  @Patch('categories/:id')
  @RequirePermission(PERMISSIONS.templateWrite)
  updateCategory(@Param('id') id: string, @Body() dto: UpdateTemplateCategoryDto) {
    return this.catalog.updateCategory(id, {
      slug: dto.slug,
      name: dto.name,
      sourceUrl: dto.sourceUrl,
      description: dto.description,
      sortOrder: dto.sortOrder,
      enabled: dto.enabled,
    });
  }

  @Delete('categories/:id')
  @RequirePermission(PERMISSIONS.templateWrite)
  removeCategory(@Param('id') id: string) {
    return this.catalog.removeCategory(id);
  }

  // ── 二级分类 ──

  @Post('groups')
  @RequirePermission(PERMISSIONS.templateWrite)
  createGroup(@Body() dto: CreateTemplateGroupDto) {
    return this.catalog.createGroup({
      categoryId: dto.categoryId,
      slug: dto.slug,
      name: dto.name,
      sortOrder: dto.sortOrder,
      enabled: dto.enabled,
    });
  }

  @Patch('groups/:id')
  @RequirePermission(PERMISSIONS.templateWrite)
  updateGroup(@Param('id') id: string, @Body() dto: UpdateTemplateGroupDto) {
    return this.catalog.updateGroup(id, {
      slug: dto.slug,
      name: dto.name,
      sortOrder: dto.sortOrder,
      enabled: dto.enabled,
    });
  }

  @Delete('groups/:id')
  @RequirePermission(PERMISSIONS.templateWrite)
  removeGroup(@Param('id') id: string) {
    return this.catalog.removeGroup(id);
  }

  // ── 模板条目 ──

  @Post('items')
  @RequirePermission(PERMISSIONS.templateWrite)
  createItem(@Body() dto: CreateTemplateItemDto) {
    return this.catalog.createItem({
      groupId: dto.groupId,
      name: dto.name,
      prompt: dto.prompt,
      imageUrl: dto.imageUrl,
      tags: dto.tags,
      sortOrder: dto.sortOrder,
      enabled: dto.enabled,
    });
  }

  @Patch('items/:id')
  @RequirePermission(PERMISSIONS.templateWrite)
  updateItem(@Param('id') id: string, @Body() dto: UpdateTemplateItemDto) {
    return this.catalog.updateItem(id, {
      name: dto.name,
      prompt: dto.prompt,
      imageUrl: dto.imageUrl,
      tags: dto.tags,
      sortOrder: dto.sortOrder,
      enabled: dto.enabled,
    });
  }

  @Delete('items/:id')
  @RequirePermission(PERMISSIONS.templateWrite)
  removeItem(@Param('id') id: string) {
    return this.catalog.removeItem(id);
  }

  /** 上传模板预览图；返回稳定引用 + 预览地址，由前端再随条目保存。 */
  @Post('upload')
  @RequirePermission(PERMISSIONS.templateWrite)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: deploymentUploadMaxBytes(), files: 1 },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.catalog.uploadImage(file);
  }
}
