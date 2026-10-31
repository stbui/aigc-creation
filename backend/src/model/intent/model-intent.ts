/**
 * 请求意图归一：把「用户点了什么」变成匹配、计价、选路共用的唯一意图。
 *
 * 移植自 open-ai-canvas：
 *   · `internal/app/model_router_capability.go` 的 `resolveModelRequestIntent` / `normalizeImageSizeIntent`
 *   · `internal/app/model_router.go` 的 `skuSelectorForIntent` 与图片档位换算
 *
 * 两件事必须在这里收敛：
 *   1. 图片尺寸口径 —— 公开意图按比例表达，线路执行可能按像素；两者只靠
 *      当前规格声明的 presets 互为别名，**不做宽高数值猜测**；
 *   2. 价格档选择器 —— 路由选档与报价算钱读同一份，否则「匹配通过但报价
 *      选不到档」会变成偶发差异。
 */

import {
  imageDimensionGCD,
  normalizeImageAspectRatio,
} from '../domain/image-parameters';
import { isImageResolutionTier, normalizeTierResolution } from '../domain/selector';
import { normalizeCapability } from '../domain/capability-config';
import { badRequest } from '../domain/json';
import {
  canonicalModelOptionName,
  normalizeModelRequestOption,
  normalizedScalar,
} from './option-values';
import type {
  CapabilityImageSizePreset,
  CapabilitySpec,
  ModelRequestIntent,
} from './spec-types';

/** 画质增强任务的 operation，前后端与价格档共用 */
export const VIDEO_PROCESSING_OPERATION_ENHANCE = 'enhance';

/* ────────────────────────── 图片档位换算 ────────────────────────── */

/** Seedream 5.0 官方 1.5K 尺寸：像素在 2.36M 附近，会被通用阈值误判成 2K */
const SEEDREAM_15K_SIZES = new Set([
  '1536x1536',
  '2048x1152',
  '1152x2048',
  '1792x1344',
  '1344x1792',
  '1872x1248',
  '1248x1872',
  '2352x1008',
]);

/** 像素尺寸 → 价格档位；5M 上限覆盖含 1.5K 的 Seedream 2K 尺寸 */
export function imageResolutionTierForSize(width: number, height: number): string {
  if (SEEDREAM_15K_SIZES.has(`${width}x${height}`)) return '1.5k';
  const pixels = width * height;
  if (pixels <= 2_000_000) return '1k';
  if (pixels <= 5_000_000) return '2k';
  if (pixels <= 8_294_400) return '4k';
  return '';
}

function parseImageSize(rawSize: string): { width: number; height: number } | null {
  const parts = String(rawSize ?? '').trim().toLowerCase().split('x');
  if (parts.length !== 2) return null;
  const width = Number(parts[0].trim());
  const height = Number(parts[1].trim());
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  if (width * height > 0xffffffff) return null;
  return { width, height };
}

/** 质量字段优先；缺省或 auto/any 时按尺寸像素推断档位 */
export function normalizeImagePriceQuality(rawQuality: unknown, rawSize: unknown): string {
  const quality = String(rawQuality ?? '').trim().toLowerCase();
  if (quality !== '' && quality !== 'auto' && quality !== 'any') return quality;
  const parsed = parseImageSize(String(rawSize ?? ''));
  if (!parsed) return '';
  return imageResolutionTierForSize(parsed.width, parsed.height);
}

export function imageResolutionFromSize(rawSize: unknown): string {
  const parsed = parseImageSize(String(rawSize ?? ''));
  if (!parsed) return '';
  return imageResolutionTierForSize(parsed.width, parsed.height);
}

function normalizeDeclaredImageRatio(value: string): string {
  const ratio = normalizeImageAspectRatio(value);
  const [left, right] = ratio.split(':');
  if (right === undefined) return ratio;
  const width = Number(left);
  const height = Number(right);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return ratio;
  const divisor = imageDimensionGCD(width, height);
  return `${width / divisor}:${height / divisor}`;
}

/**
 * 在声明的预设里找匹配项：比例按约分后比较，像素按原字符串比较；
 * 给了档位就只在同档预设里找。
 */
export function declaredImageSizePreset(
  presets: CapabilityImageSizePreset[],
  value: string,
  tier: string,
  fallbackTier = '',
): CapabilityImageSizePreset | undefined {
  const target = String(value ?? '').trim();
  if (target === '' || target.toLowerCase() === 'auto') return undefined;
  let effectiveTier = String(tier ?? '').trim();
  if (effectiveTier === '') effectiveTier = String(fallbackTier ?? '').trim();
  const ratio = target.includes(':') ? normalizeDeclaredImageRatio(target) : '';
  for (const preset of presets) {
    if (effectiveTier !== '' && String(preset.tier ?? '').trim().toLowerCase() !== effectiveTier.toLowerCase()) {
      continue;
    }
    if (
      (ratio !== '' && normalizeDeclaredImageRatio(preset.ratio) === ratio) ||
      String(preset.size ?? '').trim().toLowerCase() === target.toLowerCase()
    ) {
      return preset;
    }
  }
  return undefined;
}

/**
 * 判断一个尺寸取值是否是「当前规格声明的预设」。
 * 匹配阶段据此决定：尺寸算已归一的档位表达，还是参数合同里的普通取值。
 */
export function capabilityImageSizePresetMatches(
  spec: CapabilitySpec,
  value: unknown,
  options: Record<string, unknown> | undefined,
): boolean {
  const size = spec.imageSize;
  if (!size || (size.presets ?? []).length === 0) return false;
  if (typeof value !== 'string' || value.trim() === '') return false;

  let tier: unknown;
  if (spec.imageParameters === undefined) tier = options?.quality;
  const hasIndependentResolution = Object.prototype.hasOwnProperty.call(spec.options ?? {}, 'imageResolution');
  if (hasIndependentResolution) {
    const resolution = stringValue(options?.imageResolution);
    if (resolution === '' || resolution.toLowerCase() === 'auto' || resolution.toLowerCase() === 'any') return false;
    tier = resolution;
  }
  return declaredImageSizePreset(size.presets, value, stringValue(tier)) !== undefined;
}

/* ────────────────────────── 意图归一 ────────────────────────── */

function stringValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export function mergeIntentDefaults(
  options: Record<string, unknown> | undefined,
  defaults: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...(defaults ?? {}) };
  for (const [key, value] of Object.entries(options ?? {})) {
    if (value === null || value === undefined) continue;
    result[key] = value;
  }
  return result;
}

/**
 * 图片尺寸口径归一：把比例（或像素）按当前规格的显式预设映射成
 * 规格声明的编码方式。找不到预设就原样返回，由匹配阶段报「超出能力范围」。
 */
export function normalizeImageSizeIntent(spec: CapabilitySpec, intent: ModelRequestIntent): ModelRequestIntent {
  if (normalizeCapability(intent.capability) !== 'image' || !spec.imageSize || !intent.options) return intent;
  const value = stringValue(intent.options.size);
  if (value === '') return intent;

  let tier = stringValue(intent.options.imageResolution);
  const hasIndependentResolution = Object.prototype.hasOwnProperty.call(spec.options ?? {}, 'imageResolution');
  if (hasIndependentResolution) {
    if (tier.toLowerCase() === 'auto' || tier.toLowerCase() === 'any') tier = '';
    if (tier === '') return intent;
  } else if (spec.imageParameters === undefined) {
    tier = stringValue(intent.options.quality);
  }

  const preset = declaredImageSizePreset(spec.imageSize.presets ?? [], value, tier);
  if (!preset) return intent;
  return {
    ...intent,
    options: {
      ...intent.options,
      // 等价比例可能都匹配，但上游只接受声明过的枚举文本（如 21:9 而非约分后的 7:3）
      size: spec.imageSize.parameter === 'size' ? String(preset.size).trim() : String(preset.ratio).trim(),
    },
  };
}

/**
 * 按前台模型的能力合同裁剪意图参数。
 *
 * 能力插件给出的是**平台的**参数口径（ratio / size / variantCount…），而每个
 * 前台模型只声明其中一部分（`docs/channel-model-design.md` §5.3：只有模型
 * 声明过的参数才能进入意图）。不先裁剪就会出现两处错误：
 *   · 模型关闭了某项参数（如不支持独立分辨率），请求里残留它会被报成
 *     「不支持参数」，用户看到的是模型缺陷而不是自己的输入问题；
 *   · 意图里多一个键，匹配失败原因指向一个平台内部字段，前端无法解释。
 *
 * 参考素材同样只保留合同声明过的类型；数量本身不裁剪 —— 少传由匹配
 * 阶段报「至少需要 N 个」，多传本来就该被拒绝。
 */
export function restrictIntentToSpec(spec: CapabilitySpec, intent: ModelRequestIntent): ModelRequestIntent {
  const declared = new Set(Object.keys(spec.options ?? {}));
  for (const parameter of spec.imageParameters ?? []) {
    if (parameter.enabled === false) continue;
    declared.add(parameter.name);
  }
  // 尺寸预设在 imageSize 里，但可能没有对应的 options.size 条目
  const allowsSize = declared.has('size') || spec.imageSize !== undefined;

  const options: Record<string, unknown> = {};
  for (const [rawName, value] of Object.entries(intent.options ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    const name = canonicalModelOptionName(spec.capability, rawName);
    if (name === 'size' && allowsSize) options[name] = value;
    else if (declared.has(name)) options[name] = value;
  }

  const declaredInputs = spec.inputs ?? {};
  const inputs: Record<string, number> = {};
  for (const [name, count] of Object.entries(intent.inputs ?? {})) {
    if (count > 0 && Object.prototype.hasOwnProperty.call(declaredInputs, name)) inputs[name] = count;
  }

  return { ...intent, inputs, options };
}

/** 产出匹配、计价与线路选择共用的唯一公开生成意图 */
export function resolveModelRequestIntent(
  spec: CapabilitySpec,
  intent: ModelRequestIntent,
  defaults: Record<string, unknown> | undefined,
): ModelRequestIntent {
  return normalizeImageSizeIntent(
    spec,
    { ...intent, options: mergeIntentDefaults(intent.options, defaults) },
  );
}

/* ────────────────────────── 入参 → 意图 ────────────────────────── */

/** 允许出现在意图里的参考素材类型；未知键直接拒绝，避免拼错字段被静默忽略 */
const INTENT_INPUT_KINDS = new Set(['image', 'video', 'audio', 'mask']);

/**
 * 客户端入参 → 请求意图。
 *
 * 为什么在这里做白名单而不是靠 DTO：嵌套对象在全局 whitelist 下只能整体透传，
 * 一个拼错的参数名会被当成「合法但未声明」的参数，匹配阶段报「不支持参数」
 * 却指向一个根本不存在的参数名。这里先把非法的骨架拒掉。
 */
export function buildModelRequestIntent(input: {
  capability?: unknown;
  operation?: unknown;
  inputs?: unknown;
  options?: unknown;
}): ModelRequestIntent {
  const capability = normalizeCapability(input?.capability);
  if (capability === '') throw badRequest('请求缺少有效的模型能力类型');

  const rawInputs = input?.inputs;
  const inputs: Record<string, number> = {};
  if (rawInputs !== undefined && rawInputs !== null) {
    if (typeof rawInputs !== 'object' || Array.isArray(rawInputs)) {
      throw badRequest('参考素材数量必须是对象');
    }
    for (const [name, raw] of Object.entries(rawInputs as Record<string, unknown>)) {
      const kind = String(name ?? '').trim().toLowerCase();
      if (!INTENT_INPUT_KINDS.has(kind)) throw badRequest(`未知的参考素材类型：${name}`);
      if (raw === undefined || raw === null || raw === '') continue;
      const count = Number(raw);
      if (!Number.isInteger(count) || count < 0 || count > 128) {
        throw badRequest('参考素材数量必须是 0 到 128 的整数');
      }
      inputs[kind] = count;
    }
  }

  const rawOptions = input?.options;
  const options: Record<string, unknown> = {};
  if (rawOptions !== undefined && rawOptions !== null) {
    if (typeof rawOptions !== 'object' || Array.isArray(rawOptions)) {
      throw badRequest('模型参数必须是对象');
    }
    for (const [rawName, value] of Object.entries(rawOptions as Record<string, unknown>)) {
      if (value === undefined) continue;
      const name = canonicalModelOptionName(capability, rawName);
      options[name] = normalizeModelRequestOption(name, value);
    }
  }

  const operation = String(input?.operation ?? '').trim().toLowerCase();
  return { capability, ...(operation ? { operation } : {}), inputs, options };
}

/* ────────────────────────── 价格档选择器 ────────────────────────── */

/**
 * 意图 → 价格档选择器。
 *
 * 视频：`operation` 按**实际参考素材**归类（视频参考优先归为视频生视频，
 * 图片参考无论数量都归为图生视频），避免供应商细分操作（extend 等）
 * 把同一价格档拆成多个键。
 * 图片：保留原始参数名（插件参数直接参与计价），同时补齐
 * quality / resolution / size 三个旧键，兼容存量价格档。
 */
export function skuSelectorForIntent(intent: ModelRequestIntent): Record<string, string> {
  const selector: Record<string, string> = {};
  const operation = String(intent.operation ?? '').trim().toLowerCase();
  if (operation !== '') selector.operation = operation;
  const inputs = intent.inputs ?? {};
  const options = intent.options ?? {};

  switch (normalizeCapability(intent.capability)) {
    case 'video': {
      if (selector.operation === VIDEO_PROCESSING_OPERATION_ENHANCE) {
        // 画质增强保留自身 operation，价格档可单独按 enhance 定价
      } else if ((inputs.video ?? 0) > 0) {
        selector.operation = 'video_to_video';
      } else if ((inputs.image ?? 0) > 0) {
        selector.operation = 'image_to_video';
      }
      if ((inputs.image ?? 0) > 0) selector.imageCount = String(inputs.image);
      const vquality = normalizeTierResolution(options.vquality);
      if (vquality !== '*') selector.vquality = vquality;
      const seconds = Number.parseInt(stringValue(options.videoSeconds), 10);
      if (Number.isFinite(seconds) && seconds > 0) selector.videoSeconds = String(seconds);
      const audio = normalizedScalar(options.videoGenerateAudio);
      if (audio === 'true' || audio === 'false') selector.videoGenerateAudio = audio;
      const band = normalizedScalar(options.fpsBand);
      if (band === 'le30' || band === 'le60' || band === 'le120') selector.fpsBand = band;
      return selector;
    }
    case 'image': {
      for (const [name, value] of Object.entries(options)) {
        if (value === undefined || value === null) continue;
        selector[name] = stringValue(value);
      }
      selector.operation = (inputs.image ?? 0) > 0 ? 'image_to_image' : 'text_to_image';

      const rawQuality = stringValue(options.quality);
      const rawSize = stringValue(options.size);
      const quality = normalizeImagePriceQuality(rawQuality, rawSize);
      if (quality !== '') {
        selector.quality = quality;
        if (isImageResolutionTier(quality)) selector.resolution = quality;
      }
      const resolution = imageResolutionFromSize(rawSize);
      if (resolution !== '') {
        selector.resolution = resolution;
        // 保留存量 quality=1k/2k/4k 价格档的请求选择器
        if (quality === '' || quality === 'auto' || quality === 'any') selector.quality = resolution;
      }
      if (selector.quality === 'auto' || selector.quality === 'any') delete selector.quality;
      const size = rawSize.toLowerCase();
      if (size !== '' && size !== 'auto' && size !== 'any') selector.size = size;
      else delete selector.size;
      // 尺寸按比例表达时 size 不是价格档维度（比例不参与计价），保留原样由匹配阶段判定
      return selector;
    }
    default:
      return selector;
  }
}
