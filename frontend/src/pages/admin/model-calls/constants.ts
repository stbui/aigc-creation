/**
 * AdminModelCallsPage 的本地常量与类型。
 */

export const REQUEST_KIND_LABELS: Record<string, string> = {
  create: '创建',
  poll: '轮询',
  task: '连通性测试',
  proxy: '中转',
};

export const STATUS_LABELS: Record<string, string> = {
  success: '成功',
  failed: '失败',
  canceled: '已取消',
};

export const STATUS_TONES: Record<string, 'success' | 'danger' | 'warn' | 'brand' | 'muted'> = {
  success: 'success',
  failed: 'danger',
  canceled: 'muted',
};
