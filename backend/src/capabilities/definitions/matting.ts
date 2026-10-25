/**
 * 一键抠图 —— 参考站 background-remove。分离主体与背景, 支持换底色。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { BG_COLOR_OPTIONS, MATTING_COLOR_OPTIONS, RATIOS_WITH_ORIGINAL } from './param-options';

export const Matting: CapabilityPlugin = {
  id: 'matting',
  name: '一键抠图',
  group: 'ai_retouch',
  summary: '快速去除背景，突出商品主体。',
  sidebarHint: '智能识别主体，一键去除图片背景',
  badge: '免费',
  mode: 'real',
  creditCost: 0, // 原页面标注「限时免费」，0 保留该语义；限时结束改价即可恢复
  params: [
    { key: 'bgColor', label: '背景颜色', type: 'enum', default: 'transparent', options: BG_COLOR_OPTIONS },
    {
      key: 'customColor',
      label: '自定义背景色（HEX）',
      type: 'text',
      placeholder: '#RRGGBB',
      help: '仅当背景颜色选择"自定义颜色"时生效',
    },
    { key: 'ratio', label: '画面比例', type: 'enum', default: 'original', options: RATIOS_WITH_ORIGINAL },
    /*
     * 2026-10-25 对齐参考站 createBackgroundRemoval 的字段名。
     *
     * 页面代填 selectedColor，旧调用方仍可继续传 bgColor；提示词优先读
     * selectedColor，再回落 bgColor。customAlpha 让「自定义背景」不再只有
     * 全不透明一种结果，0 等价于透明底。
     */
    {
      key: 'selectedColor',
      label: '背景颜色（参考站字段）',
      type: 'enum',
      default: 'transparent',
      options: MATTING_COLOR_OPTIONS,
      hidden: true,
    },
    {
      key: 'customAlpha',
      label: '自定义背景透明度（%）',
      type: 'number',
      default: 100,
      min: 0,
      max: 100,
      step: 1,
      hidden: true,
    },
    {
      key: 'resolution',
      label: '输出分辨率（参考站字段）',
      type: 'text',
      hidden: true,
      help: '参考站 createBackgroundRemoval 的 resolution；与 size 同义，页面代填',
    },
  ],
  buildPrompt: (p) => {
    const color = String(p.selectedColor ?? p.bgColor ?? 'transparent');
    const backdrop =
      color === 'transparent'
        ? '透明底'
        : color === 'custom'
          ? `自定义色 ${p.customColor || '#5546D8'}，透明度 ${p.customAlpha ?? 100}%`
          : `色板 ${color}`;
    return `商品抠图：精确分离主体与背景，边缘发丝级保留；背景替换为 ${backdrop}`;
  },
  modality: 'image',
  inputs: 1,
  inWorkbench: true,
};
