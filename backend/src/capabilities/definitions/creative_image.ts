/**
 * 创意生图 —— 参考站 creative-image。提示词驱动的创意视觉 (本地为参数化占位)。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { RATIOS, ratioText, sizeText } from './param-options';

export const CreativeImage: CapabilityPlugin = {
  id: 'creative_image',
  name: '创意生图',
  group: 'ecommerce_gen',
  summary: '根据提示词探索营销创意图。',
  sidebarHint: '上传参考图、描述你的想法，即可开始创作',
  mode: 'mock',
  creditCost: 10, // 无既有展示价，取基准 10
  params: [
    {
      key: 'prompt',
      label: '画面描述',
      type: 'text',
      placeholder: '例如：清晨窗边的木质桌面，柔和自然光，极简ins风',
      help: '描述越具体，构图越可控',
    },
    { key: 'ratio', label: '画面比例', type: 'enum', default: '4:3', options: RATIOS },
  ],
  buildPrompt: (p) =>
    `创意生图：${p.prompt || '按描述创作电商视觉'}${ratioText(p.ratio)}${sizeText(p.size)}`,
  localImpl: 'makePlaceholder',
  modality: 'image',
  inputs: 1,
  inWorkbench: true,
};
