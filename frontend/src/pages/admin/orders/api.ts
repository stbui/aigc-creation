/**
 * 订单管理的接口入口 —— 目录内文件的唯一外部接口来源。
 */

import {
  adminOrdersApi as baseAdminOrdersApi,
  request,
} from '../../../lib/api';

export type RefundConfirmationResult =
  | {
      refundId: string;
      state: 'succeeded';
      pending: false;
      refundedCents: number;
      fullyRefunded: boolean;
      membershipTerminated: boolean;
      creditsReclaimed: number;
      creditsUnreclaimable: number;
      detail: Array<{ lotId: string; taken: number }>;
      invoiceFollowUp: {
        invoiceId: string;
        invoiceNo: string;
        status: 'pending' | 'issued';
        message: string;
      } | null;
    }
  | {
      refundId: string;
      orderId: string;
      state: 'failed';
      pending: false;
      refundedCents: number;
    };

export const adminOrdersApi = {
  ...baseAdminOrdersApi,

  /**
   * 异步退款最终人工核销。
   *
   * `succeeded` 会原子扣回积分并推进订单；`failed` 只关闭退款单，订单与
   * 积分不变。两种结果都必须填写依据，供审计追溯。
   */
  confirmRefund: (
    orderId: string,
    refundId: string,
    payload: {
      outcome: 'succeeded' | 'failed';
      providerRefundId?: string;
      reason: string;
    },
  ) =>
    request<RefundConfirmationResult>(
      `/admin/orders/${orderId}/refunds/${refundId}/confirm`,
      { method: 'POST', body: payload },
    ),
};
