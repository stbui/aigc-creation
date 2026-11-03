import { API_ROOT, unwrapEnvelope } from './http';
import { getToken } from './auth';
import { readSelectedModelId } from './modelSelection';
import type { CapabilitySpecView } from '../types/model';

/**
 * 前台模型目录数据层（`GET /api/v1/models`）。
 *
 * 建任务必须带 `logicalModelId`：渠道、协议、价格全部由服务端按所选模型解析，
 * 前端只表达「用哪个模型」。目录按登录用户的会员分组投影（分组决定可见线路
 * 与倍率价），因此缓存键必须区分身份 —— 否则退出登录后仍读着上一账号的价格。
 */

/** 价格档（按分辨率 / 时长选档，金额单位微积分） */
export interface ModelPriceTier {
  resolution: string;
  videoSeconds: number;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
}

export interface PublicLogicalModel {
  id: string;
  code: string;
  name: string;
  icon: string;
  description: string;
  /** 该模型提供服务的能力 id（与 `capability.registry` 一致） */
  capability: string;
  sortOrder: number;
  pricePolicy: string;
  pricingMode: string;
  /** 展示价（积分）；无法给出确定金额时为 null，以 `priceLabel` 兜底 */
  displayPrice: number | null;
  priceLabel: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputPriceMicrocredits: number;
  outputPriceMicrocredits: number;
  cachedPriceMicrocredits: number;
  priceTiers: ModelPriceTier[];
  legacyModelIds: string[];
  capabilitySpec: CapabilitySpecView;
  capabilityProfiles: CapabilitySpecView[];
  defaultOptions: Record<string, unknown>;
  /** 当前分组与参数下是否真的能跑；false 的模型不应作为默认选中项 */
  available: boolean;
}

/** 与能力清单同节奏的短 TTL：后台改线路/改价后不必整页刷新 */
const CACHE_TTL_MS = 5_000;

let cache: PublicLogicalModel[] | null = null;
let cachedAt = 0;
let cacheKey = '';
let inflight: Promise<PublicLogicalModel[]> | null = null;

function currentCacheKey(): string {
  return getToken() ? 'member' : 'guest';
}

export async function loadModels(force = false): Promise<PublicLogicalModel[]> {
  const key = currentCacheKey();
  if (cache && !force && key === cacheKey && Date.now() - cachedAt < CACHE_TTL_MS) return cache;
  if (inflight && !force) return inflight;

  inflight = (async () => {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(`${API_ROOT}/models`, { headers });
    if (!res.ok) throw new Error(`模型目录加载失败（${res.status}）`);
    const data = unwrapEnvelope<{ models: PublicLogicalModel[] }>(await res.json());
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
export function modelsSync(): PublicLogicalModel[] {
  return cache ?? [];
}

/**
 * 为该能力选一个默认模型：优先可用项，同分按 `sortOrder` 升序。
 *
 * 这是用户没有显式选择时的兜底（`ModelPicker` 的按能力记忆见 `lib/modelSelection`）：
 * 保证任务能落到真实线路上，而不是让用户在无感知的情况下选中一个不可用模型。
 */
export function defaultModelFor(
  capability: string,
  models: PublicLogicalModel[] = modelsSync(),
  requiredInputs: readonly string[] = [],
): PublicLogicalModel | null {
  return modelsForCapability(capability, models, requiredInputs)[0] ?? null;
}

/**
 * 解析本次建任务实际会使用的模型对象。
 *
 * 优先用用户显式选过的模型（`lib/modelSelection`，按能力记忆）—— 但必须
 * 在当前目录里且可用：模型可能被下架、线路可能失效，此时静默回退到默认模型，
 * 而不是把一个不可用的 id 发给后端换回 42204。
 *
 * 没有可用模型时抛错而不是发一个空 id 让后端回 40005 —— 前端先给出人话原因，
 * 用户知道是「这个能力暂时没有线路」而不是「提交失败」。
 */
export async function resolveModel(
  capability: string,
  requiredInputs: readonly string[] = [],
): Promise<PublicLogicalModel> {
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

/** 解析建任务要带的 `logicalModelId`（见 `resolveModel`） */
export async function resolveModelId(
  capability: string,
  requiredInputs: readonly string[] = [],
): Promise<string> {
  return (await resolveModel(capability, requiredInputs)).id;
}

/**
 * 模型能力合同声明的图片输入上限。
 *
 * `GET /models` 的 `capabilitySpec` 是路由实际使用的同一份合同；读取这里
 * 的数字才能保证上传区与后端匹配规则一致，不能前端另写一个固定上限。
 * 合同缺失或字段非法时返回 null，让调用方保留页面上限作为兜底。
 */
export function modelImageInputLimit(
  model: Pick<PublicLogicalModel, 'capabilitySpec'>,
): number | null {
  const max = model.capabilitySpec?.inputs?.image?.max;
  return typeof max === 'number' && Number.isInteger(max) && max >= 0 ? max : null;
}

/**
 * 目录里该能力的候选模型（含不可用项，选择器需要把它们置灰列出）。
 *
 * `requiredInputs` 描述本次请求一定会提交的输入槽位（如遮罩重绘的 `mask`）。
 * 缺少对应合同的模型不是「暂时不可用」，而是对该操作永远不可用，必须直接排除；
 * 否则选择器和提交解析会选中一条注定返回 42205 的线路。
 */
export function modelsForCapability(
  capability: string,
  models: PublicLogicalModel[] = modelsSync(),
  requiredInputs: readonly string[] = [],
): PublicLogicalModel[] {
  return models
    .filter(
      (m) =>
        m.capability === capability &&
        requiredInputs.every((input) => Boolean(m.capabilitySpec?.inputs?.[input])),
    )
    .sort((a, b) => Number(b.available) - Number(a.available) || a.sortOrder - b.sortOrder);
}
