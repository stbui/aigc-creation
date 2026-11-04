"use strict";
/**
 * 上游 usage → 计费 / 日志用的 Token 三元组。
 *
 * 各家字段名不同（OpenAI 的 `prompt_tokens`、Anthropic 的 `input_tokens`、
 * 部分聚合网关的驼峰写法），这里只做归一，不做换算。取不到任何 token 数时
 * 返回 `null` —— 表示「上游没给用量」，与「用量为 0」是两件事：
 * 前者按预留金额结算，后者按 0 结算。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractUsage = extractUsage;
function extractUsage(usage) {
    if (!usage || typeof usage !== 'object')
        return null;
    const pick = (...keys) => {
        for (const key of keys) {
            const value = usage[key];
            if (value === undefined || value === null || value === '')
                continue;
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed >= 0)
                return Math.trunc(parsed);
        }
        return -1;
    };
    const input = pick('prompt_tokens', 'input_tokens', 'promptTokens', 'inputTokens');
    const output = pick('completion_tokens', 'output_tokens', 'completionTokens', 'outputTokens');
    const cached = pick('cached_tokens', 'cache_read_input_tokens', 'cachedTokens', 'prompt_tokens_details.cached_tokens');
    if (input < 0 && output < 0)
        return null;
    return {
        inputTokens: BigInt(Math.max(0, input)),
        outputTokens: BigInt(Math.max(0, output)),
        cachedTokens: BigInt(Math.max(0, cached)),
    };
}
//# sourceMappingURL=usage.js.map