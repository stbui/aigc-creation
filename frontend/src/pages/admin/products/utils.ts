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
import { formatYuanPlain } from '../../../admin-ui/lib/format';
import {
  DEFAULT_SORT_ORDER,
  type ProductCurrency,
  type ProductDraft,
} from './constants';

/** 币种符号。商品只有 CNY / USD 两种，不做通用货币库 */
export function currencySymbol(currency: ProductCurrency | string): string {
  return currency === 'USD' ? '$' : '¥';
}

/** 分 → 元（输入框回填值；统一实现在 admin-ui/lib/format.ts） */
export const centsToYuanText = formatYuanPlain;

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

/**
 * 每积分单价（元 / 积分）。
 *
 * 跨 SKU 比「谁更划算」的唯一口径 —— 与 C 端结算页的「折合单价」同源。
 * 免费商品或不发积分的商品没有可比单价，返回 null（调用方隐藏该行，
 * 不写「0.0000」当数字看）。
 */
export function perCreditYuanText(
  priceCents: number,
  credits: number,
  currency: ProductCurrency | string = 'CNY',
): string | null {
  if (priceCents <= 0 || credits <= 0) return null;
  return `${currencySymbol(currency)}${(priceCents / credits / 100).toFixed(4)}`;
}

/**
 * 卡片上的金额：带千分位，与积分数字的排版口径一致。
 *
 * 不复用 `centsToYuanText` —— 那个函数同时服务表单回填，带逗号会破坏输入框解析。
 */
export function moneyText(cents: number): string {
  return (cents / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 限时商品的结束时刻：后台同屏比较多个商品时只需要日期与时分 */
export function saleWindowEnd(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * 删除前置条件：只有从没卖出去过的 SKU 能删。
 *
 * 有订单的商品要保留记录供退款 / 积分回收回查，只能下架。返回 `null`
 * 表示可以删；否则返回可直接展示给运营的提示 —— 文案里必须给出下一步，
 * 只说「不能删除」等于把问题丢回给人猜。
 */
export function deleteBlockedReason(
  product: Pick<AdminProduct, 'orderCount'>,
): string | null {
  if (product.orderCount <= 0) return null;
  return `该商品已有 ${product.orderCount} 笔历史订单，不能删除；请改为下架`;
}

export function toDraft(p: AdminProduct): ProductDraft {
  return {
    sku: p.sku,
    name: p.name,
    description: p.description,
    currency: p.currency,
    priceYuan: centsToYuanText(p.priceCents),
    originalPriceYuan: p.originalPriceCents === null ? '' : centsToYuanText(p.originalPriceCents),
    credits: String(p.credits),
    creditsValidDays: String(p.creditsValidDays),
    grantType: p.grantType,
    sortOrder: String(p.sortOrder),
    saleStrategy: p.saleStrategy,
    periodDays: String(p.periodDays || 30),
    periodPurchaseLimit: String(p.periodPurchaseLimit || 1),
    stockTotal: p.stockTotal > 0 ? String(p.stockTotal) : '',
    saleStartAt: toDateTimeLocalText(p.saleStartAt),
    saleEndAt: toDateTimeLocalText(p.saleEndAt),
  };
}

/**
 * ISO 时间 → `datetime-local` 的输入值（北京时间）。
 *
 * 后端把不带时区的表单时间一律按 `Asia/Shanghai` 解释，所以这里也必须按
 * +08:00 渲染，不能按浏览器本地时区：运营在海外打开后台时，回显与提交
 * 各偏一次，限时窗口每保存一次就平移一次。
 *
 * `datetime-local` 只接受 `yyyy-mm-ddTHH:mm`；直接截 UTC ISO 会差 8 小时。
 */
export function toDateTimeLocalText(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 16);
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
  // 排序留空 = 用默认值（新建 100）；非空必须是合法非负整数，不接受静默兜底
  const rawSortOrder = draft.sortOrder.trim();
  const parsedSortOrder = Number(rawSortOrder);
  if (rawSortOrder !== '' && (!Number.isInteger(parsedSortOrder) || parsedSortOrder < 0)) {
    return { ok: false, error: '排序权重必须是非负整数' };
  }
  const sortOrder = rawSortOrder === '' ? Number(DEFAULT_SORT_ORDER) : parsedSortOrder;

  /*
   * 上架策略的专属字段：只提交当前策略用得上的键。
   * 后端 DTO 对周期天数 / 库存总量设了下限，把 0 一起发过去会被判非法。
   */
  const strategy = draft.saleStrategy;
  let periodDays: number | undefined;
  let periodPurchaseLimit: number | undefined;
  let stockTotal: number | undefined;
  let saleStartAt: string | null | undefined;
  let saleEndAt: string | null | undefined;

  if (strategy === 'periodic') {
    periodDays = Number(draft.periodDays || '0');
    periodPurchaseLimit = Number(draft.periodPurchaseLimit || '0');
    if (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 365) {
      return { ok: false, error: '周期天数必须在 1–365 之间' };
    }
    if (!Number.isInteger(periodPurchaseLimit) || periodPurchaseLimit < 1 || periodPurchaseLimit > 999) {
      return { ok: false, error: '周期限购次数必须在 1–999 之间' };
    }
  } else if (strategy === 'inventory') {
    stockTotal = Number(draft.stockTotal || '0');
    if (!Number.isInteger(stockTotal) || stockTotal < 1) {
      return { ok: false, error: '库存商品必须填写大于 0 的库存总量' };
    }
  } else if (strategy === 'timed') {
    if (!draft.saleStartAt || !draft.saleEndAt) {
      return { ok: false, error: '限时商品必须填写开始与结束时间' };
    }
    if (new Date(draft.saleStartAt).getTime() >= new Date(draft.saleEndAt).getTime()) {
      return { ok: false, error: '开售时间必须早于结束时间' };
    }
    saleStartAt = draft.saleStartAt;
    saleEndAt = draft.saleEndAt;
  }

  const saleFields = {
    currency: draft.currency,
    saleStrategy: strategy,
    ...(periodDays !== undefined ? { periodDays, periodPurchaseLimit } : {}),
    ...(stockTotal !== undefined ? { stockTotal } : {}),
    ...(saleStartAt ? { saleStartAt, saleEndAt } : {}),
  };

  const update: UpdateProductPayload = {
    name: draft.name.trim(),
    description: draft.description,
    priceCents,
    originalPriceCents: originalCents ?? null,
    credits,
    creditsValidDays: validDays,
    grantType: draft.grantType,
    ...saleFields,
    ...(rawSortOrder === '' ? {} : { sortOrder }),
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
    sortOrder,
    status: 'offline',
    ...saleFields,
  };

  return { ok: true, create, update };
}
