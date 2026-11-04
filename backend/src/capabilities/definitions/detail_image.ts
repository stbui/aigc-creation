/**
 * 商品详情图：参数、模块版式和批次产出保持在同一能力定义内。
 *
 * 一次提交按勾选模块拆成多张独立图片，每张分别计费、重试和退款；
 * 任一模块失败都不能影响同批其它模块的产出。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { generateImageIntent } from '../model-mapping';
import {
  DETAIL_SECTIONS,
  DETAIL_RATIOS,
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
  hero:
    '商品主体占画面 45%-60%，居中或偏右构图；顶部保留 15%-20% 标题区；' +
    '背景简洁、有光影层次；标题只使用商品名、品牌或有依据的核心卖点',
  selling_points:
    '从商品事实中提取 2-4 条卖点；上方展示商品主视觉，下方用分栏图标和短文案呈现；' +
    '每条卖点不超过一行，不添加无依据的对比或功效',
  usage_scene:
    '商品放入真实使用场景，处于明确的使用状态；环境简洁，不抢商品主体；' +
    '人物只用于表达使用情境，不复制参考图中的人物或身份；' +
    '场景、动作和道具可合理创作，但不得暗示未提供的功效或人群承诺',
  multi_angle:
    '同一商品展示 3-4 个视角；一个主视角搭配侧面、背面或俯视视角；' +
    '颜色、结构、配件保持一致，不新增参考图中没有的部件',
  scene_atmosphere:
    '用光线、材质和简洁陈设建立氛围；商品是唯一主角；' +
    '文字限制为品牌名或一句短标题，避免复杂故事和多余道具',
  product_detail:
    '展示 1-3 个局部微距特写；放大参考图中真实存在的材质、纹理和工艺；' +
    '背景适度虚化，不改变材质和颜色',
  brand_story:
    '品牌名搭配一句短主张；主张只能来自商品事实；没有品牌主张时只表现品牌名和产品设计语言，' +
    '不编造历史、荣誉或理念',
  size_spec:
    '用示意图标注尺寸、容量或尺码；只标注已提供的数值；' +
    '信息不足时保留比例线和图标，不生成数字，标注要清晰可读',
  effect_compare:
    '使用左右或上下分屏，保持同机位、同光线；只表现商品事实支持的使用前后差异，' +
    '不夸大、不承诺功效',
  spec_table:
    '使用规整参数表；字段和数值仅从商品事实提取，缺项直接删行；' +
    '不补数字、单位或认证，表头清晰、对齐工整',
  craft_process:
    '展示 3-4 个工艺步骤；步骤信息仅来自商品事实；' +
    '缺少工艺信息时改为材质细节和制作氛围，不写具体工序',
  accessories:
    '俯拍平铺展示已有配件；数量和种类严格依据参考图和商品事实；' +
    '逐一使用短标签，不添加赠品或不存在的配件',
  series_display:
    '使用多色或多 SKU 网格；只展示参考图或商品事实中出现的颜色和款式；' +
    '颜色与标签一一对应；缺少多色信息时展示主款和中性色卡，不编造 SKU',
  ingredients:
    '将已有成分和配方做成信息图；只列商品事实中出现的成分；' +
    '有比例才显示百分比，没有比例不补数字',
  after_sale:
    '用质保、退换、发货图标搭配短文案；只写已提供的售后政策；' +
    '未提供时使用中性类别词，不写具体天数、范围或承诺',
  usage_tips:
    '展示 3-5 条注意事项或保养步骤；内容仅来自商品事实；' +
    '信息不足时减少条目，不自行补充操作步骤',
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
    { key: 'ratio', label: '画面比例', type: 'enum', default: '3:4', options: DETAIL_RATIOS },
    { key: 'size', label: '输出画质', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
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
    const brief =
      SECTION_BRIEFS[section] || '按该版块的常见电商版式组织画面，信息不足时减少内容项，不编造事实';
    const facts = (String(p.description ?? '').trim() ||
      '仅根据商品名称与参考图呈现商品外观，不补充参数事实').replace(/[。；;]+$/, '');
    const productName = String(p.productName ?? '').trim();
    const brand = String(p.brand ?? '').trim();
    const allowedCopy = [
      productName ? `商品名称「${productName}」` : '',
      brand ? `品牌「${brand}」` : '',
      `商品事实：${facts}`,
    ]
      .filter(Boolean)
      .join('；');
    const ratio = String(p.ratio ?? '').trim() || '3:4';
    const quality = String(p.size ?? '').trim().toUpperCase() || '1K';
    const deliverySpec = platformDetailSpecText(p).replace(/^，/, '');
    const deliveryText = deliverySpec
      ? `${deliverySpec}；该宽度只用于生成后的缩放或裁切，不作为模型输出画质`
      : '按目标平台详情页规范做后续缩放或裁切';
    return (
      '【任务】\n' +
      `电商详情页单模块图生成。${subjectText(p)}。商品事实：${facts}。\n` +
      `只生成「${label}」这一张独立版块图，不生成整张详情长图。\n` +
      `【版式要求】\n${brief}。\n` +
      '【参考图】\n' +
      '参考图仅作为商品外观依据，不是版式、场景或文案参考。' +
      '商品结构、颜色、材质、logo、包装和配件必须与参考图一致；' +
      '不复制参考图的背景、桌面、人物、构图、文字、水印和拍摄角度。\n' +
      '【视觉系统】\n' +
      '从参考图提取主色、光影和材质特征，保持统一的品牌视觉；' +
      '同一商品的各模块只改变版式，不改变视觉语言。\n' +
      '【本图允许文案】\n' +
      `仅限以下来源：${allowedCopy}。` +
      '只能对上述来源做不改变含义的压缩；除这些内容外，不生成任何文字、数字、标签或水印。\n' +
      '【文案规则】\n' +
      '只选取与本模块直接相关的信息；' +
      '不得补写未提供的型号、材质、尺寸、参数、认证、销量、价格、优惠或售后承诺。' +
      '信息不足时减少信息项，用短标题、图标或留白处理，不要编造具体数字。\n' +
      '【文字呈现】\n' +
      `短标题为主，少字、大字号、高对比；避免大段小字、重复标题和装饰性假文案${languageText(p.language)}。\n` +
      '【尺寸与交付】\n' +
      `画面比例：${ratio}；输出画质：${quality}。平台成品规格：${deliveryText}。\n` +
      '【输出】\n' +
      '单张完整、可独立上架的高质量电商详情版块；主体和文字保留安全边距，' +
      '画面边缘不裁切重点内容。'
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
