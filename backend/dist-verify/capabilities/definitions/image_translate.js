"use strict";
/**
 * 图片翻译 —— 参考站 image-translate。翻译图内文字并保持版式。
 * 必须由真实多模态 / 图像模型完成。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageTranslate = void 0;
const model_mapping_1 = require("../model-mapping");
const param_options_1 = require("./param-options");
exports.ImageTranslate = {
    id: 'image_translate',
    name: '图片翻译',
    group: 'ai_retouch',
    summary: '翻译图片文字并保留原有版式。',
    sidebarHint: '保留原有版式，将图片文字翻译为目标语言',
    mode: 'real',
    creditCost: 5, // 原页面标注「本次消耗5积分」
    params: [
        { key: 'targetLang', label: '目标语言', type: 'enum', default: 'zh-CN', options: param_options_1.LANGUAGES },
        { key: 'protectSubject', label: '保护商品主体', type: 'boolean', default: true },
        { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: param_options_1.QUALITY_OPTIONS },
        /* 参考站 createTemplateImageTool('IMAGE_TRANSLATION') 使用 targetLanguage。 */
        { key: 'targetLanguage', label: '目标语言（参考站字段）', type: 'enum', default: 'zh-CN', options: param_options_1.LANGUAGES, hidden: true },
    ],
    buildPrompt: (p) => `图片内文字翻译为 ${(0, param_options_1.optionLabel)(param_options_1.LANGUAGES, p.targetLanguage || p.targetLang) || '简体中文'}：保持原版式、字号与颜色不变，` +
        `只替换文字内容${p.protectSubject ? '，商品主体像素不得改动' : ''}。` +
        `不得改变画幅、构图、商品与背景，不得新增或删除画面元素。`,
    modality: 'image',
    model: { capability: 'image', operation: 'image_to_image', intent: model_mapping_1.editImageIntent },
    inputs: 1,
    inputImageMode: 'edit',
    inWorkbench: true,
};
//# sourceMappingURL=image_translate.js.map