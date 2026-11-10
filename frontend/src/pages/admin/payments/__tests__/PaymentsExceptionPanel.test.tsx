import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminPaymentException } from '../../../../types/payment';

const mocks = vi.hoisted(() => ({
  can: vi.fn(),
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
  reload: vi.fn(),
  retryRefund: vi.fn(),
  confirmRefund: vi.fn(),
  close: vi.fn(),
  currentRow: {
    id: 'exception-1',
    providerId: 'alipay',
    orderId: 'order-1',
    merchantOrderNo: 'ORDER-EXCEPTION-1',
    providerTradeNo: 'TRADE-1',
    amountCents: 1999,
    currency: 'CNY',
    kind: 'cancelled_but_paid',
    status: 'manual_review',
    priority: 'urgent',
    ownerId: null,
    slaDueAt: '2026-11-10T04:00:00.000Z',
    overdue: false,
    refundId: 'refund-1',
    refundStatus: 'failed',
    refundFailureKind: 'unknown',
    providerRefundId: null,
    resolution: null,
    lastError: '退款结果未知',
    closedAt: null,
    createdAt: '2026-11-10T02:00:00.000Z',
    updatedAt: '2026-11-10T03:00:00.000Z',
  } as AdminPaymentException,
}));

vi.mock('../hooks', () => ({
  useAdmin: () => ({ can: mocks.can }),
  useToast: () => mocks.toast,
  useRefreshOnNonce: vi.fn(),
  usePaymentExceptionFilters: () => ({
    data: {
      items: [mocks.currentRow],
      total: 1,
      page: 1,
      pageSize: 30,
    },
    loading: false,
    error: null,
    values: {
      status: '',
      providerId: '',
      priority: '',
      overdue: '',
    },
    updateFilter: vi.fn(),
    applyFilters: vi.fn(),
    resetFilters: vi.fn(),
    draftChanged: false,
    appliedChips: [],
    setPage: vi.fn(),
    reload: mocks.reload,
  }),
}));

vi.mock('../api', () => ({
  adminPaymentExceptionsApi: {
    retryRefund: mocks.retryRefund,
    confirmRefund: mocks.confirmRefund,
    close: mocks.close,
    claim: vi.fn(),
  },
}));

import { PaymentsExceptionPanel } from '../PaymentsExceptionPanel';

function row(overrides: Partial<AdminPaymentException> = {}): AdminPaymentException {
  return {
    id: 'exception-1',
    providerId: 'alipay',
    orderId: 'order-1',
    merchantOrderNo: 'ORDER-EXCEPTION-1',
    providerTradeNo: 'TRADE-1',
    amountCents: 1999,
    currency: 'CNY',
    kind: 'cancelled_but_paid',
    status: 'manual_review',
    priority: 'urgent',
    ownerId: null,
    slaDueAt: '2026-11-10T04:00:00.000Z',
    overdue: false,
    refundId: 'refund-1',
    refundStatus: 'failed',
    refundFailureKind: 'unknown',
    providerRefundId: null,
    resolution: null,
    lastError: '退款结果未知',
    closedAt: null,
    createdAt: '2026-11-10T02:00:00.000Z',
    updatedAt: '2026-11-10T03:00:00.000Z',
    ...overrides,
  };
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <PaymentsExceptionPanel refreshNonce={0} />
    </MemoryRouter>,
  );
}

function actionButton(name: string) {
  const tableRow = screen.getByText('ORDER-EXCEPTION-1').closest('tr');
  if (!tableRow) throw new Error('exception row not rendered');
  return within(tableRow).getByRole('button', { name });
}

beforeEach(() => {
  mocks.currentRow = row();
  mocks.can.mockReset();
  mocks.can.mockReturnValue(true);
  mocks.toast.success.mockReset();
  mocks.toast.warning.mockReset();
  mocks.toast.info.mockReset();
  mocks.toast.error.mockReset();
  mocks.reload.mockReset();
  mocks.reload.mockResolvedValue(undefined);
  mocks.retryRefund.mockReset();
  mocks.confirmRefund.mockReset();
  mocks.close.mockReset();
});

describe('PaymentsExceptionPanel', () => {
  it('渠道明确拒绝的失败退款显示新建退款单入口', () => {
    mocks.currentRow = row({ refundFailureKind: 'definitive' });
    renderPanel();

    expect(screen.getByText('渠道明确拒绝，可新建退款单重试')).toBeVisible();
    fireEvent.click(actionButton('新建退款单重试'));

    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(screen.getByText(/本次会生成新的退款单号后重新发起/)).toBeVisible();
  });

  it.each(['unknown', null] as const)(
    '结果未知或历史数据缺少 failureKind 时（%s）只能同号重试',
    (refundFailureKind) => {
      mocks.currentRow = row({ refundFailureKind });
      renderPanel();

      expect(screen.queryByRole('button', { name: '新建退款单重试' })).not.toBeInTheDocument();
      fireEvent.click(actionButton('同号重试'));

      expect(screen.getByText(/复用原退款单号再次调用渠道/)).toBeVisible();
    },
  );

  it('自动退款处理中只展示人工核销，不重复发起退款', () => {
    mocks.currentRow = row({
      status: 'auto_refund_pending',
      refundStatus: 'processing',
      refundFailureKind: null,
      lastError: null,
    });
    renderPanel();

    expect(screen.getByRole('button', { name: '确认退款成功' })).toBeVisible();
    expect(screen.getByRole('button', { name: '确认退款失败' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '重试退款' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '同号重试' })).not.toBeInTheDocument();
  });

  it('确认退款成功时提交核销依据和渠道退款单号', async () => {
    mocks.currentRow = row({
      status: 'auto_refund_pending',
      refundStatus: 'processing',
      refundFailureKind: null,
      lastError: null,
    });
    mocks.confirmRefund.mockResolvedValue(mocks.currentRow);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '确认退款成功' }));
    fireEvent.change(screen.getByLabelText('渠道退款单号'), {
      target: { value: '  PROVIDER-REFUND-1  ' },
    });
    fireEvent.change(screen.getByLabelText('核销依据'), {
      target: { value: '  已核对支付宝商户后台退款成功  ' },
    });

    const dialog = screen.getByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: '确认成功' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(mocks.confirmRefund).toHaveBeenCalledWith('exception-1', {
        outcome: 'succeeded',
        reason: '已核对支付宝商户后台退款成功',
        providerRefundId: 'PROVIDER-REFUND-1',
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith(
      '已确认渠道退款成功；订单状态和积分未变更',
    );
    expect(mocks.reload).toHaveBeenCalled();
  });
});
