import type { CapabilityParam } from './constants';
import { taskErrorText as genericTaskErrorText } from '../../lib/constants';

/**
 * 图生视频页面的纯函数与外部工具入口。
 *
 * 本目录内的组件不从 `lib/*` 直接取工具；需要跨目录复用的格式化能力在这里
 * 统一转出，页面与组件只依赖本文件。
 */

/** 表单值统一按字符串保存，提交前再按能力参数类型转换。 */
export type VideoParamValues = Record<string, string>;

/** 把能力参数默认值转成表单字符串；未知类型不影响页面渲染。 */
export function videoParamDefaults(params: readonly CapabilityParam[]): VideoParamValues {
  return Object.fromEntries(
    params
      .filter((param) => !param.hidden && param.default !== undefined)
      .map((param) => [param.key, String(param.default)]),
  );
}

/** 当前能力可渲染的枚举参数（隐藏参数不进入用户表单）。 */
export function videoEnumParams(params: readonly CapabilityParam[]): CapabilityParam[] {
  return params.filter((param) => !param.hidden && param.type === 'enum');
}

/** 当前能力可渲染的文本参数。 */
export function videoTextParams(params: readonly CapabilityParam[]): CapabilityParam[] {
  return params.filter((param) => !param.hidden && param.type === 'text');
}

/**
 * 表单是否具备提交条件。
 *
 * - 能力参数尚未加载时返回 false，避免按前端臆造的默认值提交；
 * - 枚举参数必须有值，且值必须仍在该参数下发的选项内；
 * - 文本参数（包括动态描述）允许为空，与后端 `prompt` 选填契约一致。
 */
export function isVideoFormReady(
  params: readonly CapabilityParam[],
  values: VideoParamValues,
): boolean {
  if (params.length === 0) return false;
  return params
    .filter((param) => !param.hidden)
    .every((param) => {
      if (param.type !== 'enum') return true;
      const value = values[param.key];
      if (!value) return false;
      if (!param.options?.length) return true;
      return param.options.some((option) => String(option.value) === value);
    });
}

/** 枚举值 → 后端下发的中文标签；找不到时回退原值，避免结果信息空白。 */
export function videoOptionLabel(
  param: CapabilityParam | undefined,
  value: string | undefined,
): string {
  if (!param || !value) return '';
  return String(param.options?.find((option) => String(option.value) === value)?.label ?? value);
}

/** 结果卡 / 就绪态使用的参数摘要，只展示用户可感知的枚举参数。 */
export function videoConfigSummary(
  params: readonly CapabilityParam[],
  values: VideoParamValues,
): string[] {
  return videoEnumParams(params)
    .map((param) => videoOptionLabel(param, values[param.key]))
    .filter(Boolean);
}

/**
 * 按能力清单中的参数声明构造提交 payload。
 *
 * 只提交清单中声明的字段，避免把 UI 临时状态带给后端；文本参数去掉首尾空白，
 * 但 **空 `prompt` 仍会保留** —— 图生视频允许不写动态描述。
 */
export function buildImageToVideoPayload(
  params: readonly CapabilityParam[],
  values: VideoParamValues,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const param of params) {
    if (param.hidden) continue;
    const raw = values[param.key];
    if (raw === undefined) continue;
    if (param.type === 'text') {
      payload[param.key] = raw.trim();
      continue;
    }
    if (param.type === 'number') {
      const numeric = Number(raw);
      payload[param.key] = Number.isFinite(numeric) ? numeric : raw;
      continue;
    }
    if (param.type === 'boolean') {
      payload[param.key] = raw === 'true';
      continue;
    }
    payload[param.key] = raw;
  }
  return payload;
}

/** 视频结果文件大小、长度等展示格式从共享组件统一转出。 */
export { formatDuration } from '../../components/ResultMedia';

/**
 * 视频任务错误码 → 用户可读文案。
 *
 * 共享错误映射里有若干文案按图片任务写成「未生成图片」；视频页直接复用会
 * 让失败原因与产出类型矛盾。这里只校正产出名词，不改变错误码与退款口径。
 */
export function videoTaskErrorText(code?: string | null): string {
  return genericTaskErrorText(code).replace(/图片/g, '视频');
}
