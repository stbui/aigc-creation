/**
 * 工单回复模板。
 *
 * 只做高频句式的快捷输入，不替代客服判断：选中后仍可在输入框里修改，
 * 发送前也仍走同一条 `POST /admin/tickets/:id/replies` 与审计。
 *
 * 变量只支持 `{name}` / `{ticketNo}` / `{orderNo}` 三种 —— 都是工单详情里
 * 已经存在的字段，不做第二套模板引擎。
 */
export interface TicketReplyTemplate {
  id: string;
  label: string;
  content: string;
}

export const TICKET_REPLY_TEMPLATES: TicketReplyTemplate[] = [
  {
    id: 'received',
    label: '已收到，正在核实',
    content:
      '{name} 你好，已收到你的反馈（工单 {ticketNo}），我们正在核实，有结果会第一时间在这里回复你。',
  },
  {
    id: 'need-info',
    label: '请补充信息',
    content:
      '{name} 你好，为了定位问题，请补充：1）操作步骤；2）出现问题的时间；3）相关截图或订单号。补充后我们会继续跟进。',
  },
  {
    id: 'refund-handoff',
    label: '退款申请已转交',
    content:
      '{name} 你好，关于订单 {orderNo} 的退款申请，我们已转交财务核对。退款结果会在订单页面与站内消息中同步。',
  },
  {
    id: 'resolved',
    label: '问题已处理',
    content:
      '{name} 你好，你反馈的问题已处理完成（工单 {ticketNo}）。如仍有异常，直接回复本工单即可继续跟进。',
  },
];

export function fillTicketTemplate(
  content: string,
  vars: { name?: string | null; ticketNo?: string | null; orderNo?: string | null },
): string {
  return content
    .replace(/\{name\}/g, vars.name?.trim() || '你好')
    .replace(/\{ticketNo\}/g, vars.ticketNo || '')
    .replace(/\{orderNo\}/g, vars.orderNo || '');
}
