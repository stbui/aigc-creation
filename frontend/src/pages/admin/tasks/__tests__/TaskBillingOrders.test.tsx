import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingOrderListResult, BillingOrderView } from '../../../../types/model';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

vi.mock('../api', () => ({
  adminBillingOrdersApi: { list: listMock },
}));

import { TaskBillingOrders } from '../TaskBillingOrders';

function billingOrder(overrides: Partial<BillingOrderView> = {}): BillingOrderView {
  return {
    id: 'billing-1',
    userId: 'user-1',
    userEmail: 'owner@example.com',
    taskId: 'task-1',
    model: 'seedream-4.0',
    capability: 'main_image',
    scene: '',
    billingMode: 'fixed_request',
    status: 'refunded',
    channelId: 'channel-1',
    channelName: '本地 Mock 渠道',
    channelModelId: 'channel-model-1',
    channelModelName: 'Seedream',
    priceTierId: 'tier-1',
    userGroup: 'default',
    priceCurrency: 'credit',
    unitPriceMicrocredits: 10_000_000,
    multiplierBasisPoints: 10_000,
    quantity: 1,
    amountMicrocredits: 10_000_000,
    reservedAmountMicrocredits: 10_000_000,
    actualAmountMicrocredits: 0,
    refundedAmountMicrocredits: 10_000_000,
    costConfigured: false,
    costAmountMicrocredits: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    usageSource: '',
    usageAvailable: false,
    chargeLimitSet: false,
    chargeLimitMicrocredits: 0,
    providerRequestId: '',
    errorText: 'connect ECONNREFUSED 127.0.0.1:3900',
    resolutionNote: '建连前网络失败，自动对账退款',
    resolvedBy: 'system:preconnection-reconcile',
    reviewable: false,
    reviewBatchId: '',
    refundReason: 'failure',
    startedAt: '2026-11-05T10:00:00.000Z',
    settledAt: null,
    refundedAt: '2026-11-05T10:00:01.000Z',
    createdAt: '2026-11-05T10:00:00.000Z',
    ...overrides,
  };
}

function result(items: BillingOrderView[]): BillingOrderListResult {
  return { items, total: items.length, page: 1, pageSize: 100, statusCounts: {} };
}

function renderBilling(canRead = true) {
  return render(
    <MemoryRouter>
      <TaskBillingOrders taskId="task-1" canRead={canRead} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listMock.mockReset();
});

describe('TaskBillingOrders', () => {
  it('无账单权限时不请求账单并说明权限边界', () => {
    renderBilling(false);

    expect(screen.getByText(/没有账单查看权限/)).toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('建连前网络失败已由系统对账退款时明确无需人工复核', async () => {
    listMock.mockResolvedValue(result([billingOrder()]));

    renderBilling();

    expect(await screen.findByText('系统对账退款')).toBeInTheDocument();
    expect(screen.getByText(/建连前网络失败，请求没有到达上游/)).toBeInTheDocument();
    expect(screen.getByText(/积分已自动退回，无需人工复核/)).toBeInTheDocument();
    expect(screen.getByText('无需人工核对')).toBeInTheDocument();
    expect(screen.queryByText('待人工核对')).not.toBeInTheDocument();
  });

  it('上游结果不明且可核对时进入待人工核对队列', async () => {
    listMock.mockResolvedValue(
      result([
        billingOrder({
          status: 'uncertain',
          reviewable: true,
          resolvedBy: '',
          refundedAmountMicrocredits: 0,
          errorText: '轮询超时',
        }),
      ]),
    );

    renderBilling();

    expect(await screen.findByText('待人工核对')).toBeInTheDocument();
    expect(screen.getByText(/上游可能已经接单/)).toBeInTheDocument();
    expect(screen.getByText('待人工核对 1 笔')).toBeInTheDocument();
  });

  it('线路切换的旧账单显示为内部重预留，不冒充真实退款', async () => {
    listMock.mockResolvedValue(
      result([
        billingOrder({
          refundReason: 'route_switch',
          resolvedBy: 'system:route-switch',
          refundedAt: null,
        }),
      ]),
    );

    renderBilling();

    expect(await screen.findByText('换线重预留')).toBeInTheDocument();
    expect(screen.getByText(/不计入真实退款/)).toBeInTheDocument();
  });
});
