/**
 * 发票审核的接口入口 —— 目录内文件的唯一外部接口来源。
 */

import {
  adminInvoicesApi as baseAdminInvoicesApi,
  request,
} from '../../../lib/api';
import type { AdminInvoice } from '../../../types/payment';

export const adminInvoicesApi = {
  ...baseAdminInvoicesApi,

  /** 已开具发票的冲红登记；原因必填并保留在冲红记录中。 */
  redFlush: (id: string, reason: string) =>
    request<AdminInvoice>(`/admin/invoices/${id}/red-flush`, {
      method: 'POST',
      body: { reason },
    }),
};
