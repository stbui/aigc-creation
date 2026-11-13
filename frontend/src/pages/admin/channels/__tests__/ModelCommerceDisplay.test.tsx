import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModelCommerceMetricsCell } from '../ModelCommerceMetricsCell';
import { ModelCommerceOverview } from '../ModelCommerceOverview';
import type { ModelCommerceOverviewView, ModelCommerceProductView } from '../../../../types/model';

const product: ModelCommerceProductView = {
  channelModelId: 'cm-1',
  channelId: 'ch-1',
  channelName: '主供应商',
  modelKey: 'image-model',
  displayName: '生图商品',
  capability: 'image',
  protocol: 'openai-image',
  enabled: true,
  channelEnabled: true,
  priceConfigured: true,
  calls: 4,
  settledOrders: 0,
  refundedOrders: 0,
  netMicrocredits: 0,
  refundedMicrocredits: 0,
  costMicrocredits: 0,
  marginMicrocredits: 0,
  marginRate: null,
  refundRate: null,
  unknownCostOrders: 0,
  bindingCount: 1,
  enabledBindingCount: 1,
  invalidBindingCount: 0,
  noCalls: false,
  lowMargin: false,
  highRefund: false,
};

const overview: ModelCommerceOverviewView = {
  days: 7,
  range: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-08T00:00:00.000Z' },
  summary: {
    products: 1,
    calls: 4,
    settledOrders: 0,
    refundedOrders: 0,
    netMicrocredits: 0,
    refundedMicrocredits: 0,
    costMicrocredits: 0,
    marginMicrocredits: 0,
    refundRate: null,
    unknownCostOrders: 0,
    pendingPricingProducts: 0,
    noCallsProducts: 0,
    lowMarginProducts: 0,
    highRefundProducts: 0,
    invalidBindingCount: 0,
    supplierDisabledProducts: 0,
  },
  items: [product],
};

describe('商品经营数据空样本口径', () => {
  it('商品行退款率无样本时显示「—」并解释原因，不写成 0%', () => {
    render(<ModelCommerceMetricsCell commerce={product} />);

    expect(screen.getByTitle('暂无真实退款样本')).toBeTruthy();
    expect(screen.queryByTitle(/退款率 0%/)).toBeNull();
  });

  it('经营总览的退款率无样本时提示没有真实样本', () => {
    render(
      <ModelCommerceOverview
        overview={overview}
        loading={false}
        error={null}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByText('暂无真实退款样本')).toBeTruthy();
    expect(screen.queryByText('已退 0 单')).toBeNull();
  });
});
