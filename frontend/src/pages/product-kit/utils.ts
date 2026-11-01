import { VARIANT_LABELS } from './constants';

/**
 * 商品主图工作台页面的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定: `product-kit/` 下的文件不从 `src/lib/*` 直接取东西, 一律经由本文件 ——
 * 页面用到的选项集、轮询与错误文案集中可见, 换实现只改一处。
 * 目录内新增外部工具引用时在这里补一行 re-export。
 */

/** 任务错误码 → 用户可读文案 */
export { taskErrorText } from '../../lib/constants';
/** 平台 / 语言 / 平台规格（读自后端能力清单） */
export { languageOptions, platformOptions, platformSpec } from '../../lib/optionSets';
/** 任务轮询到终态 */
export { pollToResult } from '../../lib/poll';

/**
 * 任务参数里的变体 → 中文标签。
 *
 * 后端定义在 `definitions/param-options.ts` 的 `MAIN_IMAGE_VARIANTS`,
 * 这里的 `VARIANT_LABELS` 与之一一对应; 认不出的变体原样显示, 不吞掉信息。
 */
export function variantCaption(params: Record<string, unknown>): string | undefined {
  const v = params?.variant;
  return typeof v === 'string' ? (VARIANT_LABELS[v] ?? v) : undefined;
}
