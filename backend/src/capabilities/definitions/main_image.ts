/**
 * 商品主图 —— 参考站 product-kit。上传商品图, 按变体类型生成主视觉套图。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { LANGUAGES, MAIN_IMAGE_VARIANTS, PLATFORMS, QUALITY_OPTIONS, RATIOS, ratioText, sizeText, subjectText } from './param-options';

export const MainImage: CapabilityPlugin = {
  id: 'main_image',
  name: '商品主图',
  group: 'ecommerce_gen',
  summary: '一键生成突出卖点的商品主视觉。',
  sidebarHint: '上传商品图，即可生成完整套图',
  mode: 'real',
  creditCost: 10, // 无既有展示价，取旗舰能力基准 10
  params: [
    { key: 'productName', label: '商品名称', type: 'text', placeholder: '例如：夏季轻音桌面循环扇' },
    { key: 'brand', label: '品牌（选填）', type: 'text', placeholder: '请输入品牌（选填）' },
    { key: 'platform', label: '投放平台', type: 'enum', default: 'taobao', options: PLATFORMS },
    { key: 'language', label: '输出语言', type: 'enum', default: 'zh-CN', options: LANGUAGES },
    {
      key: 'description',
      label: '商品描述',
      type: 'text',
      placeholder: '例如：三档风速，低噪运行，USB 供电',
    },
    { key: 'variant', label: '主图类型', type: 'enum', default: 'other', options: MAIN_IMAGE_VARIANTS },
    { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: RATIOS },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
  ],
  buildPrompt: (p) =>
    `电商商品主图生成：${subjectText(p)}，${p.description || '突出卖点与质感'}。` +
    `需要白底图、场景图、卖点图三类主图，画面干净、主体突出${ratioText(p.ratio)}${sizeText(p.size)}` +
    (p.platform ? `，适配 ${p.platform} 平台` : ''),
  localImpl: 'makeMainImage',
  modality: 'image',
  inputs: 1,
  inWorkbench: true,
};
