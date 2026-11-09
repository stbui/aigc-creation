/**
 * 邀请与签到的页签、状态文案与选项表。
 *
 * 状态文案只在这里维护一份：表格状态列、筛选下拉、补发确认弹窗都从本文件取，
 * 否则同一状态在表里叫「待发放」、在筛选里叫「未发放」。
 */

import type { AdminCheckinListResult, AdminInviteListResult } from '../../../types/api';

/** 状态标签色调，与 `StatusTag` 的 `tone` 同形 */
export type TagTone = 'success' | 'danger' | 'warn' | 'brand' | 'muted';

export type InviteRow = AdminInviteListResult['items'][number];
export type CheckinRow = AdminCheckinListResult['items'][number];
export type RewardStatus = InviteRow['rewardStatus'];

/**
 * 页签。
 *
 * 规则是配置、两张表是流水，共用一个页面但不共用版面：规则面板限宽 760，
 * 列表要横向铺开 —— 叠在同一屏里表格会被挤进窄面板的宽度。
 */
export const TAB_OPTIONS = [
  { value: 'rules', label: '规则配置' },
  { value: 'invites', label: '邀请关系' },
  { value: 'checkins', label: '签到记录' },
] as const;

export type TabValue = (typeof TAB_OPTIONS)[number]['value'];

export const DEFAULT_TAB: TabValue = 'rules';

/**
 * 邀请奖励状态。
 *
 * `pending` 不是失败：默认发放时机是被邀请人**首次支付**，没付款就一直停在
 * 待发放；规则停用时同样停在 pending，规则重开后仍可补发。
 */
export const REWARD_STATUS_META: Record<
  RewardStatus,
  { label: string; tone: TagTone; hint: string }
> = {
  pending: { label: '待发放', tone: 'warn', hint: '尚未满足发放条件，可在满足后由后台补发' },
  granted: { label: '已发放', tone: 'success', hint: '双方奖励已写入积分账本' },
  rejected: { label: '已拒绝', tone: 'muted', hint: '自邀请等无效关系，不会发放奖励' },
};

export const REWARD_STATUS_OPTIONS = (
  Object.keys(REWARD_STATUS_META) as RewardStatus[]
).map((value) => ({ value, label: REWARD_STATUS_META[value].label }));
