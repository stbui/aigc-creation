import type { Prisma } from '@prisma/client';
import { AppError } from '../common/app.exception';
import { PAYMENT_PROVIDER_IDS, type PaymentProviderId } from './adapters/types';

/**
 * 支付订单的展示状态、筛选条件与排序 —— 后端唯一实现。
 *
 * 展示状态**不落库**：`created / closing / create_failed / credited` 都能由
 * `Order.status + closeStartedAt + lastError + providerConfigId/checkoutMode`
 * 推导出来。落库会让「租约过期」「重试成功」这类时间相关状态立刻过期。
 */

export const PAYMENT_DISPLAY_STATUSES = [
  'created',
  'pending',
  'closing',
  'create_failed',
  'closed',
  'credited',
  'refunded',
  'partial_refunded',
] as const;

export type PaymentDisplayStatus = (typeof PAYMENT_DISPLAY_STATUSES)[number];

/** 关单租约：超过 5 分钟视为失效，worker 会回收 */
export const CLOSE_LEASE_MS = 5 * 60_000;

export function closeLeaseOf(now: Date): Date {
  return new Date(now.getTime() - CLOSE_LEASE_MS);
}

export function paymentStatusOf(
  input: {
    status: string;
    closeStartedAt: Date | null;
    lastError: string | null;
    providerConfigId: string | null;
    checkoutMode: string | null;
  },
  now: Date = new Date(),
): PaymentDisplayStatus {
  if (input.status === 'paid') return 'credited';
  if (input.status === 'refunded') return 'refunded';
  if (input.status === 'partial_refunded') return 'partial_refunded';
  if (input.status === 'cancelled') return 'closed';
  if (input.status !== 'pending') return 'created';

  if (input.closeStartedAt && input.closeStartedAt > closeLeaseOf(now)) return 'closing';
  if (input.lastError) return 'create_failed';
  if (input.providerConfigId || input.checkoutMode) return 'pending';
  return 'created';
}

/** 展示状态 → Prisma where。外层必须与商品订单基线放进同一个 AND 数组 */
export function paymentOrderWhere(status: PaymentDisplayStatus, closeLease: Date): Prisma.OrderWhereInput {
  const notInLease: Prisma.OrderWhereInput = {
    OR: [{ closeStartedAt: null }, { closeStartedAt: { lte: closeLease } }],
  };
  switch (status) {
    case 'credited':
      return { status: 'paid' };
    case 'refunded':
      return { status: 'refunded' };
    case 'partial_refunded':
      return { status: 'partial_refunded' };
    case 'closed':
      return { status: 'cancelled' };
    case 'closing':
      return { status: 'pending', closeStartedAt: { gt: closeLease } };
    case 'create_failed':
      return { AND: [{ status: 'pending' }, { lastError: { not: null } }, notInLease] };
    case 'created':
      return {
        AND: [
          { status: 'pending' },
          { providerConfigId: null },
          { checkoutMode: null },
          { lastError: null },
          notInLease,
        ],
      };
    case 'pending':
      return {
        AND: [
          { status: 'pending' },
          { lastError: null },
          { OR: [{ providerConfigId: { not: null } }, { checkoutMode: { not: null } }] },
          notInLease,
        ],
      };
    default:
      throw new AppError(40001, '订单状态筛选值非法', 400);
  }
}

export type PaymentTimeField = 'created' | 'paid' | 'credited';

export interface AdminPaymentOrderQuery {
  status?: string;
  keyword?: string;
  providerId?: string;
  timeField?: string;
  from?: string;
  to?: string;
  sort?: string;
}

const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

/** `YYYY-MM-DD` → 上海时区当日 00:00 的 UTC 时刻 */
export function startOfShanghaiDay(date: string): Date {
  const d = parseDateStrict(date);
  return new Date(Date.UTC(d.y, d.m - 1, d.d, 0, 0, 0, 0) - SHANGHAI_OFFSET_MS);
}

/** `YYYY-MM-DD` → 上海时区当日 23:59:59.999 的 UTC 时刻 */
export function endOfShanghaiDay(date: string): Date {
  const d = parseDateStrict(date);
  return new Date(Date.UTC(d.y, d.m - 1, d.d, 23, 59, 59, 999) - SHANGHAI_OFFSET_MS);
}

/** 严格解析日期：`2026-02-30` 必须报错，不能靠 Date 自动滚到 3 月 */
export function parseDateStrict(value: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) throw new AppError(40001, `日期格式必须为 YYYY-MM-DD: ${value}`, 400);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new AppError(40001, `日期不存在: ${value}`, 400);
  }
  return { y, m, d };
}

export function shanghaiDayRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const start = from ? startOfShanghaiDay(from) : undefined;
  const end = to ? endOfShanghaiDay(to) : undefined;
  if (start && end && start > end) {
    throw new AppError(40001, '开始日期不能晚于结束日期', 400);
  }
  return {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {}),
  };
}

export function timeFieldColumn(timeField?: string): 'createdAt' | 'providerPaidAt' | 'paidAt' {
  switch (timeField ?? 'created') {
    case 'created':
      return 'createdAt';
    case 'paid':
      return 'providerPaidAt';
    case 'credited':
      return 'paidAt';
    default:
      throw new AppError(40001, `时间字段非法: ${timeField}`, 400);
  }
}

export function assertProviderId(providerId?: string): PaymentProviderId | undefined {
  if (!providerId) return undefined;
  if (!(PAYMENT_PROVIDER_IDS as string[]).includes(providerId)) {
    throw new AppError(40001, `未知支付渠道: ${providerId}`, 400);
  }
  return providerId as PaymentProviderId;
}

function paymentKeywordWhere(keyword: string): Prisma.OrderWhereInput {
  return {
    OR: [
      { orderNo: { contains: keyword } },
      { providerTradeNo: { contains: keyword } },
      { items: { some: { nameSnapshot: { contains: keyword } } } },
      { user: { email: { contains: keyword } } },
      { user: { name: { contains: keyword } } },
      { userId: { contains: keyword } },
    ],
  };
}

/** 列表 / 计数 / 导出共用同一套条件，避免三处各写一份后结果对不上 */
export function buildAdminPaymentOrderWhere(
  q: AdminPaymentOrderQuery,
  now: Date = new Date(),
): Prisma.OrderWhereInput {
  const parts: Prisma.OrderWhereInput[] = [{ items: { some: {} } }];

  if (q.status) {
    if (!(PAYMENT_DISPLAY_STATUSES as readonly string[]).includes(q.status)) {
      throw new AppError(40001, `订单状态筛选值非法: ${q.status}`, 400);
    }
    parts.push(paymentOrderWhere(q.status as PaymentDisplayStatus, closeLeaseOf(now)));
  }

  const providerId = assertProviderId(q.providerId);
  if (providerId) parts.push({ channel: providerId });

  const keyword = q.keyword?.trim();
  if (keyword) {
    if (keyword.length > 120) throw new AppError(40001, '搜索关键字过长', 400);
    parts.push(paymentKeywordWhere(keyword));
  }

  const range = shanghaiDayRange(q.from, q.to);
  // 即使没有日期范围也要校验 timeField，避免非法字段被静默忽略
  const timeField = timeFieldColumn(q.timeField);
  if (range) parts.push({ [timeField]: range });

  return { AND: parts };
}

const SORT_COLUMNS = {
  createdAt: 'createdAt',
  providerPaidAt: 'providerPaidAt',
  paidAt: 'paidAt',
  amountCents: 'paidCents',
} as const;

/** 排序白名单；必须带 `id` 次排序，否则同毫秒创建的订单翻页会重复/漏行 */
export function orderByOf(sort?: string): Prisma.OrderOrderByWithRelationInput[] {
  const [field, direction = 'desc'] = (sort ?? 'createdAt:desc').split(':');
  const column = SORT_COLUMNS[field as keyof typeof SORT_COLUMNS];
  if (!column || (direction !== 'asc' && direction !== 'desc')) {
    throw new AppError(40001, '排序字段非法', 400);
  }
  const dir = direction as Prisma.SortOrder;
  const nullable = column === 'providerPaidAt' || column === 'paidAt';
  const first = nullable
    ? ({ [column]: { sort: dir, nulls: 'last' } } as Prisma.OrderOrderByWithRelationInput)
    : ({ [column]: dir } as Prisma.OrderOrderByWithRelationInput);
  return [first, { id: 'asc' }];
}

/** 上海时区时间戳（CSV 与页面文案统一口径） */
export function formatShanghai(d: Date | null | undefined): string {
  if (!d) return '';
  const shifted = new Date(d.getTime() + SHANGHAI_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())} ` +
    `${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}`
  );
}
