/**
 * 优惠券的文案映射与表单状态。
 *
 * 面额语义随类型而变（折扣是万分比、其余是分），展示与提交都必须先看
 * `type`，不能统一按元处理。
 */

import type { AdminCoupon, CouponScope, CouponStatus, CouponType } from '../../../types/api';
import type { TagTone } from '../../../components/admin/statusMeta';

export const TYPE_LABEL: Record<CouponType, string> = {
  full_cut: '满减',
  discount: '折扣',
  fixed: '固定额',
};

export const SCOPE_LABEL: Record<CouponScope, string> = {
  all: '全站',
  product: '指定商品',
  new_user: '仅新用户首单',
};

export const TYPE_OPTIONS = Object.entries(TYPE_LABEL).map(([value, label]) => ({
  value,
  label,
}));

export const SCOPE_OPTIONS = Object.entries(SCOPE_LABEL).map(([value, label]) => ({
  value,
  label,
}));

export const STATUS_OPTIONS = [
  { value: 'on', label: '启用' },
  { value: 'off', label: '停用' },
];

/** 状态标签色调，与 `StatusTag` 的 `tone` 同形 */
export type { TagTone };

/** 券的派生生效态：优先于人工开关展示，过期/未开始/售罄不是「停用」 */
export const EFFECTIVE_META: Record<AdminCoupon['effective'], { label: string; tone: TagTone }> = {
  on: { label: '生效中', tone: 'success' },
  off: { label: '已停用', tone: 'muted' },
  expired: { label: '已过期', tone: 'warn' },
  not_started: { label: '未开始', tone: 'brand' },
  sold_out: { label: '已售罄', tone: 'danger' },
};

export interface FormState {
  code: string;
  name: string;
  type: CouponType;
  /** 折扣为万分比；满减 / 固定额为用户输入的**元** —— 只在 buildCouponPayload 换算一次 */
  value: string;
  /** 使用门槛，用户输入的**元** —— 只在 buildCouponPayload 换算一次 */
  threshold: string;
  scope: CouponScope;
  totalCount: string;
  perUserLimit: string;
  validFrom: string;
  validTo: string;
  status: CouponStatus;
}
