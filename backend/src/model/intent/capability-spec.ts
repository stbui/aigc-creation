/**
 * 能力合同（CapabilitySpec）：解码、归一、由渠道能力配置派生、覆盖校验。
 *
 * 移植自 open-ai-canvas：
 *   · `internal/app/model_capability.go`  —— 能力配置 → 合同
 *   · `internal/app/model_router_capability.go` —— 归一与匹配
 *   · `internal/app/logical_models_coverage.go` —— 产品合同必须被线路覆盖
 *   · `internal/app/image_parameters.go` —— 图片参数合同投影
 *
 * 一条铁律：**前台模型承诺的能力必须被至少一条可用线路真实承接**。
 * 保存期用 `validateProductSpecWithinRoutes` 拒绝，运行期快照装载时再校验一次 ——
 * 否则用户会选中一个「目录里可选、实际永远失败」的规格。
 */

import {
  type ImageSizeConfig,
  containsCapabilityString,
  normalizeCapability,
  validateImageCapabilityConfig,
  type ModelCapabilityConfig,
} from '../domain/capability-config';
import {
  imageParameterAccepts,
  imageParameterValue,
  validateImageParameters,
} from '../domain/image-parameters';
import { badRequest, decodeJson } from '../domain/json';
import { normalizeTierResolution } from '../domain/selector';
import {
  activeImageSizePresets,
  capabilityImageSizeFromConfig,
  imageParameterConstraints,
  imageParameterDefaults,
  imageSizeOptionConstraint,
  publicImageParameters,
  resolveImageParameterValues,
} from './image-contract';
import {
  anyValues,
  boolValues,
  canonicalModelOptionName,
  isWildcardOptionConstraint,
  matchOptionConstraint,
  normalizedScalar,
  numericRange,
} from './option-values';
import type {
  CapabilityImageSize,
  CapabilitySpec,
  InputConstraint,
  OptionConstraint,
} from './spec-types';

/* ────────────────────────── 解码与归一 ────────────────────────── */

export function decodeCapabilitySpec(raw: string | null | undefined): CapabilitySpec {
  const parsed = decodeJson<CapabilitySpec>(
    raw,
    { version: 0, capability: '' },
    '能力配置',
  );
  return normalizeCapabilitySpec(parsed);
}

export function validateCapabilitySpec(spec: CapabilitySpec): void {
  normalizeCapabilitySpec(spec);
}

/**
 * 归一化并校验能力合同。任何字段非法都直接抛错 —— 型号配置损坏时
 * 宁可在装载目录时把这条线路剔除，也不能带着半份合同去匹配。
 */
export function normalizeCapabilitySpec(spec: CapabilitySpec): CapabilitySpec {
  const capability = normalizeCapability(spec?.capability);
  if (Number(spec?.version) !== 1) throw badRequest('能力配置 version 必须为 1');
  if (!capability) throw badRequest('能力配置必须声明 capability');

  const operations: string[] = [];
  const seenOperations = new Set<string>();
  for (const raw of spec.operations ?? []) {
    const operation = String(raw ?? '').trim().toLowerCase();
    if (operation === '' || seenOperations.has(operation)) continue;
    seenOperations.add(operation);
    operations.push(operation);
  }

  const inputs: Record<string, InputConstraint> = {};
  for (const [rawName, constraint] of Object.entries(spec.inputs ?? {})) {
    const name = String(rawName ?? '').trim().toLowerCase();
    const min = Number(constraint?.min ?? 0);
    const max = Number(constraint?.max ?? 0);
    if (name === '' || min < 0 || max < min) throw badRequest('输入能力范围无效');
    if (Object.prototype.hasOwnProperty.call(inputs, name)) throw badRequest(`输入能力存在重复名称：${name}`);
    inputs[name] = { min, max };
  }

  const options: Record<string, OptionConstraint> = {};
  for (const [rawName, rawConstraint] of Object.entries(spec.options ?? {})) {
    const name = canonicalModelOptionName(capability, rawName);
    if (name.trim() === '') throw badRequest('能力参数名称不能为空');
    if (Object.prototype.hasOwnProperty.call(options, name)) throw badRequest(`能力参数存在重复别名：${name}`);
    const values = [...(rawConstraint?.values ?? [])];
    const hasValues = values.length > 0;
    const hasRange =
      rawConstraint?.min !== undefined || rawConstraint?.max !== undefined || rawConstraint?.step !== undefined;
    if (!hasValues && !hasRange) throw badRequest('能力参数必须声明 values 或数值范围');
    if (hasValues && hasRange) throw badRequest('能力参数不能同时声明 values 和数值范围');
    if (hasRange && (rawConstraint?.min === undefined || rawConstraint?.max === undefined)) {
      throw badRequest('数值范围必须同时声明 min 和 max');
    }
    if (
      rawConstraint?.min !== undefined &&
      rawConstraint?.max !== undefined &&
      rawConstraint.max < rawConstraint.min
    ) {
      throw badRequest('能力参数数值范围无效');
    }
    if (rawConstraint?.step !== undefined && rawConstraint.step <= 0) {
      throw badRequest('能力参数 step 必须大于 0');
    }
    options[name] = {
      ...(hasValues ? { values } : {}),
      ...(hasRange
        ? { min: rawConstraint?.min, max: rawConstraint?.max, step: rawConstraint?.step }
        : {}),
    };
  }

  const normalized: CapabilitySpec = {
    version: 1,
    capability,
    operations,
    inputs,
    options,
  };
  if (spec.imageParameters !== undefined && spec.imageParameters !== null) {
    if (capability !== 'image') throw badRequest('只有图片模型可以声明图片参数合同');
    validateImageParameters(spec.imageParameters);
    normalized.imageParameters = spec.imageParameters;
  }
  if (spec.imageSize) {
    normalized.imageSize = {
      parameter: String(spec.imageSize.parameter ?? ''),
      allowCustom: spec.imageSize.allowCustom === true,
      presets: (spec.imageSize.presets ?? []).map((preset) => ({
        size: String(preset.size ?? ''),
        tier: String(preset.tier ?? ''),
        ratio: String(preset.ratio ?? ''),
        width: Number(preset.width ?? 0),
        height: Number(preset.height ?? 0),
      })),
    };
  }
  return normalized;
}

/* ────────────────────── 渠道能力配置 → 线路合同 ────────────────────── */

function capabilityLabel(capability: string): string {
  switch (capability) {
    case 'text':
      return '文本';
    case 'image':
      return '图片';
    case 'video':
      return '视频';
    case 'audio':
      return '音频';
    default:
      return '';
  }
}

/**
 * 渠道模型的能力配置 → 线路能力合同。
 *
 * 音频当前没有可编辑的能力 JSON，返回空合同表示「无额外路由约束」；
 * 其余能力缺失配置直接拒绝 —— 缺配置的线路不能进入目录。
 */
export function capabilitySpecFromModelCapabilityConfig(
  config: ModelCapabilityConfig | null | undefined,
  capability: string,
): CapabilitySpec {
  const normalizedCapability = normalizeCapability(capability);
  const spec: CapabilitySpec = {
    version: 1,
    capability: normalizedCapability,
    inputs: {},
    options: {},
  };
  if (normalizedCapability === 'audio') return spec;
  if (!config) {
    throw badRequest(`渠道${capabilityLabel(normalizedCapability)}模型尚未配置能力参数`);
  }

  if (normalizedCapability === 'text') {
    if (!config.text) throw badRequest('渠道文本模型尚未配置能力参数');
    addInputs(spec, 'image', 0, config.text.references.maxImages);
    addInputs(spec, 'video', 0, config.text.references.maxVideos);
    return normalizeCapabilitySpec(spec);
  }

  if (normalizedCapability === 'image') {
    const image = config.image;
    if (!image) throw badRequest('渠道图片模型尚未配置能力参数');
    addInputs(spec, 'image', 0, image.references.maxImages);
    if (image.references.maskSupported) addInputs(spec, 'mask', 0, 1);
    if (image.size.parameter !== 'none') {
      const sizeConstraint = imageSizeOptionConstraint(image.size);
      if ((sizeConstraint.values ?? []).length > 0) spec.options!.size = sizeConstraint;
      // 参数表存在时尺寸档走参数合同的 activeImageSizePresets，兼容旧三元组的模型才读原始预设
      const presets = image.parameters !== undefined ? activeImageSizePresets(image) : image.size.presets;
      spec.imageSize = capabilityImageSizeFromConfig({ ...image.size, presets } as ImageSizeConfig);
    }
    if (image.resolution.supported) spec.options!.imageResolution = anyValues(image.resolution.values);
    if (image.quality.supported) spec.options!.quality = anyValues(image.quality.values);
    spec.options!.transparentBackground = boolValues(image.transparentBackground.supported);
    spec.options!.count = numericRange(1, Math.trunc(image.maxOutputs), 1);
    if (image.parameters !== undefined) {
      spec.options = imageParameterConstraints(image.parameters);
      spec.imageParameters = publicImageParameters(image.parameters);
    }
    return normalizeCapabilitySpec(spec);
  }

  if (normalizedCapability === 'video') {
    const video = config.video;
    if (!video) throw badRequest('渠道视频模型尚未配置能力参数');
    spec.operations = [...video.operations];
    addInputs(spec, 'image', video.references.minImages, video.references.maxImages);
    addInputs(spec, 'video', 0, video.references.maxVideos);
    addInputs(spec, 'audio', 0, video.references.maxAudios);
    if (video.duration.selection === 'enum') {
      spec.options!.videoSeconds = { values: [...(video.duration.values ?? [])] };
    } else {
      spec.options!.videoSeconds = numericRange(
        Number(video.duration.min ?? 0),
        Number(video.duration.max ?? 0),
        Number(video.duration.step ?? 1),
      );
    }
    if (video.ratios.length > 0) spec.options!.size = anyValues(video.ratios);
    if (video.resolutions.length > 0) spec.options!.vquality = anyValues(video.resolutions);
    if (video.processing) {
      // 处理类模型的 videoSeconds 是服务端测得的源时长；fpsBand 只用于价格档选择
      spec.options!.videoSeconds = numericRange(
        1,
        Number(video.processing.maxSourceSeconds ?? 180),
        1,
      );
      spec.options!.fpsBand = anyValues(['le30', 'le60', 'le120']);
    }
    spec.options!.videoGenerateAudio = boolValues(video.generateAudio.supported);
    spec.options!.videoWatermark = boolValues(video.watermark.supported);
    return normalizeCapabilitySpec(spec);
  }

  return normalizeCapabilitySpec(spec);
}

function addInputs(spec: CapabilitySpec, name: string, min: number, max: number): void {
  if (min <= 0 && max <= 0) return;
  spec.inputs![name] = { min, max };
}

/**
 * 视频价格档裁剪可选规格：只让创作端选到「已启用且可结算」的分辨率/时长。
 * 规格组合最终仍由路由时的精确价格档匹配保证 —— 独立枚举无法表达
 * 「分辨率 × 时长」的非笛卡尔组合。
 */
export function capabilitySpecWithPriceTiers(
  spec: CapabilitySpec,
  tiers: Array<{ resolution: string; videoSeconds: number; enabled: boolean; priceConfigured: boolean }>,
  protocol = '',
): CapabilitySpec {
  if (normalizeCapability(spec.capability) !== 'video' || tiers.length === 0) return spec;
  const active = tiers.filter((tier) => tier.enabled && tier.priceConfigured);
  if (active.length === 0) return spec;

  const result: CapabilitySpec = { ...spec, options: { ...(spec.options ?? {}) } };
  let hasResolutionWildcard = false;
  let hasDurationWildcard = false;
  const resolutions: unknown[] = [];
  const durations: unknown[] = [];
  const seenResolutions = new Set<string>();
  const seenDurations = new Set<number>();
  for (const tier of active) {
    const resolution = normalizeTierResolution(tier.resolution);
    if (resolution === '*') hasResolutionWildcard = true;
    else if (!seenResolutions.has(resolution)) {
      seenResolutions.add(resolution);
      resolutions.push(resolution);
    }
    if (tier.videoSeconds === 0) hasDurationWildcard = true;
    else if (!seenDurations.has(tier.videoSeconds)) {
      seenDurations.add(tier.videoSeconds);
      durations.push(tier.videoSeconds);
    }
  }
  if (!hasResolutionWildcard && resolutions.length > 0) {
    let allowed = resolutions;
    if (protocol === 'autodl-comfyui') {
      const declared = result.options!.vquality;
      if (declared) {
        allowed = resolutions.filter((value) => matchOptionConstraint('vquality', declared, value));
      }
    }
    if (allowed.length > 0) result.options!.vquality = { values: allowed };
  }
  if (!hasDurationWildcard && durations.length > 0) {
    result.options!.videoSeconds = { values: durations };
  }
  return result;
}

/* ────────────────── 前台模型合同 × 线路合同 的预设合并 ────────────────── */

/**
 * 修复旧前台模型快照只存了 `*` 的自定义尺寸：通配符继续用于匹配自定义值，
 * 同时把各线路的真实预设并回来，供后台与创作端渲染。
 * 调用方只能传当前启用且权重 > 0 的线路。
 */
export function capabilitySpecWithRoutePresets(spec: CapabilitySpec, routes: CapabilitySpec[]): CapabilitySpec {
  if (normalizeCapability(spec.capability) === 'image') {
    for (const route of routes) {
      if (route.imageParameters !== undefined) return effectiveImageParameterSpec(spec, routes);
    }
  }
  const result: CapabilitySpec = { ...spec, options: { ...(spec.options ?? {}) } };
  for (const [name, constraint] of Object.entries(spec.options ?? {})) {
    if (!isWildcardOptionConstraint(constraint)) {
      result.options![name] = constraint;
      continue;
    }
    const values = [...(constraint.values ?? [])];
    const seen = new Set(values.map((value) => normalizedScalar(value)));
    for (const route of routes) {
      for (const value of route.options?.[name]?.values ?? []) {
        const key = normalizedScalar(value);
        if (key === '' || seen.has(key)) continue;
        seen.add(key);
        values.push(value);
      }
    }
    result.options![name] = { values };
  }
  const merged = mergeCapabilityImageSize([spec, ...routes]);
  if (merged) {
    if (!result.imageSize) result.imageSize = merged;
    else {
      const restored = { ...result.imageSize };
      if (!restored.parameter) restored.parameter = merged.parameter;
      if (!restored.allowCustom) restored.allowCustom = merged.allowCustom;
      restored.presets = merged.presets;
      result.imageSize = restored;
    }
  }
  return result;
}

export function mergeCapabilityImageSize(specs: CapabilitySpec[]): CapabilityImageSize | undefined {
  let result: CapabilityImageSize | undefined;
  const seen = new Set<string>();
  for (const spec of specs) {
    const part = spec.imageSize;
    if (!part) continue;
    if (!result) {
      result = { parameter: part.parameter, allowCustom: part.allowCustom, presets: [] };
    } else {
      if (result.parameter !== 'aspect_ratio' && part.parameter === 'aspect_ratio') {
        result.parameter = 'aspect_ratio';
      } else if (!result.parameter) {
        result.parameter = part.parameter;
      }
      result.allowCustom = result.allowCustom || part.allowCustom;
    }
    for (const preset of part.presets ?? []) {
      const key = `${preset.tier}:${preset.ratio}:${preset.size}`;
      if (key === '::' || seen.has(key)) continue;
      seen.add(key);
      result.presets.push(preset);
    }
  }
  return result;
}

/**
 * 图片参数合同的跨线路并集投影：只有**所有**启用线路都支持的参数、取值与
 * 范围才会保留，避免前台承诺一个部分线路无法承接的取值。
 */
export function effectiveImageParameterSpec(spec: CapabilitySpec, routes: CapabilitySpec[]): CapabilitySpec {
  if (normalizeCapability(spec.capability) !== 'image') return spec;
  const sources = new Map<string, any>();
  const conflicts = new Set<string>();
  const order: string[] = [];
  for (const route of routes) {
    for (const parameter of route.imageParameters ?? []) {
      if (parameter.enabled === false) continue;
      const previous = sources.get(parameter.name);
      if (!previous) {
        sources.set(parameter.name, { ...parameter });
        order.push(parameter.name);
        continue;
      }
      if (previous.type !== parameter.type) {
        conflicts.add(parameter.name);
        continue;
      }
      previous.pricing = previous.pricing === true && parameter.pricing === true;
      if ((previous.values ?? []).length > 0 && (parameter.values ?? []).length > 0) {
        const merged = [...previous.values];
        for (const candidate of parameter.values) {
          if (!merged.some((value) => normalizedScalar(value) === normalizedScalar(candidate))) merged.push(candidate);
        }
        previous.values = merged;
      } else if (
        parameter.min !== undefined &&
        parameter.max !== undefined &&
        previous.min !== undefined &&
        previous.max !== undefined
      ) {
        const minimum = Math.min(parameter.min, previous.min);
        const maximum = Math.max(parameter.max, previous.max);
        const candidate = { min: minimum, max: maximum, step: previous.step };
        if (optionConstraintCovered(candidate, parameter.name, routes)) {
          previous.min = minimum;
          previous.max = maximum;
        }
      }
      sources.set(parameter.name, previous);
    }
  }
  const hasContract = routes.some((route) => route.imageParameters !== undefined);
  if (!hasContract) return spec;

  const result: CapabilitySpec = { ...spec, imageParameters: [], options: {} };
  for (const name of order) {
    if (conflicts.has(name)) continue;
    const parameter = sources.get(name);
    const constraint = spec.options?.[name];
    if (!constraint) {
      const known = (spec.imageParameters ?? []).some((item) => item.name === name);
      if (known) {
        result.imageParameters!.push({ ...parameter, enabled: false });
      }
      continue;
    }
    if (!isWildcardOptionConstraint(constraint)) {
      const values = [];
      for (const value of constraint.values ?? []) {
        if (!parameterAccepts(parameter, value)) continue;
        values.push(coerceParameterValue(parameter, value));
      }
      if (values.length === 0) continue;
      parameter.values = values;
    }
    if (constraint.min !== undefined && (parameter.min === undefined || constraint.min > parameter.min)) {
      parameter.min = constraint.min;
    }
    if (constraint.max !== undefined && (parameter.max === undefined || constraint.max < parameter.max)) {
      parameter.max = constraint.max;
    }
    if (constraint.step !== undefined && (parameter.step === undefined || constraint.step >= parameter.step)) {
      parameter.step = constraint.step;
    }
    if (parameter.min !== undefined && parameter.max !== undefined && parameter.min > parameter.max) continue;
    if (parameter.default !== undefined && parameter.default !== null && !parameterAccepts(parameter, parameter.default)) {
      parameter.default = (parameter.values ?? [])[0];
    }
    result.imageParameters!.push({ ...parameter, binding: undefined, models: undefined, encoding: undefined });
  }
  result.options = imageParameterConstraints(result.imageParameters!);
  result.imageSize = mergeCapabilityImageSize(routes);
  if (!result.options.size) result.imageSize = undefined;
  return result;
}

function parameterAccepts(parameter: any, value: unknown): boolean {
  return imageParameterAccepts(parameter, value);
}

function coerceParameterValue(parameter: any, value: unknown): unknown {
  return imageParameterValue(parameter, value);
}

/* ────────────────────────── 指纹与覆盖校验 ────────────────────────── */

/** 能力画像指纹：规范化后比较，数组顺序不同不应算作不同画像 */
export function capabilityFingerprint(spec: CapabilitySpec): string {
  const copy: CapabilitySpec = {
    ...spec,
    operations: [...(spec.operations ?? [])].sort(),
    inputs: { ...(spec.inputs ?? {}) },
    options: {},
  };
  for (const [name, constraint] of Object.entries(spec.options ?? {})) {
    const values = [...(constraint.values ?? [])];
    if (values.length > 0) {
      values.sort((left, right) => (normalizedScalar(left) < normalizedScalar(right) ? -1 : 1));
    }
    copy.options![name] = { ...constraint, ...(values.length > 0 ? { values } : {}) };
  }
  if (spec.imageParameters) {
    copy.imageParameters = [...spec.imageParameters].sort((left, right) => (left.name < right.name ? -1 : 1));
  }
  return JSON.stringify(copy);
}

/**
 * 产品合同必须被线路合同完整覆盖；不满足时抛错（保存期拒绝）或返回 false（装载期剔除）。
 */
export function validateProductSpecWithinRoutes(product: CapabilitySpec, routeSpecs: CapabilitySpec[]): void {
  for (const routeSpec of routeSpecs) {
    if (normalizeCapability(routeSpec.capability) !== normalizeCapability(product.capability)) {
      throw badRequest('供应线路能力类型与前台模型不一致');
    }
  }
  const productOperations = product.operations ?? [];
  if (productOperations.length === 0) {
    if (!routeSpecs.some((routeSpec) => (routeSpec.operations ?? []).length === 0)) {
      throw badRequest('创作端生成方式必须从供应线路支持的选项中选择');
    }
  } else {
    for (const operation of productOperations) {
      const supported = routeSpecs.some(
        (routeSpec) =>
          (routeSpec.operations ?? []).length === 0 ||
          containsCapabilityString(routeSpec.operations ?? [], operation),
      );
      if (!supported) throw badRequest(`创作端生成方式不受任何供应线路支持：${operation}`);
    }
  }
  for (const [name, constraint] of Object.entries(product.inputs ?? {})) {
    if (!inputConstraintCovered(constraint, name, routeSpecs)) {
      throw badRequest(`创作端输入范围超出供应线路能力：${name}`);
    }
  }
  for (const [name, constraint] of Object.entries(product.options ?? {})) {
    if (!optionConstraintCovered(constraint, name, routeSpecs)) {
      throw badRequest(`创作端参数超出供应线路能力：${name}`);
    }
  }
}

export function logicalModelCapabilityCovered(product: CapabilitySpec, routeSpecs: CapabilitySpec[]): boolean {
  if (routeSpecs.length === 0) return false;
  try {
    validateProductSpecWithinRoutes(product, routeSpecs);
    return true;
  } catch {
    return false;
  }
}

function inputConstraintCovered(candidate: InputConstraint, name: string, routeSpecs: CapabilitySpec[]): boolean {
  let next = candidate.min;
  while (next <= candidate.max) {
    let coveredUntil = next - 1;
    for (const routeSpec of routeSpecs) {
      const constraint = routeSpec.inputs?.[name] ?? { min: 0, max: 0 };
      if (constraint.min <= next && constraint.max >= next && constraint.max > coveredUntil) {
        coveredUntil = constraint.max;
      }
    }
    if (coveredUntil < next) return false;
    next = coveredUntil + 1;
  }
  return true;
}

function optionConstraintCovered(candidate: OptionConstraint, name: string, routeSpecs: CapabilitySpec[]): boolean {
  const routeConstraints = routeSpecs
    .map((routeSpec) => routeSpec.options?.[name])
    .filter((constraint): constraint is OptionConstraint => constraint !== undefined);
  if (routeConstraints.length === 0) return false;
  if (routeConstraints.some((constraint) => isWildcardOptionConstraint(constraint))) return true;

  const values = candidate.values ?? [];
  if (values.length > 0) {
    return values.every((value) => optionValueSupported(name, value, routeConstraints));
  }
  if (candidate.min === undefined || candidate.max === undefined) return false;
  if (Math.abs(candidate.max - candidate.min) < 1e-9) {
    return optionValueSupported(name, candidate.min, routeConstraints);
  }
  if (candidate.step === undefined) {
    return continuousOptionRangeCovered(candidate.min, candidate.max, routeConstraints);
  }
  const step = candidate.step;
  const count = Math.floor((candidate.max - candidate.min) / step + 1e-9) + 1;
  if (count <= 10000) {
    for (let index = 0; index < count; index += 1) {
      const value = candidate.min + index * step;
      if (!optionValueSupported(name, value, routeConstraints)) return false;
    }
    return true;
  }
  // 超大离散范围不逐点展开；只有单条连续范围或步长完全兼容的线路才是可靠来源
  for (const routeConstraint of routeConstraints) {
    if (
      routeConstraint.min === undefined ||
      routeConstraint.max === undefined ||
      routeConstraint.min > candidate.min ||
      routeConstraint.max < candidate.max
    ) {
      continue;
    }
    if (routeConstraint.step === undefined) return true;
    const startSteps = (candidate.min - routeConstraint.min) / routeConstraint.step;
    const stepRatio = step / routeConstraint.step;
    if (Math.abs(startSteps - Math.round(startSteps)) < 1e-9 && Math.abs(stepRatio - Math.round(stepRatio)) < 1e-9) {
      return true;
    }
  }
  return false;
}

function optionValueSupported(name: string, value: unknown, constraints: OptionConstraint[]): boolean {
  return constraints.some(
    (constraint) => isWildcardOptionConstraint(constraint) || matchOptionConstraint(name, constraint, value),
  );
}

function continuousOptionRangeCovered(
  minimum: number,
  maximum: number,
  constraints: OptionConstraint[],
): boolean {
  let next = minimum;
  while (next <= maximum + 1e-9) {
    let coveredUntil = next;
    let advanced = false;
    for (const constraint of constraints) {
      if (constraint.min === undefined || constraint.max === undefined || constraint.step !== undefined) continue;
      if (constraint.min <= next + 1e-9 && constraint.max >= next - 1e-9 && constraint.max > coveredUntil) {
        coveredUntil = constraint.max;
        advanced = true;
      }
    }
    if (coveredUntil >= maximum - 1e-9) return true;
    if (!advanced) return false;
    next = coveredUntil;
  }
  return true;
}

/* ────────────────────────── 默认参数 ────────────────────────── */

/**
 * 前台模型默认参数校验：每个键都必须在产品合同里声明，且取值合法。
 * `*` 只能表示「允许任意值」，不能作为实际发送的默认值。
 */
export function normalizeLogicalDefaults(
  spec: CapabilitySpec,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  if (normalizeCapability(spec.capability) === 'image' && spec.imageParameters !== undefined) {
    const parameters = spec.imageParameters.map((parameter) => ({ ...parameter, required: false }));
    resolveImageParameterValues(parameters, defaults);
  }
  const result: Record<string, unknown> = {};
  for (const [rawName, rawValue] of Object.entries(defaults ?? {})) {
    const name = canonicalModelOptionName(spec.capability, rawName);
    if (Object.prototype.hasOwnProperty.call(result, name)) {
      throw badRequest(`默认参数存在重复别名：${name}`);
    }
    const constraint = spec.options?.[name];
    if (!constraint || !matchOptionConstraint(name, constraint, rawValue)) {
      throw badRequest(`默认参数 ${name} 不在前台模型能力范围内`);
    }
    let value = rawValue;
    if (normalizedScalar(value) === '*') {
      const first = (constraint.values ?? []).find((candidate) => normalizedScalar(candidate) !== '*');
      if (first !== undefined) value = first;
    }
    result[name] = value;
  }
  return result;
}

export function decodeLogicalDefaults(
  raw: string | null | undefined,
  spec: CapabilitySpec,
): Record<string, unknown> {
  let defaults = decodeJson<Record<string, unknown>>(raw, {}, '前台模型默认参数');
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
    throw badRequest('前台模型默认参数必须是 JSON 对象');
  }
  if (normalizeCapability(spec.capability) === 'image' && spec.imageParameters !== undefined) {
    const current = imageParameterDefaults(spec.imageParameters);
    for (const parameter of spec.imageParameters) {
      if (!Object.prototype.hasOwnProperty.call(defaults, parameter.name)) continue;
      const value = defaults[parameter.name];
      if (parameter.enabled === false) continue;
      if (!parameterAccepts(parameter, value)) continue;
      current[parameter.name] = coerceParameterValue(parameter, value);
    }
    defaults = current;
  }
  return normalizeLogicalDefaults(spec, defaults);
}

/** 图片参数合同的默认值（供后台「重置为默认」使用） */
export function imageParameterDefaultsForSpec(spec: CapabilitySpec): Record<string, unknown> {
  return spec.imageParameters ? imageParameterDefaults(spec.imageParameters) : {};
}

/** 校验图片能力配置（渠道模型保存路径已做，这里供能力合同装载兜底） */
export function assertImageCapabilityConfig(image: any): void {
  validateImageCapabilityConfig(image);
}

/** 目录装载期的能力配置归一化入口（包装 `normalizeModelCapabilityConfig`） */
export function capabilitySpecForChannelModel(options: {
  config: ModelCapabilityConfig | null;
  capability: string;
}): CapabilitySpec {
  return capabilitySpecFromModelCapabilityConfig(options.config, options.capability);
}
