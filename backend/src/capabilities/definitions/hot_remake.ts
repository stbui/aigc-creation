/**
 * 爆款复刻 —— 参考站 viral-clone。两张输入(商品图 + 参考图), 复刻爆款风格。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { LANGUAGES, PLATFORMS, QUALITY_OPTIONS, RATIOS, ratioText, sizeText } from './param-options';

export const HotRemake: CapabilityPlugin = {
  id: 'hot_remake',
  name: '爆款复刻',
  group: 'ecommerce_gen',
  summary: '参考爆款风格生成商品内容图。',
  sidebarHint: '上传想参考的爆款图，即刻生成同款',
  mode: 'real',
  creditCost: 10, // 无既有展示价，取基准 10
  params: [
    { key: 'productName', label: '商品名称（选填）', type: 'text', placeholder: '请输入商品名称（选填）' },
    { key: 'brand', label: '品牌（选填）', type: 'text', placeholder: '请输入品牌（选填）' },
    { key: 'platform', label: '投放平台', type: 'enum', default: 'taobao', options: PLATFORMS },
    { key: 'language', label: '输出语言', type: 'enum', default: 'zh-CN', options: LANGUAGES },
    {
      key: 'requirement',
      label: '复刻要求（选填）',
      type: 'text',
      placeholder: '例如：文案统一用英文、模特保持完全不变、参考图不变只替换商品。',
      help: '中文原文会完整写入模型提示词',
    },
    {
      key: 'degree',
      label: '复刻程度',
      type: 'enum',
      default: 'high_replica',
      options: [
        { value: 'reference_style', label: '参考风格' },
        { value: 'high_replica', label: '高度复刻' },
      ],
      help: '参考风格: 提取参考图配色与结构重建场景; 高度复刻: 保留参考图整体结构替换商品',
    },
    { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: RATIOS },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
  ],
  buildPrompt: (p) =>
    `爆款风格复刻：参考上传的爆款图的构图、配色与氛围，替换主体为上传的商品，保持整体风格一致。` +
    `${p.degree === 'reference_style' ? '偏重保留参考图版式' : '偏重高度还原参考图'}${ratioText(p.ratio)}${sizeText(p.size)}`,
  modality: 'image',
  inputs: 2,
  inWorkbench: true,
};
