/** 能力绑定草稿：提交前允许运营调整启停、优先级与权重。 */
export interface BindingDraft {
  channelModelId: string;
  enabled: boolean;
  priority: number;
  weight: number;
  modelKey: string;
  displayName: string;
  channelName: string;
  channelEnabled: boolean;
  modelEnabled: boolean;
  priceConfigured: boolean;
}

export type CapabilityRuntimeFilter = 'remote' | 'disabled' | 'unavailable';

export type CapabilityTab = 'overview' | 'bindings' | 'pricing' | 'impact';
