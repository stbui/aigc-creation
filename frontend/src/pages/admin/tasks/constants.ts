/**
 * 任务监控的常量与选项表。
 *
 * 状态值必须与后端 DTO 白名单一致；通道值来自任务快照（`gateway` / `pending`
 * / 历史 `local`），未登记的取值由界面原样显示。
 */

/** 通道 → 中文。未登记的原样显示, 便于发现未文档化的取值 */
export const PROVIDER_LABELS: Record<string, string> = {
  gateway: '真实模型',
  local: '历史本地结果',
  // 建任务时的初值; 跑完后会被 processTask 改写成实际通道
  pending: '待执行',
};

/** 状态筛选的可选值。与后端 DTO 白名单一致 */
export const STATUS_OPTIONS = [
  { value: 'queued', label: '排队中' },
  { value: 'running', label: '执行中' },
  { value: 'succeeded', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已终止' },
];

export const PROVIDER_OPTIONS = [
  { value: 'gateway', label: '真实模型' },
  { value: 'local', label: '历史本地结果' },
  // 「建了但没跑起来」的任务: 排障时按它筛，比逐条看状态快
  { value: 'pending', label: '待执行' },
];
