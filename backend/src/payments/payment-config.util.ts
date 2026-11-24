import { createHash } from 'node:crypto';
import type { VisiblePaymentMethod } from './adapters/types';

/**
 * 支付渠道配置的纯函数：排序、支付方式集合、摘要与时间键。
 *
 * 与 Prisma / 加密无关，便于单测；带状态的版本链与来源选择在各自的 service 里。
 */

export function compareInstanceRows(
  a: { sortOrder: number; instanceId: string },
  b: { sortOrder: number; instanceId: string },
): number {
  return a.sortOrder - b.sortOrder || a.instanceId.localeCompare(b.instanceId);
}

export function defaultPaymentMethods(providerId: string): VisiblePaymentMethod[] {
  if (providerId === 'alipay') return ['alipay'];
  if (providerId === 'wechat') return ['wechat'];
  return ['alipay', 'wechat'];
}

/** 实例支持的支付方式必须是该渠道允许集合的子集。 */
export function paymentMethodsOf(
  row: { paymentMethods: string },
  providerId: string,
): VisiblePaymentMethod[] {
  const allowed = defaultPaymentMethods(providerId);
  try {
    const parsed = JSON.parse(row.paymentMethods);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is VisiblePaymentMethod =>
        (value === 'alipay' || value === 'wechat') && allowed.includes(value),
    );
  } catch {
    return [];
  }
}

export function normalizeName(name: string | null | undefined): string | null {
  const value = String(name ?? '').trim();
  return value ? value.slice(0, 80) : null;
}

export function shanghaiDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}`;
}

export function digestOfConfig(
  providerId: string,
  instanceId: string,
  enabled: boolean,
  closeAfterMinutes: number,
  minAmountCents: number | null,
  maxAmountCents: number | null,
  dailyLimitCents: number | null,
  refundEnabled: boolean,
  paymentMethods: VisiblePaymentMethod[],
  name: string | null,
  sortOrder: number,
  values: Record<string, string>,
): string {
  const normalized = Object.keys(values)
    .filter((k) => values[k] !== undefined && values[k] !== '')
    .sort()
    .map((k) => `${k}=${values[k]}`)
    .join('\n');
  return createHash('sha256')
    .update(
      [
        providerId,
        instanceId,
        enabled ? 1 : 0,
        closeAfterMinutes,
        minAmountCents ?? '',
        maxAmountCents ?? '',
        dailyLimitCents ?? '',
        refundEnabled ? 1 : 0,
        paymentMethods.join(','),
        name ?? '',
        sortOrder,
        normalized,
      ].join('\n'),
    )
    .digest('hex');
}
