/**
 * 智能扩图 —— 参考站 image-expand。向外延展画面并自然补全。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { EXPAND_POSITIONS, QUALITY_OPTIONS, RATIOS_WITH_ORIGINAL } from './param-options';

export const Expand: CapabilityPlugin = {
  id: 'expand',
  name: '智能扩图',
  group: 'ai_retouch',
  summary: '自然补全画面边缘与展示空间。',
  sidebarHint: '智能补全画面边缘，扩展图片构图',
  mode: 'real',
  creditCost: 5, // 原页面标注「本次消耗5积分」
  params: [
    { key: 'occupy', label: '原图占比（%）', type: 'number', default: 80, min: 1, max: 100, step: 1 },
    { key: 'position', label: '原图位置', type: 'enum', default: 'center', options: EXPAND_POSITIONS },
    { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    /*
     * 参考站 SMART_EXPAND 的定位字段（均相对目标画布 0..1）。
     * 页面不填时由页面按 occupy + position 推导；API 直调时可直接给出
     * 精确构图，避免只能落在九宫格上。
     */
    { key: 'placementX', label: '原图 X（0-1）', type: 'number', min: 0, max: 1, step: 0.001, hidden: true },
    { key: 'placementY', label: '原图 Y（0-1）', type: 'number', min: 0, max: 1, step: 0.001, hidden: true },
    { key: 'placementWidth', label: '原图宽（0-1）', type: 'number', min: 0.01, max: 1, step: 0.001, hidden: true },
    { key: 'placementHeight', label: '原图高（0-1）', type: 'number', min: 0.01, max: 1, step: 0.001, hidden: true },
    { key: 'targetImageRatio', label: '目标画幅（参考站字段）', type: 'text', hidden: true },
  ],
  buildPrompt: (p) =>
    `智能扩图：把画面向外延展到${p.occupy ?? 80}% 的原图占比，` +
    `延展区域按原图内容自然补全${p.position ? `，原图位于${p.position}` : ''}` +
    `${p.targetImageRatio || p.ratio ? `，目标画幅 ${p.targetImageRatio || p.ratio}` : ''}`,
  modality: 'image',
  inputs: 1,
  inWorkbench: true,
};
