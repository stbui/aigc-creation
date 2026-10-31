/**
 * 图片参数合同 —— 渠道模型能力配置里的 `parameters` 字段。
 *
 * 移植自 open-ai-canvas `internal/protocol/image_parameters.go` 与
 * `internal/app/image_parameters.go`。它同时承担三件事：
 *   1. 后台「能力配置」编辑器声明的参数契约（类型/范围/枚举/默认值）；
 *   2. 价格档选择器的合法性校验（只有 `pricing=true` 的参数可以作为选择器键）；
 *   3. 运行期把统一参数投影成 size / resolution / quality 三块兼容配置。
 *
 * 这里不执行任何网络或数据库操作，是纯函数模块。
 */

import { badRequest, ModelDomainError } from './json';

export interface ImageParameter {
  name: string;
  label: string;
  /** 'string' | 'number' | 'integer' | 'boolean' */
  type: string;
  description?: string;
  values?: unknown[];
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  default?: unknown;
  required?: boolean;
  /** 是否参与价格档计价（后台勾选） */
  pricing?: boolean;
  /** 'aspectRatio' | 'resolution' | 'quality' | 'imageCount' | 'transparentBackground' | providerOptions.<x>.<y> */
  binding?: string;
  /** 'pixels' | 'ratio' */
  encoding?: string;
  /** 仅对这些上游模型生效；空 = 全部 */
  models?: string[];
  enabled?: boolean;
}

const IMAGE_PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export function isImageParameterEnabled(parameter: ImageParameter): boolean {
  return parameter.enabled === undefined || parameter.enabled === null || parameter.enabled === true;
}

export function imageParameterAppliesTo(parameter: ImageParameter, model: string): boolean {
  const models = parameter.models ?? [];
  if (models.length === 0) return true;
  const target = String(model ?? '')
    .trim()
    .replace(/^models\//, '');
  return models.includes(target);
}

function imageParameterNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function imageParameterValuesEqual(left: unknown, right: unknown): boolean {
  const leftNumber = imageParameterNumber(left);
  const rightNumber = imageParameterNumber(right);
  if (leftNumber !== null || rightNumber !== null) {
    return leftNumber !== null && rightNumber !== null && leftNumber === rightNumber;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

/** 参数是否接受某个值（与参考实现 `ImageParameter.Accepts` 等价） */
export function imageParameterAccepts(parameter: ImageParameter, value: unknown): boolean {
  if (value === undefined || value === null) return !parameter.required;
  switch (parameter.type) {
    case 'string': {
      if (typeof value !== 'string') return false;
      if ((parameter.maxLength ?? 0) > 0 && [...value].length > (parameter.maxLength ?? 0)) return false;
      break;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') return false;
      break;
    }
    case 'number':
    case 'integer': {
      const number = imageParameterNumber(value);
      if (number === null) return false;
      if (parameter.type === 'integer' && !Number.isInteger(number)) return false;
      if (parameter.min !== undefined && number < parameter.min) return false;
      if (parameter.max !== undefined && number > parameter.max) return false;
      if (parameter.step !== undefined) {
        const base = parameter.min ?? 0;
        const steps = (number - base) / parameter.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-8) return false;
      }
      break;
    }
    default:
      return false;
  }
  const values = parameter.values ?? [];
  if (values.length === 0) return true;
  return values.some((candidate) => imageParameterValuesEqual(candidate, value));
}

/** 字符串形式的选择器值按参数类型转换后再校验 */
export function imageParameterValue(parameter: ImageParameter, value: unknown): unknown {
  if (typeof value !== 'string' || parameter.type === 'string') return value;
  if (parameter.type === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }
  if (parameter.type === 'number' || parameter.type === 'integer') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

function validImageParameterBinding(binding: string): boolean {
  if (
    ['aspectRatio', 'resolution', 'quality', 'imageCount', 'transparentBackground'].includes(binding)
  ) {
    return true;
  }
  const parts = binding.split('.');
  return (
    parts.length === 3 &&
    parts[0] === 'providerOptions' &&
    /^[a-z0-9][a-z0-9._-]*$/.test(parts[1] ?? '') &&
    IMAGE_PARAMETER_NAME.test(parts[2] ?? '')
  );
}

/** 校验插件声明侧的参数合同 */
export function validateImageParameters(parameters: ImageParameter[] | undefined | null): void {
  const seen = new Set<string>();
  const bindings = new Set<string>();
  for (const parameter of parameters ?? []) {
    if (!IMAGE_PARAMETER_NAME.test(parameter.name ?? '') || seen.has(parameter.name)) {
      throw new ModelDomainError(`图片参数名无效或重复：${parameter.name}`);
    }
    seen.add(parameter.name);
    if (!String(parameter.label ?? '').trim()) {
      throw new ModelDomainError(`图片参数缺少名称：${parameter.name}`);
    }
    if (
      parameter.encoding &&
      (parameter.binding !== 'aspectRatio' ||
        (parameter.encoding !== 'pixels' && parameter.encoding !== 'ratio'))
    ) {
      throw new ModelDomainError(`图片参数 ${parameter.name} 的 encoding 无效`);
    }
    if (!['string', 'number', 'integer', 'boolean'].includes(parameter.type)) {
      throw new ModelDomainError(`图片参数 ${parameter.name} 的类型不受支持：${parameter.type}`);
    }
    if (
      (parameter.min !== undefined && !Number.isFinite(parameter.min)) ||
      (parameter.max !== undefined && !Number.isFinite(parameter.max)) ||
      (parameter.min !== undefined && parameter.max !== undefined && parameter.min > parameter.max) ||
      (parameter.step !== undefined && (!Number.isFinite(parameter.step) || parameter.step <= 0)) ||
      (parameter.maxLength ?? 0) < 0
    ) {
      throw new ModelDomainError(`图片参数 ${parameter.name} 的取值范围无效`);
    }
    if (parameter.binding) {
      if (!validImageParameterBinding(parameter.binding) || bindings.has(parameter.binding)) {
        throw new ModelDomainError(`图片参数 ${parameter.name} 的 binding 无效或重复`);
      }
      bindings.add(parameter.binding);
    }
    for (const value of parameter.values ?? []) {
      const constraint: ImageParameter = { ...parameter, values: undefined };
      if (!imageParameterAccepts(constraint, value)) {
        throw new ModelDomainError(`图片参数 ${parameter.name} 存在无效枚举值`);
      }
    }
    if (parameter.default !== undefined && parameter.default !== null && !imageParameterAccepts(parameter, parameter.default)) {
      throw new ModelDomainError(`图片参数 ${parameter.name} 的默认值超出约束`);
    }
  }
}

/**
 * 只接受渠道可编辑的限制（启用与否、可选值），标签/类型/pricing/binding
 * 永远来自插件声明 —— 否则后台可以把「不计价」的参数改成计价参数。
 */
export function resolveImageParameters(
  definitions: ImageParameter[] | undefined | null,
  configured: ImageParameter[] | undefined | null,
  model: string,
): ImageParameter[] {
  validateImageParameters(definitions);
  const settings = new Map<string, ImageParameter>();
  for (const parameter of configured ?? []) {
    if (settings.has(parameter.name)) {
      throw new ModelDomainError(`图片参数重复：${parameter.name}`);
    }
    settings.set(parameter.name, parameter);
  }
  const result: ImageParameter[] = [];
  for (const definition of definitions ?? []) {
    if (!imageParameterAppliesTo(definition, model)) continue;
    const parameter: ImageParameter = { ...definition };
    const setting = settings.get(parameter.name);
    if (setting) {
      parameter.enabled = setting.enabled;
      if (!isImageParameterEnabled(parameter) && parameter.required) {
        throw new ModelDomainError(`${parameter.label} 为必填参数，不能关闭`);
      }
      if (setting.values) {
        for (const value of setting.values) {
          if (!imageParameterAccepts(definition, value)) {
            throw new ModelDomainError(`${parameter.label} 的值超出插件约束`);
          }
        }
        if (setting.values.length === 0 && (definition.values ?? []).length > 0 && isImageParameterEnabled(parameter)) {
          throw new ModelDomainError(`${parameter.label} 需要至少一个可选值`);
        }
        parameter.values = setting.values;
      }
    }
    result.push(parameter);
  }
  return result;
}

/** 价格档选择器校验：只允许启用且 pricing=true 的参数作为键 */
export function validateImageParameterPriceSelector(
  parameters: ImageParameter[] | undefined | null,
  selector: Record<string, string>,
): void {
  const allowed = new Map<string, ImageParameter>();
  for (const parameter of parameters ?? []) {
    if (isImageParameterEnabled(parameter) && parameter.pricing) {
      allowed.set(parameter.name, parameter);
    }
  }
  for (const [name, value] of Object.entries(selector)) {
    if (name === 'operation') {
      if (!['text_to_image', 'image_to_image', '', '*'].includes(value)) {
        throw badRequest('图片价格生成方式无效');
      }
      continue;
    }
    const parameter = allowed.get(name);
    if (!parameter) {
      throw badRequest(`当前图片模型未声明此计价参数：${name}`);
    }
    if (!value || value === '*') continue;
    if (!imageParameterAccepts(parameter, imageParameterValue(parameter, value))) {
      throw badRequest(`价格档参数不在支持范围内：${parameter.label}`);
    }
  }
}

/** 计算宽高比的最简整数比；不合法返回空串 */
export function normalizeImageAspectRatio(value: string): string {
  let text = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/×/g, 'x');
  if (text.includes(':')) {
    const [left, right] = text.split(':');
    const width = Number(left);
    const height = Number(right);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      return '';
    }
    const divisor = imageDimensionGCD(width, height);
    return `${width / divisor}:${height / divisor}`;
  }
  const parts = text.split('x');
  if (parts.length !== 2) return '';
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return '';
  }
  const divisor = imageDimensionGCD(width, height);
  return `${width / divisor}:${height / divisor}`;
}

export function imageDimensionGCD(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a < 1 ? 1 : a;
}
