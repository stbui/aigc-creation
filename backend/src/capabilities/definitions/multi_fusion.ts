/**
 * 多图融合 —— 参考站 multi-image-fusion。主体图 + 搭配图合成一张主视觉。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { FUSION_SCENARIOS, FUSION_VARIANT_COUNTS, QUALITY_OPTIONS, RATIOS, ratioText, sizeText } from './param-options';

export const MultiFusion: CapabilityPlugin = {
  id: 'multi_fusion',
  name: '多图融合',
  group: 'ecommerce_gen',
  summary: '多张素材合成一张主视觉。',
  sidebarHint: '多图合成，保留主体一致性',
  mode: 'mock',
  creditCost: 40, // 原页面标注「本次消耗40积分」
  help: '本地为参数化合成占位 (场景版式 + 真实图片层叠), 非 AI 语义融合',
  params: [
    { key: 'scene', label: '融合场景', type: 'enum', default: 'print_pattern', options: FUSION_SCENARIOS },
    { key: 'variantCount', label: '变体张数', type: 'enum', default: '4', options: FUSION_VARIANT_COUNTS },
    { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: RATIOS },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
  ],
  buildPrompt: (p) =>
    `多图融合：把搭配图融合进主体图场景（${p.scene || '自然融合'}），` +
    `保持光影与透视一致${ratioText(p.ratio)}${sizeText(p.size)}`,
  localImpl: 'makeMultiFusion',
  modality: 'image',
  inputs: 2,
  inWorkbench: false,
};
