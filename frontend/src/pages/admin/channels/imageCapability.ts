/**
 * 图片能力参数的纯数据处理。
 *
 * 后台只允许改协议声明参数的 `enabled` / `values`；标签、类型、范围、默认值
 * 和 binding 都来自协议目录。这里负责把编辑态序列化回后端已有的
 * `capabilityConfig` JSON，不改变保存接口。
 */

import type { ImageParameterDefinitionView } from '../../../types/imageCapability';

export type { ImageParameterDefinitionView } from '../../../types/imageCapability';

export interface ImageParameterSettingView {
  name: string;
  enabled: boolean;
  values?: unknown[];
}

export interface ImageReferenceConfigView {
  promptMaxChars: number;
  maxImages: number;
  maxImageBytes: number;
  maskSupported: boolean;
}

export interface ImageSizeConfigView {
  parameter: string;
  values: string[];
  default: string;
  allowCustom: boolean;
  presets?: Array<Record<string, unknown>>;
  defaultTier?: string;
}

export interface ImageValueConfigView {
  supported: boolean;
  values: string[];
  default: string;
}

export interface ImageSupportConfigView {
  supported: boolean;
  default?: string;
}

export interface ImageCapabilityConfigView {
  parameters?: ImageParameterSettingView[];
  references: ImageReferenceConfigView;
  size: ImageSizeConfigView;
  resolution: ImageValueConfigView;
  quality: ImageValueConfigView;
  resolutionUsesQuality?: boolean;
  transparentBackground: { supported: boolean; default: boolean };
  responseFormat: ImageSupportConfigView;
  outputFormat: ImageSupportConfigView;
  maxOutputs: number;
}

type JsonRecord = Record<string, unknown>;

const MEGABYTE = 1024 * 1024;

export const DEFAULT_IMAGE_REFERENCE_CONFIG: ImageReferenceConfigView = {
  promptMaxChars: 4000,
  maxImages: 4,
  maxImageBytes: 20 * MEGABYTE,
  maskSupported: false,
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function normalizeModelKey(value: string): string {
  return String(value ?? '').trim().replace(/^models\//, '');
}

function parameterAppliesTo(parameter: ImageParameterDefinitionView, model: string): boolean {
  const scopedModels = (parameter.models ?? []).map(normalizeModelKey).filter(Boolean);
  const target = normalizeModelKey(model);
  return scopedModels.length === 0 || !target || scopedModels.includes(target);
}

export function imageParameterValuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' || typeof right === 'number') {
    return Number(left) === Number(right);
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function configuredParameters(value: unknown): ImageParameterSettingView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== 'string' || !item.name.trim()) return [];
    return [
      {
        name: item.name,
        enabled: booleanValue(item.enabled, true),
        ...(Array.isArray(item.values) ? { values: item.values } : {}),
      },
    ];
  });
}

/** 把插件定义与已保存设置合并成编辑态参数表；后台不允许改写插件元信息。 */
export function resolveParameterSettings(
  definitions: ImageParameterDefinitionView[],
  configured: unknown,
  model: string,
): ImageParameterSettingView[] {
  const configuredByName = new Map(configuredParameters(configured).map((item) => [item.name, item]));
  return definitions
    .filter((definition) => parameterAppliesTo(definition, model))
    .map((definition) => {
      const saved = configuredByName.get(definition.name);
      const values = saved?.values ?? definition.values;
      return {
        name: definition.name,
        enabled: saved?.enabled ?? definition.enabled ?? true,
        ...(values !== undefined ? { values: [...values] } : {}),
      };
    });
}

interface ProjectedImageFields {
  size: ImageSizeConfigView;
  resolution: ImageValueConfigView;
  quality: ImageValueConfigView;
  transparentBackground: { supported: boolean; default: boolean };
  maxOutputs: number;
}

/** 与后端 `projectImageParameters` 保持同一套派生规则。 */
function projectParameterSettings(
  definitions: ImageParameterDefinitionView[],
  settings: ImageParameterSettingView[],
): ProjectedImageFields {
  const definitionByName = new Map(definitions.map((item) => [item.name, item]));
  let size: ImageSizeConfigView = {
    parameter: 'none',
    values: [],
    default: 'auto',
    allowCustom: false,
  };
  let resolution: ImageValueConfigView = { supported: false, values: [], default: 'auto' };
  let quality: ImageValueConfigView = { supported: false, values: [], default: 'auto' };
  let transparentBackground = { supported: false, default: false };
  let maxOutputs = 1;

  for (const setting of settings) {
    if (!setting.enabled) continue;
    const definition = definitionByName.get(setting.name);
    if (!definition) continue;
    const values = (setting.values ?? []).map(String);
    const initial =
      definition.default !== undefined && definition.default !== null
        ? String(definition.default)
        : (values[0] ?? 'auto');
    switch (definition.name) {
      case 'size':
        size = {
          parameter:
            definition.encoding === 'pixels' && !values.some((value) => value.includes(':'))
              ? 'size'
              : 'aspect_ratio',
          values,
          default: initial,
          allowCustom: (setting.values ?? []).length === 0,
        };
        break;
      case 'imageResolution':
        resolution = { supported: true, values, default: initial };
        break;
      case 'quality':
        quality = { supported: true, values, default: initial };
        break;
      case 'transparentBackground':
        transparentBackground = { supported: true, default: definition.default === true };
        break;
      case 'count':
        maxOutputs = definition.max !== undefined ? Math.trunc(definition.max) : 1;
        break;
      default:
        break;
    }
  }
  return { size, resolution, quality, transparentBackground, maxOutputs };
}

function normalizeSupport(value: unknown, fallbackDefault = 'auto'): ImageSupportConfigView {
  const record = isRecord(value) ? value : {};
  return {
    supported: booleanValue(record.supported, false),
    default: stringValue(record.default, fallbackDefault),
  };
}

/** 把任意历史合同归一成编辑器需要的完整形状，未知扩展字段会保留。 */
export function normalizeImageCapabilityConfig(
  value: unknown,
  definitions: ImageParameterDefinitionView[],
  model: string,
): ImageCapabilityConfigView {
  const image = isRecord(value) ? value : {};
  const references = isRecord(image.references) ? image.references : {};
  const size = isRecord(image.size) ? image.size : {};
  const settings = resolveParameterSettings(definitions, image.parameters, model);
  const projected = projectParameterSettings(definitions, settings);
  const presets = Array.isArray(size.presets)
    ? size.presets.filter((item): item is Record<string, unknown> => isRecord(item))
    : undefined;

  return {
    ...image,
    parameters: settings,
    references: {
      promptMaxChars: numberValue(
        references.promptMaxChars,
        DEFAULT_IMAGE_REFERENCE_CONFIG.promptMaxChars,
      ),
      maxImages: numberValue(references.maxImages, DEFAULT_IMAGE_REFERENCE_CONFIG.maxImages),
      maxImageBytes: numberValue(
        references.maxImageBytes,
        DEFAULT_IMAGE_REFERENCE_CONFIG.maxImageBytes,
      ),
      maskSupported: booleanValue(references.maskSupported, false),
    },
    size: {
      ...projected.size,
      ...(presets ? { presets } : {}),
      ...(typeof size.defaultTier === 'string' ? { defaultTier: size.defaultTier } : {}),
    },
    resolution: { ...projected.resolution },
    quality: { ...projected.quality },
    resolutionUsesQuality: false,
    transparentBackground: { ...projected.transparentBackground },
    responseFormat: normalizeSupport(image.responseFormat),
    outputFormat: normalizeSupport(image.outputFormat),
    maxOutputs: projected.maxOutputs,
  };
}

export function createDefaultImageCapabilityConfig(
  definitions: ImageParameterDefinitionView[],
  model = '',
): ImageCapabilityConfigView {
  return normalizeImageCapabilityConfig(null, definitions, model);
}

export function createDefaultImageCapabilityConfigJson(
  definitions: ImageParameterDefinitionView[],
  model = '',
): string {
  return JSON.stringify(
    { version: 1, image: createDefaultImageCapabilityConfig(definitions, model) },
    null,
    2,
  );
}

/** 读取现有图片合同；留空或结构缺失返回 null，由调用方生成协议默认值。 */
export function readImageCapabilityConfig(raw: string): ImageCapabilityConfigView | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  try {
    const document = JSON.parse(text) as unknown;
    if (!isRecord(document) || !isRecord(document.image)) return null;
    return document.image as unknown as ImageCapabilityConfigView;
  } catch {
    return null;
  }
}

/** 保留合同中的其它字段，仅替换 image。 */
export function serializeImageCapabilityConfig(
  raw: string,
  image: ImageCapabilityConfigView,
): string {
  let document: JsonRecord = {};
  try {
    const parsed = JSON.parse(String(raw ?? '').trim() || '{}') as unknown;
    if (isRecord(parsed)) document = parsed;
  } catch {
    document = {};
  }
  return JSON.stringify({ ...document, version: 1, image }, null, 2);
}

/** 更新单个参数设置，并同步派生 size / resolution / quality / maxOutputs。 */
export function updateImageParameterSettings(
  image: ImageCapabilityConfigView,
  definitions: ImageParameterDefinitionView[],
  settings: ImageParameterSettingView[],
): ImageCapabilityConfigView {
  const projected = projectParameterSettings(definitions, settings);
  return {
    ...image,
    parameters: settings,
    ...projected,
    size: {
      ...projected.size,
      ...(image.size.presets ? { presets: image.size.presets } : {}),
      ...(image.size.defaultTier ? { defaultTier: image.size.defaultTier } : {}),
    },
  };
}

/** 切换参数启用态；必填参数始终保留启用，防止前端做出后端必拒的配置。 */
export function setImageParameterEnabled(
  image: ImageCapabilityConfigView,
  definitions: ImageParameterDefinitionView[],
  name: string,
  enabled: boolean,
  model = '',
): ImageCapabilityConfigView {
  const definition = definitions.find((item) => item.name === name);
  if (enabled === false && definition?.required) return image;
  const settings = resolveParameterSettings(definitions, image.parameters, model).map((setting) =>
    setting.name === name ? { ...setting, enabled } : setting,
  );
  return updateImageParameterSettings(image, definitions, settings);
}

/** 切换参数可选值；已有枚举的启用参数不能清空，否则后端保存会失败。 */
export function setImageParameterValues(
  image: ImageCapabilityConfigView,
  definitions: ImageParameterDefinitionView[],
  name: string,
  values: unknown[],
  model = '',
): ImageCapabilityConfigView {
  const definition = definitions.find((item) => item.name === name);
  if (definition && (definition.values ?? []).length > 0 && values.length === 0) return image;
  const settings = resolveParameterSettings(definitions, image.parameters, model);
  const current = settings.find((setting) => setting.name === name)?.values ?? [];
  if (
    definition?.default !== undefined &&
    definition.default !== null &&
    current.some((item) => imageParameterValuesEqual(item, definition.default)) &&
    !values.some((item) => imageParameterValuesEqual(item, definition.default))
  ) {
    return image;
  }
  const nextSettings = settings.map((setting) =>
    setting.name === name ? { ...setting, values } : setting,
  );
  return updateImageParameterSettings(image, definitions, nextSettings);
}

function contains(values: string[], target: string): boolean {
  return values.includes(target);
}

/**
 * 前端可执行的合同校验，与后端保存期规则保持关键约束一致。
 * 参数自身的插件约束由后端继续兜底。
 */
export function validateImageCapabilityConfigJson(raw: string): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return '请配置图片模型能力参数';
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return '能力合同不是合法 JSON';
  }
  if (!isRecord(document) || !isRecord(document.image)) return '请配置图片模型能力参数';
  const image = document.image;
  const references = isRecord(image.references) ? image.references : null;
  if (!references) return '请配置图片引用限制';
  const promptMaxChars = numberValue(references.promptMaxChars, 0);
  const maxImages = numberValue(references.maxImages, -1);
  const maxImageBytes = numberValue(references.maxImageBytes, -1);
  if (promptMaxChars < 1 || promptMaxChars > 1_000_000) {
    return '提示词最大字符数必须在 1-1000000 之间';
  }
  if (maxImages < 0 || maxImages > 100) return '最大参考图数必须在 0-100 之间';
  if (maxImageBytes < 0) return '参考图体积上限不能小于 0';

  const maxOutputs = numberValue(image.maxOutputs, 0);
  if (maxOutputs < 1 || maxOutputs > 100) return '单次图片数量必须在 1-100 之间';
  const parameters = image.parameters;
  if (parameters !== undefined && !Array.isArray(parameters)) return '图片参数必须是数组';
  const size = isRecord(image.size) ? image.size : null;
  if (!size || !['none', 'size', 'aspect_ratio'].includes(String(size.parameter))) {
    return '尺寸参数仅支持不发送、size 或 aspect_ratio';
  }
  if (
    size.parameter !== 'none' &&
    size.allowCustom !== true &&
    !contains(stringArray(size.values), stringValue(size.default, ''))
  ) {
    return '默认图片尺寸必须属于支持值';
  }
  for (const [label, config] of [
    ['分辨率', image.resolution],
    ['质量', image.quality],
  ] as Array<[string, unknown]>) {
    if (!isRecord(config) || config.supported !== true) continue;
    const values = stringArray(config.values);
    const defaultValue = stringValue(config.default, '');
    if (parameters === undefined && (values.length === 0 || !values.includes(defaultValue))) {
      return `图片${label}支持值和默认值不完整`;
    }
  }
  const responseFormat = isRecord(image.responseFormat) ? image.responseFormat : null;
  if (!responseFormat) return '请配置图片响应格式';
  if (
    responseFormat.supported === true &&
    !['auto', 'b64_json', 'url'].includes(String(responseFormat.default ?? 'auto'))
  ) {
    return '图片响应格式默认值仅支持 auto、b64_json 或 url';
  }
  const names = new Set<string>();
  for (const parameter of parameters ?? []) {
    if (!isRecord(parameter) || typeof parameter.name !== 'string' || !parameter.name) {
      return '图片参数缺少名称';
    }
    if (names.has(parameter.name)) return `图片参数重复：${parameter.name}`;
    names.add(parameter.name);
    if (parameter.values !== undefined && !Array.isArray(parameter.values)) {
      return `图片参数 ${parameter.name} 的可选值必须是数组`;
    }
  }
  return null;
}
