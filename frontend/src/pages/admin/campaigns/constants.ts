/**
 * 限时活动的类型 / 状态文案与表单状态。
 *
 * payload 字段随类型而变，表单用一个扁平 `FormState` 承接三种类型，
 * 提交时只取当前类型需要的字段（见 `buildCampaignPayload`）。
 */

import type { AdminCampaign, CampaignStatus, CampaignType } from '../../../types/api';

export const TYPE_LABEL: Record<CampaignType, string> = {
  limited_price: '限时价',
  limited_free: '限时免费',
  popup: '弹窗位',
};

export const STATUS_LABEL: Record<CampaignStatus, { label: string; tone: string }> = {
  draft: { label: '草稿', tone: 'muted' },
  active: { label: '进行中', tone: 'success' },
  ended: { label: '已结束', tone: 'warn' },
  off: { label: '已下线', tone: 'muted' },
};

export const TYPE_OPTIONS = Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }));

export const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, item]) => ({
  value,
  label: item.label,
}));

/** 状态标签色调，与 `StatusTag` 的 `tone` 同形 */
export type TagTone = 'success' | 'danger' | 'warn' | 'brand' | 'muted';

/**
 * 派生生效态优先于人工 status 展示。
 * `status=active` 但时间窗未到，对用户就是不生效；把这种状态显示成「进行中」
 * 会让运营以为活动已在曝光，实际一条都没跑到。
 */
export const EFFECTIVE_META: Record<AdminCampaign['effective'], { label: string; tone: TagTone }> = {
  draft: { label: '草稿', tone: 'muted' },
  live: { label: '进行中', tone: 'success' },
  scheduled: { label: '未开始', tone: 'brand' },
  ended: { label: '已结束', tone: 'warn' },
  off: { label: '已下线', tone: 'muted' },
};

export interface FormState {
  name: string;
  type: CampaignType;
  startAt: string;
  endAt: string;
  status: CampaignStatus;
  onlyNewUsers: boolean;
  productId: string;
  /** 表单内统一填**元**，提交时换算成分 */
  priceCents: string;
  capabilityIds: string;
  title: string;
  body: string;
  ctaText: string;
  ctaUrl: string;
}
