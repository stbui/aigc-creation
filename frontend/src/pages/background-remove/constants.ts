/**
 * 一键抠图的选项表 —— 目录内文件的唯一常量入口。
 *
 * 色板取值统一定义在 `src/lib/colorPalette`（抠图 / 换色 / 人工修图共用）,
 * 这里只做本目录的转出: 页面从 `./constants` 取, 不直连 `src/lib`。
 *
 * 约定: `background-remove/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件或 `./components` —— 目录内新增共享常量时在这里补一行。
 */

/** 背景色色板: 透明底 + 五个预设色, value 是后端认识的色名 */
export { DEFAULT_CUSTOM_COLOR, MATTING_COLOR_SWATCHES } from '../../lib/colorPalette';
