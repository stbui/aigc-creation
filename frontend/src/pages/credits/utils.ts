/**
 * 积分明细页面的纯函数与外部工具入口 —— 目录内文件的唯一本页工具来源。
 */

import type { CreditLedgerEntry } from '../../types/api';
import { BUSINESS_TYPE_LABEL, LEDGER_LABEL, type LedgerFilter } from './constants';

/** 日期格式化（桌面表格与窄屏列表共用） */
export { formatDate, formatDateTime } from '../../lib/format';

/**
 * 流水行的展示文案：业务类型优先，`other` 才回退到动作类型。
 *
 * 后端保证 `businessType` 恒有值（历史行按 `type` 兜底推导），所以正常路径
 * 展示的是「连续签到奖励」「创意生图扣费」这类业务口径；只有无法归类的
 * 扣费（如文本/音频代理计费）才落到 `other`，这时用「生成消耗」这类动作文案。
 *
 * 末尾仍保留 `?? row.type`：后端尚未升级时前端不显示空白。
 */
export function ledgerTypeLabel(row: { type: string; businessType?: string | null }): string {
  if (row.businessType && row.businessType !== 'other') {
    const business = BUSINESS_TYPE_LABEL[row.businessType];
    if (business) return business;
  }
  return LEDGER_LABEL[row.type] ?? row.type;
}

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

/**
 * 单据短 ID：cuid 前缀区分度低，取末 8 位（与后台任务列表同一口径）。
 * 表格只放短 ID，完整值由调用方放进 title，便于复制与客服核对。
 */
export function shortId(id: string): string {
  return id.slice(-8);
}

/**
 * 流水关联单据：生成账单 / 支付订单 / 生成任务是三张不同的表，
 * 只取与这笔变动最直接的一张，优先级 账单 > 订单 > 任务。
 * 不把三者拼成一串裸 id —— 用户分不清哪个能拿去查。
 */
export function ledgerReference(
  row: CreditLedgerEntry,
): { label: string; id: string } | null {
  if (row.billingOrderId) return { label: '生成账单', id: row.billingOrderId };
  if (row.paymentOrderId) return { label: '支付订单', id: row.paymentOrderId };
  if (row.taskId) return { label: '生成任务', id: row.taskId };
  return null;
}
