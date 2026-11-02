/**
 * 用户分组的徽标选项与表单草稿结构。
 *
 * 倍率入库为万分比（`ratioBasisPoints`），表单里是百分比（100 = 原价）；
 * 汇率入库为微积分，表单里是普通积分 —— 换算只在 `utils.ts` 的
 * `buildGroupPayload` / `toDraft` 一处发生。
 */

export const BADGE_STYLE_OPTIONS = [
  { value: 'none', label: '无徽标' },
  { value: 'vip', label: 'VIP' },
  { value: 'svip', label: 'SVIP' },
];

export const BADGE_STYLE_LABELS: Record<string, string> = {
  none: '无',
  vip: 'VIP',
  svip: 'SVIP',
};

export interface OverrideDraft {
  modelKey: string;
  ratioPercent: string;
  pointsPerUsd: string;
  pointsPerCny: string;
}

export interface GroupDraft {
  code: string;
  name: string;
  description: string;
  badgeLabel: string;
  badgeStyle: string;
  sortOrder: string;
  ratioPercent: string;
  pointsPerUsd: string;
  pointsPerCny: string;
  allChannels: boolean;
  channelIds: string[];
  overrides: OverrideDraft[];
  reason: string;
}

export const EMPTY_DRAFT: GroupDraft = {
  code: '',
  name: '',
  description: '',
  badgeLabel: '',
  badgeStyle: 'none',
  sortOrder: '0',
  ratioPercent: '100',
  pointsPerUsd: '1',
  pointsPerCny: '0.14',
  allChannels: true,
  channelIds: [],
  overrides: [],
  reason: '',
};
