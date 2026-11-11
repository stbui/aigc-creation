import type { OrderStatus } from '../../types/api';

/**
 * 我的订单页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 分页大小、状态文案与筛选档位这些「改一处就得全改」的值集中在这里:
 * 列表取数与底部「加载更多」必须用同一个 `PAGE_SIZE`，筛选标签与
 * `matchesFilter` 必须用同一份 `FILTERS`，否则会出现「点了没有结果」的死角。
 *
 * 约定: `orders/` 下的文件不从外部常量模块直接取东西,
 * 一律经由本文件 —— 目录内新增共享常量时在这里补一行。
 */

/** 服务端分页每页条数 */
export const PAGE_SIZE = 20;

/** 订单状态 → 中文标签 */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: '待支付',
  paid: '已支付',
  cancelled: '已取消',
  refunded: '已退款',
  partial_refunded: '部分退款',
};

/** 状态筛选档位；`refund` 合并 `refunded` / `partial_refunded` 两种退款态 */
export const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待支付' },
  { value: 'paid', label: '已支付' },
  { value: 'refund', label: '退款' },
  { value: 'cancelled', label: '已取消' },
] as const;

export type FilterValue = (typeof FILTERS)[number]['value'];

/** 开票表单草稿（页面持有状态，卡片只渲染） */
export interface InvoiceFormState {
  kind: 'personal' | 'company';
  title: string;
  taxNo: string;
  email: string;
}

/** 开票表单初始值；提交成功或收起表单时都回到这一份 */
export const EMPTY_INVOICE_FORM: InvoiceFormState = {
  kind: 'personal',
  title: '',
  taxNo: '',
  email: '',
};
