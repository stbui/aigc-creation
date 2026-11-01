import type { PolledOutput, PolledResult } from '../../lib/poll';
import { ALL_SCENES } from './constants';
import type { ToolResult } from './components';

/**
 * 多图融合页面的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定: `multi-image-fusion/` 下的文件不从 `src/lib/*` 直接取东西, 一律经由本文件 ——
 * 页面用到的图片校验、比例 / 画质选项、扣费换算与结果映射集中可见。
 * 目录内新增外部工具引用时在这里补一行 re-export。
 */

/** 上传前的图片格式校验 */
export { isSupportedImageFile } from '../../lib/constants';
/** 比例 / 画质选项 (按能力读取后台下发的参数目录) */
export { ratioOptions, resolutionOptions } from '../../lib/optionSets';
/** 变体计费: 基础价 / 4 × 张数 × 画质倍率 */
export { multiFusionCreditCost } from '../../lib/multiFusionBilling';
/** 任务轮询到终态 */
export { pollToResult, type PolledOutput, type PolledResult } from '../../lib/poll';

/* ------------------------------------------------------------------------- */
/* 场景                                                                      */
/* ------------------------------------------------------------------------- */

/** 场景 value → 中文名; 未知值原样返回, 标题不至于空白。 */
export function sceneLabel(value: string): string {
  return ALL_SCENES.find((scene) => scene.value === value)?.label ?? value;
}

/** 场景卡预览图路径 */
export function sceneImage(value: string): string {
  return `/multi-fusion/scenes/${value}.webp`;
}

/* ------------------------------------------------------------------------- */
/* 提交区文案                                                                */
/* ------------------------------------------------------------------------- */

/**
 * 提交按钮上的价格口径。
 *
 * `null` = 能力清单还没到 (加载中), 此时按钮里**不显示任何价格占位** ——
 * 「加载中…」放在价格位上会被读成价格文案。0 元档显示「免费」。
 */
export function compactCreditLabelOf(cost: number | null): string | null {
  if (cost === null) return null;
  return cost > 0 ? `本次消耗${cost}积分` : '免费';
}

/* ------------------------------------------------------------------------- */
/* 结果                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * 一次任务的全部真实产出。
 *
 * 新后端在 `outputs` 里给 1-4 张变体; 旧后端只有单个 `url`, 退化成一项。
 * 两者都没有时返回空数组, 由页面判「没有可用图片」。
 */
export function outputsOf(done: PolledResult): PolledOutput[] {
  if (done.outputs?.length) return done.outputs;
  return done.url ? [{ url: done.url, width: done.width, height: done.height }] : [];
}

/** 产出 → 结果卡片; `provider` 取本单实际通道 (新任务恒为 gateway)。 */
export function resultsOf(done: PolledResult): ToolResult[] {
  return outputsOf(done).map((output) => ({
    status: 'succeeded',
    url: output.url,
    width: output.width,
    height: output.height,
    modality: output.modality,
    durationMs: output.durationMs,
    provider: done.provider,
  }));
}

/** 下载文件名: 序号 + 产出真实扩展名 (缺省 jpg)。 */
export function downloadFilenameOf(index: number, url: string): string {
  const extension = url.split('.').pop()?.split('?')[0] || 'jpg';
  return `multi-fusion-${index + 1}.${extension}`;
}
