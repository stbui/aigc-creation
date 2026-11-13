import { useMemo } from 'react';
import { adminCapabilityModelsApi } from './api';
import { useAdmin, useAdminResource, useCapabilities } from './hooks';
import type { AdminChannelView } from '../../../types/model';

/**
 * 商品被哪些能力消费。
 *
 * 数据来自 `GET /admin/capability-models/consumption`（能力绑定反查），
 * 供商品台账与单供应商商品清单共用。
 *
 * 权限：读取绑定需要 `logical_model.read`。没有权限时只返回
 * `available=false`，页面显示 `—`，不把整张商品表挡掉。
 */
export interface ProductConsumptionRef {
  modelKey: string;
  modelName: string;
  capabilityId: string;
  capabilityName: string;
  enabled: boolean;
  available: boolean;
}

export interface ConsumptionRow {
  channelModelId: string;
  channelId: string;
  modelKey: string;
  capabilityId: string;
  capabilityName: string;
}

export interface ProductConsumptionState {
  /** 商品 id → 消费它的能力 */
  byModelId: Map<string, ProductConsumptionRef[]>;
  /** `${channelId}:${channelModelKey}` → 消费它的能力；用于供应商级影响面 */
  byModelKey: Map<string, ProductConsumptionRef[]>;
  loading: boolean;
  error: string | null;
  available: boolean;
}

function rowToRef(row: ConsumptionRow): ProductConsumptionRef {
  return {
    modelKey: row.channelModelId,
    modelName: row.modelKey,
    capabilityId: row.capabilityId,
    capabilityName: row.capabilityName || row.capabilityId,
    enabled: true,
    available: true,
  };
}

/** 纯函数，单测直接覆盖；hook 只负责取数与权限判断 */
export function buildConsumptionIndex(rows: ConsumptionRow[]): Map<string, ProductConsumptionRef[]> {
  const index = new Map<string, ProductConsumptionRef[]>();
  for (const row of rows) {
    const list = index.get(row.channelModelId);
    const ref = rowToRef(row);
    if (list) list.push(ref);
    else index.set(row.channelModelId, [ref]);
  }
  return index;
}

/** 与 `buildConsumptionIndex` 同源，按「渠道 + 上游模型键」反查；供应商级影响面用 */
export function buildConsumptionKeyIndex(rows: ConsumptionRow[]): Map<string, ProductConsumptionRef[]> {
  const index = new Map<string, ProductConsumptionRef[]>();
  for (const row of rows) {
    const key = `${row.channelId}:${row.modelKey}`;
    const list = index.get(key);
    const ref = rowToRef(row);
    if (list) list.push(ref);
    else index.set(key, [ref]);
  }
  return index;
}

/** 同一能力可能由多个商品消费，影响面只报一次 */
export function uniqueConsumedCapabilities(
  refs: ProductConsumptionRef[],
): ProductConsumptionRef[] {
  const byCapability = new Map<string, ProductConsumptionRef>();
  for (const ref of refs) {
    const current = byCapability.get(ref.capabilityId);
    if (!current || (!current.available && ref.available)) {
      byCapability.set(ref.capabilityId, ref);
    }
  }
  return [...byCapability.values()];
}

/** 供应商影响面：只统计在售商品被谁消费 */
export function channelConsumptionRefs(
  channel: Pick<AdminChannelView, 'id' | 'modelCosts'>,
  byModelKey: Map<string, ProductConsumptionRef[]>,
): ProductConsumptionRef[] {
  return (channel.modelCosts ?? []).flatMap(
    (cost) => byModelKey.get(`${channel.id}:${cost.model}`) ?? [],
  );
}

/** 确认框里的一行人话：影响哪些能力，或明确「没人消费」 */
export function consumptionImpactText(refs: ProductConsumptionRef[]): string {
  const unique = uniqueConsumedCapabilities(refs);
  if (unique.length === 0) return '当前没有被任何能力消费';
  const names = unique.slice(0, 3).map((ref) => ref.capabilityName);
  return `影响 ${unique.length} 个能力（${names.join('、')}${unique.length > 3 ? ' 等' : ''}）`;
}

export function useProductConsumption(): ProductConsumptionState {
  const { can } = useAdmin();
  const readable = can('logical_model.read');
  const capabilities = useCapabilities();
  const resource = useAdminResource<ConsumptionRow[]>(
    () =>
      readable
        ? adminCapabilityModelsApi.consumption().then((result) => result.items ?? [])
        : Promise.resolve([]),
    [readable],
  );

  const rows = useMemo(
    () =>
      (resource.data ?? []).map((row) => ({
        ...row,
        capabilityName:
          row.capabilityName ||
          capabilities.data?.items.find((item) => item.id === row.capabilityId)?.name ||
          row.capabilityId,
      })),
    [capabilities.data, resource.data],
  );

  const byModelId = useMemo(() => buildConsumptionIndex(rows), [rows]);
  const byModelKey = useMemo(() => buildConsumptionKeyIndex(rows), [rows]);

  return {
    byModelId,
    byModelKey,
    loading: readable && (resource.loading || capabilities.loading),
    error: resource.error ?? capabilities.error,
    available: readable,
  };
}
