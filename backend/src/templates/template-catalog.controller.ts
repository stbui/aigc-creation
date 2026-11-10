import { Controller, Get } from '@nestjs/common';

import { TemplateCatalogService } from './template-catalog.service';

/**
 * 写真模板公开目录（免登录）。
 *
 * 数据源是数据库里的 `TemplateCategory → TemplateGroup → TemplateItem`，
 * 由后台「写真模板」页维护。这里只下发启用中的分类/分组/模板，
 * 图片地址在服务端解析成当前可访问的预览地址。
 */
@Controller('template')
export class TemplateCatalogController {
  constructor(private readonly catalog: TemplateCatalogService) {}

  @Get('templates')
  list() {
    return this.catalog.publicCatalog();
  }
}
