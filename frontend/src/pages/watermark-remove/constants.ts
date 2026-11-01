/**
 * 去除水印页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 画布缩放的三档边界必须是页面按钮、键盘快捷键与 `WatermarkMaskEditor`
 * 的共同事实源: 按钮点一下、按一次 `+`、拖一次滚轮都必须落在同一区间内，
 * 否则同一个缩放值会因入口不同而被夹到不同结果。
 *
 * 约定: `watermark-remove/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件或 `./components` —— 目录内新增共享常量时在这里补一行。
 */

/** 画布缩放下限 (%) */
export const ZOOM_MIN = 70;
/** 画布缩放上限 (%) */
export const ZOOM_MAX = 140;
/** 每次缩放步进 (%) */
export const ZOOM_STEP = 10;
/** 初始 / 复位后的缩放 (%) */
export const ZOOM_DEFAULT = 100;
