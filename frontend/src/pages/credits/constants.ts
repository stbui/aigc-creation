/**
 * 积分明细页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 流水类型 / 批次状态 / 来源文案与分页步长集中定义，桌面表格与窄屏列表共用。
 */

import type { CreditLot } from '../../types/api';

/** 页面标题与描述（主态 / 访客态两套描述） */
export const CREDITS_PAGE_META = {
  title: '积分明细',
  description: '积分按批次发放并可能有有效期；余额由后端账本实时汇总。',
  guestDescription: '查看余额、批次与每一笔积分流水。',
} as const;

export type Tab = 'ledger' | 'lots';

export type LedgerFilter =
  | 'all'
  | 'income'
  | 'expense'
  | 'purchase'
  | 'consume'
  | 'admin_adjust'
  | 'expire';

export const SOURCE_LABEL: Record<string, string> = {
  purchase: '购买',
  grant: '赠送',
  admin_adjust: '客服调整',
};

export const LEDGER_LABEL: Record<string, string> = {
  purchase: '购买获得',
  grant: '发放',
  consume: '生成消耗',
  refund_reclaim: '退款扣回',
  reserve: '预授权冻结',
  refund: '预授权退回',
  expire: '到期回收',
  admin_adjust: '客服调整',
};

export const LOT_STATUS: Record<CreditLot['status'], string> = {
  active: '可用',
  expired: '已过期',
  exhausted: '已用尽',
};

/** 每页条数: 桌面表格与窄屏列表共用, 换结构不改分页节奏 */
export const PAGE_SIZE = 20;

export const LEDGER_FILTER_OPTIONS: Array<{ value: LedgerFilter; label: string }> = [
  { value: 'all', label: '全部流水' },
  { value: 'income', label: '只看收入' },
  { value: 'expense', label: '只看支出' },
  { value: 'purchase', label: '购买获得' },
  { value: 'consume', label: '生成消耗' },
  { value: 'admin_adjust', label: '客服调整' },
  { value: 'expire', label: '到期回收' },
];
