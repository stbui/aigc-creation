import type { TicketPriority, TicketStatus, TicketType } from '../../types/api';

/**
 * 我的工单页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 类型 / 状态 / 优先级文案与筛选档位集中在这里: 新建表单、详情头部与
 * 列表筛选必须用同一份映射, 否则会出现「列表显示已解决、详情显示 closed」
 * 这类同值不同名的漂移。
 *
 * 约定: `tickets/` 下的文件不从外部常量模块直接取东西,
 * 一律经由本文件 —— 目录内新增共享常量时在这里补一行。
 */

/** 问题类型选项 */
export const TYPE_OPTIONS: Array<{ value: TicketType; label: string }> = [
  { value: 'bug', label: '功能异常' },
  { value: 'complaint', label: '投诉' },
  { value: 'consultation', label: '咨询' },
  { value: 'invoice', label: '发票问题' },
  { value: 'other', label: '其他' },
];

/** 工单状态 → 中文标签 */
export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

/** 优先级 → 中文标签 */
export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: '低',
  normal: '中',
  high: '高',
};

/** 优先级选项顺序（表单下拉直接按这个顺序生成） */
export const PRIORITY_VALUES: TicketPriority[] = ['low', 'normal', 'high'];

/**
 * 列表筛选。工单量小 (单个用户通常个位数), 列表接口一次返回全部,
 * 因此在客户端按状态切片即可 —— 不为每次切档位再发一次请求。
 */
export const FILTERS: Array<{ value: 'all' | TicketStatus; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'open', label: '待处理' },
  { value: 'processing', label: '处理中' },
  { value: 'resolved', label: '已解决' },
  { value: 'closed', label: '已关闭' },
];

export type TicketFilterValue = 'all' | TicketStatus;

/** 新建工单表单草稿（页面持有状态，表单组件只渲染） */
export interface TicketFormState {
  type: TicketType;
  subject: string;
  content: string;
  priority: TicketPriority;
}

/** 新建工单表单初始值；提交成功或收起后都回到这一份 */
export const EMPTY_TICKET_FORM: TicketFormState = {
  type: 'consultation',
  subject: '',
  content: '',
  priority: 'normal',
};
