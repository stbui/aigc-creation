import { Controller, Get } from '@nestjs/common';

import {
  PORTRAIT_TEMPLATES,
  TEMPLATE_CAPTURED_AT,
  TEMPLATE_CATEGORIES,
  TEMPLATE_SOURCE_URL,
} from './definitions/template.templates';

/**
 * 写真模板清单接口（公开，免登录）。
 *
 * 模板是**能力定义的一部分**（它决定提交给模型的风格提示词），事实源在
 * `definitions/template.templates.ts`。前端不另存一份清单 —— 两份清单漂移时，
 * 用户选中的模板会与后端查不到的那份对不上。
 *
 * 缩略图是本仓库静态文件（`frontend/public/templates/wedding/`），
 * 接口只给相对路径，运行时不请求任何外部站点。
 */
@Controller('template')
export class TemplateCatalogController {
  /** 模板清单 + 分类；数据量固定，整体下发，客户端可自行缓存。 */
  @Get('templates')
  list() {
    return {
      sourceUrl: TEMPLATE_SOURCE_URL,
      capturedAt: TEMPLATE_CAPTURED_AT,
      categories: TEMPLATE_CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
      })),
      templates: PORTRAIT_TEMPLATES.map((template) => ({
        id: template.id,
        name: template.name,
        categoryIds: template.categoryIds,
        prompt: template.prompt,
        thumbFile: template.thumbFile,
      })),
    };
  }
}
