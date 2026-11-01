/**
 * 商品换色页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 色板取值由 `ColorStudio` 的 `RECOLOR_COLOR_SWATCHES` 提供, 经 `./components`
 * 转出; 这里只保留「色值 → 中文名」的展示映射, 结果标签读它。
 *
 * 约定: `product-recolor/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件或 `./components` —— 目录内新增共享常量时在这里补一行。
 */

/** 商品颜色的色值 / 自定义 → 中文名 */
export const COLOR_LABEL: Record<string, string> = {
  '#FFFFFF': '白色',
  '#82CEF3': '浅蓝',
  '#3988E9': '蓝色',
  '#FF0B22': '红色',
  '#A8001B': '深红',
  custom: '自定义',
};
