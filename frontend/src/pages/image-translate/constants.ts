/**
 * 图片翻译页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 目标语言清单不在这里: 它来自能力参数目录 (`lib/optionSets`), 经 `./utils`
 * 转出。这里只保留页面自己的默认值与字段名口径。
 *
 * 约定: `image-translate/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件或 `./components` —— 目录内新增共享常量时在这里补一行。
 */

/** 默认目标语言: 简体中文 (与参考站首项一致) */
export const DEFAULT_TARGET_LANG = 'zh-CN';
