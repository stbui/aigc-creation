import type { CapabilityRuntimeFilter, CapabilityTab } from './types';

export const CAPABILITY_TABS: ReadonlyArray<{ value: CapabilityTab; label: string }> = [
  { value: 'overview', label: '概览' },
  { value: 'bindings', label: '绑定' },
  { value: 'pricing', label: '能力售价' },
  { value: 'impact', label: '影响面' },
];

export const RUNTIME_FILTER_OPTIONS: ReadonlyArray<{
  value: CapabilityRuntimeFilter;
  label: string;
}> = [
  { value: 'remote', label: '云端模型' },
  { value: 'disabled', label: '已下线' },
  { value: 'unavailable', label: '暂不可用' },
];

export function isCapabilityTab(value: string | null | undefined): value is CapabilityTab {
  return CAPABILITY_TABS.some((tab) => tab.value === value);
}

export function isRuntimeFilter(
  value: string | null | undefined,
): value is CapabilityRuntimeFilter {
  return RUNTIME_FILTER_OPTIONS.some((option) => option.value === value);
}

/** 下线不要求运营手填原因，统一给 C 端一句可读提示。 */
export const DEFAULT_OFFLINE_REASON = '该能力已暂时下线，请稍后再试。';
