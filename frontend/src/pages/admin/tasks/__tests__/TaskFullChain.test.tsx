import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminTaskDetail } from '../../../../types/api';
import type { AdminTaskRouteAttempt } from '../../../../types/task-route';
import type { BillingOrderListResult, BillingOrderView } from '../../../../types/model';

const { billingListMock, apiLogListMock } = vi.hoisted(() => ({
  billingListMock: vi.fn(),
  apiLogListMock: vi.fn(),
}));

vi.mock('../api', () => ({
  adminBillingOrdersApi: { list: billingListMock },
  adminApiLogsApi: { list: apiLogListMock },
}));

import { TaskFullChain } from '../TaskFullChain';

function attempt(overrides: Partial<AdminTaskRouteAttempt> = {}): AdminTaskRouteAttempt {
  return {
    id: 'attempt-1',
    routeRun: 1,
    attemptNumber: 1,
    logicalModelId: 'logical-1',
    logicalModelRevisionId: 'revision-1',
    routeId: 'route-1',
    channelId: 'channel-1',
    channelModelId: 'channel-model-1',
    status: 'failed',
    dispatchState: 'submission_unknown',
    providerRequestId: '',
    failureCode: 'outbound_network',
    failureMessage: 'connect ECONNREFUSED 127.0.0.1:3900',
    startedAt: '2026-11-05T10:00:00.100Z',
    completedAt: '2026-11-05T10:00:01.100Z',
    ...overrides,
  };
}

function task(routeAttempts: AdminTaskRouteAttempt[]): AdminTaskDetail {
  return {
    id: 'task-1',
    capability: 'main_image',
    capabilityName: '主图生成',
    status: 'failed',
    errorCode: '42204',
    creditCost: 10,
    retriedFromId: null,
    user: { id: 'user-1', email: 'owner@example.com' },
    project: { id: 'project-1', name: '默认项目' },
    durationMs: 2000,
    createdAt: '2026-11-05T10:00:00.000Z',
    updatedAt: '2026-11-05T10:00:02.000Z',
    timeline: [],
    params: {},
    routeAttempts,
    inputAssets: [],
    outputAsset: null,
  };
}

function billingOrder(): BillingOrderView {
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
  };
}

function billingResult(items: BillingOrderView[]): BillingOrderListResult {
  return { items, total: items.length, page: 1, pageSize: 100, statusCounts: {} };
}

function renderChain(detail: AdminTaskDetail) {
  return render(
    <MemoryRouter>
      <TaskFullChain task={detail} canReadBilling canReadModelCalls={false} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  billingListMock.mockReset();
  apiLogListMock.mockReset();
});

describe('TaskFullChain', () => {
  it('集中展示线路尝试、模型调用入口、账单和产出结果', async () => {
    billingListMock.mockResolvedValue(billingResult([billingOrder()]));

    renderChain(
      task([
        attempt(),
        attempt({
          id: 'attempt-2',
          attemptNumber: 2,
          failureCode: 'channel_unavailable',
          dispatchState: 'rejected_no_job',
          failureMessage: '渠道不可用',
        }),
        attempt({
          id: 'attempt-3',
          routeRun: 2,
          failureCode: '',
          dispatchState: 'not_sent',
          status: 'selected',
          failureMessage: '',
        }),
      ]),
    );

    expect(await screen.findByText('系统对账退款')).toBeInTheDocument();
    expect(screen.getByText('无需人工核对')).toBeInTheDocument();
    expect(screen.getByText('建连前网络失败')).toBeInTheDocument();
    expect(screen.getByText('上游未接单')).toBeInTheDocument();
    expect(screen.getByText('已选择，未派发')).toBeInTheDocument();
    expect(screen.getAllByText(/第 \d 轮 · 第 \d 次/).map((node) => node.textContent)).toEqual([
      '第 1 轮 · 第 1 次',
      '第 1 轮 · 第 2 次',
      '第 2 轮 · 第 1 次',
    ]);
    expect(screen.getAllByTitle('connect ECONNREFUSED 127.0.0.1:3900')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /查看全部模型调用/ })).toHaveAttribute(
      'href',
      '/admin/model-calls?taskId=task-1',
    );
    expect(screen.getByText(/任务失败，未产出素材/)).toBeInTheDocument();
    expect(billingListMock).toHaveBeenCalledWith({ taskId: 'task-1', page: 1, pageSize: 100 });
    expect(apiLogListMock).not.toHaveBeenCalled();
  });

  it('兼容旧版任务详情缺失 routeAttempts 字段，不崩溃并显示空态', async () => {
    billingListMock.mockResolvedValue(billingResult([]));
    const legacyTask = task([]);
    delete legacyTask.routeAttempts;

    renderChain(legacyTask);

    expect(screen.getAllByText('尚无记录')).toHaveLength(2);
    expect(screen.getByText(/历史任务可能没有 RouteAttempt 快照/)).toBeInTheDocument();
  });

  it('非建连前的结果不明仍标记为待确认，不能当作网络失败自动退款', async () => {
    billingListMock.mockResolvedValue(billingResult([]));
    renderChain(
      task([
        attempt({
          failureCode: 'upstream_timeout',
          dispatchState: 'submission_unknown',
          failureMessage: '轮询超时',
        }),
      ]),
    );

    expect(await screen.findByText('结果待确认')).toBeInTheDocument();
    expect(screen.getByText(/不能自动重发，需要结合账单判断是否人工核对/)).toBeInTheDocument();
  });
});
