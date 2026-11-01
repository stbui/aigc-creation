/**
 * 一键抠图页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 色板本身的取值 (透明底 / 白 / 浅蓝 / 蓝 / 红 / 深红 / 自定义) 由
 * `ColorStudio` 的 `MATTING_COLOR_SWATCHES` 提供, 经 `./components` 转出;
 * 这里只保留「色值 → 中文名」的展示映射, 结果标签与文案都读它。
 *
 * 约定: `background-remove/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件或 `./components` —— 目录内新增共享常量时在这里补一行。
 */

/** 抠图结果标签用的色值 / 色名 → 中文名 */
export const COLOR_LABEL: Record<string, string> = {
  transparent: '透明底',
  white: '白色',
  'light-blue': '浅蓝',
  blue: '蓝色',
  red: '红色',
  'dark-red': '深红',
  custom: '自定义',
  '#FFFFFF': '白色',
  '#82CEF3': '浅蓝',
  '#3988E9': '蓝色',
  '#FF0B22': '红色',
  '#A8001B': '深红',
};
