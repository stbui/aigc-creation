"use strict";
/**
 * 渠道域的请求 / 响应类型 —— 与 open-ai-canvas 的管理端契约逐字段对齐。
 *
 * 价格一律以「微积分」的整数字符串或安全整数传输（`BigInt` 不能直接过 JSON），
 * 读写两侧都经过 `toSafeAmount()` / `toMicrocredits()` 校验。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_IMPORTED_CHANNEL_MODELS = exports.MAX_IMPORTED_SYSTEM_CHANNELS = exports.SYSTEM_CHANNEL_EXPORT_VERSION = exports.SYSTEM_CHANNEL_EXPORT_FORMAT = exports.MAX_CHANNEL_MODEL_BATCH_REPRICE = exports.MAX_CHANNEL_MODEL_BATCH_DELETE = exports.MAX_SORT_ORDER = exports.MAX_CHANNEL_CONCURRENCY = exports.MIN_CHANNEL_CONCURRENCY = exports.CHANNEL_MODEL_TAG_COLORS = exports.DEFAULT_USER_GROUP_CODE = exports.USER_GROUP_BADGE_STYLES = exports.PRICE_CURRENCY_CNY = exports.PRICE_CURRENCY_USD = exports.PRICE_CURRENCY_CREDITS = exports.CHANNEL_SCOPE_USER = exports.CHANNEL_SCOPE_SYSTEM = void 0;
exports.CHANNEL_SCOPE_SYSTEM = 'system';
exports.CHANNEL_SCOPE_USER = 'user';
exports.PRICE_CURRENCY_CREDITS = 'credits';
exports.PRICE_CURRENCY_USD = 'USD';
exports.PRICE_CURRENCY_CNY = 'CNY';
exports.USER_GROUP_BADGE_STYLES = ['none', 'vip', 'svip'];
exports.DEFAULT_USER_GROUP_CODE = 'default';
exports.CHANNEL_MODEL_TAG_COLORS = ['purple', 'blue', 'green', 'gold', 'orange', 'pink'];
/** 渠道并发上限 */
exports.MIN_CHANNEL_CONCURRENCY = 1;
exports.MAX_CHANNEL_CONCURRENCY = 999;
/** 排序值上限 */
exports.MAX_SORT_ORDER = 999_999;
/** 单次批量删除渠道模型上限 */
exports.MAX_CHANNEL_MODEL_BATCH_DELETE = 100;
/** 单次批量调价渠道模型上限（与参考实现一致） */
exports.MAX_CHANNEL_MODEL_BATCH_REPRICE = 100;
exports.SYSTEM_CHANNEL_EXPORT_FORMAT = 'yingce.system-channels';
exports.SYSTEM_CHANNEL_EXPORT_VERSION = 1;
exports.MAX_IMPORTED_SYSTEM_CHANNELS = 200;
exports.MAX_IMPORTED_CHANNEL_MODELS = 500;
//# sourceMappingURL=channel.types.js.map