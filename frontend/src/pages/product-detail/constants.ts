/**
 * 商品详情图页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 约定: `product-detail/` 下的文件不从 `src/lib/constants` 直接取东西, 一律经由本文件 ——
 * 页面用到的上限、字段长度与模块清单集中可见, 调整只改一处。
 * 目录内新增共享常量时在这里补一行 re-export。
 */

/** 单张图片体积上限 (MB), 全站上传校验共用 */
export { MAX_IMAGE_MB } from '../../lib/constants';

// ───────────────── 上传与字段长度 (参考站实拍) ─────────────────

/** 一次提交最多上传的商品图张数 */
export const MAX_IMAGES = 5;
/** 商品名称 / 品牌输入上限 */
export const MAX_NAME_LEN = 100;
/** 商品描述输入上限 */
export const MAX_DESC_LEN = 5000;
/** 单个模块提示词上限 */
export const MAX_SECTION_PROMPT_LEN = 1000;

// ───────────────── 包含模块 ─────────────────

/**
 * 商品详情图「包含模块」16 项。
 *
 * 选项清单是页面与任务参数的共同事实源: `value` 与后端 `DETAIL_SECTIONS` 一致
 * (后端按键渲染长图区块), 顺序即参考站模块固定顺序 —— 勾选不重排。
 * value 与后端 registry DETAIL_SECTIONS 一致。
 */
export const SECTION_MODULES = [
  { value: 'hero', label: '首屏主视觉', desc: '传递核心价值' },
  { value: 'selling_points', label: '核心卖点图', desc: '突出差异优势' },
  { value: 'usage_scene', label: '使用场景图', desc: '呈现真实使用场景' },
  { value: 'multi_angle', label: '多角度图', desc: '多角度呈现外观' },
  { value: 'scene_atmosphere', label: '场景氛围图', desc: '展示使用场景' },
  { value: 'product_detail', label: '商品细节图', desc: '放大材质与工艺' },
  { value: 'brand_story', label: '品牌故事图', desc: '传达品牌理念' },
  { value: 'size_spec', label: '尺寸/容量/尺码图', desc: '展示规格信息' },
  { value: 'effect_compare', label: '效果对比图', desc: '使用前后效果对比' },
  { value: 'spec_table', label: '详细规格/参数表', desc: '展示详细商品数据' },
  { value: 'craft_process', label: '工艺制作图', desc: '展示工艺制作过程' },
  { value: 'accessories', label: '配件/随箱物品图', desc: '明确收到的配件、零配件和随购赠送物品' },
  { value: 'series_display', label: '系列展示图', desc: '多色或多SKU展示' },
  { value: 'ingredients', label: '商品成分图', desc: '展示配方/材质/成分' },
  { value: 'after_sale', label: '售后保障图', desc: '说明质保退换政策' },
  { value: 'usage_tips', label: '使用建议图', desc: '商品使用的注意事项' },
] as const;

/** 模块固定顺序 (勾选时按此排序, 不按点击先后) */
export const SECTION_VALUES: string[] = SECTION_MODULES.map((s) => s.value);

/** 默认勾选前 6 项 (参考站初始状态 已选 6/10) */
export const DEFAULT_SECTIONS = SECTION_VALUES.slice(0, 6);

/** 与参考站「已选 N/10」一致 */
export const MAX_SECTIONS = 10;

/**
 * 模块提示词的初始内容。
 *
 * 每个模块都有自己的输入框, 默认内容只描述该模块的画面职责;
 * 商品名称、品牌与公共商品描述仍由服务端统一注入, 避免 16 份提示词里重复维护事实。
 */
export function defaultSectionPrompt(value: string): string {
  const module = SECTION_MODULES.find((item) => item.value === value);
  if (!module) return '';
  return `${module.label}：${module.desc}。突出商品主体，保持商品外观、材质与颜色与参考图一致。`;
}
