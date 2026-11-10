import { request } from './api';
import type {
  AdminPageResult,
  AdminPaymentException,
} from '../types/payment';

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** 支付异常补偿工作台 */
export const adminPaymentExceptionsApi = {
  list: (
    params: {
      status?: string;
      providerId?: string;
      priority?: string;
      overdue?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    request<AdminPageResult<AdminPaymentException>>(
      `/admin/payments/exceptions${query(params)}`,
    ),

  detail: (id: string) =>
    request<AdminPaymentException>(`/admin/payments/exceptions/${id}`),

  claim: (id: string) =>
    request<AdminPaymentException>(`/admin/payments/exceptions/${id}/claim`, {
      method: 'POST',
    }),

  retryRefund: (id: string) =>
    request<{ case: AdminPaymentException; outcome: string }>(
      `/admin/payments/exceptions/${id}/retry-refund`,
      { method: 'POST' },
    ),

  confirmRefund: (
    id: string,
    payload: {
      outcome: 'succeeded' | 'failed';
      providerRefundId?: string;
      reason: string;
    },
  ) =>
    request<AdminPaymentException>(
      `/admin/payments/exceptions/${id}/confirm-refund`,
      { method: 'POST', body: payload },
    ),

  close: (id: string, resolution: string) =>
    request<AdminPaymentException>(`/admin/payments/exceptions/${id}/close`, {
      method: 'POST',
      body: { resolution },
    }),
};
