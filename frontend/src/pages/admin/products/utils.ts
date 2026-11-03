/**
 * 商品的纯函数入口 —— 目录内文件的唯一纯函数来源。
 *
 * 库里一律整数分：浮点算钱会在对账时出现 0.01 的差异，且无法复现。
 * 运营填元，转换只用 `Math.round` —— `9.9 * 100` 在浮点下是 989.9999…。
 * 非法输入返回 `null` 而不是兜底成 0：静默变免费是灾难。
 */

import type {
  AdminProduct,
  CreateProductPayload,
  UpdateProductPayload,
} from '../../../types/api';
import type { ProductDraft } from './constants';

/** 分 → 元（输入框回填值） */
export function centsToYuanText(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 元 → 分。非法输入返回 null，由调用方拦截 */
export function yuanTextToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

/** 积分有效期的人类可读文案。0 是「永久」而不是「0 天」 */
export function validDaysText(days: number): string {
  return days === 0 ? '永久有效' : `${days} 天`;
}

export function toDraft(p: AdminProduct): ProductDraft {
  return {
    sku: p.sku,
    name: p.name,
    description: p.description,
    priceYuan: centsToYuanText(p.priceCents),
    originalPriceYuan: p.originalPriceCents === null ? '' : centsToYuanText(p.originalPriceCents),
    credits: String(p.credits),
    creditsValidDays: String(p.creditsValidDays),
    grantType: p.grantType,
    sortOrder: String(p.sortOrder),
  };
}

export type ProductPayloadResult =
  | { ok: true; create: CreateProductPayload; update: UpdateProductPayload }
  | { ok: false; error: string };

/**
 * 表单 → 新建 / 更新两套 payload。校验失败返回首条错误文案。
 *
 * 新建一律先下架：建完确认无误再上架，避免半成品 SKU 立刻可售。
 * 清空划线价必须显式传 `null` —— 传 undefined 会被 whitelist 丢掉，旧值留着。
 */
export function buildProductPayload(
  draft: ProductDraft,
  editing: AdminProduct | null,
): ProductPayloadResult {
  const priceCents = yuanTextToCents(draft.priceYuan);
  if (priceCents === null) {
    return { ok: false, error: '售价格式不正确，请填两位小数的金额，如 9.90' };
  }
  const originalCents = draft.originalPriceYuan.trim()
    ? yuanTextToCents(draft.originalPriceYuan)
    : undefined;
  if (draft.originalPriceYuan.trim() && originalCents === null) {
    return { ok: false, error: '划线价格式不正确' };
  }
  const credits = Number(draft.credits);
  if (!Number.isInteger(credits) || credits < 0) {
    return { ok: false, error: '赠送积分必须是非负整数' };
  }
  const validDays = Number(draft.creditsValidDays || '0');
  if (!Number.isInteger(validDays) || validDays < 0) {
    return { ok: false, error: '积分有效期必须是非负整数天' };
  }

  const update: UpdateProductPayload = {
    name: draft.name.trim(),
    description: draft.description,
    priceCents,
    originalPriceCents: originalCents ?? null,
    credits,
    creditsValidDays: validDays,
    grantType: draft.grantType,
    sortOrder: Number(draft.sortOrder) || 0,
  };

  const create: CreateProductPayload = {
    sku: draft.sku.trim(),
    name: draft.name.trim(),
    description: draft.description,
    priceCents,
    // 新建时 null 与「不填」同效（库里就是 null），但 DTO 只接受数字，故不发 null
    ...(originalCents != null ? { originalPriceCents: originalCents } : {}),
    credits,
    creditsValidDays: validDays,
    grantType: draft.grantType,
    sortOrder: Number(draft.sortOrder) || 0,
    status: 'offline',
  };

  return { ok: true, create, update };
}
