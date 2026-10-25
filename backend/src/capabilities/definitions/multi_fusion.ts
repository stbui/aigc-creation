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
  mode: 'real',
  creditCost: 40, // 原页面标注「本次消耗40积分」
  help: '由图像模型完成场景语义融合，需要可用的图像通道',
  params: [
    { key: 'scene', label: '融合场景', type: 'enum', default: 'print_pattern', options: FUSION_SCENARIOS },
    { key: 'variantCount', label: '变体张数', type: 'enum', default: '4', options: FUSION_VARIANT_COUNTS },
    { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: RATIOS },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    {
      key: 'prompt',
      label: '画面描述（选填）',
      type: 'text',
      placeholder: '点击「AI分析」按主体图生成，或手写画面要求',
    },
  ],
  buildPrompt: (p) => {
    // 2026-10-22: 新增画面描述, 由「AI分析」(promptToolsApi.imageToPrompt) 生成或用户手写。
    // 为空时保持原提示词, 不塞占位文案 —— 空描述不等于没有要求。
    const desc = String(p.prompt ?? '').trim();
    const descPart = desc ? `，画面描述：${desc}` : '';
    return (
      `多图融合：把搭配图融合进主体图场景（${p.scene || '自然融合'}），` +
      `保持光影与透视一致${descPart}${ratioText(p.ratio)}${sizeText(p.size)}`
    );
  },
  modality: 'image',
  inputs: 2,
  inWorkbench: false,
};
