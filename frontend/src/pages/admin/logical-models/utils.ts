/**
 * 前台模型的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 */

import type { AdminLogicalModelView, AdminLogicalRouteView } from '../../../types/model';
import { parseCredits, toCreditsInput } from '../../../lib/microcredits';
import type { ModelDraft, RouteDraft } from './constants';

export { parseCredits, toCreditsInput };

/** 添加商品时只需要能力清单里的路由元信息，不需要把完整能力定义带进表单。 */
export interface CapabilityRoutingDefinition {
  modality?: string;
  inputs: number;
  model?: {
    capability?: string;
    operation?: string;
  };
}

/**
 * 根据所选能力补齐新模型的能力范围。
 *
 * 运营只需要选择业务能力，不需要手写底层规则；带参考图的生成能力同时支持
 * 文生图与图生图，避免保存后部分使用场景被误判为不支持。
 */
export function defaultCapabilitySpecFor(
  definition: CapabilityRoutingDefinition | null | undefined,
): { version: number; capability: string; operations: string[] } | null {
  const capability = definition?.model?.capability ?? definition?.modality;
  if (!capability) return null;

  const operations = new Set<string>();
  const primaryOperation = definition?.model?.operation?.trim();
  if (primaryOperation) operations.add(primaryOperation);
  if (
    capability === 'image' &&
    primaryOperation === 'text_to_image' &&
    (definition?.inputs ?? 0) > 0
  ) {
    operations.add('image_to_image');
  }

  return { version: 1, capability, operations: [...operations] };
}

export function routeToDraft(route: AdminLogicalRouteView): RouteDraft {
  return {
    key: route.id,
    channelModelId: route.channelModelId,
    enabled: route.enabled,
    priority: String(route.priority),
    weight: String(route.weight),
  };
}

export function toDraft(model: AdminLogicalModelView): ModelDraft {
  return {
    code: model.code,
    name: model.name,
    icon: model.icon,
    description: model.description,
    capability: model.capability,
    sortOrder: String(model.sortOrder),
    enabled: model.enabled,
    pricePolicy: model.pricePolicy || 'channel',
    billingMode: model.billingMode || 'fixed_request',
    unitPrice: toCreditsInput(model.unitPriceMicrocredits),
    inputPrice: toCreditsInput(model.inputPriceMicrocredits),
    outputPrice: toCreditsInput(model.outputPriceMicrocredits),
    cachedPrice: toCreditsInput(model.cachedPriceMicrocredits),
    capabilitySpecText: JSON.stringify(model.capabilitySpec ?? {}, null, 2),
    defaultOptionsText: JSON.stringify(model.defaultOptions ?? {}, null, 2),
    routes: model.routes.map(routeToDraft),
  };
}
