/**
 * 会员套餐的纯函数入口 —— 目录内文件的唯一纯函数来源。
 *
 * 三条约束的落点：
 * 1. 编码创建后不可改（订单与外部对账靠它认套餐）；
 * 2. `free` 套餐允许 0 天，其余可购买套餐周期必须大于 0；
 * 3. 改价 / 改权益 / 上下架由后台审计自动记录动作。
 */

import type {
  AdminMembershipPlan,
  AdminMembershipPlanPayload,
  CreateAdminMembershipPlanPayload,
} from '../../../types/api';
import type { PlanDraft } from './constants';

/** 分 → 元 */
export function centsToYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 元 → 分。非法输入返回 null，由调用方拦截 */
export function yuanToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

/** 万分比 → 折扣百分比。9500 → 95 */
export function bpsToPercent(bps: number): string {
  return String(Math.round(bps / 100));
}

export function toDraft(plan: AdminMembershipPlan): PlanDraft {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    priceYuan: centsToYuan(plan.priceCents),
    durationDays: String(plan.durationDays),
    monthlyCredits: String(plan.monthlyCredits),
    fastChannel: plan.perks.fastChannel,
    maxConcurrent: String(plan.perks.maxConcurrent),
    discountPercent: bpsToPercent(plan.perks.addonDiscountBps),
    sortOrder: String(plan.sortOrder),
  };
}

export type PlanPayloadResult =
  | {
      ok: true;
      create: CreateAdminMembershipPlanPayload;
      update: AdminMembershipPlanPayload;
    }
  | { ok: false; error: string };

/**
 * 表单 → 新建 / 更新两套 payload。校验失败返回首条错误文案。
 *
 * 新建默认下架：确认无误后再手动上架，避免半成品套餐立刻可售。
 */
export function buildPlanPayload(
  draft: PlanDraft,
  opts: { creating: boolean; editingCode: string | null },
): PlanPayloadResult {
  const name = draft.name.trim();
  if (!name) return { ok: false, error: '请填写套餐名称' };
  if (opts.creating && !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(draft.code.trim())) {
    return { ok: false, error: '套餐编码只能是小写字母/数字/下划线/短横线，长度 2~40' };
  }

  const priceCents = yuanToCents(draft.priceYuan);
  if (priceCents === null) {
    return { ok: false, error: '价格格式不正确，请填两位小数，如 29.00' };
  }
  const durationDays = Number(draft.durationDays);
  if (!Number.isInteger(durationDays) || durationDays < 0) {
    return { ok: false, error: '周期必须是非负整数天' };
  }
  if (opts.editingCode !== 'free' && durationDays === 0) {
    return { ok: false, error: '可购买的套餐周期必须大于 0 天' };
  }
  const monthlyCredits = Number(draft.monthlyCredits);
  if (!Number.isInteger(monthlyCredits) || monthlyCredits < 0) {
    return { ok: false, error: '每月积分必须是非负整数' };
  }
  const maxConcurrent = Number(draft.maxConcurrent);
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 0 || maxConcurrent > 100) {
    return { ok: false, error: '并发上限必须是 0~100 的整数（0 表示不限）' };
  }
  const discountPercent = Number(draft.discountPercent);
  if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 100) {
    return { ok: false, error: '折扣必须是 1~100 的整数（100 表示无折扣）' };
  }
  const perks = {
    fastChannel: draft.fastChannel,
    maxConcurrent,
    addonDiscountBps: discountPercent * 100,
  };
  const sortOrder = Number(draft.sortOrder) || 0;

  const update: AdminMembershipPlanPayload = {
    name,
    description: draft.description.trim(),
    priceCents,
    durationDays,
    monthlyCredits,
    perks,
    sortOrder,
  };

  return {
    ok: true,
    create: {
      ...update,
      code: draft.code.trim(),
      status: 'offline',
    },
    update,
  };
}
