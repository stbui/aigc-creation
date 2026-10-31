/**
 * 补充模型目录的注册表。
 *
 * 与协议插件同构：内置发现器按注册顺序匹配，**先匹配先得**（不按 map 遍历，
 * 否则多个厂商规则命中时结果不稳定）。发现器只补充模型元数据，不发起网络
 * 请求、不接触凭证 —— 标准 `/models` 的鉴权与出站边界仍由客户端统一负责。
 */

import { bailianDiscovery } from './discovery/bailian';
import type { ChannelModelCatalogItem, ModelCatalogDiscovery } from './model-catalog.types';

const DISCOVERIES: ModelCatalogDiscovery[] = [bailianDiscovery];

/** 按 Base URL 匹配补充目录；没有匹配返回 null */
export function matchModelCatalogDiscovery(
  baseUrl: string,
  headers: Array<{ name: string; value: string }> = [],
): ModelCatalogDiscovery | null {
  for (const discovery of DISCOVERIES) {
    if (discovery.match(baseUrl, headers)) return discovery;
  }
  return null;
}

/** 合并补充目录：同 ID 时补齐空字段，不覆盖上游实际返回值 */
export function extendCatalog(catalog: ChannelModelCatalogItem[], extra: ChannelModelCatalogItem[]): ChannelModelCatalogItem[] {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  for (const item of extra) {
    const id = String(item.id ?? '').trim();
    if (id === '') continue;
    const current = byId.get(id);
    if (current) {
      if (!current.displayName) current.displayName = item.displayName;
      if (!current.modelType) current.modelType = item.modelType;
      if (!current.supportedEndpointTypes?.length) current.supportedEndpointTypes = item.supportedEndpointTypes;
      continue;
    }
    byId.set(id, { ...item });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}
