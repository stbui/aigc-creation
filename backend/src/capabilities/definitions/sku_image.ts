/**
 * 商品SKU图 —— 参考站 product-sku。按 SKU 清单批量出图。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { BG_COLOR_OPTIONS, QUALITY_OPTIONS, RATIOS, ratioText, sizeText } from './param-options';

export const SkuImage: CapabilityPlugin = {
  id: 'sku_image',
  name: '商品SKU图',
  group: 'ecommerce_gen',
  summary: '按 SKU 批量出图。',
  sidebarHint: '批量生成同款不同规格图',
  mode: 'mock',
  creditCost: 0, // 原页面标注「本次消耗0积分」
  help: '本地为模板 + 区域填充的参数化批量渲染, 非 AI 套版',
  params: [
    {
      key: 'region',
      label: '变体区域',
      type: 'enum',
      default: 'center',
      options: [
        { value: 'center', label: '画面中心' },
        { value: 'top', label: '画面上方' },
        { value: 'bottom', label: '画面下方' },
        { value: 'left', label: '画面左侧' },
        { value: 'right', label: '画面右侧' },
      ],
      help: '参考站支持框选最多 3 个 SKU 变体区域, 本地以位置枚举代替',
    },
    { key: 'skuName', label: 'SKU 名称', type: 'text', placeholder: '例如： CLASSIC BLACK / M' },
    { key: 'skuColor', label: 'SKU 颜色', type: 'enum', default: '#FFFFFF', options: BG_COLOR_OPTIONS.slice(1, 6) },
    { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: RATIOS },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
  ],
  buildPrompt: (p) =>
    `SKU 套图：沿用上传模板图的版式，在${p.region || '指定'}区域替换为 SKU「${p.skuName || ''}」` +
    `（颜色 ${p.skuColor || '保持原样'}），批量输出版式一致的整组 SKU 图${ratioText(p.ratio)}${sizeText(p.size)}`,
  localImpl: 'makeSkuImage',
  modality: 'image',
  inputs: 1,
  inWorkbench: false,
};
