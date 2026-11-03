/**
 * 前台模型的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 */

import type { AdminLogicalModelView, AdminLogicalRouteView } from '../../../types/model';
import { parseCredits, toCreditsInput } from '../../../lib/microcredits';
import type { ModelDraft, RouteDraft } from './constants';

export { parseCredits, toCreditsInput };

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
