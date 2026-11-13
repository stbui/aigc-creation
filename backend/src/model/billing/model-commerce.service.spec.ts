import { describe, expect, it, vi } from 'vitest';
import { ModelCommerceService } from './model-commerce.service';

const model = {
  id: 'cm-1',
  channelId: 'ch-1',
  modelKey: 'gpt-image-1',
  displayName: '生图模型',
  capability: 'ecommerce_gen',
  protocol: 'openai_image',
  enabled: true,
  priceConfigured: true,
};

const channel = { id: 'ch-1', name: '主供应商', enabled: true, deletedAt: null };

function order(overrides: Record<string, unknown> = {}) {
  return {
    channelModelId: 'cm-1',
    status: 'settled',
    actualAmountMicrocredits: 1000n,
    refundedAmountMicrocredits: 0n,
    refundReason: null,
    costConfigured: true,
    costBillingMode: 'fixed_request',
    costUnitPriceMicrocredits: 200n,
    costInputTokenPriceMicrocredits: 0n,
    costOutputTokenPriceMicrocredits: 0n,
    costCachedTokenPriceMicrocredits: 0n,
    costQuantity: 1n,
    costVideoFormulaTokens: 0n,
    inputTokens: 0n,
    outputTokens: 0n,
    cachedTokens: 0n,
    quantity: 1n,
    ...overrides,
  };
}

function serviceWith(input: {
  models?: unknown[];
  channels?: unknown[];
  bindings?: unknown[];
  orders?: unknown[];
}) {
  const prisma = {
    channelModel: { findMany: vi.fn().mockResolvedValue(input.models ?? [model]) },
    modelChannel: { findMany: vi.fn().mockResolvedValue(input.channels ?? [channel]) },
    capabilityModelBinding: { findMany: vi.fn().mockResolvedValue(input.bindings ?? []) },
    billingOrder: { findMany: vi.fn().mockResolvedValue(input.orders ?? []) },
  };
  return new ModelCommerceService(prisma as never);
}

describe('ModelCommerceService 商品经营口径', () => {
  it('route_switch 不计真实退款，净利润仍按已结算收入计算', async () => {
    const result = await serviceWith({
      orders: [
        order({ actualAmountMicrocredits: 1000n }),
        order({
          status: 'refunded',
          actualAmountMicrocredits: 0n,
          refundedAmountMicrocredits: 1000n,
          refundReason: 'route_switch',
        }),
      ],
    }).overview(7);

    const item = result.items[0];
    expect(item.calls).toBe(2);
    expect(item.refundedOrders).toBe(0);
    expect(item.refundedMicrocredits).toBe(0);
    expect(item.netMicrocredits).toBe(1000);
    expect(item.marginMicrocredits).toBe(800);
    expect(result.summary.refundRate).toBe(0);
  });

  it('任一已结算账单成本未知时，商品与总览的成本和毛利均为 null', async () => {
    const result = await serviceWith({
      orders: [order({ costConfigured: false })],
    }).overview(7);

    expect(result.items[0].unknownCostOrders).toBe(1);
    expect(result.items[0].costMicrocredits).toBeNull();
    expect(result.items[0].marginMicrocredits).toBeNull();
    expect(result.summary.costMicrocredits).toBeNull();
    expect(result.summary.marginMicrocredits).toBeNull();
  });

  it('无调用与待定价是两条独立运营待办', async () => {
    const result = await serviceWith({
      models: [{ ...model, priceConfigured: false }],
      orders: [],
    }).overview(7);

    expect(result.items[0].noCalls).toBe(true);
    expect(result.items[0].priceConfigured).toBe(false);
    expect(result.items[0].refundRate).toBeNull();
    expect(result.items[0].highRefund).toBe(false);
    expect(result.summary.refundRate).toBeNull();
    expect(result.summary.noCallsProducts).toBe(1);
    expect(result.summary.pendingPricingProducts).toBe(1);
  });

  it('失效能力绑定会计入商品与总览', async () => {
    const result = await serviceWith({
      bindings: [{ channelModelId: 'cm-1', capabilityId: 'removed_capability', enabled: true }],
    }).overview(7);

    expect(result.items[0].invalidBindingCount).toBe(1);
    expect(result.summary.invalidBindingCount).toBe(1);
  });

  it('供应商停用会反映在商品行与总览待办', async () => {
    const result = await serviceWith({
      channels: [{ ...channel, enabled: false }],
    }).overview(7);

    expect(result.items[0].channelEnabled).toBe(false);
    expect(result.summary.supplierDisabledProducts).toBe(1);
  });
});
