/**
 * AdminInvoicesPage 的本地常量与类型。
 */

import type { AdminInvoice, InvoiceStatus } from '../../../types/api';

export const STATUS_OPTIONS: Array<{ value: InvoiceStatus; label: string }> = [
  { value: 'pending', label: '待开具' },
  { value: 'issued', label: '已开具' },
  { value: 'rejected', label: '已驳回' },
];

export const KIND_LABELS: Record<string, string> = {
  personal: '个人',
  company: '企业',
};

export const STATUS_LABELS: Record<string, string> = {
  pending: '待开具',
  issued: '已开具',
  rejected: '已驳回',
};
