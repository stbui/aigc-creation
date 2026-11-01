/**
 * 商品详情图 —— 参考站 product-detail。上传商品图, 按「包含模块」逐张生成分区详情图。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 *
 * 2026-10-31 起按模块出图: 一次提交产出 N 张模块图 (勾选几个模块就出几张),
 * 由 `outputPlan` 声明。**按张计费** —— 每张各扣一次 `creditCost`,
 * 前端按 batchId 聚合成「一次生成」展示、按张数展示合计价。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { generateImageIntent } from '../model-mapping';
import {
  DETAIL_SECTIONS,
  LANGUAGES,
  PLATFORMS,
  QUALITY_OPTIONS,
  languageText,
  parseDetailSections,
  platformDetailSpecText,
  ratioText,
  sizeText,
  subjectText,
} from './param-options';

/**
 * 每个模块的画面要求。
 *
 * 详情图按模块逐张产出, 每个模块必须有自己的版式说明 —— 共用一句
 * 「按模块分区排版」会让 6 张图长得一模一样, 用户拿到的是一组废图。
 * 键与 `DETAIL_SECTIONS` 一一对应, 漏写时回落到通用说明 (不报错但质量差)。
 */
const SECTION_BRIEFS: Record<string, string> = {
  hero: '首屏主视觉: 商品主体大气居中, 背景干净, 光影通透, 顶部留出主标题与核心卖点的文字区',
  selling_points: '核心卖点: 2-4 个卖点做成分栏图标加短文案的版式, 商品仍是画面视觉中心',
  usage_scene: '使用场景: 把商品放进真实使用场景, 环境与人物自然, 突出正在使用的状态',
  multi_angle: '多角度: 同一商品的正视、侧视、俯视等角度拼版, 各角度比例一致、排布整齐',
  scene_atmosphere: '场景氛围: 用光影与陈设烘托商品调性, 商品保持唯一主角, 避免环境抢戏',
  product_detail: '商品细节: 局部特写放大材质、纹理与工艺, 背景景深虚化',
  brand_story: '品牌故事: 品牌调性的画面加品牌名与一句品牌主张, 版式克制、留白充足',
  size_spec: '尺寸规格: 以示意图标注尺寸、容量或尺码, 数字与标注线清晰可读',
  effect_compare: '效果对比: 左右或上下分屏对比使用前后, 两侧构图、光线与机位一致',
  spec_table: '参数表: 规整表格列出材质、规格与参数, 表头清晰、字号统一、对齐工整',
  craft_process: '工艺制作: 分步骤展示制作工艺, 每一步一张小图并附一句工序说明',
  accessories: '配件陈列: 随箱配件平铺陈列并逐一命名, 数量与清单一致',
  series_display: '系列展示: 多色或多 SKU 并排展示, 每个色块标签与颜色一一对应',
  ingredients: '成分信息: 把配方、材质、成分做成信息图, 突出关键成分与占比',
  after_sale: '售后保障: 质保、退换、发货等政策做成图标加文案的保障版块',
  usage_tips: '使用建议: 使用注意事项与保养方式做成条目式版块, 图标统一',
};

const SECTION_LABELS = new Map(DETAIL_SECTIONS.map((s) => [String(s.value), s.label]));

/** 模块键 → 展示名 (供准入层构造 outputPlan 与结果行标签) */
export function detailSectionLabel(key: string): string {
  return SECTION_LABELS.get(key) ?? key;
}

/** 旧口径: 不分模块时用一句通用提示词 (后台重试改造前的存量任务会走到这里) */
function legacyPrompt(p: Record<string, any>): string {
  return (
    `电商详情长图生成：${subjectText(p)}，${p.description || '把参数与卖点转成可视化内容'}。` +
    `按模块分区排版（首屏主视觉 / 卖点 / 参数细节 / 售后），纵向长图${ratioText(p.ratio)}${sizeText(p.size)}` +
    `${platformDetailSpecText(p)}${languageText(p.language)}`
  );
}

export const DetailImage: CapabilityPlugin = {
  id: 'detail_image',
  name: '商品详情图',
  group: 'ecommerce_gen',
  summary: '按模块逐张生成详情页版块图。',
  sidebarHint: '上传商品图，即可生成全套详情图',
  mode: 'real',
  creditCost: 10, // 整次生成（N 张模块图）统一按价目表扣一次
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
      placeholder: DETAIL_SECTIONS.slice(0, 6)
        .map((s) => s.value)
        .join(','),
      help: '每个模块单独产出一张图: ' + DETAIL_SECTIONS.map((s) => s.value).join(' / '),
    },
    { key: 'sku', label: 'SKU 编号（选填）', type: 'text', placeholder: 'SKU-001' },
    { key: 'size', label: '画质（输出宽度）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    // ── 批次技术字段 (页面不填, 准入层按 outputPlan 代填) ──
    { key: 'section', label: '模块键', type: 'text', hidden: true, help: '本张图负责的模块键' },
    { key: 'sectionLabel', label: '模块名称', type: 'text', hidden: true, help: '结果行图片下方的标签' },
    { key: 'batchId', label: '批次 ID', type: 'text', hidden: true, maxLength: 128 },
    { key: 'batchIndex', label: '批次序号', type: 'number', hidden: true, min: 1, max: 10, step: 1 },
    { key: 'batchSize', label: '批次数量', type: 'number', hidden: true, min: 1, max: 10, step: 1 },
  ],
  buildPrompt: (p) => {
    const section = typeof p.section === 'string' ? p.section.trim() : '';
    if (!section) return legacyPrompt(p);
    const label = detailSectionLabel(section);
    const brief = SECTION_BRIEFS[section] || '按该版块的常见电商排版组织画面';
    return (
      `电商详情页版块图生成：${subjectText(p)}，${p.description || '把参数与卖点转成可视化内容'}。` +
      `本次只产出一张「${label}」版块图：${brief}。` +
      `与同一商品的其它版块保持一致的配色与风格，画面完整、可独立上架使用` +
      `${ratioText(p.ratio)}${sizeText(p.size)}${platformDetailSpecText(p)}${languageText(p.language)}`
    );
  },
  // 勾选 N 个模块 → N 张模块图；每张各计一次 creditCost (见 outputPlan 注释)
  outputPlan: (p) =>
    parseDetailSections(p.sections).map((key) => ({
      key,
      label: detailSectionLabel(key),
      params: { section: key, sectionLabel: detailSectionLabel(key) },
    })),
  modality: 'image',
  model: { capability: 'image', operation: 'text_to_image', intent: generateImageIntent },
  inputs: 1,
  inWorkbench: true,
};
