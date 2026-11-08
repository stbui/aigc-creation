"use strict";
/**
 * 商品主图 —— 参考站 product-kit。上传商品图, 按变体类型生成主视觉套图。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MainImage = void 0;
const model_mapping_1 = require("../model-mapping");
const param_options_1 = require("./param-options");
exports.MainImage = {
    id: 'main_image',
    name: '商品主图',
    group: 'ecommerce_gen',
    summary: '一键生成突出卖点的商品主视觉。',
    sidebarHint: '上传商品图，即可生成完整套图',
    mode: 'real',
    creditCost: 10, // 无既有展示价，取旗舰能力基准 10
    params: [
        { key: 'productName', label: '商品名称', type: 'text', placeholder: '例如：夏季轻音桌面循环扇' },
        { key: 'brand', label: '品牌（选填）', type: 'text', placeholder: '请输入品牌（选填）' },
        { key: 'platform', label: '投放平台', type: 'enum', default: 'taobao', options: param_options_1.PLATFORMS },
        { key: 'language', label: '输出语言', type: 'enum', default: 'zh-CN', options: param_options_1.LANGUAGES },
        {
            key: 'description',
            label: '商品描述',
            type: 'text',
            placeholder: '例如：三档风速，低噪运行，USB 供电',
        },
        { key: 'variant', label: '主图类型', type: 'enum', default: 'other', options: param_options_1.MAIN_IMAGE_VARIANTS },
        { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: param_options_1.RATIOS },
        { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: param_options_1.QUALITY_OPTIONS },
        // ── 批次技术字段 (页面按一次提交代填, 结果栏据此把多张图聚合成一行) ──
        { key: 'batchId', label: '批次 ID', type: 'text', hidden: true, maxLength: 128 },
        { key: 'batchIndex', label: '批次序号', type: 'number', hidden: true, min: 1, max: 20, step: 1 },
        { key: 'batchSize', label: '批次数量', type: 'number', hidden: true, min: 1, max: 20, step: 1 },
    ],
    buildPrompt: (p) => `电商商品主图生成：${(0, param_options_1.subjectText)(p)}，${p.description || '突出卖点与质感'}。` +
        `需要白底图、场景图、卖点图三类主图，画面干净、主体突出${(0, param_options_1.ratioText)(p.ratio)}${(0, param_options_1.sizeText)(p.size)}` +
        `${(0, param_options_1.platformSpecText)(p)}${(0, param_options_1.languageText)(p.language)}`,
    modality: 'image',
    model: { capability: 'image', operation: 'text_to_image', intent: model_mapping_1.generateImageIntent },
    inputs: 1,
    inWorkbench: true,
};
//# sourceMappingURL=main_image.js.map