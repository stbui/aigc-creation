/**
 * 图片参数合同 → 能力合同的投影工具。
 *
 * 移植自 open-ai-canvas `internal/app/image_parameters.go`：
 *   1. `resolveImageParameterValues` —— 运行期把请求参数按合同校验并补默认值；
 *   2. `imageParameterConstraints` / `publicImageParameters` —— 合同 → 能力选项；
 *   3. `activeImageSizePresets` / `imageSizeOptionConstraint` —— 尺寸预设与档位。
 *
 * 图片参数合同优先于旧的 size / quality / resolution 三元组：只要插件为模型
 * 声明了参数表，路由匹配、价格档选择与后台控件就都读这一份，不再读兼容字段。
 */

import { ModelDomainError, badRequest } from '../domain/json';
import {
  type ImageParameter,
  imageParameterAccepts,
  imageParameterValue,
  isImageParameterEnabled,
} from '../domain/image-parameters';
import { singleImageSizeTier, type ImageSizeConfig, type ImageSizePreset } from '../domain/capability-config';
import type { CapabilityImageSize, OptionConstraint } from './spec-types';

/** 合同里声明过、且当前启用的参数默认值 */
export function imageParameterDefaults(parameters: ImageParameter[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const parameter of parameters) {
    if (!isImageParameterEnabled(parameter)) continue;
    if (parameter.default === undefined || parameter.default === null) continue;
    result[parameter.name] = parameter.default;
  }
  return result;
}

/** 参数合同 → 选项约束（枚举或数值范围，二者只保留其一） */
export function imageParameterConstraints(parameters: ImageParameter[]): Record<string, OptionConstraint> {
  const result: Record<string, OptionConstraint> = {};
  for (const parameter of parameters) {
    if (!isImageParameterEnabled(parameter)) continue;
    const values = [...(parameter.values ?? [])];
    let constraint: OptionConstraint = {
      values,
      min: parameter.min,
      max: parameter.max,
      step: parameter.step,
    };
    if (values.length > 0) {
      constraint = { values };
    } else if (parameter.type === 'boolean') {
      constraint = { values: [false, true] };
    } else if (parameter.type === 'string') {
      constraint = { values: ['*'] };
    } else if (
      (parameter.type === 'number' || parameter.type === 'integer') &&
      (parameter.min === undefined || parameter.max === undefined)
    ) {
      constraint = { values: ['*'] };
    }
    result[parameter.name] = constraint;
  }
  return result;
}

/** 下发到前端的参数合同：内部绑定与编码方式不下发 */
export function publicImageParameters(parameters: ImageParameter[]): ImageParameter[] {
  return parameters.map((parameter) => ({
    ...parameter,
    binding: undefined,
    models: undefined,
    encoding: undefined,
  }));
}

/**
 * 执行侧生效的尺寸预设。
 * 关闭了独立分辨率档的模型只保留单一档位预设 —— 多档且无默认档时不能按数组顺序猜。
 */
export function activeImageSizePresets(image: {
  parameters?: ImageParameter[];
  resolution: { supported: boolean };
  size: ImageSizeConfig;
}): ImageSizePreset[] {
  if (image.parameters === undefined || image.resolution.supported) return image.size.presets ?? [];
  const single = singleImageSizeTier(image as any);
  if (!single.ok) return [];
  return (image.size.presets ?? []).filter((preset) => preset.tier === single.tier);
}

/** 尺寸支持值 → 选项约束：保留可见标准值，并用 `*` 表示允许自定义 */
export function imageSizeOptionConstraint(size: ImageSizeConfig): OptionConstraint {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const raw of size.values ?? []) {
    const value = String(raw ?? '').trim();
    if (value === '' || value === '*' || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  if (size.allowCustom) {
    if (values.length === 0) {
      for (const value of legacyImageSizeValues()) {
        if (seen.has(value)) continue;
        seen.add(value);
        values.push(value);
      }
    }
    values.push('*');
  }
  return { values };
}

/** 尺寸配置 → 能力合同里的尺寸预设（none / 空参数返回 undefined） */
export function capabilityImageSizeFromConfig(size: ImageSizeConfig): CapabilityImageSize | undefined {
  if (!size || !size.parameter || size.parameter === 'none') return undefined;
  const presets = [];
  for (const preset of size.presets ?? []) {
    const tier = String(preset.tier ?? '').trim().toLowerCase();
    const ratio = String(preset.ratio ?? '').trim();
    const value = String(preset.size ?? '').trim();
    if (ratio === '' || value === '') continue;
    presets.push({ size: value, tier, ratio, width: preset.width, height: preset.height });
  }
  return { parameter: size.parameter, allowCustom: size.allowCustom === true, presets };
}

/** 只登记真实存在输入范围（0-0 表示不接受该类型输入） */
export function addInputConstraint(
  inputs: Record<string, { min: number; max: number }>,
  name: string,
  min: number,
  max: number,
): void {
  if (min <= 0 && max <= 0) return;
  inputs[name] = { min, max };
}

/** 旧数据里只存了 `*` 的尺寸能力回填用的基础预设 */
export function legacyImageSizeValues(): string[] {
  return ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '21:9', '9:16', '1024x1024', '1536x1024', '1024x1536'];
}

function imageParameterUnsupportedMessage(parameter: ImageParameter): string {
  let message = `图片参数超出支持范围：${parameter.label}`;
  const values = parameter.values ?? [];
  if (values.length > 0) {
    const shown = values.slice(0, 12).map((value) => String(value));
    message += `；支持值：${shown.join('、')}`;
    if (values.length > shown.length) message += '等';
  } else if (parameter.min !== undefined || parameter.max !== undefined) {
    message += `；范围：${parameter.min ?? '不限'}-${parameter.max ?? '不限'}`;
  }
  if (parameter.default !== undefined && parameter.default !== null) {
    message += `；默认值：${String(parameter.default)}`;
  }
  if (parameter.binding === 'aspectRatio' && parameter.encoding === 'pixels') {
    message += '；若使用比例，按模型声明的 imageSize.presets 选择对应像素尺寸';
  }
  return message;
}

/**
 * 运行期参数校验：未声明的参数一律拒绝，声明过的补默认值并校验取值。
 *
 * 为什么不能「忽略未知参数」：客户端残留字段会把已关闭的参数再次送到上游，
 * 上游报错时表现为「模型不支持」，与真实原因（后台关掉了该参数）不符。
 */
export function resolveImageParameterValues(
  parameters: ImageParameter[],
  values: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const allowed = new Map<string, ImageParameter>();
  const result = imageParameterDefaults(parameters);
  for (const parameter of parameters) {
    if (isImageParameterEnabled(parameter)) allowed.set(parameter.name, parameter);
  }
  for (const [name, raw] of Object.entries(values ?? {})) {
    if (raw === undefined) continue;
    const parameter = allowed.get(name);
    if (!parameter) throw badRequest(`当前图片模型未启用参数：${name}`);
    const value = imageParameterValue(parameter, raw);
    if (!imageParameterAccepts(parameter, value)) {
      throw badRequest(imageParameterUnsupportedMessage(parameter));
    }
    if (value !== null && value !== undefined && value !== '') result[name] = value;
  }
  for (const parameter of parameters) {
    if (!isImageParameterEnabled(parameter) || !parameter.required) continue;
    const value = result[parameter.name];
    if (value === undefined || value === null || value === '') {
      throw badRequest(`请填写图片参数：${parameter.label}`);
    }
  }
  return result;
}

/** 把合同错误重新包装成带字段名的业务错误（用于准入提示） */
export function imageContractError(field: string, caught: unknown): ModelDomainError {
  const message = caught instanceof Error ? caught.message : String(caught);
  return new ModelDomainError(`${field}：${message}`);
}
