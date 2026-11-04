"use strict";
/**
 * 成本金额计算（账单口径唯一实现）。
 *
 * 移植自 open-ai-canvas `internal/app/credit_cost.go` 的 `billingCreditCost`：
 *   - Token 计费按「输入(减缓存) + 输出 + 缓存」三项分别计价；
 *   - 视频在上游 usage 缺失时回退到提交时的公式快照（`costVideoFormulaTokens`）；
 *   - 未结算 / 未配置成本时返回 null —— **不编造金额**，页面显示「未配置」而不是 0。
 *
 * 为什么不散落在两个服务里各写一份：
 *   账单列表（`BillingAdminService`）与财务汇总（`FinanceAnalyticsService`）
 *   之前口径不同（后者漏算缓存 Token、且未结算也照算），同一笔账在两页显示两个毛利。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingCreditCost = billingCreditCost;
exports.billingGrossProfit = billingGrossProfit;
/**
 * 账单成本（微积分）。返回 null 表示**无法确定**：
 *   - 未配置成本价；
 *   - 账单尚未结算（用量与最终金额都还没定）。
 */
function billingCreditCost(order) {
    if (!order.costConfigured)
        return null;
    // 未结算不做估算：结算后才有真实用量，早算会与最终值对不上
    if (order.status !== 'settled')
        return null;
    const mode = order.costBillingMode || 'fixed_request';
    if (mode === 'token') {
        const input = order.inputTokens > 0n ? order.inputTokens : 0n;
        const output = order.outputTokens > 0n ? order.outputTokens : 0n;
        const cached = order.cachedTokens > 0n ? order.cachedTokens : 0n;
        // 缓存命中的输入按缓存价计，不重复按输入价计
        const billableInput = input > cached ? input - cached : 0n;
        const tokenCost = order.costInputTokenPriceMicrocredits * billableInput +
            order.costOutputTokenPriceMicrocredits * output +
            order.costCachedTokenPriceMicrocredits * cached;
        if (tokenCost > 0n)
            return tokenCost;
        // 上游没给 usage：视频可回退到提交时的公式快照
        if (order.costVideoFormulaTokens > 0n) {
            return order.costOutputTokenPriceMicrocredits * order.costVideoFormulaTokens;
        }
        return null;
    }
    const quantity = order.costQuantity > 0n ? order.costQuantity : order.quantity;
    if (quantity <= 0n)
        return null;
    return order.costUnitPriceMicrocredits * quantity;
}
/** 毛利（微积分）：售价 − 成本。成本无法确定时返回 null，不写 0 假装满毛利。 */
function billingGrossProfit(order) {
    const cost = billingCreditCost(order);
    if (cost === null)
        return null;
    const sale = order.actualAmountMicrocredits ?? 0n;
    return sale - cost;
}
//# sourceMappingURL=cost-amount.js.map