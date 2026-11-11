/**
 * 供应商默认商品配置 —— 读取、校验与「套用到商品」的唯一实现。
 *
 * 为什么单独成文件：这份配置同时被后台渠道保存（校验）、手工新建商品与
 * 上游目录导入（套用）三条路径消费。分散在三个服务里各写一遍默认合同，
 * 迟早会出现「导入出来的模型能生成、手工新建的同款却 400」。
 *
 * 边界：
 *   1. 只支持图像 / 文本 —— 与后台既有的「导入后统一配置」保持一致；
 *   2. 读取（解析库内 JSON）宽容，写入（后台提交）严格；损坏的历史值按
 *      「未配置」处理，不让一条脏配置挡住整条渠道；
 *   3. 能力合同必须按**真实上游模型键**生成：插件参数可以限定适用模型，
 *      用空模型名生成会把 `models: ['gpt-image-2']` 这类参数静默丢掉。
 */

import { badRequest, normalizeModelKey, toSafeAmount } from '../domain/json';
import {
  normalizeCapability,
  projectImageParameters,
  type ImageCapabilityConfig,
  type ModelCapabilityConfig,
  type TextCapabilityConfig,
} from '../domain/capability-config';
import { resolveImageParameters } from '../domain/image-parameters';
import { validateChannelModelTierPricing } from '../domain/selector';
import type { ProtocolCatalogEntry, ProtocolCatalogService } from '../protocol/protocol-catalog.service';
import type { ChannelDefaultModelConfig, ChannelModelRequest } from './channel.types';

const MEGABYTE = 1024 * 1024;

/** 与前端 `textCapability.ts` 的默认文本合同逐字段一致 */
const DEFAULT_TEXT_CONFIG: TextCapabilityConfig = {
  streaming: true,
  contextWindowTokens: 128000,
  maxOutputTokens: 16384,
  references: {
    promptMaxChars: 4000,
    maxImages: 4,
    maxImageBytes: 10 * MEGABYTE,
    maxVideos: 0,
    maxVideoBytes: 0,
  },
};

/** 与前端 `imageCapability.ts` 的默认图片合同逐字段一致 */
const DEFAULT_IMAGE_REFERENCES = {
  promptMaxChars: 4000,
  maxImages: 4,
  maxImageBytes: 20 * MEGABYTE,
  maskSupported: false,
};

function emptyImageConfig(): ImageCapabilityConfig {
  return {
    parameters: [],
    references: { ...DEFAULT_IMAGE_REFERENCES },
    size: { parameter: 'none', values: [], default: 'auto', allowCustom: false },
    resolution: { supported: false, values: [], default: 'auto' },
    quality: { supported: false, values: [], default: 'auto' },
    transparentBackground: { supported: false, default: false },
    responseFormat: { supported: false, default: 'auto' },
    outputFormat: { supported: false, default: 'auto' },
    maxOutputs: 1,
  };
}

/** 库内 JSON → 配置；损坏或越界一律视为「未配置」 */
export function decodeDefaultModelConfig(
  raw: string | null | undefined,
): ChannelDefaultModelConfig | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const capability = normalizeCapability(record.capability);
  if (capability !== 'image' && capability !== 'text') return null;
  const protocol = String(record.protocol ?? '').trim();
  if (!protocol) return null;
  const amount = (value: unknown) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  };
  return {
    capability,
    protocol,
    billingMode: String(record.billingMode ?? '').trim() || 'fixed_request',
    unitPriceMicrocredits: amount(record.unitPriceMicrocredits),
    inputTokenPriceMicrocredits: amount(record.inputTokenPriceMicrocredits),
    outputTokenPriceMicrocredits: amount(record.outputTokenPriceMicrocredits),
    cachedTokenPriceMicrocredits: amount(record.cachedTokenPriceMicrocredits),
    enabled: record.enabled !== false,
  };
}

/**
 * 后台提交 → 配置。`undefined` = 保持不变（由调用方处理），`null` 或
 * `capability` 为空 = 清空；其余必须完整且通过能力 / 计价校验。
 */
export function normalizeDefaultModelConfig(
  input: unknown,
  protocols: ProtocolCatalogService,
): ChannelDefaultModelConfig | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('默认商品配置格式不正确');
  }
  const record = input as Record<string, unknown>;
  const rawCapability = String(record.capability ?? '').trim();
  if (!rawCapability) return null;
  const capability = normalizeCapability(rawCapability);
  if (capability !== 'image' && capability !== 'text') {
    throw badRequest('默认商品配置仅支持图像或文本模型');
  }
  const protocol = String(record.protocol ?? '').trim();
  if (!protocol) throw badRequest('默认商品配置需要选择接入方式');
  protocols.require(protocol, capability);

  const prices = {
    billingMode: String(record.billingMode ?? '').trim() || 'fixed_request',
    unitPriceMicrocredits: toSafeAmount(record.unitPriceMicrocredits, '默认商品售价'),
    inputTokenPriceMicrocredits: toSafeAmount(record.inputTokenPriceMicrocredits, '默认商品输入 Token 价格'),
    outputTokenPriceMicrocredits: toSafeAmount(record.outputTokenPriceMicrocredits, '默认商品输出 Token 价格'),
    cachedTokenPriceMicrocredits: toSafeAmount(record.cachedTokenPriceMicrocredits, '默认商品缓存 Token 价格'),
  };
  validateChannelModelTierPricing(capability, prices.billingMode, prices);

  return {
    capability,
    protocol,
    ...prices,
    enabled: record.enabled !== false,
  };
}

/** 按协议声明与真实上游模型键生成默认能力合同 */
export function defaultModelCapabilityConfig(
  config: ChannelDefaultModelConfig,
  entry: ProtocolCatalogEntry,
  model: string,
): ModelCapabilityConfig {
  if (config.capability === 'text') {
    return { version: 1, text: { ...DEFAULT_TEXT_CONFIG, references: { ...DEFAULT_TEXT_CONFIG.references } } };
  }
  const image = emptyImageConfig();
  image.parameters = resolveImageParameters(entry.imageParameters, null, model);
  // 与后台图片参数编辑器同一套派生规则：尺寸 / 分辨率 / 质量 / 张数
  projectImageParameters(image);
  return { version: 1, image };
}

/** 默认配置 → 一条完整的「新建商品」请求 */
export function defaultModelRequest(
  config: ChannelDefaultModelConfig,
  entry: ProtocolCatalogEntry,
  modelKey: string,
  providerModelKey: string,
): ChannelModelRequest {
  return {
    modelKey,
    providerModelKey,
    displayName: '未分类',
    capability: config.capability,
    protocol: config.protocol,
    billingMode: config.billingMode,
    unitPriceMicrocredits: config.unitPriceMicrocredits,
    inputTokenPriceMicrocredits: config.inputTokenPriceMicrocredits,
    outputTokenPriceMicrocredits: config.outputTokenPriceMicrocredits,
    cachedTokenPriceMicrocredits: config.cachedTokenPriceMicrocredits,
    priceConfigured: true,
    enabled: config.enabled,
    capabilityConfig: defaultModelCapabilityConfig(config, entry, providerModelKey),
  };
}

/**
 * 把默认配置补进一条尚未填完整的商品请求。
 *
 * 只补「同能力」的字段：请求显式选了视频 / 音频时，默认的图像协议与价格
 * 不能硬套 —— 那会造出一条能力与协议不匹配、必然失败的线路。
 */
export function applyDefaultModelToRequest(
  req: ChannelModelRequest,
  config: ChannelDefaultModelConfig,
  protocols: ProtocolCatalogService,
): ChannelModelRequest {
  const requestedCapability = normalizeCapability(req.capability);
  const capability = requestedCapability || config.capability;
  if (capability !== config.capability) return req;

  const protocol = String(req.protocol ?? '').trim() || config.protocol;
  const hasPriceTiers = Array.isArray(req.priceTiers) && req.priceTiers.length > 0;
  let capabilityConfig = req.capabilityConfig;
  if (capabilityConfig === undefined || capabilityConfig === null) {
    const entry = protocols.require(protocol, capability);
    const model =
      normalizeModelKey(req.providerModelKey) || normalizeModelKey(req.modelKey);
    capabilityConfig = defaultModelCapabilityConfig(config, entry, model);
  }

  const merged: ChannelModelRequest = {
    ...req,
    capability,
    protocol,
    capabilityConfig,
    enabled: req.enabled === undefined || req.enabled === null ? config.enabled : req.enabled,
  };
  if (hasPriceTiers) return merged;
  merged.unitPriceMicrocredits =
    req.unitPriceMicrocredits === undefined || req.unitPriceMicrocredits === null
      ? config.unitPriceMicrocredits
      : req.unitPriceMicrocredits;
  merged.inputTokenPriceMicrocredits =
    req.inputTokenPriceMicrocredits === undefined || req.inputTokenPriceMicrocredits === null
      ? config.inputTokenPriceMicrocredits
      : req.inputTokenPriceMicrocredits;
  merged.outputTokenPriceMicrocredits =
    req.outputTokenPriceMicrocredits === undefined || req.outputTokenPriceMicrocredits === null
      ? config.outputTokenPriceMicrocredits
      : req.outputTokenPriceMicrocredits;
  merged.cachedTokenPriceMicrocredits =
    req.cachedTokenPriceMicrocredits === undefined || req.cachedTokenPriceMicrocredits === null
      ? config.cachedTokenPriceMicrocredits
      : req.cachedTokenPriceMicrocredits;
  merged.billingMode = req.billingMode ?? config.billingMode;
  merged.priceConfigured = req.priceConfigured ?? true;
  return merged;
}
