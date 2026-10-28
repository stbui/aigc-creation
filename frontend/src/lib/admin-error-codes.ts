/**
 * 任务错误码 → 运营能看懂的中文说明。
 *
 * 后端只落 errorCode 字符串；运营看到 `42201` 无法判断该找谁。已知取值
 * 在这里统一翻译，未登记的原样显示 —— 隐藏未知码会让「没见过的故障」
 * 看起来像「没有问题」。任务监控与概览的失败原因榜共用这一份。
 */
export const TASK_ERROR_LABELS: Record<string, string> = {
  '42201': '生成过程异常',
  // 当时没有可用的模型通道（已自动退款）
  '42204': '无可用模型通道',
  cancelled_by_admin: '后台终止',
  unknown: '未记录错误码',
};

export function taskErrorLabel(code: string | null | undefined): string {
  if (!code) return '未记录错误码';
  return TASK_ERROR_LABELS[code] ?? code;
}
