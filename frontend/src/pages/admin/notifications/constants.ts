/**
 * AdminNotificationsPage 的本地常量与类型。
 */

export const CHANNEL_LABEL: Record<string, string> = {
  inapp: '站内消息',
  email: '邮件',
  sms: '短信',
};

export const CHANNEL_OPTIONS = Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label }));

export const BUILTIN_CODES = [
  { code: 'payment_success', hint: '支付成功（订单号 / 金额 / 积分）' },
  { code: 'credit_granted', hint: '积分到账（积分）' },
  { code: 'task_failed', hint: '任务失败（能力 / 原因）' },
  { code: 'membership_expired', hint: '会员到期（到期日）' },
  { code: 'ticket_reply', hint: '工单回复（工单号）' },
];
