import { Controller, Get } from '@nestjs/common';

import {
  SHOPPABLE_CAROUSEL_CAPTURED_AT,
  SHOPPABLE_CAROUSEL_CATEGORIES,
  SHOPPABLE_CAROUSEL_SOURCE_URL,
  SHOPPABLE_CAROUSEL_TEMPLATES,
} from './definitions/shoppable-carousel.templates';
import { SHOPPABLE_CAROUSEL_MAX_COUNT, SHOPPABLE_CAROUSEL_MIN_COUNT } from './definitions/shoppable_carousel';

/**
 * AI 带货图文模板清单接口 (公开, 免登录)。
 *
 * ## 为什么模板数据在后端下发, 而不是前端硬编码
 *
 * 模板是**能力定义的一部分** (它决定提示词的三拍结构), 事实源在
 * `backend/src/capabilities/definitions/shoppable-carousel.templates.ts`。
 * 若前端再抄一份 JSON, 两份模板清单迟早会漂 —— 前端选中的模板 id
 * 与后端查不到的那份不一致时, 用户拿到的是「版式不对但看不出原因」的结果。
 * 这里下发唯一的清单, 前端只做筛选与渲染。
 *
 * 缩略图本身是**本仓库内的静态文件** (`frontend/public/templates/shoppable-carousel/`),
 * 接口只给相对路径, 运行时不请求任何外部站点。
 */
@Controller('shoppable-carousel')
export class ShoppableCarouselController {
  /**
   * 模板清单 + 分类 + 张数区间。
   *
   * 数据量固定 (49 模板), 直接整体下发; 客户端可自行缓存。
   */
  @Get('templates')
  list() {
    return {
      sourceUrl: SHOPPABLE_CAROUSEL_SOURCE_URL,
      capturedAt: SHOPPABLE_CAROUSEL_CAPTURED_AT,
      countRange: { min: SHOPPABLE_CAROUSEL_MIN_COUNT, max: SHOPPABLE_CAROUSEL_MAX_COUNT },
      categories: SHOPPABLE_CAROUSEL_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
      templates: SHOPPABLE_CAROUSEL_TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        categoryIds: t.categoryIds,
        beats: t.beats,
        promptFragment: t.promptFragment,
        thumbFile: t.thumbFile,
        thumbFiles: t.thumbFiles,
      })),
    };
  }
}
