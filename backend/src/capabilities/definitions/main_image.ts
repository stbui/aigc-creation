/**
 * 商品主图 —— 参考站 product-kit。上传商品图, 按变体类型生成主视觉套图。
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
  MAIN_IMAGE_VARIANTS,
  PLATFORMS,
  QUALITY_OPTIONS,
  RATIOS,
  languageText,
  platformSpecText,
  ratioText,
  sizeText,
  subjectText,
} from './param-options';

/** 一次提交最多产出的主图张数（与 `batchSize` 的声明上限一致） */
export const MAIN_IMAGE_MAX_OUTPUTS = 20;

/**
 * 变体键 → 画面要求。
 *
 * ## 为什么必须有这张表
 *
 * `variant` 过去只参与**任务参数与结果标签**, 从未进入提示词 ——
 * 三次生成（白底图 / 场景图 / 卖点图）发给模型的是**完全相同**的一条指令
 * （"需要白底图、场景图、卖点图三类主图"），模型只能靠随机性拉开差异，
 * 产出的三张图会明显趋同，用户拿到的是"同一张图的三次复制"。
 *
 * 每类变体必须有**互斥的画面目标**，白底图要求纯净背景、场景图要求环境叙事、
 * 卖点图要求信息表达，三者互斥才谈得上"一套"。
 *
 * ⚠️ 键必须与 `MAIN_IMAGE_VARIANTS` 的 value 一一对应；认不出的值回落到
 * 通用主图要求（不丢信息、不崩）。
 */
const VARIANT_BRIEFS: Record<string, string> = {
  white_background:
    '纯白无缝背景（RGB 255/255/255），无投影、无渐变、无场景道具；' +
    '商品居中完整呈现，正面或微侧 45° 视角，柔和均匀的顶部主光加底部浅反射；' +
    '保持商品结构、颜色、材质、logo 与包装与参考图一致，不添加任何文字、标签、水印或装饰元素。',
  scene:
    '商品置于真实可感的消费场景中（依据商品品类选择恰当环境，如桌面、厨房、浴室、户外），' +
    '环境有明确的层次与生活气息，道具克制、不遮挡商品；' +
    '光线方向与阴影柔和自然，商品是唯一视觉主体，景深适度虚化背景。',
  selling_point:
    '以「一张图讲清一个卖点」的版式呈现：商品主体占画面 45%-60%，' +
    '其余区域用简短文字与图标标注 1-3 个卖点；' +
    '文字只能取自商品名称、品牌与商品描述中出现的事实，不得编造参数、功效、认证或促销承诺。',
  other:
    '按商品品类补充一张常规展示图：商品完整清晰、背景简洁、构图干净，' +
    '作为主图套图的补充视角，不与其它变体重复。',
};

/** 变体键 → 提示词片段；未知键回落到通用主图要求 */
export function mainImageVariantBrief(variant: unknown): string {
  const key = String(variant ?? '').trim();
  return VARIANT_BRIEFS[key] ?? VARIANT_BRIEFS.other;
}

/**
 * 变体键 → 是否允许画面出现文字。
 *
 * ## 为什么只有卖点图允许写字
 *
 * 三类主图的用途不同，**写字的代价也不同**：
 *
 *   · 白底图 / 场景图 / 其他图 是「商品陈列图」，行业惯例是无字 ——
 *     平台审核与搜索加权都偏向干净底图；
 *   · 卖点图按定义就是要用文字讲卖点。
 *
 * 更实际的理由是**生图模型写中文会糊**：让模型在白底图上渲染品牌名，
 * 十次有八次会得到错字或乱码，而错字的品牌名比没有品牌名更糟 ——
 * 用户会直接把它当成「AI 生成的假图」���
 *
 * 所以除卖点图外一律禁字，卖点图则把可用文字限定在用户填的事实闭集里。
 */
const VARIANT_ALLOWS_TEXT: Record<string, boolean> = {
  white_background: false,
  scene: false,
  selling_point: true,
  other: false,
};

/** 变体是否允许画面出现文字；未知变体按「不允许」处理（更安全的一侧） */
export function mainImageVariantAllowsText(variant: unknown): boolean {
  const key = String(variant ?? '').trim();
  return VARIANT_ALLOWS_TEXT[key] ?? false;
}

/**
 * 变体键 → 中文标签；未知键原样显示，不吞信息。
 *
 * 放在同一文件里定义（而不是 `param-options.ts`）是有意的：标签与提示词
 * 是同一件事的两面 —— 变体叫什么，模型就得被要求画什么。
 */
/**
 * 变体的画面文案规则。
 *
 * 分三种情形，避免出现「这一段禁字、下一段允许写字」的自相矛盾指令：
 *
 *   1. 该变体本来就不写字（白底 / 场景 / 其他）→ 明确禁字；
 *   2. 该变体要写字但用户没提供任何素材 → 只能靠画面讲，不硬凑假文案；
 *   3. 该变体要写字且用户提供了素材 → 用事实闭集限定可写内容。
 */
function mainImageCopyRules(variant: string, allowedCopy: string): string[] {
  const forbidden =
    '不得出现任何文字、数字、标签、logo 文字、水印或装饰性假文案；商品本体上原有的 logo 与包装文字保持与参考图一致即可。';
  if (!mainImageVariantAllowsText(variant)) {
    return [`本图不写字：${forbidden}`];
  }
  if (!allowedCopy) {
    return [
      '用户未提供商品文案素材，画面不出现任何文字、数字、标签或水印；用构图与商品本体表达卖点。',
      '不得编造型号、材质、尺寸、参数、功效、认证、销量、价格、优惠或售后承诺。',
    ];
  }
  return [
    `画面文字只能取自以下素材；“商品名称”“品牌”“商品事实”只是来源标签，不得原样写入画面：${allowedCopy}。`,
    '只能对上述素材做不改变含义的压缩，或按目标语言做等价翻译。',
    '不得编造型号、材质、尺寸、参数、功效、认证、销量、价格、优惠或售后承诺。',
  ];
}
function variantLabel(variant: string): string {
  if (!variant) return '商品主图';
  return MAIN_IMAGE_VARIANTS.find((option) => String(option.value) === variant)?.label ?? variant;
}

/**
 * 「自定义配置」的变体计数 → 本次要产出的变体清单。
 *
 * 计数是「每类几张」，这里展开成**有序的变体键列表**：一类填 3 就出现 3 次。
 * 顺序固定为 `MAIN_IMAGE_VARIANTS` 的声明顺序 —— 结果栏按 `batchIndex` 排序，
 * 顺序必须稳定，否则「白底、场景、卖点」的套图会随请求顺序错位。
 */
export function parseMainImageVariants(raw: unknown): string[] {
  const valid = new Set(MAIN_IMAGE_VARIANTS.map((option) => String(option.value)));
  const list = String(raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => valid.has(item));
  const out: string[] = [];
  for (const option of MAIN_IMAGE_VARIANTS) {
    const key = String(option.value);
    const count = list.filter((item) => item === key).length;
    for (let i = 0; i < count; i += 1) out.push(key);
  }
  // 上限 20 张：与 `batchSize` 的声明上限一致，也是一次提交的合理上限
  return out.slice(0, MAIN_IMAGE_MAX_OUTPUTS);
}

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
    {
      key: 'variants',
      label: '主图类型（逗号分隔，一类可重复）',
      type: 'text',
      hidden: true,
      maxLength: 400,
      help: '自定义配置的计数展开结果；服务端按它拆成 N 个任务',
    },
    { key: 'variant', label: '主图类型', type: 'enum', default: 'other', options: MAIN_IMAGE_VARIANTS },
    { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: RATIOS },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    // ── 批次技术字段 (服务端按 outputPlan 代填, 结果栏据此把多张图聚合成一行) ──
    { key: 'variantLabel', label: '主图类型名称', type: 'text', hidden: true, help: '本张图负责的主图类型' },
    { key: 'batchId', label: '批次 ID', type: 'text', hidden: true, maxLength: 128 },
    { key: 'batchIndex', label: '批次序号', type: 'number', hidden: true, min: 1, max: 20, step: 1 },
    { key: 'batchSize', label: '批次数量', type: 'number', hidden: true, min: 1, max: 20, step: 1 },
  ],
  buildPrompt: (p, refCount = 0) => {
    const variant = String(p?.variant ?? '').trim();
    const productName = String(p?.productName ?? '').trim();
    const brand = String(p?.brand ?? '').trim();
    const description = String(p?.description ?? '').trim();
    /*
     * 允许写入画面的文案闭集 —— 与商品详情图同一套原则:
     * 用户填了什么才允许出现什么，模型不得自行补写卖点与参数。
     */
    const allowedCopy = [
      productName ? `商品名称「${productName}」` : '',
      brand ? `品牌「${brand}」` : '',
      description ? `商品事实：${description}` : '',
    ]
      .filter(Boolean)
      .join('；');

    return [
      '【任务】',
      `生成一张电商商品主图。${subjectText(p)}。`,
      '',
      '【本图类型】',
      `本次只生成「${variantLabel(variant)}」这一张主图，不生成其它类型。`,
      `画面要求：${mainImageVariantBrief(variant)}`,
      '',
      '【商品一致性｜硬约束】',
      '商品结构、颜色、材质、纹理、logo、包装与可见配件必须与参考图一致；',
      '不得替换商品、改变比例、拉伸变形或增删部件；参考图未覆盖的角度只做结构一致的合理推演。',
      '',
      '【参考图边界｜硬约束】',
      '参考图仅作为商品外观依据，不是版式、场景或文案参考；',
      '不复制参考图的背景、桌面、人物、构图、文字与水印。',
      '',
      '【本图允许文案】',
      ...mainImageCopyRules(variant, allowedCopy),
      '',
      '【输出】',
      `单张完整、可独立上架的高质量电商主图，主体完整不裁切，边缘保留安全边距${ratioText(p.ratio)}${sizeText(p.size)}${platformSpecText(p)}${languageText(p.language)}。`,
      ...(refCount > 0 ? ['', '【参考图】', `共参考上传的 ${refCount} 张商品图。`] : []),
    ].join('\n');
  },
  /**
   * 一次提交 → N 张主图（每类变体各出一张）。
   *
   * 与商品详情图同一套机制：服务端拆任务、各自计费、各自退款。
   * 变体计数由客户端展开成 `variants` 参数（逗号分隔、可重复），
   * 服务端只负责按**声明顺序**展开，保证结果栏的套图顺序稳定。
   */
  outputPlan: (p) =>
    parseMainImageVariants(p.variants).map((variant, index) => ({
      key: `${variant}-${index + 1}`,
      label: variantLabel(variant),
      params: { variant, variantLabel: variantLabel(variant) },
    })),
  modality: 'image',
  model: { capability: 'image', operation: 'text_to_image', intent: generateImageIntent },
  inputs: 1,
  inWorkbench: true,
};
