"use strict";
/**
 * 自由创作 —— 参考站 free-creation。参考图(选填) + 提示词驱动, 已接优云智算 qwen-image-3.0。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 *
 * 创作只能由真实模型完成。没有可用模型通道时任务 failed/42204 并退款,
 * 既不交付占位图, 也不假装"还能在本机画一张"。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FreeCreate = void 0;
const model_mapping_1 = require("../model-mapping");
const param_options_1 = require("./param-options");
exports.FreeCreate = {
    id: 'free_create',
    name: '自由创作',
    group: 'ai_video',
    summary: '参考图加提示词，直接创作新画面。',
    sidebarHint: '上传参考图、描述你的想法，即可开始创作',
    mode: 'real',
    creditCost: 10, // 原页面标注「本次消耗 10 积分」
    params: [
        {
            key: 'prompt',
            label: '创作提示词',
            type: 'text',
            placeholder: '例如：把这款产品放在未来感厨房场景中，清晨自然光，干净高级，电商广告质感',
        },
        { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: param_options_1.RATIOS },
        { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: param_options_1.QUALITY_OPTIONS },
    ],
    buildPrompt: (p, refCount) => `自由创作：${p.prompt || '按描述创作电商视觉'}` +
        `${(0, param_options_1.refCountText)(refCount)}，保持主体一致${(0, param_options_1.ratioText)(p.ratio)}${(0, param_options_1.sizeText)(p.size)}`,
    modality: 'image',
    model: { capability: 'image', operation: 'text_to_image', intent: model_mapping_1.generateImageIntent },
    inputs: 0,
    inWorkbench: false,
};
//# sourceMappingURL=free_create.js.map