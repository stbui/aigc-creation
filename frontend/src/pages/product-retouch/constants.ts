/**
 * 产品精修页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 6 个精修模式、它们的中文名与参考站模板码必须一一对应: 页面只保存 `mode`,
 * 提交时再翻译成模板码与展示标签。任何一处漏配都会让用户选 A 得到 B,
 * 因此三张表都在这里集中定义。
 *
 * 约定: `product-retouch/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件或 `./components` —— 目录内新增共享常量时在这里补一行。
 */

/** 精修模式选项 (页面单选 pill) */
export const MODE_OPTIONS = [
  { value: 'comprehensive', label: '综合精修' },
  { value: 'texture', label: '质感增强' },
  { value: 'blemish', label: '瑕疵修复' },
  { value: 'color', label: '色彩校正' },
  { value: 'clarity', label: '提升清晰度' },
  { value: 'material', label: '材质强化' },
];

/** 模式 → 中文名 (结果标签用) */
export const MODE_LABEL: Record<string, string> = Object.fromEntries(
  MODE_OPTIONS.map((option) => [option.value, option.label]),
);

/** 参考站 PRODUCT_REFINEMENT 的模板码；本地 mode 与模板码双向对应。 */
export const MODE_TO_TEMPLATE: Record<string, string> = {
  comprehensive: 'IT_PR_COMPREHENSIVE',
  texture: 'IT_PR_TEXTURE',
  blemish: 'IT_PR_DEFECT_REPAIR',
  color: 'IT_PR_COLOR_CORRECTION',
  clarity: 'IT_PR_CLARITY',
  material: 'IT_PR_MATERIAL',
};

/** 补充要求输入上限 (与参考站一致) */
export const NOTE_MAX_LENGTH = 200;
