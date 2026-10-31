/**
 * 上游模型目录客户端（`GET {base}/models`）。
 *
 * 移植自 open-ai-canvas `FetchChannelModelCatalog`。只代理这一个固定的 GET：
 * 渠道凭证由宿主解密后注入，**不经过浏览器、不写日志**；出站仍走统一
 * `outboundRequest`，因此 SSRF、重定向、代理与体积上限全部生效。
 *
 * 只支持 `openai` 与 `gemini` 两种目录形态。其它格式显式拒绝 —— 猜一个
 * 「差不多」的地址只会让管理员看到一个与事实不符的错误。
 */

import { Injectable } from '@nestjs/common';
import { apiUrl } from '../protocol/executor';
import { getHeader, setHeader } from '../protocol/auth';
import { OutboundError, outboundRequest } from '../infra/outbound';
import { ModelDomainError } from '../domain/json';
import { matchModelCatalogDiscovery, extendCatalog } from './model-catalog.discovery';
import type {
  ChannelModelCatalogItem,
  ChannelModelCatalogOption,
  ChannelModelCatalogRequest,
} from './model-catalog.types';

/** 目录请求超时：目录通常很小，60 秒足够；不沿用生成请求的 5 分钟 */
const CATALOG_TIMEOUT_MS = 60 * 1000;

@Injectable()
export class ModelCatalogClient {
  async fetch(input: ChannelModelCatalogRequest): Promise<ChannelModelCatalogItem[]> {
    const baseUrl = String(input.baseUrl ?? '').trim().replace(/\/+$/, '');
    if (baseUrl === '') throw new ModelDomainError('请先填写 Base URL');
    if (String(input.apiKey ?? '').trim() === '') throw new ModelDomainError('请先填写 API Key');

    const apiFormat = String(input.apiFormat ?? '').trim().toLowerCase() || 'openai';
    if (apiFormat !== 'openai' && apiFormat !== 'gemini') {
      throw new ModelDomainError('接口协议不支持拉取模型');
    }

    const target = apiFormat === 'gemini' ? geminiModelsUrl(baseUrl) : apiUrl(baseUrl, '/models');
    const headers: Record<string, string> = {};
    if (apiFormat === 'gemini') setHeader(headers, 'x-goog-api-key', input.apiKey);
    else setHeader(headers, 'Authorization', `Bearer ${input.apiKey}`);
    for (const header of input.headers ?? []) {
      if (!header?.name) continue;
      setHeader(headers, header.name, String(header.value ?? ''));
    }
    if (!getHeader(headers, 'accept')) setHeader(headers, 'Accept', 'application/json');

    let response;
    try {
      response = await outboundRequest(target, {
        method: 'GET',
        headers,
        timeoutMs: input.timeoutMs ?? CATALOG_TIMEOUT_MS,
        proxyUrl: input.proxyUrl ?? null,
      });
    } catch (error) {
      throw upstreamError(error);
    }
    if (response.status < 200 || response.status >= 300) {
      throw statusError(response.status);
    }

    let payload: any;
    try {
      payload = JSON.parse(response.text || '{}');
    } catch {
      throw new ModelDomainError('模型服务返回的不是有效 JSON', 50201);
    }
    if (payload?.error && String(payload.error.message ?? '').trim() !== '') {
      throw new ModelDomainError('模型服务返回失败，请检查渠道配置', 50201);
    }
    if (payload?.code !== undefined && payload?.code !== null && Number(payload.code) !== 0) {
      throw new ModelDomainError('模型服务返回失败，请检查渠道配置', 50201);
    }

    const items: any[] = Array.isArray(apiFormat === 'gemini' ? payload?.models : payload?.data)
      ? apiFormat === 'gemini'
        ? payload.models
        : payload.data
      : [];
    const catalog: ChannelModelCatalogItem[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const id = String(item?.id ?? item?.name ?? '')
        .trim()
        .replace(/^models\//, '');
      if (id === '' || seen.has(id)) continue;
      seen.add(id);
      catalog.push({
        id,
        displayName: String(item?.display_name ?? item?.displayName ?? '').trim() || undefined,
        modelType: normalizeModelType(item?.model_type ?? item?.modelType),
        supportedEndpointTypes: uniqueStrings(item?.supported_endpoint_types ?? item?.supportedEndpointTypes),
        defaultParameters: normalizeDefaultParameters(item?.default_parameters ?? item?.defaultParameters),
        options: normalizeOptions(item?.options),
        supportsImages: boolOrUndefined(item?.supports_images ?? item?.supportsImages),
        minImages: intOrUndefined(item?.min_images ?? item?.minImages),
        maxImages: intOrUndefined(item?.max_images ?? item?.maxImages),
      });
    }
    catalog.sort((left, right) => left.id.localeCompare(right.id));

    const discovery = matchModelCatalogDiscovery(baseUrl, input.headers ?? []);
    return discovery ? extendCatalog(catalog, discovery.additionalModels()) : catalog;
  }
}

function geminiModelsUrl(baseUrl: string): string {
  const base = baseUrl.toLowerCase().endsWith('/v1beta') ? baseUrl : `${baseUrl}/v1beta`;
  return `${base}/models`;
}

function normalizeModelType(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['text', 'image', 'video', 'audio'].includes(normalized) ? normalized : undefined;
}

function normalizeDefaultParameters(value: any): ChannelModelCatalogItem['defaultParameters'] {
  if (!value || typeof value !== 'object') return undefined;
  const aspectRatio = String(value.aspect_ratio ?? value.aspectRatio ?? '').trim();
  const durationSeconds = String(value.duration_seconds ?? value.durationSeconds ?? '').trim();
  const resolution = String(value.resolution ?? '').trim();
  if (aspectRatio === '' && durationSeconds === '' && resolution === '') return undefined;
  return {
    ...(aspectRatio !== '' ? { aspectRatio } : {}),
    ...(durationSeconds !== '' ? { durationSeconds } : {}),
    ...(resolution !== '' ? { resolution } : {}),
  };
}

function normalizeOptions(value: any): ChannelModelCatalogItem['options'] {
  if (!value || typeof value !== 'object') return undefined;
  const build = (raw: unknown): ChannelModelCatalogOption[] => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const result: ChannelModelCatalogOption[] = [];
    for (const item of raw) {
      const optionValue = String(item?.value ?? '').trim();
      if (optionValue === '' || seen.has(optionValue)) continue;
      seen.add(optionValue);
      const label = String(item?.label ?? '').trim();
      result.push(label === '' ? { value: optionValue } : { value: optionValue, label });
    }
    return result;
  };
  const aspectRatio = build(value.aspect_ratio ?? value.aspectRatio);
  const durationSeconds = build(value.duration_seconds ?? value.durationSeconds);
  const resolution = build(value.resolution);
  if (aspectRatio.length + durationSeconds.length + resolution.length === 0) return undefined;
  return {
    ...(aspectRatio.length > 0 ? { aspectRatio } : {}),
    ...(durationSeconds.length > 0 ? { durationSeconds } : {}),
    ...(resolution.length > 0 ? { resolution } : {}),
  };
}

function uniqueStrings(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const value = String(item ?? '').trim();
    if (value === '' || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result.length > 0 ? result : undefined;
}

function boolOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function intOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : undefined;
}

/** 上游连不上：区分配置错误与网络错误，避免「检查地址」掩盖真实原因 */
function upstreamError(error: unknown): ModelDomainError {
  if (error instanceof ModelDomainError) return error;
  if (error instanceof OutboundError) {
    return new ModelDomainError(`连接模型服务失败：${error.message}`, 50201);
  }
  return new ModelDomainError(`连接模型服务失败：${(error as Error)?.message ?? '未知错误'}`, 50201);
}

function statusError(status: number): ModelDomainError {
  switch (status) {
    case 401:
    case 403:
      return new ModelDomainError('模型服务鉴权失败，请检查 API Key', 50201);
    case 404:
      return new ModelDomainError('模型服务未提供 /models 接口', 50201);
    case 429:
      return new ModelDomainError('模型服务请求过于频繁或额度不足', 50201);
    default:
      return new ModelDomainError(`模型服务返回 HTTP ${status}`, 50201);
  }
}
