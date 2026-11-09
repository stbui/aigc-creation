/**
 * 账单计费方式的展示文案（唯一事实源）。
 *
 * 「生成账单」「能力与模型」「渠道模型价格档」三处都要展示同一组 `billingMode`。
 * 此前各写一份且文案不同（`per_second` 一处「按秒」一处「按时长」，`token`
 * 一处「按 Token」一处「按用量」），同名枚举在几张表里读起来像几种计费方式。
 *
 * 统一用与后端枚举语义一致的中文：`fixed_request` 按次、`per_second` 按时长、
 * `token` 按用量。需要更精确的单位说明时由调用方补后缀（渠道价格档用
 * 「按时长（秒）」），不改这里的基准文案。
 */

export const BILLING_MODE_LABELS: Record<string, string> = {
  fixed_request: '按次',
  per_second: '按时长',
  token: '按用量',
};

/** 下拉选项：从文案表派生，避免选项与标签各维护一份。 */
export const BILLING_MODE_OPTIONS = Object.entries(BILLING_MODE_LABELS).map(
  ([value, label]) => ({ value, label }),
);
