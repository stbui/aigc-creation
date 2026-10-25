/**
 * 商品换色 —— 参考站 product-recolor。保持结构光影, 只换主体颜色。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { BG_COLOR_OPTIONS, QUALITY_OPTIONS, RATIOS_WITH_ORIGINAL } from './param-options';

export const Recolor: CapabilityPlugin = {
  id: 'recolor',
  name: '商品换色',
  group: 'ai_retouch',
  summary: '快速替换商品颜色，丰富展示版本。',
  sidebarHint: '保持商品结构不变，快速替换主体颜色',
  mode: 'real',
  creditCost: 5, // 原页面标注「本次消耗5积分」
  params: [
    { key: 'color', label: '商品颜色', type: 'enum', default: '#FFFFFF', options: BG_COLOR_OPTIONS.slice(1) },
    {
      key: 'customColor',
      label: '自定义颜色（HEX）',
      type: 'text',
      placeholder: '#RRGGBB',
      help: '仅当商品颜色选择"自定义颜色"时生效',
    },
    { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    /** 参考站 createTemplateImageTool 直接提交解析后的 HEX；旧 color/customColor 继续兼容。 */
    {
      key: 'targetColor',
      label: '目标颜色（HEX）',
      type: 'text',
      placeholder: '#RRGGBB',
      hidden: true,
    },
  ],
  buildPrompt: (p) =>
    `商品换色：只改变商品主体颜色为 ${p.targetColor || p.color || '#FFFFFF'}，保持材质、光影与结构不变`,
  modality: 'image',
  inputs: 1,
  inWorkbench: true,
};
