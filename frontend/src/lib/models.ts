import { API_ROOT, unwrapEnvelope } from './http';
import { getToken } from './auth';
import { readSelectedModelId } from './modelSelection';
import type { CapabilitySpecView } from '../types/model';

/**
 * C 端模型目录（`GET /api/v1/models`）。
 *
 * 前台模型层删除后，目录返回的是「能力下的模型分组」：同一 `modelKey` 挂在
 * 多条渠道时只出现一次，具体线路由服务端自动切换。建任务只表达
 * 「用哪个能力 + 哪个模型分组」，渠道、协议与价格全部在服务端解析。
 */

export interface PublicModelGroup {
  /** 稳定标识：`capability:modelKey` */
  id: string;
  capability: string;
  modelKey: string;
  name: string;
  icon: string;
  description: string;
  available: boolean;
  billingMode: string;
  priceLabel: string;
  /** 展示价（积分）；无法给出确定金额时为 null，以 `priceLabel` 兜底 */
  displayPrice: number | null;
  sortOrder: number;
  capabilitySpec: CapabilitySpecView;
  /** 该分组当前可供货的渠道数（不暴露渠道名） */
  supplyCount: number;
}

/** 与能力清单同节奏的短 TTL：后台改绑定/改价后不必整页刷新 */
const CACHE_TTL_MS = 5_000;

let cache: PublicModelGroup[] | null = null;
let cachedAt = 0;
let cacheKey = '';
let inflight: Promise<PublicModelGroup[]> | null = null;

function currentCacheKey(): string {
  return getToken() ? 'member' : 'guest';
}

export async function loadModels(force = false): Promise<PublicModelGroup[]> {
  const key = currentCacheKey();
  if (cache && !force && key === cacheKey && Date.now() - cachedAt < CACHE_TTL_MS) return cache;
  if (inflight && !force) return inflight;

  inflight = (async () => {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(`${API_ROOT}/models`, { headers });
    if (!res.ok) throw new Error(`模型目录加载失败（${res.status}）`);
    const data = unwrapEnvelope<{ models: PublicModelGroup[] }>(await res.json());
    cache = Array.isArray(data?.models) ? data.models : [];
    cachedAt = Date.now();
    cacheKey = key;
    return cache;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** 同步读取（仅用于目录已加载后的渲染） */
export function modelsSync(): PublicModelGroup[] {
  return cache ?? [];
}

/**
 * 为该能力选一个默认模型：优先可用项，同分按 `sortOrder` 升序。
 */
export function defaultModelFor(
  capability: string,
  models: PublicModelGroup[] = modelsSync(),
  requiredInputs: readonly string[] = [],
): PublicModelGroup | null {
  return modelsForCapability(capability, models, requiredInputs)[0] ?? null;
}

/**
 * 解析本次建任务实际会使用的模型分组。
 *
 * 优先用用户显式选过的模型（`lib/modelSelection`，按能力记忆）—— 但必须
 * 在当前目录里且可用：分组可能被移除或线路全部失效，此时静默回退到默认模型，
 * 而不是把一个不可用的 modelKey 发给后端。
 */
export async function resolveModel(
  capability: string,
  requiredInputs: readonly string[] = [],
): Promise<PublicModelGroup> {
  const models = await loadModels();
  const candidates = modelsForCapability(capability, models, requiredInputs);
  const selectedId = readSelectedModelId(capability);
  const selected = selectedId ? candidates.find((m) => m.id === selectedId) : null;
  const model = selected?.available ? selected : defaultModelFor(capability, models, requiredInputs);
  if (!model) {
    throw new Error(
      requiredInputs.includes('mask')
        ? '当前没有支持遮罩重绘的模型，请稍后再试或联系客服'
        : '该能力当前没有可用模型，请稍后再试',
    );
  }
  if (!model.available) throw new Error('该能力当前没有可用线路，请稍后再试');
  return model;
}

/** 解析建任务要带的 `modelKey`（见 `resolveModel`） */
export async function resolveModelKey(
  capability: string,
  requiredInputs: readonly string[] = [],
): Promise<string> {
  return (await resolveModel(capability, requiredInputs)).modelKey;
}

/**
 * 模型能力合同声明的图片输入上限。
 *
 * `GET /models` 的 `capabilitySpec` 是运行时实际使用的同一份合同；读取这里
 * 的数字才能保证上传区与后端匹配规则一致。
 */
export function modelImageInputLimit(
  model: Pick<PublicModelGroup, 'capabilitySpec'>,
): number | null {
  const max = model.capabilitySpec?.inputs?.image?.max;
  return typeof max === 'number' && Number.isInteger(max) && max >= 0 ? max : null;
}

/**
 * 目录里该能力的候选模型分组（含不可用项，选择器需要把它们置灰列出）。
 */
export function modelsForCapability(
  capability: string,
  models: PublicModelGroup[] = modelsSync(),
  requiredInputs: readonly string[] = [],
): PublicModelGroup[] {
  return models
    .filter(
      (m) =>
        m.capability === capability &&
        requiredInputs.every((input) => Boolean(m.capabilitySpec?.inputs?.[input])),
    )
    .sort((a, b) => Number(b.available) - Number(a.available) || a.sortOrder - b.sortOrder);
}
