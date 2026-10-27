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
      pattern: '^#[0-9a-fA-F]{6}$',
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
      pattern: '^#[0-9a-fA-F]{6}$',
    },
  ],
  buildPrompt: (p) => {
    /*
     * targetColor 是定制页提交的最终 HEX；color/customColor 是旧调用方的
     * 兼容字段。选择 custom 时必须把 customColor 解析出来，否则提示词会变成
     * “换成 custom”，模型无法知道要换什么颜色。
     */
    const targetColor =
      p.targetColor || (p.color === 'custom' ? p.customColor : p.color) || '#FFFFFF';
    return [
      `商品换色：以输入图片中唯一的商品为基准，只把该商品主体颜色替换为 ${targetColor}。`,
      '必须保持同一件商品：商品类别、外形轮廓、数量、部件与结构、材质纹理、反光/高光、阴影、视角、构图、背景和画面尺寸全部不变。',
      '不得新增、移除或替换任何物体；不得把商品改画成其他品类；不得改变非主体颜色（金属件、透明件、Logo、装饰件保留原色）。',
      '输出必须是与输入图同一商品、同一画面的换色版本，而不是重新创作一张相似风格的新图。',
    ].join('');
  },
  modality: 'image',
  inputs: 1,
  inputImageMode: 'edit',
  inWorkbench: true,
};
