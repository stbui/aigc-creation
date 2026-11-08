"use strict";
/**
 * 模型域 JSON 列编解码。
 *
 * 本仓约定（`prisma/schema.prisma` 顶部）：JSON 一律以 String 存储，读写经过
 * 类型化 codec，不启用 Prisma `Json`。这样做的原因：
 *   · SQLite 的 Json 类型只是 TEXT 的别名，开启后仍要自己校验；
 *   · 迁移到 MySQL/PostgreSQL 时列类型不必改，编码规则由代码保证；
 *   · 解析失败必须显式失败，不能静默返回 `{}` —— 价格档选择器损坏会直接
 *     导致「报价与扣费对不上」，那是最难排查的一类事故。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelDomainError = void 0;
exports.badRequest = badRequest;
exports.decodeJson = decodeJson;
exports.decodeJsonLoose = decodeJsonLoose;
exports.encodeJson = encodeJson;
exports.uniqueNonEmpty = uniqueNonEmpty;
exports.normalizeModelKey = normalizeModelKey;
exports.firstNonEmpty = firstNonEmpty;
exports.toSafeAmount = toSafeAmount;
const app_exception_1 = require("../../common/app.exception");
/**
 * 模型域统一的参数错误：40001（与后端错误码表一致）。
 * 继承 `AppError`，全局异常过滤器会直接把它渲染成 `{ code, message }` 信封 ——
 * 不要改成普通 Error，否则会退化成 50001。
 */
class ModelDomainError extends app_exception_1.AppError {
    constructor(message, code = 40001) {
        super(code, message);
        this.name = 'ModelDomainError';
    }
}
exports.ModelDomainError = ModelDomainError;
function badRequest(message, code = 40001) {
    return new ModelDomainError(message, code);
}
/** 解析 JSON 文本；空串返回 fallback，损坏直接抛错（指名字段） */
function decodeJson(raw, fallback, field) {
    const text = String(raw ?? '').trim();
    if (!text)
        return fallback;
    try {
        return JSON.parse(text);
    }
    catch {
        throw badRequest(`${field} 不是合法的 JSON`);
    }
}
/** 解析可选 JSON：空串/损坏都返回 fallback（只用于展示字段，不用于价格与合同） */
function decodeJsonLoose(raw, fallback) {
    const text = String(raw ?? '').trim();
    if (!text)
        return fallback;
    try {
        return JSON.parse(text);
    }
    catch {
        return fallback;
    }
}
/** 编码 JSON；undefined/null 编码为 fallback 的编码结果 */
function encodeJson(value, fallback = {}) {
    return JSON.stringify(value === undefined || value === null ? fallback : value);
}
/** 字符串数组去空去重（保持首次出现顺序） */
function uniqueNonEmpty(values) {
    const result = [];
    const seen = new Set();
    for (const value of values ?? []) {
        const text = String(value ?? '').trim();
        if (!text || seen.has(text))
            continue;
        seen.add(text);
        result.push(text);
    }
    return result;
}
/** 去 `models/` 前缀并 trim（上游模型键的历史写法） */
function normalizeModelKey(value) {
    return String(value ?? '')
        .trim()
        .replace(/^models\//, '');
}
/** 取第一个非空字符串 */
function firstNonEmpty(...values) {
    for (const value of values) {
        const text = String(value ?? '').trim();
        if (text)
            return text;
    }
    return '';
}
/** 把 number/string 金额规范成 number（安全整数范围），供 BigInt 写入前校验 */
function toSafeAmount(value, field) {
    const text = String(value ?? '').trim();
    if (!text)
        return 0;
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw badRequest(`${field} 必须是整数`);
    }
    if (parsed < 0) {
        throw badRequest(`${field} 不能为负数`);
    }
    if (!Number.isSafeInteger(parsed)) {
        throw badRequest(`${field} 超出可表示范围`);
    }
    return parsed;
}
//# sourceMappingURL=json.js.map