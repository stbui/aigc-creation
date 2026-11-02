import type {
  AdminPaymentProductView,
  PaymentSaleStatus,
  PaymentSaleStrategy,
} from '../../../types/payment';

/**
 * 商品展示派生：销售状态、上架策略文案、权益文案、金额格式化。
 *
 * **状态以服务端为准**：后端已按 `Asia/Shanghai` 判定并回 `saleStatus`，
 * 前端只做展示兜底 —— 浏览器时区与服务器不一致时，按本地时间算窗口会把
 * 「已开售」显示成「待发售」，比晚一分钟开卖更让人误判。
 */

/** 金额格式化：分 → 带币种符号的两位小数 */
export function moneyText(cents: number, currency: string): string {
  const symbol = currency === 'USD' ? '$' : '¥';
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

/** 积分文案：带千分位；有效期 0 = 永久 */
export function creditsText(product: {
  credits: number;
  creditsValidDays: number;
}): string {
  const base = `${product.credits.toLocaleString('zh-CN')} 积分`;
  return product.creditsValidDays === 0
    ? `${base}（永久有效）`
    : `${base}（${product.creditsValidDays} 天有效）`;
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
