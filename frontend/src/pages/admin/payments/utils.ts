import { formatYuanPlain } from '../../../admin-ui/lib/format';
import type {
  AdminPaymentProductView,
  PaymentProductInput,
  PaymentSaleStatus,
  PaymentSaleStrategy,
} from '../../../types/payment';
import { PROVIDER_LABELS, type PaymentProductDraft } from './constants';

/**
 * 支付域的纯函数：账单日期（上海时区）、商品展示派生、金额与时间换算。
 *
 * **状态以服务端为准**：后端已按 `Asia/Shanghai` 判定并回 `saleStatus`，
 * 前端只做展示兜底 —— 浏览器时区与服务器不一致时，按本地时间算窗口会把
 * 「已开售」显示成「待发售」，比晚一分钟开卖更让人误判。
 */

/**
 * 昨天（`YYYY-MM-DD`，上海时区）。对账只能选昨天及更早的账单日。
 *
 * 必须按上海时区切日：用 `toISOString` 会在东八区 00:00–08:00 默认成前天。
 */
export function yesterday(): string {
  const shifted = new Date(Date.now() + 8 * 3600 * 1000);
  shifted.setUTCDate(shifted.getUTCDate() - 1);
  return shifted.toISOString().slice(0, 10);
}

/** 90 天前（`YYYY-MM-DD`，上海时区），对账最早回溯范围。 */
export function ninetyDaysAgo(): string {
  const shifted = new Date(Date.now() + 8 * 3600 * 1000);
  shifted.setUTCDate(shifted.getUTCDate() - 90);
  return shifted.toISOString().slice(0, 10);
}

/** 金额格式化：分 → 带币种符号的两位小数 */
export function moneyText(cents: number, currency: string): string {
  const symbol = currency === 'USD' ? '$' : '¥';
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

/**
 * 渠道 id → 展示短名。
 *
 * 订单、对账、异常三个列表都要把渠道 id 翻成人话；未登记的 id 原样返回，
 * 保证新增渠道时页面不会出现空白格。
 */
export function providerLabel(id: string | null | undefined): string {
  if (!id) return '—';
  return PROVIDER_LABELS[id] ?? id;
}

/** 积分文案：带千分位；有效期 0 = 永久 */
export function creditsText(product: { credits: number; creditsValidDays: number }): string {
  const base = `${product.credits.toLocaleString('zh-CN')} 积分`;
  return product.creditsValidDays === 0 ? `${base}（永久有效）` : `${base}（${product.creditsValidDays} 天有效）`;
}

/** 上架策略文案 */
export function strategyText(product: {
  saleStrategy: PaymentSaleStrategy;
  periodDays: number;
  periodPurchaseLimit: number;
  stockTotal: number;
  stockRemaining: number;
  saleStartAt: string | null;
  saleEndAt: string | null;
}): string {
  switch (product.saleStrategy) {
    case 'periodic':
      return `周期 ${product.periodDays} 天 · 限 ${product.periodPurchaseLimit} 次`;
    case 'inventory':
      return `库存 ${product.stockRemaining} / ${product.stockTotal}`;
    case 'timed': {
      const start = product.saleStartAt ? product.saleStartAt.slice(0, 10) : '—';
      const end = product.saleEndAt ? product.saleEndAt.slice(0, 10) : '—';
      return `限时 ${start} ~ ${end}`;
    }
    default:
      return '不限量';
  }
}

/**
 * 销售状态。
 *
 * 直接取后端 `saleStatus`；后端没给时（如本地兜底）按规则派生。
 */
export function productSaleStatusOf(product: {
  status: string;
  saleStrategy: string;
  saleStartAt: string | null;
  saleEndAt: string | null;
  stockRemaining: number;
}): PaymentSaleStatus {
  if (product.status !== 'active') return 'disabled';
  if (product.saleStrategy === 'timed') {
    const now = Date.now();
    if (product.saleStartAt && now < new Date(product.saleStartAt).getTime()) return 'upcoming';
    if (product.saleEndAt && now > new Date(product.saleEndAt).getTime()) return 'ended';
  }
  if (product.saleStrategy === 'inventory' && product.stockRemaining <= 0) return 'sold_out';
  return 'on_sale';
}

/** 销售状态 → 文案与色调 */
export const SALE_STATUS_META: Record<
  PaymentSaleStatus,
  { label: string; tone: 'success' | 'danger' | 'warn' | 'brand' | 'muted' }
> = {
  on_sale: { label: '销售中', tone: 'success' },
  upcoming: { label: '待发售', tone: 'warn' },
  ended: { label: '已结束', tone: 'muted' },
  sold_out: { label: '已售罄', tone: 'danger' },
  disabled: { label: '已停用', tone: 'muted' },
};

/** 商品列表行：展示状态一律走这里，避免各列各判一次 */
export function saleStatusOf(product: AdminPaymentProductView): PaymentSaleStatus {
  return product.saleStatus ?? productSaleStatusOf(product);
}

/** 分 → 表单里的元 / 美元文本，固定两位小数。 */
export function paymentProductPriceText(cents: number): string {
  return formatYuanPlain(cents);
}

/** 表单金额 → 整数分；非法输入返回 null，由调用方拦截。 */
export function paymentProductPriceToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

/**
 * UTC ISO → `datetime-local` 值。
 *
 * 不能直接 slice ISO 字符串：后端存的是 UTC，`slice(0,16)` 会把 UTC 时间
 * 当成浏览器本地时间显示，每次编辑保存都会把限时窗口平移时区差。
 */
export function isoToLocalDateTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` → ISO；空串或非法值返回 null。 */
export function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** 商品视图 → 表单草稿。 */
export function paymentProductToDraft(product: AdminPaymentProductView): PaymentProductDraft {
  return {
    name: product.name,
    description: product.description,
    currency: product.currency,
    price: paymentProductPriceText(product.priceCents),
    originalPrice: product.originalPriceCents === null ? '' : paymentProductPriceText(product.originalPriceCents),
    credits: String(product.credits),
    creditsValidDays: String(product.creditsValidDays),
    grantType: product.grantType === 'manual' ? 'manual' : 'immediate',
    saleStrategy: product.saleStrategy,
    periodDays: String(product.periodDays || 30),
    periodPurchaseLimit: String(product.periodPurchaseLimit || 1),
    stockTotal: String(product.stockTotal || 0),
    saleStartAt: isoToLocalDateTime(product.saleStartAt),
    saleEndAt: isoToLocalDateTime(product.saleEndAt),
    sortOrder: String(product.sortOrder),
    enabled: product.status === 'active',
  };
}

export type PaymentProductPayloadResult = { ok: true; payload: PaymentProductInput } | { ok: false; error: string };

/** 表单草稿 → 商品保存入参；校验失败返回首条错误文案。 */
export function buildPaymentProductPayload(
  draft: PaymentProductDraft,
  usdAvailable: boolean,
): PaymentProductPayloadResult {
  const priceCents = paymentProductPriceToCents(draft.price);
  if (priceCents === null || priceCents <= 0) {
    return { ok: false, error: '售价必须大于 0，请填两位小数的金额，如 9.90' };
  }

  let originalPriceCents: number | null = null;
  if (draft.originalPrice.trim()) {
    originalPriceCents = paymentProductPriceToCents(draft.originalPrice);
    if (originalPriceCents === null) {
      return { ok: false, error: '划线价格式不正确' };
    }
    if (originalPriceCents < priceCents) {
      return { ok: false, error: '划线价不能低于售价' };
    }
  }

  if (draft.saleStrategy === 'inventory' && (Number(draft.stockTotal) || 0) < 1) {
    return { ok: false, error: '库存商品必须填写大于 0 的库存总量' };
  }

  const credits = Number(draft.credits);
  if (!Number.isInteger(credits) || credits < 0) {
    return { ok: false, error: '到账积分必须是非负整数' };
  }

  const validDays = Number(draft.creditsValidDays || '0');
  if (!Number.isInteger(validDays) || validDays < 0 || validDays > 3650) {
    return { ok: false, error: '积分有效期必须是 0–3650 之间的整数天' };
  }

  if (draft.enabled && draft.currency === 'USD' && !usdAvailable) {
    return {
      ok: false,
      error: '当前没有已配置的美元支付渠道，无法上架美元商品',
    };
  }

  return {
    ok: true,
    payload: {
      // DTO 必填：当前只支持积分商品
      kind: 'credits',
      name: draft.name.trim(),
      description: draft.description,
      currency: draft.currency,
      priceCents,
      originalPriceCents,
      credits,
      creditsValidDays: validDays,
      grantType: draft.grantType,
      sortOrder: Number(draft.sortOrder) || 0,
      saleStrategy: draft.saleStrategy,
      ...(draft.saleStrategy === 'periodic'
        ? {
            periodDays: Number(draft.periodDays) || 30,
            periodPurchaseLimit: Number(draft.periodPurchaseLimit) || 1,
          }
        : {}),
      ...(draft.saleStrategy === 'inventory' ? { stockTotal: Number(draft.stockTotal) || 0 } : {}),
      ...(draft.saleStrategy === 'timed'
        ? {
            saleStartAt: localDateTimeToIso(draft.saleStartAt),
            saleEndAt: localDateTimeToIso(draft.saleEndAt),
          }
        : {}),
      status: draft.enabled ? 'active' : 'offline',
    },
  };
}
