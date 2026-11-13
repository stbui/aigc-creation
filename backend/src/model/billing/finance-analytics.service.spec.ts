import { describe, expect, it, vi } from 'vitest';
import { FinanceAnalyticsService } from './finance-analytics.service';

const baseTime = new Date('2026-01-01T12:00:00.000Z');

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bo-1',
    status: 'settled',
    model: 'gpt-image-1',
    capability: 'ecommerce_gen',
    channelId: 'ch-1',
    scene: 'image_generation',
    billingMode: 'fixed_request',
    actualAmountMicrocredits: 1000n,
    reservedAmountMicrocredits: 0n,
    refundedAmountMicrocredits: 0n,
    refundReason: null,
    costConfigured: true,
    costUnitPriceMicrocredits: 250n,
    costInputTokenPriceMicrocredits: 0n,
    costOutputTokenPriceMicrocredits: 0n,
    costCachedTokenPriceMicrocredits: 0n,
    costBillingMode: 'fixed_request',
    costQuantity: 1n,
    costVideoFormulaTokens: 0n,
    inputTokens: 0n,
    outputTokens: 0n,
    cachedTokens: 0n,
    quantity: 1n,
    createdAt: baseTime,
    ...overrides,
  };
}

function serviceWith(rows: unknown[]) {
  const prisma = { billingOrder: { findMany: vi.fn().mockResolvedValue(rows) } };
  return new FinanceAnalyticsService(prisma as never);
}

const range = { from: '2026-01-01', to: '2026-01-01' };

describe('FinanceAnalyticsService 财务口径', () => {
  it('任一已结算订单成本未知时，总览与所有维度的成本、毛利均为 null', async () => {
    const result = await serviceWith([
      order({ id: 'known', costUnitPriceMicrocredits: 200n }),
      order({ id: 'unknown', costConfigured: false }),
    ]).summary(range);

    expect(result.totals.costMicrocredits).toBeNull();
    expect(result.totals.marginMicrocredits).toBeNull();
    for (const rows of [
      result.byDay,
      result.byModel,
      result.byChannel,
      result.byCapability,
      result.byScene,
    ]) {
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.costMicrocredits === null)).toBe(true);
      expect(rows.every((row) => row.marginMicrocredits === null)).toBe(true);
    }
  });

  it('route_switch 不计真实退款，净收入与毛利按真实资金流计算', async () => {
    const result = await serviceWith([
      order({ id: 'settled', actualAmountMicrocredits: 1000n }),
      order({
        id: 'switch',
        status: 'refunded',
        actualAmountMicrocredits: 0n,
        refundedAmountMicrocredits: 1000n,
        refundReason: 'route_switch',
      }),
      order({
        id: 'refund',
        status: 'refunded',
        actualAmountMicrocredits: 0n,
        refundedAmountMicrocredits: 200n,
        refundReason: 'user_refund',
      }),
    ]).summary(range);

    expect(result.totals.chargedMicrocredits).toBe(1000);
    expect(result.totals.refundedMicrocredits).toBe(200);
    expect(result.totals.netMicrocredits).toBe(800);
    expect(result.totals.costMicrocredits).toBe(250);
    expect(result.totals.marginMicrocredits).toBe(550);
    expect(result.totals.refundedOrders).toBe(1);
    expect(result.totals.settleRate).toBe(0.5);
  });
});
