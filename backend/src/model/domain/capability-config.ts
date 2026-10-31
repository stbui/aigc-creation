/**
 * 渠道模型能力合同（`ChannelModel.capabilityConfigJson`）。
 *
 * 移植自 open-ai-canvas `internal/app/model_capability.go` /
 * `model_capability_validate.go` / `image_parameters.go` 的模型域部分。
 *
 * 三层用途：
 *   1. 保存渠道模型时校验并归一化（本文件）；
 *   2. 价格档选择器校验（`selector.ts` 读 `image.parameters`）；
 *   3. 任务准入与前端控件渲染（P3/P5 读同一份结构）。
 *
 * 原则：**能力合同属于前台/渠道模型，不由供应商隐式决定**。因此这里只做
 * 结构校验与默认值归一化，不猜上游实际行为。
 */

import { badRequest, decodeJson } from './json';
import {
  type ImageParameter,
  isImageParameterEnabled,
  resolveImageParameters,
  validateImageParameters,
} from './image-parameters';

export interface ParameterSupport {
  supported: boolean;
  default?: string;
}

export interface TextReferenceConfig {
  promptMaxChars: number;
  maxImages: number;
  maxImageBytes: number;
  maxVideos: number;
  maxVideoBytes: number;
}

export interface TextCapabilityConfig {
  /** 是否接受上游 SSE 文本流；缺省视为 true（兼容旧配置） */
  streaming?: boolean;
  contextWindowTokens: number;
  maxOutputTokens: number;
  references: TextReferenceConfig;
}

export interface ImageSizePreset {
  tier: string;
  ratio: string;
  size: string;
  width: number;
  height: number;
}

export interface ImageSizeConfig {
  /** 'none' | 'size' | 'aspect_ratio' */
  parameter: string;
  values: string[];
  default: string;
  allowCustom: boolean;
  presets?: ImageSizePreset[];
  defaultTier?: string;
}

export interface ImageQualityConfig {
  supported: boolean;
  values: string[];
  default: string;
}

export interface ImageResolutionConfig {
  supported: boolean;
  values: string[];
  default: string;
}

export interface ImageReferenceConfig {
  promptMaxChars: number;
  maxImages: number;
  maxImageBytes: number;
  maskSupported: boolean;
}

export interface ImageCapabilityConfig {
  parameters?: ImageParameter[];
  references: ImageReferenceConfig;
  size: ImageSizeConfig;
  resolution: ImageResolutionConfig;
  quality: ImageQualityConfig;
  /** 某些协议的 quality 值是分辨率档位（如 Gemini imageSize） */
  resolutionUsesQuality?: boolean;
  transparentBackground: { supported: boolean; default: boolean };
  responseFormat: ParameterSupport;
  outputFormat: ParameterSupport;
  maxOutputs: number;
}

export interface VideoDurationConfig {
  /** 'range' | 'enum' */
  selection: string;
  min?: number;
  max?: number;
  step?: number;
  values?: number[];
  default: number;
}

export interface VideoScreenSpecConfig {
  ratios: string[];
  defaultRatio: string;
  resolutions: string[];
  defaultResolution: string;
}

export interface VideoReferenceConfig {
  promptMaxChars: number;
  minImages: number;
  maxImages: number;
  maxImageBytes: number;
  maxVideos: number;
  maxVideoBytes: number;
  maxVideoDurationSeconds: number;
  maxAudios: number;
  maxAudioBytes: number;
  maxAudioDurationSeconds: number;
}

export interface VideoProcessingConfig {
  /** 'keep_source' | 'user_select' */
  fpsPolicy: string;
  fpsOptions?: number[];
  maxSourceSeconds?: number;
}

export interface VideoCapabilityConfig {
  references: VideoReferenceConfig;
  duration: VideoDurationConfig;
  durationSupported?: boolean;
  ratios: string[];
  defaultRatio: string;
  resolutions: string[];
  defaultResolution: string;
  fixedScreenSpec?: VideoScreenSpecConfig;
  generateAudio: { supported: boolean; default: boolean };
  watermark: { supported: boolean; default: boolean };
  operations: string[];
  defaultOperation: string;
  processing?: VideoProcessingConfig;
}

export interface ModelCapabilityConfig {
  version: number;
  text?: TextCapabilityConfig;
  image?: ImageCapabilityConfig;
  video?: VideoCapabilityConfig;
}

export const VIDEO_PROCESSING_FPS_KEEP_SOURCE = 'keep_source';
export const VIDEO_PROCESSING_FPS_USER_SELECT = 'user_select';
export const DEFAULT_VIDEO_PROCESSING_MAX_SOURCE_SECONDS = 180;

/** 能力类型白名单（audio 暂无协议实现，但结构上允许） */
export function normalizeCapability(value: unknown): string {
  const text = String(value ?? '').trim().toLowerCase();
  return ['text', 'image', 'video', 'audio'].includes(text) ? text : '';
}

export function decodeCapabilityConfig(raw: string | null | undefined): ModelCapabilityConfig | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const value = decodeJson<ModelCapabilityConfig>(text, {} as ModelCapabilityConfig, '模型能力配置');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('模型能力配置必须是 JSON 对象');
  }
  return value;
}

/* ────────────────────────── 通用小工具 ────────────────────────── */

export function containsCapabilityString(values: readonly string[] | undefined, target: string): boolean {
  return (values ?? []).some((value) => String(value) === String(target));
}

function containsInt(values: readonly number[] | undefined, target: number): boolean {
  return (values ?? []).some((value) => value === target);
}

/** 视频模型是否按用户选择的时长执行（缺省视为支持） */
export function videoDurationSupported(value: VideoCapabilityConfig | null | undefined): boolean {
  return !value || value.durationSupported === undefined || value.durationSupported === null || value.durationSupported === true;
}

/* ────────────────────── 图片分辨率档位与预设 ────────────────────── */

export function imageResolutionTier(quality: string): string {
  switch (String(quality ?? '').trim().toLowerCase()) {
    case '1k':
    case 'low':
      return '1k';
    case '1.5k':
      return '1.5k';
    case '2k':
    case 'medium':
      return '2k';
    case '4k':
    case 'high':
      return '4k';
    default:
      return '';
  }
}

function declaredImageResolutionTier(value: string): string {
  const text = String(value ?? '').trim().toLowerCase();
  return ['1k', '1.5k', '2k', '4k'].includes(text) ? text : '';
}

export function singleImageSizeTier(image: ImageCapabilityConfig): { tier: string; ok: boolean } {
  if (image.size.defaultTier) return { tier: image.size.defaultTier, ok: true };
  for (const field of image.parameters ?? []) {
    if (field.name === 'imageResolution' && field.default !== undefined && field.default !== null && String(field.default) !== 'auto') {
      return { tier: String(field.default), ok: true };
    }
  }
  const presets = image.size.presets ?? [];
  for (const preset of presets) {
    if (preset.size === image.size.default) return { tier: preset.tier, ok: true };
  }
  if (presets.length === 0) return { tier: '', ok: true };
  const tier = presets[0].tier;
  return presets.every((preset) => preset.tier === tier) ? { tier, ok: true } : { tier: '', ok: false };
}

export function imagePresetSelectionTier(image: ImageCapabilityConfig, value: string): string {
  if (image.parameters !== undefined) {
    if (image.resolution.supported && containsCapabilityString(image.resolution.values, value)) return value;
    if (!image.resolution.supported) {
      const single = singleImageSizeTier(image);
      if (single.ok) return single.tier;
    }
    return '';
  }
  const declared = declaredImageResolutionTier(value);
  if (declared) return declared;
  if (image.resolution.supported || (image.quality.supported && image.resolutionUsesQuality)) {
    return imageResolutionTier(value);
  }
  for (const quality of image.quality.values ?? []) {
    if (declaredImageResolutionTier(quality)) return imageResolutionTier(value);
  }
  return '';
}

function imagePresetDefaultTier(image: ImageCapabilityConfig): string {
  if (image.resolution.supported) return imagePresetSelectionTier(image, image.resolution.default);
  return imagePresetSelectionTier(image, image.quality.default);
}

function validateImagePresetSelection(image: ImageCapabilityConfig, quality: string, ratio: string): void {
  if (
    image.size.parameter !== 'aspect_ratio' ||
    image.size.allowCustom ||
    (image.size.presets ?? []).length === 0 ||
    ratio === 'auto'
  ) {
    return;
  }
  const tier = imagePresetSelectionTier(image, quality);
  if (!tier) return;
  const matched = (image.size.presets ?? []).some(
    (preset) => preset.tier === tier && preset.ratio === ratio,
  );
  if (!matched) {
    throw badRequest('当前分辨率不支持所选图片宽高比');
  }
}

/* ───────────────────────── 能力配置校验 ───────────────────────── */

export function validateTextCapabilityConfig(value: TextCapabilityConfig): void {
  if (value.contextWindowTokens < 4096 || value.contextWindowTokens > 10000000) {
    throw badRequest('文本模型上下文窗口必须在 4096-10000000 Token 之间');
  }
  if (
    value.maxOutputTokens < 256 ||
    value.maxOutputTokens > 1000000 ||
    value.maxOutputTokens >= value.contextWindowTokens
  ) {
    throw badRequest('文本模型最大输出 Token 必须小于上下文窗口且在 256-1000000 之间');
  }
  if (value.references.promptMaxChars < 1 || value.references.promptMaxChars > 1000000) {
    throw badRequest('提示词最大字符数必须在 1-1000000 之间');
  }
  for (const [name, number] of [
    ['最大图片引用数', value.references.maxImages],
    ['最大视频引用数', value.references.maxVideos],
  ] as Array<[string, number]>) {
    if (number < 0 || number > 100) throw badRequest(`${name}必须在 0-100 之间`);
  }
  if (value.references.maxImageBytes < 0 || value.references.maxVideoBytes < 0) {
    throw badRequest('引用素材大小限制不能小于 0');
  }
}

export function validateImageCapabilityConfig(value: ImageCapabilityConfig): void {
  if (value.responseFormat.supported) {
    const format = String(value.responseFormat.default ?? '').trim().toLowerCase();
    if (!format || format === 'auto') {
      value.responseFormat.default = 'auto';
    } else if (format === 'b64_json' || format === 'url') {
      value.responseFormat.default = format;
    } else {
      throw badRequest('图片响应格式默认值仅支持 auto、b64_json 或 url');
    }
  } else {
    value.responseFormat.default = 'auto';
  }
  if (value.references.promptMaxChars < 1 || value.references.promptMaxChars > 1000000) {
    throw badRequest('提示词最大字符数必须在 1-1000000 之间');
  }
  if (value.references.maxImages < 0 || value.references.maxImages > 100 || value.references.maxImageBytes < 0) {
    throw badRequest('图片引用限制无效');
  }
  if (value.maxOutputs < 1 || value.maxOutputs > 100) {
    throw badRequest('单次图片数量必须在 1-100 之间');
  }
  switch (value.size.parameter) {
    case 'none':
      value.size.values = [];
      value.size.presets = undefined;
      value.size.default = 'auto';
      value.size.allowCustom = false;
      break;
    case 'size':
    case 'aspect_ratio':
      if (value.parameters === undefined && !String(value.size.default ?? '').trim()) {
        throw badRequest('请配置默认图片尺寸或比例');
      }
      if (!value.size.allowCustom && !containsCapabilityString(value.size.values, value.size.default)) {
        throw badRequest('默认图片尺寸必须属于支持值');
      }
      break;
    default:
      throw badRequest('尺寸参数仅支持不发送、size 或 aspect_ratio');
  }
  const seenPresets = new Set<string>();
  for (const preset of value.size.presets ?? []) {
    if (value.parameters === undefined && !['1k', '1.5k', '2k', '4k'].includes(preset.tier)) {
      throw badRequest('图片分辨率档位仅支持 1K、1.5K、2K、4K');
    }
    if (
      value.parameters !== undefined &&
      value.resolution.supported &&
      !containsCapabilityString(value.resolution.values, preset.tier)
    ) {
      throw badRequest('像素映射使用了未启用的分辨率');
    }
    const ratioParts = String(preset.ratio ?? '').split(':');
    if (ratioParts.length !== 2) throw badRequest('图片预设比例格式无效');
    const width = Number(ratioParts[0]);
    const height = Number(ratioParts[1]);
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width > 100000 ||
      height > 100000 ||
      (value.parameters === undefined && Math.max(width, height) > Math.min(width, height) * 3)
    ) {
      throw badRequest('图片预设比例无效');
    }
    if (
      preset.width <= 0 ||
      preset.height <= 0 ||
      Math.max(preset.width, preset.height) > 100000 ||
      preset.size !== `${preset.width}x${preset.height}`
    ) {
      throw badRequest('图片预设像素尺寸无效');
    }
    if (
      value.parameters === undefined &&
      (Math.max(preset.width, preset.height) > 3840 ||
        Math.max(preset.width, preset.height) > Math.min(preset.width, preset.height) * 3 ||
        preset.width * preset.height < 655360 ||
        preset.width * preset.height > 8294400)
    ) {
      throw badRequest('图片预设像素尺寸无效');
    }
    const difference = Math.abs(preset.width * height - preset.height * width);
    if (difference * 1000 > preset.height * width * 25) {
      throw badRequest('图片预设像素尺寸与宽高比不一致');
    }
    let a = width;
    let b = height;
    while (b !== 0) {
      const next = a % b;
      a = b;
      b = next;
    }
    const key = `${preset.tier}:${width / a}:${height / a}`;
    if (seenPresets.has(key)) throw badRequest('图片尺寸预设重复');
    seenPresets.add(key);
    const requestValue = value.size.parameter === 'aspect_ratio' ? preset.ratio : preset.size;
    if (!containsCapabilityString(value.size.values, requestValue)) {
      if (value.size.allowCustom) {
        value.size.values.push(requestValue);
      } else {
        throw badRequest('图片预设必须包含在尺寸支持值中');
      }
    }
  }
  if (value.quality.supported) {
    if (
      value.parameters === undefined &&
      (value.quality.values.length === 0 ||
        !String(value.quality.default ?? '').trim() ||
        !containsCapabilityString(value.quality.values, value.quality.default))
    ) {
      throw badRequest('请配置图片质量支持值和默认值');
    }
  } else {
    value.quality.values = [];
    value.quality.default = 'auto';
  }
  if (value.resolution.supported) {
    if (
      value.parameters === undefined &&
      (value.resolution.values.length === 0 ||
        !String(value.resolution.default ?? '').trim() ||
        !containsCapabilityString(value.resolution.values, value.resolution.default))
    ) {
      throw badRequest('请配置图片分辨率支持值和默认值');
    }
  } else {
    value.resolution.values = [];
    value.resolution.default = 'auto';
  }
  const defaultTier = value.resolution.supported ? value.resolution.default : value.quality.default;
  validateImagePresetSelection(value, defaultTier, value.size.default);
  if (!value.transparentBackground.supported) {
    value.transparentBackground.default = false;
  }
}

export function validateVideoDuration(value: VideoDurationConfig): void {
  switch (value.selection) {
    case 'range': {
      const min = value.min ?? 0;
      const max = value.max ?? 0;
      const step = value.step ?? 0;
      if (
        min < 1 ||
        max < min ||
        max > 3600 ||
        step < 1 ||
        value.default < min ||
        value.default > max ||
        (value.default - min) % step !== 0
      ) {
        throw badRequest('视频时长范围或默认值无效');
      }
      break;
    }
    case 'enum': {
      const values = [...(value.values ?? [])].sort((left, right) => left - right);
      if (values.length === 0 || values.length > 100) {
        throw badRequest('视频固定时长至少需要一个选项');
      }
      values.forEach((item, index) => {
        if (item < 1 || item > 3600 || (index > 0 && values[index - 1] === item)) {
          throw badRequest('视频固定时长选项无效或重复');
        }
      });
      if (!containsInt(values, value.default)) {
        throw badRequest('视频默认时长必须属于固定时长选项');
      }
      break;
    }
    default:
      throw badRequest('视频时长选择方式仅支持范围或固定值');
  }
}

export function validateVideoProcessingConfig(value: VideoProcessingConfig | undefined): void {
  if (!value) return;
  switch (value.fpsPolicy) {
    case VIDEO_PROCESSING_FPS_KEEP_SOURCE:
      if ((value.fpsOptions ?? []).length > 0) throw badRequest('保持原帧率时不能配置可选帧率');
      break;
    case VIDEO_PROCESSING_FPS_USER_SELECT: {
      const options = value.fpsOptions ?? [];
      if (options.length === 0 || options.length > 16) {
        throw badRequest('用户选择帧率时需配置 1-16 个可选帧率');
      }
      const seen = new Set<number>();
      for (const fps of options) {
        if (fps < 15 || fps > 120 || seen.has(fps)) {
          throw badRequest('可选帧率必须在 15-120 之间且不能重复');
        }
        seen.add(fps);
      }
      break;
    }
    default:
      throw badRequest('视频处理帧率策略仅支持保持原帧率或用户选择');
  }
  if ((value.maxSourceSeconds ?? 0) < 0 || (value.maxSourceSeconds ?? 0) > DEFAULT_VIDEO_PROCESSING_MAX_SOURCE_SECONDS) {
    throw badRequest(`源视频时长上限必须在 1-${DEFAULT_VIDEO_PROCESSING_MAX_SOURCE_SECONDS} 秒之间（任务轮询上限为 1 小时）`);
  }
}

export function validateVideoCapabilityConfig(value: VideoCapabilityConfig): void {
  if (value.references.promptMaxChars < 1 || value.references.promptMaxChars > 1000000) {
    throw badRequest('提示词最大字符数必须在 1-1000000 之间');
  }
  for (const [name, number] of [
    ['最少图片引用数', value.references.minImages],
    ['最大图片引用数', value.references.maxImages],
    ['最大视频引用数', value.references.maxVideos],
    ['最大音频引用数', value.references.maxAudios],
  ] as Array<[string, number]>) {
    if (number < 0 || number > 100) throw badRequest(`${name}必须在 0-100 之间`);
  }
  if (value.references.minImages > value.references.maxImages) {
    throw badRequest('最少图片引用数不能超过最大图片引用数');
  }
  if (
    value.references.maxImageBytes < 0 ||
    value.references.maxVideoBytes < 0 ||
    value.references.maxAudioBytes < 0 ||
    value.references.maxVideoDurationSeconds < 0 ||
    value.references.maxAudioDurationSeconds < 0
  ) {
    throw badRequest('引用素材限制不能小于 0');
  }
  validateVideoDuration(value.duration);
  if (value.ratios.length === 0) {
    if (String(value.defaultRatio ?? '').trim()) throw badRequest('未配置画面比例时不能设置默认比例');
  } else if (!String(value.defaultRatio ?? '').trim() || !containsCapabilityString(value.ratios, value.defaultRatio)) {
    throw badRequest('默认画面比例必须属于支持值');
  }
  if (value.resolutions.length === 0) {
    if (String(value.defaultResolution ?? '').trim()) throw badRequest('未配置输出分辨率时不能设置默认分辨率');
  } else if (
    !String(value.defaultResolution ?? '').trim() ||
    !containsCapabilityString(value.resolutions, value.defaultResolution)
  ) {
    throw badRequest('默认输出分辨率必须属于支持值');
  }
  if (
    value.operations.length === 0 ||
    !String(value.defaultOperation ?? '').trim() ||
    !containsCapabilityString(value.operations, value.defaultOperation)
  ) {
    throw badRequest('请至少配置一个生成模式，并选择默认模式');
  }
  validateVideoProcessingConfig(value.processing);
}

/* ───────────────────────── 归一化入口 ───────────────────────── */

const LEGACY_IMAGE_RESOLUTION_TIERS: Record<string, string[]> = {
  'grok-image': ['1k', '2k'],
  'agnes-image': ['1k', '2k', '4k'],
  'km-kemei-seedream': ['1k', '1.5k', '2k'],
};

export function legacyImageResolutionProtocol(protocol: string): boolean {
  return (LEGACY_IMAGE_RESOLUTION_TIERS[String(protocol ?? '').trim()] ?? []).length > 0;
}

/** 旧配置把分辨率档位放在 quality 里；按协议白名单迁移到 resolution */
export function normalizeLegacyImageResolutionConfig(protocol: string, image: ImageCapabilityConfig): void {
  const allowed = LEGACY_IMAGE_RESOLUTION_TIERS[String(protocol ?? '').trim()];
  if (!allowed || image.resolution.supported || !image.quality.supported) return;
  const values: string[] = [];
  for (const raw of image.quality.values ?? []) {
    const value = String(raw ?? '').trim().toLowerCase();
    if (!allowed.includes(value)) return;
    values.push(value);
  }
  const defaultValue = String(image.quality.default ?? '').trim().toLowerCase();
  if (values.length === 0 || !allowed.includes(defaultValue) || !containsCapabilityString(values, defaultValue)) {
    return;
  }
  image.resolution = { supported: true, values, default: defaultValue };
  image.quality = { supported: false, values: [], default: 'auto' };
}

/** 把参数合同投影成 size / resolution / quality / 透明背景 / 最大张数 */
export function projectImageParameters(image: ImageCapabilityConfig): void {
  validateImageParameters(image.parameters);
  image.quality = { supported: false, values: [], default: 'auto' };
  image.resolution = { supported: false, values: [], default: 'auto' };
  image.transparentBackground = { supported: false, default: false };
  image.resolutionUsesQuality = false;
  image.maxOutputs = 1;
  let sizeEnabled = false;
  for (const parameter of image.parameters ?? []) {
    if (!isImageParameterEnabled(parameter)) continue;
    const values = (parameter.values ?? []).map((value) => String(value));
    let initial = 'auto';
    if (parameter.default !== undefined && parameter.default !== null) {
      initial = String(parameter.default);
    } else if (values.length > 0) {
      initial = values[0];
    }
    switch (parameter.name) {
      case 'size':
        sizeEnabled = true;
        image.size.parameter = 'aspect_ratio';
        if (parameter.encoding === 'pixels') {
          image.size.parameter = 'size';
          if (values.some((value) => value.includes(':'))) image.size.parameter = 'aspect_ratio';
        }
        image.size.values = values;
        image.size.default = initial;
        image.size.allowCustom = (parameter.values ?? []).length === 0;
        break;
      case 'imageResolution':
        image.resolution = { supported: true, values, default: initial };
        break;
      case 'quality':
        image.quality = { supported: true, values, default: initial };
        break;
      case 'transparentBackground':
        image.transparentBackground = { supported: true, default: parameter.default === true };
        break;
      case 'count':
        if (parameter.max !== undefined) image.maxOutputs = Math.trunc(parameter.max);
        break;
      default:
        break;
    }
  }
  if (!sizeEnabled) {
    image.size = { parameter: 'none', default: 'auto', values: [], allowCustom: false };
  } else {
    image.size.presets = (image.size.presets ?? []).filter((preset) => {
      const value = image.size.parameter === 'size' ? preset.size : preset.ratio;
      const sizeAllowed = image.size.allowCustom || containsCapabilityString(image.size.values, value);
      const tierAllowed =
        !image.resolution.supported ||
        image.resolution.values.length === 0 ||
        containsCapabilityString(image.resolution.values, preset.tier);
      return sizeAllowed && tierAllowed;
    });
  }
}

export interface NormalizeCapabilityOptions {
  capability: string;
  protocol: string;
  model: string;
  input: ModelCapabilityConfig | null | undefined;
  /**
   * 插件声明的图片参数合同（P2 由协议适配器元数据提供）。
   * 未提供时走旧版 size/resolution/quality 兼容路径。
   */
  imageParameterDefinitions?: ImageParameter[];
}

/**
 * 保存渠道模型时的能力配置归一化。返回 null 表示该能力不需要能力配置（audio）。
 * 校验失败抛 `ModelDomainError`。
 */
export function normalizeModelCapabilityConfig(
  options: NormalizeCapabilityOptions,
): ModelCapabilityConfig | null {
  const capability = normalizeCapability(options.capability);
  if (!['text', 'image', 'video'].includes(capability)) return null;
  const input = options.input;

  if (capability === 'text') {
    if (!input?.text) throw badRequest('请配置文本模型能力参数');
    const text: TextCapabilityConfig = {
      streaming: input.text.streaming ?? true,
      contextWindowTokens: input.text.contextWindowTokens || 128000,
      maxOutputTokens: input.text.maxOutputTokens || 16384,
      references: {
        promptMaxChars: input.text.references?.promptMaxChars ?? 0,
        maxImages: input.text.references?.maxImages ?? 0,
        maxImageBytes: input.text.references?.maxImageBytes ?? 0,
        maxVideos: input.text.references?.maxVideos ?? 0,
        maxVideoBytes: input.text.references?.maxVideoBytes ?? 0,
      },
    };
    validateTextCapabilityConfig(text);
    return { version: 1, text };
  }

  if (capability === 'image') {
    if (!input?.image) throw badRequest('请配置图片模型能力参数');
    const image: ImageCapabilityConfig = {
      ...input.image,
      references: {
        promptMaxChars: input.image.references?.promptMaxChars ?? 0,
        maxImages: input.image.references?.maxImages ?? 0,
        maxImageBytes: input.image.references?.maxImageBytes ?? 0,
        maskSupported: input.image.references?.maskSupported === true,
      },
    };
    if (options.imageParameterDefinitions) {
      image.parameters = resolveImageParameterSubset(options.imageParameterDefinitions, image.parameters, options.model);
      projectImageParameters(image);
    } else if (image.parameters !== undefined) {
      projectImageParameters(image);
    } else {
      normalizeLegacyImageResolutionConfig(options.protocol, image);
    }
    validateImageCapabilityConfig(image);
    return { version: 1, image };
  }

  if (!input?.video) throw badRequest('请配置视频模型能力参数');
  const video: VideoCapabilityConfig = { ...input.video };
  validateVideoCapabilityConfig(video);
  return { version: 1, video };
}

function resolveImageParameterSubset(
  definitions: ImageParameter[],
  configured: ImageParameter[] | undefined,
  model: string,
): ImageParameter[] {
  return resolveImageParameters(definitions, configured, model);
}
