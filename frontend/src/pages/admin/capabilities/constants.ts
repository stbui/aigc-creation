import type { CapabilityRuntime } from '../../../types/api';
import type { CapabilityRuntimeFilter, CapabilityTab } from './types';

export const CAPABILITY_TABS: ReadonlyArray<{ value: CapabilityTab; label: string }> = [
  { value: 'overview', label: '概览' },
  { value: 'bindings', label: '商品绑定' },
  { value: 'pricing', label: '售价' },
  { value: 'impact', label: '影响面' },
];

/**
 * 后台运行状态。
 *
 * 正常状态不需要额外标签，只有已下线 / 暂不可用这类异常需要主动提示。
 * 筛选器仍保留正常状态，便于运营只看异常能力。
 */
export const ADMIN_RUNTIME_LABELS: Record<CapabilityRuntime['effective'], string> = {
  remote: '运行正常',
  disabled: '已下线',
  unavailable: '暂不可用',
};

/** 能力卡片和页头只在异常时展示状态标签。 */
export function runtimeStatusLabel(effective: CapabilityRuntime['effective']): string | null {
  return effective === 'remote' ? null : ADMIN_RUNTIME_LABELS[effective];
}

export const RUNTIME_FILTER_OPTIONS: ReadonlyArray<{
  value: CapabilityRuntimeFilter;
  label: string;
}> = [
  { value: 'remote', label: ADMIN_RUNTIME_LABELS.remote },
  { value: 'disabled', label: ADMIN_RUNTIME_LABELS.disabled },
  { value: 'unavailable', label: ADMIN_RUNTIME_LABELS.unavailable },
];

export function isCapabilityTab(value: string | null | undefined): value is CapabilityTab {
  return CAPABILITY_TABS.some((tab) => tab.value === value);
}

export function isRuntimeFilter(
  value: string | null | undefined,
): value is CapabilityRuntimeFilter {
  return RUNTIME_FILTER_OPTIONS.some((option) => option.value === value);
}

/** 下线不要求运营手填原因，统一给用户一句可读提示。 */
export const DEFAULT_OFFLINE_REASON = '该能力已暂时下线，请稍后再试。';
