/**
 * 能力参数的标量归一与约束比对（纯函数）。
 *
 * 移植自 open-ai-canvas `model_router_capability.go` 的
 * `canonicalCapabilityOptionName` / `matchOptionConstraint` / `normalizedScalar`
 * 等辅助函数。被能力匹配、价格档选择器、前台模型默认参数校验共用 ——
 * 三处必须用**同一套归一规则**，否则「匹配通过但报价选不到档」这类问题
 * 会极难定位。
 */

import { normalizeCapability } from '../domain/capability-config';
import { normalizeVqualityResolution } from '../domain/selector';
import type { OptionConstraint } from './spec-types';

/** 能力参数别名：同一含义只能有一个规范名 */
export function canonicalCapabilityOptionName(value: string): string {
  const name = String(value ?? '').trim();
  switch (name) {
    case 'duration':
      return 'videoSeconds';
    case 'aspectRatio':
      return 'size';
    case 'resolution':
      return 'vquality';
    default:
      return name;
  }
}

/**
 * 按能力类型取规范名。图片模型的参数名来自插件声明，**不做别名替换** ——
 * 否则插件里真实存在的 `aspectRatio` 参数会被改写成 `size` 而找不到。
 */
export function canonicalModelOptionName(capability: string, value: string): string {
  if (normalizeCapability(capability) === 'image') return String(value ?? '').trim();
  return canonicalCapabilityOptionName(value);
}

/** 哪些参数属于该能力维度的「供应线路能力」 */
export function isCapabilityOptionFor(capability: string, name: string): boolean {
  switch (normalizeCapability(capability)) {
    case 'image':
      return ['size', 'quality', 'imageResolution', 'transparentBackground', 'count'].includes(name);
    case 'video':
      return ['size', 'videoSeconds', 'vquality', 'videoGenerateAudio', 'videoWatermark', 'fpsBand'].includes(name);
    case 'audio':
      return ['audioVoice', 'audioFormat', 'audioSpeed', 'audioInstructions'].includes(name);
    case 'text':
      // systemPrompt 是请求内容，不是供应线路能力维度，不能参与路由匹配
      return false;
    default:
      return false;
  }
}

export function isProviderCapabilityOption(name: string): boolean {
  return (
    isCapabilityOptionFor('image', name) ||
    isCapabilityOptionFor('video', name) ||
    isCapabilityOptionFor('audio', name) ||
    isCapabilityOptionFor('text', name)
  );
}

/** 请求参数归一：图片质量/尺寸小写化，视频分辨率统一成 `NNNp` */
export function normalizeModelRequestOption(name: string, value: unknown): unknown {
  const canonicalName = canonicalCapabilityOptionName(name);
  if (canonicalName === 'quality' || canonicalName === 'size' || canonicalName === 'imageResolution') {
    if (typeof value === 'string') return value.trim().toLowerCase();
    return value;
  }
  if (canonicalName !== 'vquality') return value;
  if (typeof value !== 'string') return value;
  return normalizeVqualityResolution(value);
}

/**
 * 判断取值是否表示「未请求该参数」。
 * 空值与图片质量/分辨率的 auto/any 不构成请求；其他非空字符串、true、
 * 非零数字仍视为真实要求。
 */
export function inactiveCapabilityOptionValue(name: string, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized === '') return true;
    return (
      (name === 'quality' || name === 'imageResolution') &&
      (normalized.toLowerCase() === 'auto' || normalized.toLowerCase() === 'any')
    );
  }
  if (typeof value === 'number') return value === 0;
  return false;
}

/** 标量的规范化字符串：跨类型比较（`2` 与 `"2"`、`true` 与 `"true"`）只走这里 */
export function normalizedScalar(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value.trim().toLowerCase();
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return String(value);
    default:
      if (value === undefined || value === null) return '';
      return JSON.stringify(value);
  }
}

/** 取数值标量；非数值返回 null */
export function numericScalar(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 选项值比较：视频分辨率按 `720` / `720p` / `2k` 同一套别名比较 */
export function capabilityOptionValuesEqual(name: string, candidate: unknown, value: unknown): boolean {
  let left = normalizedScalar(candidate);
  let right = normalizedScalar(value);
  if (canonicalCapabilityOptionName(name) === 'vquality') {
    left = normalizedScalar(normalizeModelRequestOption(name, left)).replace(/p$/, '');
    right = normalizedScalar(normalizeModelRequestOption(name, right)).replace(/p$/, '');
  }
  return left === right;
}

/** 单个选项约束是否接受该值 */
export function matchOptionConstraint(name: string, constraint: OptionConstraint, value: unknown): boolean {
  const values = constraint.values ?? [];
  if (values.length > 0) {
    for (const candidate of values) {
      if (normalizedScalar(candidate) === '*') return true;
      if (capabilityOptionValuesEqual(name, candidate, value)) return true;
    }
    return false;
  }
  const number = numericScalar(value);
  if (number === null) return false;
  if (constraint.min !== undefined && number < constraint.min) return false;
  if (constraint.max !== undefined && number > constraint.max) return false;
  if (constraint.step !== undefined && constraint.min !== undefined) {
    const steps = (number - constraint.min) / constraint.step;
    return Math.abs(steps - Math.round(steps)) < 1e-9;
  }
  return true;
}

/** 通配约束（`values: ['*']`）：允许任意自定义值 */
export function isWildcardOptionConstraint(constraint: OptionConstraint | undefined | null): boolean {
  return (constraint?.values ?? []).some((value) => normalizedScalar(value) === '*');
}

export function anyValues(values: string[]): OptionConstraint {
  return { values: [...values] };
}

export function boolValues(supportsTrue: boolean): OptionConstraint {
  return { values: supportsTrue ? [false, true] : [false] };
}

export function numericRange(minimum: number, maximum: number, step: number): OptionConstraint {
  return { min: minimum, max: maximum, step };
}

/* ────────────────────────── 展示文案 ────────────────────────── */

export function capabilityInputLabel(name: string): string {
  switch (String(name ?? '').trim().toLowerCase()) {
    case 'image':
      return '参考图片';
    case 'video':
      return '参考视频';
    case 'audio':
      return '参考音频';
    case 'mask':
      return '蒙版';
    default:
      return name;
  }
}

export function capabilityOptionLabel(name: string): string {
  switch (canonicalCapabilityOptionName(name)) {
    case 'size':
      return '画面尺寸';
    case 'quality':
      return '生成质量';
    case 'imageResolution':
      return '图片分辨率';
    case 'transparentBackground':
      return '透明背景';
    case 'count':
      return '输出数量';
    case 'videoSeconds':
      return '视频时长';
    case 'vquality':
      return '输出分辨率';
    case 'videoGenerateAudio':
      return '同步音频';
    case 'videoWatermark':
      return '水印设置';
    case 'audioVoice':
      return '音色';
    case 'audioFormat':
      return '音频格式';
    case 'audioSpeed':
      return '语速';
    case 'audioInstructions':
      return '朗读指令';
    default:
      return name;
  }
}
