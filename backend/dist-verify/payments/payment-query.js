"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLOSE_LEASE_MS = exports.PAYMENT_DISPLAY_STATUSES = void 0;
exports.closeLeaseOf = closeLeaseOf;
exports.paymentStatusOf = paymentStatusOf;
exports.paymentOrderWhere = paymentOrderWhere;
exports.startOfShanghaiDay = startOfShanghaiDay;
exports.endOfShanghaiDay = endOfShanghaiDay;
exports.parseDateStrict = parseDateStrict;
exports.shanghaiDayRange = shanghaiDayRange;
exports.timeFieldColumn = timeFieldColumn;
exports.assertProviderId = assertProviderId;
exports.buildAdminPaymentOrderWhere = buildAdminPaymentOrderWhere;
exports.orderByOf = orderByOf;
exports.formatShanghai = formatShanghai;
const app_exception_1 = require("../common/app.exception");
const types_1 = require("./adapters/types");
/**
 * 支付订单的展示状态、筛选条件与排序 —— 后端唯一实现。
 *
 * 展示状态**不落库**：`created / closing / create_failed / credited` 都能由
 * `Order.status + closeStartedAt + lastError + providerConfigId/checkoutMode`
 * 推导出来。落库会让「租约过期」「重试成功」这类时间相关状态立刻过期。
 */
exports.PAYMENT_DISPLAY_STATUSES = [
    'created',
    'pending',
    'closing',
    'create_failed',
    'closed',
    'credited',
    'refunded',
    'partial_refunded',
];
/** 关单租约：超过 5 分钟视为失效，worker 会回收 */
exports.CLOSE_LEASE_MS = 5 * 60_000;
function closeLeaseOf(now) {
    return new Date(now.getTime() - exports.CLOSE_LEASE_MS);
}
function paymentStatusOf(input, now = new Date()) {
    if (input.status === 'paid')
        return 'credited';
    if (input.status === 'refunded')
        return 'refunded';
    if (input.status === 'partial_refunded')
        return 'partial_refunded';
    if (input.status === 'cancelled')
        return 'closed';
    if (input.status !== 'pending')
        return 'created';
    if (input.closeStartedAt && input.closeStartedAt > closeLeaseOf(now))
        return 'closing';
    if (input.lastError)
        return 'create_failed';
    if (input.providerConfigId || input.checkoutMode)
        return 'pending';
    return 'created';
}
/** 展示状态 → Prisma where。外层必须与商品订单基线放进同一个 AND 数组 */
function paymentOrderWhere(status, closeLease) {
    const notInLease = {
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
            throw new app_exception_1.AppError(40001, '订单状态筛选值非法', 400);
    }
}
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;
/** `YYYY-MM-DD` → 上海时区当日 00:00 的 UTC 时刻 */
function startOfShanghaiDay(date) {
    const d = parseDateStrict(date);
    return new Date(Date.UTC(d.y, d.m - 1, d.d, 0, 0, 0, 0) - SHANGHAI_OFFSET_MS);
}
/** `YYYY-MM-DD` → 上海时区当日 23:59:59.999 的 UTC 时刻 */
function endOfShanghaiDay(date) {
    const d = parseDateStrict(date);
    return new Date(Date.UTC(d.y, d.m - 1, d.d, 23, 59, 59, 999) - SHANGHAI_OFFSET_MS);
}
/** 严格解析日期：`2026-02-30` 必须报错，不能靠 Date 自动滚到 3 月 */
function parseDateStrict(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match)
        throw new app_exception_1.AppError(40001, `日期格式必须为 YYYY-MM-DD: ${value}`, 400);
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
        throw new app_exception_1.AppError(40001, `日期不存在: ${value}`, 400);
    }
    return { y, m, d };
}
function shanghaiDayRange(from, to) {
    if (!from && !to)
        return undefined;
    const start = from ? startOfShanghaiDay(from) : undefined;
    const end = to ? endOfShanghaiDay(to) : undefined;
    if (start && end && start > end) {
        throw new app_exception_1.AppError(40001, '开始日期不能晚于结束日期', 400);
    }
    return {
        ...(start ? { gte: start } : {}),
        ...(end ? { lte: end } : {}),
    };
}
function timeFieldColumn(timeField) {
    switch (timeField ?? 'created') {
        case 'created':
            return 'createdAt';
        case 'paid':
            return 'providerPaidAt';
        case 'credited':
            return 'paidAt';
        default:
            throw new app_exception_1.AppError(40001, `时间字段非法: ${timeField}`, 400);
    }
}
function assertProviderId(providerId) {
    if (!providerId)
        return undefined;
    if (!types_1.PAYMENT_PROVIDER_IDS.includes(providerId)) {
        throw new app_exception_1.AppError(40001, `未知支付渠道: ${providerId}`, 400);
    }
    return providerId;
}
function paymentKeywordWhere(keyword) {
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
function buildAdminPaymentOrderWhere(q, now = new Date()) {
    const parts = [{ items: { some: {} } }];
    if (q.status) {
        if (!exports.PAYMENT_DISPLAY_STATUSES.includes(q.status)) {
            throw new app_exception_1.AppError(40001, `订单状态筛选值非法: ${q.status}`, 400);
        }
        parts.push(paymentOrderWhere(q.status, closeLeaseOf(now)));
    }
    const providerId = assertProviderId(q.providerId);
    if (providerId)
        parts.push({ channel: providerId });
    const keyword = q.keyword?.trim();
    if (keyword) {
        if (keyword.length > 120)
            throw new app_exception_1.AppError(40001, '搜索关键字过长', 400);
        parts.push(paymentKeywordWhere(keyword));
    }
    const range = shanghaiDayRange(q.from, q.to);
    // 即使没有日期范围也要校验 timeField，避免非法字段被静默忽略
    const timeField = timeFieldColumn(q.timeField);
    if (range)
        parts.push({ [timeField]: range });
    return { AND: parts };
}
const SORT_COLUMNS = {
    createdAt: 'createdAt',
    providerPaidAt: 'providerPaidAt',
    paidAt: 'paidAt',
    amountCents: 'paidCents',
};
/** 排序白名单；必须带 `id` 次排序，否则同毫秒创建的订单翻页会重复/漏行 */
function orderByOf(sort) {
    const [field, direction = 'desc'] = (sort ?? 'createdAt:desc').split(':');
    const column = SORT_COLUMNS[field];
    if (!column || (direction !== 'asc' && direction !== 'desc')) {
        throw new app_exception_1.AppError(40001, '排序字段非法', 400);
    }
    const dir = direction;
    const nullable = column === 'providerPaidAt' || column === 'paidAt';
    const first = nullable
        ? { [column]: { sort: dir, nulls: 'last' } }
        : { [column]: dir };
    return [first, { id: 'asc' }];
}
/** 上海时区时间戳（CSV 与页面文案统一口径） */
function formatShanghai(d) {
    if (!d)
        return '';
    const shifted = new Date(d.getTime() + SHANGHAI_OFFSET_MS);
    const p = (n) => String(n).padStart(2, '0');
    return (`${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())} ` +
        `${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}`);
}
//# sourceMappingURL=payment-query.js.map