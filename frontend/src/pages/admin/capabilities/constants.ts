import type { CapabilityRuntime } from '../../../types/api';
import type { CapabilityRuntimeFilter, CapabilityTab } from './types';

export const CAPABILITY_TABS: ReadonlyArray<{ value: CapabilityTab; label: string }> = [
  { value: 'overview', label: '概览' },
  { value: 'bindings', label: '商品绑定' },
  { value: 'pricing', label: '售价' },
  { value: 'impact', label: '影响面' },
];

/**
 * 后台运行结论。
 *
 * C 端顶部沿用的 `RUNTIME_LABELS` 是「云端模型 / 已下线」的实现口径；运营
 * 在这里关心的是「现在能不能承接下单」，所以单独用业务口径，不改 C 端文案。
 */
export const ADMIN_RUNTIME_LABELS: Record<CapabilityRuntime['effective'], string> = {
  remote: '可承接',
  disabled: '已下线',
  unavailable: '暂不可用',
};

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

/** 下线不要求运营手填原因，统一给 C 端一句可读提示。 */
export const DEFAULT_OFFLINE_REASON = '该能力已暂时下线，请稍后再试。';
