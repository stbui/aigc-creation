/**
 * 爆款复刻 —— 参考站 viral-clone。两张输入(商品图 + 参考图), 复刻爆款风格。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { generateImageIntent } from '../model-mapping';
import {
  LANGUAGES,
  PLATFORMS,
  QUALITY_OPTIONS,
  RATIOS,
  languageText,
  platformSpecText,
  ratioText,
  sizeText,
  subjectText,
} from './param-options';

function text(value: unknown): string {
  return String(value ?? '').trim();
}

/** 参考图永远是最后一张；它前面的图片才是商品素材。 */
function inputRoleText(refCount: number): string {
  if (refCount < 2) return '上传图片中，商品素材用于锁定商品身份，最后一张爆款图只用于复刻画面。';
  if (refCount === 2) return '共上传 2 张图：第 1 张为商品素材，最后 1 张为爆款参考图。';
  const productCount = refCount - 1;
  return `共上传 ${refCount} 张图：第 1-${productCount} 张为商品素材，最后 1 张为爆款参考图。`;
}

/**
 * 两档不能只靠「偏重」区分。
 *
 * 高度复刻要尽量锁住参考图的几何关系；参考风格则允许重建场景，
 * 否则两个选项最终会得到几乎相同的提示词，用户无法感知差异。
 */
function degreeText(degree: unknown): string {
  if (degree === 'reference_style') {
    return '参考风格：提取参考图的版式语言（构图节奏、镜头角度、主体占比、配色、光影与氛围）重建同风格场景；允许调整背景和道具，但商品卖点与画面层级必须一致。';
  }
  return '高度复刻参考图：保持构图、透视、主体位置与占比、背景、道具、光影、色调和文案留白区不变，只替换商品并修复遮挡；除商品相关细节外，场景尽量接近参考图。';
}

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
  buildPrompt: (p, refCount = 0) => {
    const requirement = text(p.requirement);
    const subject = subjectText({ productName: text(p.productName), brand: text(p.brand) });
    return (
      `爆款复刻任务。${inputRoleText(refCount)}` +
      `以商品素材为准，严格保持${subject}的轮廓、颜色、材质、纹理、图案、结构、数量和可见配件；` +
      `多张商品图之间以最清晰完整的细节为准。除非用户复刻要求明确指定，否则不把参考图中的商品、品牌或价格信息带入结果。` +
      `${degreeText(p.degree)}最终将主体替换为上传商品，保留参考图的主要留白和文案安全区；` +
      `画面真实、干净、完整，商品边缘自然、接触阴影与场景光影一致，保持商业摄影级清晰度；` +
      `无变形、无重复主体、无错字、无平台界面、无水印。` +
      `${requirement ? `用户复刻要求（优先逐条执行）：${requirement}。` : ''}` +
      `${ratioText(p.ratio)}${sizeText(p.size)}${platformSpecText(p)}${languageText(p.language)}`
    );
  },
  modality: 'image',
  model: { capability: 'image', operation: 'text_to_image', intent: generateImageIntent },
  inputs: 2,
  inWorkbench: true,
};
