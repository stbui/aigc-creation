import type { PolledOutput, PolledResult } from '../../lib/poll';
import { ALL_SCENES } from './constants';
import type { ToolResult } from './components';
import { taskErrorText } from '../../lib/constants';

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
/** 提示词工具失败文案: 把接口错误码翻译成用户可读文案 */
export { promptToolErrorMessage } from '../../lib/promptToolMessages';
/** 任务失败码 → 用户可读文案 */
export { taskErrorText } from '../../lib/constants';

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

/** 产出 → 结果卡片。 */
export function resultsOf(done: PolledResult): ToolResult[] {
  return outputsOf(done).map((output) => ({
    status: 'succeeded',
    url: output.url,
    width: output.width,
    height: output.height,
    modality: output.modality,
    durationMs: output.durationMs,
  }));
}

export type FusionResultState = 'idle' | 'generating' | 'complete' | 'partial' | 'failed';

export interface FusionResultStatus {
  state: FusionResultState;
  badge: string;
  summary: string;
}

/**
 * 结果面板状态：把「请求几张 / 实际回来几张 / 是否失败」收敛成一份文案。
 *
 * 数量不足不能继续显示成普通成功：用户明明选了 4 张，只回 1 张时必须明确
 * 标为部分成功，并说清还有几张未返回。
 */
export function fusionResultStatusOf(input: {
  submitting: boolean;
  resultCount: number;
  requestedCount: number;
  failed: boolean;
}): FusionResultStatus {
  const requested = Math.max(1, Math.trunc(input.requestedCount) || 1);
  const generated = Math.max(0, Math.trunc(input.resultCount) || 0);
  if (input.submitting) {
    return {
      state: 'generating',
      badge: '生成中',
      summary: `正在生成 ${requested} 张融合变体`,
    };
  }
  if (input.failed && generated === 0) {
    return {
      state: 'failed',
      badge: '失败',
      summary: '生成失败，本次未产出图片',
    };
  }
  if (generated > 0 && generated < requested) {
    return {
      state: 'partial',
      badge: '部分成功',
      summary: `已生成 ${generated} / ${requested} 张，其余 ${requested - generated} 张未返回`,
    };
  }
  if (generated > 0) {
    return {
      state: 'complete',
      badge: '完整成功',
      summary: `已生成 ${generated} / ${requested} 张`,
    };
  }
  return {
    state: 'idle',
    badge: '',
    summary: '完成设置后，生成结果会显示在这里',
  };
}

/** 结果面板失败文案；未知错误码原样显示，避免把真实故障藏成“未知”。 */
export function fusionFailureText(code?: string | null): string {
  if (code === 'EMPTY_OUTPUT') return '模型没有返回可用图片，请重试';
  if (code === 'GENERATE_FAILED') return '生成请求失败，请稍后重试';
  return taskErrorText(code);
}

/** 下载文件名: 序号 + 产出真实扩展名 (缺省 jpg)。 */
export function downloadFilenameOf(index: number, url: string): string {
  const extension = url.split('.').pop()?.split('?')[0] || 'jpg';
  return `multi-fusion-${index + 1}.${extension}`;
}
