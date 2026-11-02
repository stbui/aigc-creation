/**
 * 生成账单的状态文案、色调与筛选选项。
 *
 * 状态机本身在 `backend/src/model/billing/billing.service.ts` 的
 * `BILLING_STATUSES`；这里只做展示映射，不新增或改变状态语义。
 */

export const STATUS_LABELS: Record<string, string> = {
  reserved: '已预留',
  running: '计费中',
  settled: '已结算',
  refunded: '已退款',
  uncertain: '结果不明',
};

export const STATUS_TONES: Record<string, 'success' | 'danger' | 'warn' | 'brand' | 'muted'> = {
  reserved: 'brand',
  running: 'brand',
  settled: 'success',
  refunded: 'warn',
  uncertain: 'danger',
};

/**
 * 退款归类说明。
 *
 * `route_switch` 是唯一「钱没离开平台」的退款：线路切换时旧账单的预授权
 * 只是挪到新账单。用户既没拿回钱、平台也没多收，所以财务口径不把它算「已退」——
 * 页面必须能解释这一点，否则运营看到「退 9 分」会以为用户真拿走了 9 分。
 */
export const REFUND_REASON_LABELS: Record<string, string> = {
  route_switch: '线路切换（内部重预留，不计入已退）',
  failure: '任务失败',
  manual: '人工核对',
  proxy_timeout: '中转超时',
  auto_sweep: '预留超时自动退回',
};

export const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** 「待核对」是跨状态的队列口径（后端算），不是一个账单状态 */
export const REVIEW_OPTION = { value: 'review', label: '待核对（需人工处置）' };

export const BILLING_MODE_LABELS: Record<string, string> = {
  fixed_request: '按次',
  per_second: '按秒',
  token: '按 Token',
};

export const BILLING_MODE_OPTIONS = Object.entries(BILLING_MODE_LABELS).map(([value, label]) => ({
  value,
  label,
}));
