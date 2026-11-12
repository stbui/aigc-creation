/**
 * 积分明细页面的纯函数与外部工具入口 —— 目录内文件的唯一本页工具来源。
 */

import type { CreditLedgerEntry } from '../../types/api';
import type { LedgerFilter } from './constants';

/** 日期格式化（桌面表格与窄屏列表共用） */
export { formatDate, formatDateTime } from '../../lib/format';

/** 筛选项 → 后端查询参数；全部时不带任何过滤 */
export function ledgerFilterParams(filter: LedgerFilter): {
  type?: string;
  direction?: 'income' | 'expense';
} {
  if (filter === 'all') return {};
  if (filter === 'income' || filter === 'expense') return { direction: filter };
  return { type: filter };
}

/**
 * 流水的备注口径: 后台人工调整的原文可能含工单号 / 客服姓名,
 * C 端只展示枚举文案, 不把内部备注透出给用户。
 */
export function ledgerRemark(row: CreditLedgerEntry): string | null {
  if (row.type === 'admin_adjust') return '客服调整';
  return row.reason ?? null;
}
