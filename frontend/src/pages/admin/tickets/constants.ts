/**
 * 工单处理的类型 / 状态 / 优先级映射与流转表。
 *
 * `TRANSITIONS` 必须与后端 `TicketsService.TRANSITIONS` 保持一致；
 * 前端只用于决定显示哪些按钮，真正的合法性校验在后端。
 */

import type { TagTone } from './components';
import type { TicketPriority, TicketStatus, TicketType } from '../../../types/api';

export const TYPE_LABELS: Record<TicketType, string> = {
  bug: '功能异常',
  complaint: '投诉',
  consultation: '咨询',
  invoice: '发票问题',
  other: '其他',
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

/** 与后端 TRANSITIONS 保持一致（仅用于决定显示哪些流转按钮） */
export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['processing', 'resolved', 'closed'],
  processing: ['resolved', 'closed', 'open'],
  resolved: ['closed', 'open'],
  closed: ['open'],
};

/**
 * 状态 → 标签色。
 *
 * 不直接复用 `STATUS_META`：`open` 在账号 / 商品语境下是「正常」的绿色，
 * 在这里是「待处理」的黄色。语义相同、颜色相反，覆盖一层比改共享表安全。
 */
export const STATUS_TONE: Record<TicketStatus, TagTone> = {
  open: 'warn',
  processing: 'brand',
  resolved: 'success',
  closed: 'muted',
};

export const PRIORITY_TONE: Record<TicketPriority, TagTone> = {
  high: 'danger',
  normal: 'brand',
  low: 'muted',
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: '低',
  normal: '中',
  high: '高',
};

export const PRIORITY_OPTIONS = [
  { value: 'high', label: '高' },
  { value: 'normal', label: '中' },
  { value: 'low', label: '低' },
];

export const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** URL 里只接受这四个状态，避免告警链接被手工改成非法值时整页 400 */
export const TICKET_STATUSES: TicketStatus[] = ['open', 'processing', 'resolved', 'closed'];
