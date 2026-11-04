/**
 * 爆款复刻
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
  if (refCount < 2) return '上传图片中，商品素材仅用于确认商品身份，最后一张爆款图仅作为视觉参考。';
  if (refCount === 2) {
    return '共上传 2 张图：第 1 张仅用于确认商品身份，最后 1 张仅作为构图、镜头、光影、配色和版式参考。';
  }
  const productCount = refCount - 1;
  return `共上传 ${refCount} 张图：第 1-${productCount} 张仅用于确认商品身份，最后 1 张仅作为构图、镜头、光影、配色和版式参考。`;
}

/**
 * 两档不能只靠「偏重」区分。
 *
 * 高度复刻要尽量锁住参考图的几何关系；参考风格则允许重建场景，
 * 否则两个选项最终会得到几乎相同的提示词，用户无法感知差异。
 */
function degreeText(degree: unknown): string {
  if (degree === 'reference_style') {
    return (
      '参考风格：提取参考图的配色、光影、镜头语言和视觉重心重建场景；' +
      '允许调整背景和道具，但保持信息层级、视觉重心和商品调性一致。'
    );
  }
  return (
    '高度复刻：保持参考图的构图、透视、画面重心、背景关系、光影、色调和留白区；' +
    '替换主体为上传商品。若商品尺寸或遮挡关系不匹配，允许在主体区域内做最小比例和位置调整，' +
    '但不得变形商品，也不得改变整体版式关系。'
  );
}

function allowedCopyText(productName: string, brand: string): string {
  const provided = [
    productName ? `商品名称「${productName}」` : '',
    brand ? `品牌「${brand}」` : '',
  ].filter(Boolean);
  const prefix = provided.length > 0 ? `仅允许使用${provided.join('、')}，以及` : '仅允许使用';
  return `${prefix}用户在复刻要求中明确指定为画面文案的内容。`;
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
      placeholder: '例如：背景保持简洁、商品居中、文案使用英文。',
      help: '用户补充要求会在商品一致性与参考图边界约束内执行',
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
      help: '参考风格: 提取参考图配色与结构重建场景; 高度复刻: 保留参考图整体结构替换商品，并保证商品不变形',
    },
    { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: RATIOS },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
  ],
  buildPrompt: (p, refCount = 0) => {
    const productName = text(p.productName);
    const brand = text(p.brand);
    const requirement = text(p.requirement);
    const subject = subjectText({ productName, brand });
    const ratio = text(p.ratio);
    const delivery = `${ratioText(p.ratio)}${sizeText(p.size)}${platformSpecText(p)}${languageText(p.language)}`.replace(
      /^，/,
      '',
    );

    return [
      '【任务】',
      '基于商品素材生成一张可投放的电商图片。复刻参考图的视觉策略，不照搬参考图内容。',
      '',
      '【输入分工】',
      inputRoleText(refCount),
      '',
      '【商品一致性｜硬约束】',
      `以最清晰、完整的商品素材为准，保持${subject}的轮廓、颜色、材质、纹理、图案、结构、数量和可见配件。`,
      '不得为了匹配参考图对商品进行拉伸、压扁、补造结构或改变比例。',
      '多张商品图细节冲突时，采用清晰且多图一致的信息；无法确认的细节不臆造。',
      '',
      '【参考图边界｜硬约束】',
      '不得复刻参考图中的任何商品、可识别人物及面部、品牌标识、商标、水印、平台界面、二维码、价格、销量、认证、功效、促销语或其他文字。',
      '人物仅按参考图中的位置、姿态和景别重建为匿名通用模特。',
      '只继承参考图的构图关系、镜头、光影、配色、视觉层级和留白。',
      '',
      '【复刻策略】',
      degreeText(p.degree),
      '',
      '【比例与构图｜硬约束】',
      ratio
        ? `输出比例 ${ratio} 是硬约束。若与参考图比例不同，以目标比例为优先，通过最小范围裁切、扩边或重新构图适配，不拉伸商品和背景，不裁断商品及核心文案区。`
        : '输出比例以系统设定为硬约束。若与参考图比例不同，以目标比例为优先，通过最小范围适配，不拉伸商品和背景，不裁断商品及核心文案区。',
      '',
      '【文案｜硬约束】',
      allowedCopyText(productName, brand),
      '不新增价格、优惠、参数、功效、认证、销量、评价、售后承诺或行动号召。',
      '没有明确可用文案时，保留干净留白，不补写。',
      '所选输出语言只约束新增营销文案；商品包装和标签上的原有文字保持素材原样。',
      '参考图原有文字一律不复刻，只保留文字块的位置、大小和视觉层级。',
      '',
      '【质量】',
      '画面真实、干净、完整；商品边缘自然，接触阴影和场景光影一致，主体清晰，保持商业摄影级质感。',
      '成图不得出现水印、平台界面、二维码、重复主体或明显错字。',
      ...(requirement
        ? [
            '',
            '【用户附加要求】',
            `在不违反上述商品一致性、参考图边界、目标比例和平台规范的前提下执行：${requirement}`,
          ]
        : []),
      ...(delivery ? ['', '【交付】', `${delivery}。`] : []),
    ].join('\n');
  },
  modality: 'image',
  model: { capability: 'image', operation: 'text_to_image', intent: generateImageIntent },
  inputs: 2,
  inWorkbench: true,
};
