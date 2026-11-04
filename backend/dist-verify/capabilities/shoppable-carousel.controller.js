"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShoppableCarouselController = void 0;
const common_1 = require("@nestjs/common");
const shoppable_carousel_templates_1 = require("./definitions/shoppable-carousel.templates");
const shoppable_carousel_1 = require("./definitions/shoppable_carousel");
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
let ShoppableCarouselController = class ShoppableCarouselController {
    /**
     * 模板清单 + 分类 + 张数区间。
     *
     * 数据量固定 (49 模板), 直接整体下发; 客户端可自行缓存。
     */
    list() {
        return {
            sourceUrl: shoppable_carousel_templates_1.SHOPPABLE_CAROUSEL_SOURCE_URL,
            capturedAt: shoppable_carousel_templates_1.SHOPPABLE_CAROUSEL_CAPTURED_AT,
            countRange: { min: shoppable_carousel_1.SHOPPABLE_CAROUSEL_MIN_COUNT, max: shoppable_carousel_1.SHOPPABLE_CAROUSEL_MAX_COUNT },
            categories: shoppable_carousel_templates_1.SHOPPABLE_CAROUSEL_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
            templates: shoppable_carousel_templates_1.SHOPPABLE_CAROUSEL_TEMPLATES.map((t) => ({
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
};
exports.ShoppableCarouselController = ShoppableCarouselController;
__decorate([
    (0, common_1.Get)('templates'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ShoppableCarouselController.prototype, "list", null);
exports.ShoppableCarouselController = ShoppableCarouselController = __decorate([
    (0, common_1.Controller)('shoppable-carousel')
], ShoppableCarouselController);
//# sourceMappingURL=shoppable-carousel.controller.js.map