import { toCredits } from '../../../lib/microcredits';
import type { AdminCapabilityControl } from '../../../types/api';
import type { CapabilityPricingView } from '../../../types/model';
import type { CapabilityRuntimeFilter } from './types';

export function matchesCapabilityFilters(
  row: AdminCapabilityControl,
  keyword: string,
  runtime: CapabilityRuntimeFilter | undefined,
): boolean {
  if (runtime && row.runtime.effective !== runtime) return false;
  const query = keyword.trim().toLowerCase();
  if (!query) return true;
  return `${row.name} ${row.capabilityId} ${row.group} ${row.groupName}`
    .toLowerCase()
    .includes(query);
}

export function runtimeTone(effective: AdminCapabilityControl['runtime']['effective']) {
  if (effective === 'remote') return 'success' as const;
  if (effective === 'disabled') return 'muted' as const;
  return 'warn' as const;
}

export function formatUpdatedAt(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

type BindingExecutionFields = {
  enabled: boolean;
  channelEnabled: boolean;
  modelEnabled: boolean;
};

/**
 * 单个绑定的**配置可执行性**。
 *
 * 最终能否用于生成仍以运行结论 / 可用性检查为准（运行时还会叠加健康分层、
 * 能力合同等条件）；这里只统一后台三个显式开关的展示口径，避免概览、商品绑定
 * 和影响面各算一套。成本档只影响毛利可算性，按能力级售价体系不阻断使用。
 */
export function bindingIssue(row: BindingExecutionFields): string | null {
  if (!row.channelEnabled) return '供应商已停用';
  if (!row.modelEnabled) return '商品已停用';
  if (!row.enabled) return '商品开关已关闭';
  return null;
}

export function bindingConfigAvailable(row: BindingExecutionFields): boolean {
  return bindingIssue(row) === null;
}

/** 成本档缺失不是阻断项；只提示运营该商品的毛利无法计算。 */
export function bindingCostHint(row: { priceConfigured: boolean }): string | null {
  return row.priceConfigured ? null : '成本未配置，毛利不可算';
}

/** 计费单位后缀：后台售价统一写成「积分 / 次」「积分 / 秒」。 */
export function billingUnitLabel(billingMode: string | undefined): string {
  if (billingMode === 'per_second') return '秒';
  if (billingMode === 'token') return 'Token';
  return '次';
}

/**
 * 能力售价的一行摘要。
 *
 * 按 Token 计价时单值 `unitPriceMicrocredits` 不参与计费，不能把它当「单价」
 * 展示成 0；这种情况直接说明计费方式，明细留在「售价」页。
 */
export function capabilityPriceText(
  pricing: Pick<CapabilityPricingView, 'billingMode' | 'unitPriceMicrocredits'> | null | undefined,
): string {
  if (!pricing) return '—';
  if (pricing.billingMode === 'token') return '按 Token 计费';
  return `${toCredits(pricing.unitPriceMicrocredits)} 积分 / ${billingUnitLabel(pricing.billingMode)}`;
}
