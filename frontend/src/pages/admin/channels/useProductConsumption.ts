import { useMemo } from 'react';
import { adminLogicalModelsApi } from './api';
import { useAdmin, useAdminResource, useCapabilities } from './hooks';
import type { AdminChannelView, AdminLogicalModelView } from '../../../types/model';

/**
 * 商品被哪些能力消费。
 *
 * 数据不需要新接口：前台模型的 `routes[].channelModelId` 就是消费关系。
 * 这里把「前台模型 → 线路」反查成「渠道模型 → 能力列表」，供商品台账与
 * 单供应商商品清单共用。
 *
 * 权限：读取前台模型需要 `logical_model.read`。没有权限时只返回
 * `available=false`，页面显示 `—`，不把整张商品表挡掉。
 */
export interface ProductConsumptionRef {
  logicalModelId: string;
  modelName: string;
  capabilityId: string;
  capabilityName: string;
  enabled: boolean;
  available: boolean;
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

/** 纯函数，单测直接覆盖；hook 只负责取数与权限判断 */
export function buildConsumptionIndex(
  models: AdminLogicalModelView[],
  capabilityNames: Map<string, string>,
): Map<string, ProductConsumptionRef[]> {
  const index = new Map<string, ProductConsumptionRef[]>();

  for (const model of models) {
    if (model.archivedAt) continue;
    const ref: ProductConsumptionRef = {
      logicalModelId: model.id,
      modelName: model.name,
      capabilityId: model.capability,
      capabilityName: capabilityNames.get(model.capability) ?? model.capability,
      enabled: model.enabled,
      available: model.available,
    };
    for (const route of model.routes) {
      const list = index.get(route.channelModelId);
      if (list) list.push(ref);
      else index.set(route.channelModelId, [ref]);
    }
  }

  return index;
}

/** 与 `buildConsumptionIndex` 同源，按「渠道 + 上游模型键」反查；供应商级影响面用 */
export function buildConsumptionKeyIndex(
  models: AdminLogicalModelView[],
  capabilityNames: Map<string, string>,
): Map<string, ProductConsumptionRef[]> {
  const index = new Map<string, ProductConsumptionRef[]>();

  for (const model of models) {
    if (model.archivedAt) continue;
    const ref: ProductConsumptionRef = {
      logicalModelId: model.id,
      modelName: model.name,
      capabilityId: model.capability,
      capabilityName: capabilityNames.get(model.capability) ?? model.capability,
      enabled: model.enabled,
      available: model.available,
    };
    for (const route of model.routes) {
      const key = `${route.channelId}:${route.channelModelKey || route.channelModelId}`;
      const list = index.get(key);
      if (list) list.push(ref);
      else index.set(key, [ref]);
    }
  }

  return index;
}

/** 同一能力可能由多个售卖配置消费，影响面只报一次 */
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

/** 供应商影响面：只统计在售商品（enabled + 已定价）被谁消费 */
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
  const resource = useAdminResource<AdminLogicalModelView[]>(
    () => (readable ? adminLogicalModelsApi.list(false) : Promise.resolve([])),
    [readable],
  );

  const capabilityNames = useMemo(
    () =>
      new Map(
        (capabilities.data?.items ?? []).map((item) => [item.id, item.name] as const),
      ),
    [capabilities.data],
  );

  const byModelId = useMemo(
    () => buildConsumptionIndex(resource.data ?? [], capabilityNames),
    [capabilityNames, resource.data],
  );
  const byModelKey = useMemo(
    () => buildConsumptionKeyIndex(resource.data ?? [], capabilityNames),
    [capabilityNames, resource.data],
  );

  return {
    byModelId,
    byModelKey,
    loading: readable && (resource.loading || capabilities.loading),
    error: resource.error ?? capabilities.error,
    available: readable,
  };
}
