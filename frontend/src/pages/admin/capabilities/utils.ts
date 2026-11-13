import type { AdminCapabilityControl } from '../../../types/api';
import type { CapabilityRuntimeFilter } from './types';

export function matchesCapabilityFilters(
  row: AdminCapabilityControl,
  keyword: string,
  runtime: CapabilityRuntimeFilter | undefined,
): boolean {
  if (runtime && row.runtime.effective !== runtime) return false;
  const query = keyword.trim().toLowerCase();
  if (!query) return true;
  return `${row.name} ${row.capabilityId} ${row.group}`.toLowerCase().includes(query);
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
 * 最终能否选到这条线路仍以运行结论 / 模拟选路为准（运行时还会叠加健康分层、
 * 能力合同等条件）；这里只统一后台三个显式开关的展示口径，避免概览、绑定和
 * 影响面各算一套。成本档只影响毛利可算性，按能力级售价体系不阻断选路。
 */
export function bindingIssue(row: BindingExecutionFields): string | null {
  if (!row.channelEnabled) return '供应商已停用';
  if (!row.modelEnabled) return '商品已停用';
  if (!row.enabled) return '未参与选路';
  return null;
}

export function bindingCanRun(row: BindingExecutionFields): boolean {
  return bindingIssue(row) === null;
}

/** 成本档缺失不是阻断项；只提示运营该线路的毛利无法计算。 */
export function bindingCostHint(row: { priceConfigured: boolean }): string | null {
  return row.priceConfigured ? null : '成本未配置，毛利不可算';
}
