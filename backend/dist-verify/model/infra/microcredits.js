"use strict";
/**
 * 微积分算术 —— 计费金额的唯一入口。
 *
 * 1 积分 = 1,000,000 微积分。所有单价、数量、倍率全程使用 BigInt 整数运算，
 * 不经过浮点：Token 单价常低至「0.0002 积分 / token」，浮点会在乘法链上
 * 产生 1 个微积分的偏差，而这类偏差在批量结算后会被放大成真实的对账差异。
 *
 * 四条硬约束（与 open-ai-canvas `credit_policy.go` / `user_groups.go` 对齐）：
 * 1. 一律向上取整 —— 宁可多扣 1 微积分，也不能因为截断少扣；
 * 2. 单笔金额 `ceil(unitPrice × quantity × bps / 10000)`；
 * 3. Token 金额 `ceil(Σ(tokens × 单价) × bps / 1e10)`，双尺度必须单独实现，
 *    套用单笔公式会少乘 1e6；
 * 4. 倍率连乘逐级向上取整，结果至少 1 基点、上限 1<<40。
 *
 * 溢出策略：入参先做范围校验，中间结果用 BigInt 计算，出参前再校验
 * 是否落在 JS 安全整数区间 —— 库里的金额列是 BigInt，但 API 出参是 number，
 * 超过 `Number.MAX_SAFE_INTEGER` 的金额在 JSON 里会静默失真。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MicrocreditError = exports.MAX_SAFE_AMOUNT = exports.MAX_MULTIPLIER_BASIS_POINTS = exports.BASIS_POINTS_SCALE = exports.CREDIT_SCALE = void 0;
exports.toMicrocredits = toMicrocredits;
exports.toSafeNumber = toSafeNumber;
exports.ceilDiv = ceilDiv;
exports.creditAmount = creditAmount;
exports.tokenAmount = tokenAmount;
exports.combineMultiplierBasisPoints = combineMultiplierBasisPoints;
exports.convertCurrencyPrice = convertCurrencyPrice;
exports.formatCredits = formatCredits;
exports.parseCredits = parseCredits;
/** 1 积分对应的微积分数量 */
exports.CREDIT_SCALE = 1000000n;
/** 倍率基点：10000 表示 1.0 倍 */
exports.BASIS_POINTS_SCALE = 10000n;
/** 倍率上限（1<<40），防止配置错误把账单放大到天文数字 */
exports.MAX_MULTIPLIER_BASIS_POINTS = 1n << 40n;
/** JS 安全整数上限，BigInt 出参前必须校验 */
exports.MAX_SAFE_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);
/** 金额非法或越界时抛出，由调用方映射为业务错误码 */
class MicrocreditError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MicrocreditError';
    }
}
exports.MicrocreditError = MicrocreditError;
/** 把任意可接受的金额输入规范成 BigInt；拒绝小数、负数与科学计数法 */
function toMicrocredits(value) {
    if (typeof value === 'bigint')
        return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || !Number.isInteger(value)) {
            throw new MicrocreditError(`金额必须是整数：${value}`);
        }
        return BigInt(value);
    }
    const trimmed = String(value ?? '').trim();
    if (!/^-?\d+$/.test(trimmed)) {
        throw new MicrocreditError(`金额必须是整数字符串：${value}`);
    }
    return BigInt(trimmed);
}
/** BigInt 出参：超出安全整数直接抛错，不允许静默截断 */
function toSafeNumber(value) {
    if (value > exports.MAX_SAFE_AMOUNT || value < -exports.MAX_SAFE_AMOUNT) {
        throw new MicrocreditError(`金额超出安全整数范围：${value.toString()}`);
    }
    return Number(value);
}
/** 向上取整除法（BigInt 版），divisor 必须为正 */
function ceilDiv(dividend, divisor) {
    if (divisor <= 0n)
        throw new MicrocreditError('除必须为正数');
    if (dividend <= 0n)
        return 0n;
    return (dividend + divisor - 1n) / divisor;
}
/**
 * 单笔金额：`ceil(unitPrice × quantity × multiplierBPS / 10000)`。
 *
 * @param unitPriceMicrocredits 单价（微积分）
 * @param quantity 数量，必须 > 0
 * @param multiplierBasisPoints 倍率基点，必须 > 0
 */
function creditAmount(unitPriceMicrocredits, quantity, multiplierBasisPoints) {
    const unitPrice = toMicrocredits(unitPriceMicrocredits);
    const qty = toMicrocredits(quantity);
    const bps = toMicrocredits(multiplierBasisPoints);
    if (unitPrice < 0n || qty <= 0n || bps <= 0n) {
        throw new MicrocreditError('积分计费参数无效');
    }
    return ceilDiv(unitPrice * qty * bps, exports.BASIS_POINTS_SCALE);
}
/**
 * Token 金额：`ceil(Σ(tokens × 单价) × bps / 1e10)`。
 *
 * 为什么分母是 1e10：Token 单价同样以微积分表示，再乘倍率基点后尺度是
 * `1e6 × 1e4`。单独写一个函数而不是复用 `creditAmount`，就是为了让这个
 * 双尺度无法被误用 —— 参考实现 `kernel/token_billing.go` 同此处理。
 */
function tokenAmount(usage, multiplierBasisPoints) {
    const bps = toMicrocredits(multiplierBasisPoints);
    if (bps <= 0n)
        throw new MicrocreditError('倍率必须为正数');
    const inputTokens = Math.max(0, Math.trunc(usage.inputTokens || 0));
    const outputTokens = Math.max(0, Math.trunc(usage.outputTokens || 0));
    const cachedTokens = Math.max(0, Math.trunc(usage.cachedTokens || 0));
    const sum = toMicrocredits(usage.inputTokenPriceMicrocredits) * BigInt(inputTokens) +
        toMicrocredits(usage.outputTokenPriceMicrocredits) * BigInt(outputTokens) +
        toMicrocredits(usage.cachedTokenPriceMicrocredits ?? 0) * BigInt(cachedTokens);
    return ceilDiv(sum * bps, exports.CREDIT_SCALE * exports.BASIS_POINTS_SCALE);
}
/** 多个基点倍率连乘，逐级向上取整，至少 1 基点、上限 1<<40 */
function combineMultiplierBasisPoints(...values) {
    let result = exports.BASIS_POINTS_SCALE;
    for (const raw of values) {
        const value = toMicrocredits(raw);
        if (value <= 0n)
            continue;
        result = ceilDiv(result * value, exports.BASIS_POINTS_SCALE);
    }
    if (result > exports.MAX_MULTIPLIER_BASIS_POINTS)
        return exports.MAX_MULTIPLIER_BASIS_POINTS;
    if (result < 1n)
        return 1n;
    return result;
}
/**
 * 货币换算：`ceil(price × rate / 1e6)`。
 *
 * 价格以「百万分之一货币单位」存储（价格档的原始口径），rate 为
 * 「1 单位货币折合多少微积分」。积分计价时 rate 恰为 1e6，结果原样返回。
 */
function convertCurrencyPrice(price, rateMicrocredits) {
    const amount = toMicrocredits(price);
    const rate = toMicrocredits(rateMicrocredits);
    if (amount < 0n)
        throw new MicrocreditError('模型价格无效');
    if (rate <= 0n)
        throw new MicrocreditError('货币兑换比例无效');
    if (rate === exports.CREDIT_SCALE || amount === 0n)
        return amount;
    return ceilDiv(amount * rate, exports.CREDIT_SCALE);
}
/** 微积分 → 积分的展示字符串，去掉无意义的尾随零（保留最多 6 位） */
function formatCredits(value) {
    const amount = toMicrocredits(value);
    const negative = amount < 0n;
    const absolute = negative ? -amount : amount;
    const whole = absolute / exports.CREDIT_SCALE;
    const fraction = absolute % exports.CREDIT_SCALE;
    const sign = negative ? '-' : '';
    if (fraction === 0n)
        return `${sign}${whole.toString()}`;
    const padded = fraction.toString().padStart(6, '0').replace(/0+$/, '');
    return `${sign}${whole.toString()}.${padded}`;
}
/** 积分（可带 6 位小数）→ 微积分；运营手工填价时使用 */
function parseCredits(value) {
    const text = String(value ?? '').trim();
    const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(text);
    if (!match)
        throw new MicrocreditError(`积分格式无效：${value}`);
    const sign = match[1] === '-' ? -1n : 1n;
    const whole = BigInt(match[2]);
    const fraction = BigInt((match[3] ?? '').padEnd(6, '0') || '0');
    return sign * (whole * exports.CREDIT_SCALE + fraction);
}
//# sourceMappingURL=microcredits.js.map