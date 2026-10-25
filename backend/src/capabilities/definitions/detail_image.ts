/**
 * 商品详情图 —— 参考站 product-detail。上传商品图, 按「包含模块」生成分区详情长图。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { DETAIL_SECTIONS, DETAIL_SECTION_DEFAULTS, LANGUAGES, PLATFORMS, QUALITY_OPTIONS, ratioText, sizeText, subjectText } from './param-options';

export const DetailImage: CapabilityPlugin = {
  id: 'detail_image',
  name: '商品详情图',
  group: 'ecommerce_gen',
  summary: '快速组织详情页模块与卖点素材。',
  sidebarHint: '上传商品图，即可生成全套详情图',
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
    {
      key: 'sections',
      label: '包含模块（逗号分隔，默认前 6 项，上限 10）',
      type: 'text',
      placeholder: DETAIL_SECTION_DEFAULTS.join(','),
      help: '可选键: ' + DETAIL_SECTIONS.map((s) => s.value).join(' / '),
    },
    { key: 'sku', label: 'SKU 编号（选填）', type: 'text', placeholder: 'SKU-001' },
    { key: 'size', label: '画质（输出宽度）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
  ],
  buildPrompt: (p) =>
    `电商详情长图生成：${subjectText(p)}，${p.description || '把参数与卖点转成可视化内容'}。` +
    `按模块分区排版（首屏主视觉 / 卖点 / 参数细节 / 售后），纵向长图${ratioText(p.ratio)}${sizeText(p.size)}`,
  modality: 'image',
  inputs: 1,
  inWorkbench: true,
};
