/**
 * 产品精修 —— 参考站 product-retouch。优化质感与细节, 6 种精修模式。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { QUALITY_OPTIONS, RATIOS_WITH_ORIGINAL, RETOUCH_MODES } from './param-options';

export const Enhance: CapabilityPlugin = {
  id: 'enhance',
  name: '产品精修',
  group: 'ai_retouch',
  summary: '优化商品细节与材质质感。',
  sidebarHint: '优化商品质感与画面细节，提升展示效果',
  mode: 'real',
  creditCost: 5, // 原页面标注「本次消耗5积分」
  params: [
    { key: 'mode', label: '精修模式', type: 'enum', default: 'comprehensive', options: RETOUCH_MODES },
    {
      key: 'note',
      label: '补充要求（选填）',
      type: 'text',
      placeholder: '如：去掉电镀件上的指纹，让皮革看起来更有光泽',
      help: '本地算法仅将 ASCII 部分绘制到图上, 中文原文完整记录在任务参数中',
    },
    { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    /* 参考站 createTemplateImageTool('PRODUCT_REFINEMENT') 的模板码；旧 mode/note 仍兼容。 */
    {
      key: 'templateCode',
      label: '精修模板（参考站字段）',
      type: 'enum',
      default: 'IT_PR_COMPREHENSIVE',
      options: [
        { value: 'IT_PR_COMPREHENSIVE', label: '综合精修' },
        { value: 'IT_PR_TEXTURE', label: '质感增强' },
        { value: 'IT_PR_DEFECT_REPAIR', label: '瑕疵修复' },
        { value: 'IT_PR_COLOR_CORRECTION', label: '色彩校正' },
        { value: 'IT_PR_CLARITY', label: '提升清晰度' },
        { value: 'IT_PR_MATERIAL', label: '材质强化' },
      ],
      hidden: true,
    },
    {
      key: 'additionalRequirement',
      label: '补充要求（参考站字段）',
      type: 'text',
      maxLength: 2000,
      hidden: true,
    },
    /* 参考站 PRODUCT_REFINEMENT 仅在非原比例时提交 imageRatio。 */
    { key: 'imageRatio', label: '画面比例（参考站字段）', type: 'text', hidden: true },
  ],
  buildPrompt: (p) =>
    `产品精修（${p.templateCode || p.mode || 'comprehensive'}）：` +
    `${p.additionalRequirement || p.note || '优化商品质感与画面细节'}，` +
    `保持结构与颜色真实，提升清晰度与质感${p.imageRatio ? `；输出比例 ${p.imageRatio}` : ''}`,
  localImpl: 'makeEnhance',
  modality: 'image',
  inputs: 1,
  inWorkbench: true,
};
