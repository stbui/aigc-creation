/**
 * C 端公开目录：能力下的模型分组。
 *
 * 前台模型层删除后，C 端看到的「模型」是同一能力下 `modelGroupKey` 相同的
 * 渠道模型集合。分组只是读取时的投影，没有主键、没有 revision：
 *   · 名称 / 图标取绑定优先级最高、排序最靠前的商品；
 *   · 能力合同由分组内线路的合同合并（参数预设取并集）；
 *   · 可用性按当前分组是否有可承接线路判定；
 *   · 售价来自能力级 `CapabilityPricing`，同一分组 / 不同线路同价。
 */

import { Injectable } from '@nestjs/common';
import { getCapability } from '../../capabilities/capability.registry';
import { capabilitySpecWithRoutePresets } from '../intent/capability-spec';
import { normalizeCapability } from '../domain/capability-config';
import type { CapabilitySpec, ModelRequestIntent } from '../intent/spec-types';
import type { UserGroupAccess } from '../user-groups/user-group.service';
import { CapabilityCatalogService } from './capability-catalog.service';
import { RouterService } from '../routing/router.service';
import type { CachedCapability, CachedCapabilityPricing, CachedModelGroup } from '../routing/routing.types';

export interface PublicModelGroup {
  /** 稳定标识：`capability:modelKey`，前端记忆与选择都用它 */
  id: string;
  capability: string;
  modelKey: string;
  name: string;
  icon: string;
  description: string;
  available: boolean;
  billingMode: string;
  priceLabel: string;
  displayPrice: number | null;
  /** 分组展示排序：取组内最优线路的 sortOrder */
  sortOrder: number;
  capabilitySpec: CapabilitySpec;
  /** 该分组当前可供货的渠道数（不暴露渠道名） */
  supplyCount: number;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly catalog: CapabilityCatalogService,
    private readonly router: RouterService,
  ) {}

  /** 某能力的模型分组；`intent` 给出时只保留可承接该参数组合的分组 */
  async publicGroups(
    access: UserGroupAccess | null,
    capabilityId: string,
    intent?: ModelRequestIntent,
  ): Promise<PublicModelGroup[]> {
    const snapshot = await this.catalog.snapshotOrThrow();
    const capability = snapshot.capabilities.get(String(capabilityId ?? '').trim());
    if (!capability) return [];
    // 入参的 capability 是产品能力 id；匹配合同要用产出模态
    const matchedIntent = intent
      ? { ...intent, capability: capabilityModality(capability.id) }
      : null;
    const result: PublicModelGroup[] = [];
    for (const key of capability.orderedGroupKeys) {
      const group = capability.groups.get(key);
      if (!group) continue;
      const available = await this.router.groupAvailable(access, capability.id, key, matchedIntent);
      if (intent && !available) continue;
      result.push(this.project(capability, group, available));
    }
    return result;
  }

  /** 单个分组 */
  async publicGroup(
    access: UserGroupAccess | null,
    capabilityId: string,
    modelKey: string,
  ): Promise<PublicModelGroup | null> {
    const snapshot = await this.catalog.snapshotOrThrow();
    const capability = snapshot.capabilities.get(String(capabilityId ?? '').trim());
    const group = capability?.groups.get(String(modelKey ?? '').trim());
    if (!capability || !group) return null;
    const available = await this.router.groupAvailable(access, capability.id, group.modelKey, null);
    return this.project(capability, group, available);
  }

  /** 全量目录：按能力平铺，供工作台首屏一次取回 */
  async publicAll(access: UserGroupAccess | null): Promise<PublicModelGroup[]> {
    const snapshot = await this.catalog.snapshotOrThrow();
    const result: PublicModelGroup[] = [];
    for (const capability of snapshot.capabilities.values()) {
      for (const key of capability.orderedGroupKeys) {
        const group = capability.groups.get(key);
        if (!group) continue;
        const available = await this.router.groupAvailable(access, capability.id, key, null);
        result.push(this.project(capability, group, available));
      }
    }
    return result;
  }

  private project(
    capability: CachedCapability,
    group: CachedModelGroup,
    available: boolean,
  ): PublicModelGroup {
    const specs = group.lines.map((line) => line.channelModel.capabilitySpec).filter(Boolean);
    const base: CapabilitySpec = specs[0] ?? { version: 1, capability: capabilityModality(capability.id) };
    const capabilitySpec = specs.length > 0
      ? capabilitySpecWithRoutePresets(base, specs)
      : (base as CapabilitySpec);
    const pricing = capability.pricing;
    const display = displayOf(pricing);
    return {
      id: `${capability.id}:${group.modelKey}`,
      capability: capability.id,
      modelKey: group.modelKey,
      name: group.displayName || group.modelKey,
      icon: group.icon,
      description: '',
      available: available && pricing.configured,
      billingMode: pricing.billingMode,
      priceLabel: pricing.configured ? display.label : '未配置',
      displayPrice: pricing.configured ? display.price : null,
      sortOrder: Math.min(...group.lines.map((line) => line.channelModel.sortOrder), Number.MAX_SAFE_INTEGER),
      capabilitySpec,
      supplyCount: group.lines.filter(
        (line) => line.enabled && line.channelModel.enabled && line.channelModel.channelEnabled,
      ).length,
    };
  }
}

function capabilityModality(capabilityId: string): string {
  return normalizeCapability(getCapability(capabilityId)?.model?.capability ?? '');
}

function displayOf(pricing: CachedCapabilityPricing): { price: number | null; label: string } {
  if (pricing.billingMode === 'fixed_request') {
    return { price: pricing.unitPriceMicrocredits, label: '' };
  }
  if (pricing.billingMode === 'per_second') {
    return { price: pricing.unitPriceMicrocredits, label: '按秒' };
  }
  if (pricing.billingMode === 'token') {
    const price = pricing.outputTokenPriceMicrocredits || pricing.inputTokenPriceMicrocredits;
    return { price: price > 0 ? price : null, label: '按 Token' };
  }
  return { price: null, label: '未配置' };
}
