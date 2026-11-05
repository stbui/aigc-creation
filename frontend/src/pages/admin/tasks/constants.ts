/**
 * 任务监控的常量与选项表。
 *
 * 状态值必须与后端 DTO 白名单一致。
 */

/** 状态筛选的可选值。与后端 DTO 白名单一致 */
export const STATUS_OPTIONS = [
  { value: 'queued', label: '排队中' },
  { value: 'running', label: '执行中' },
  { value: 'succeeded', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已终止' },
];
