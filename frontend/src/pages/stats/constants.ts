/**
 * 数据中心页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 状态文案与周几清单集中定义，页面、趋势图与最近作品列表共用同一套口径。
 */

/** 页面标题 / 描述：访客、加载、失败、空态四个分支复用同一份文案 */
export const STATS_PAGE_META = {
  title: '数据中心',
  description: '查看作品积累、创作趋势与常用能力。',
} as const;

export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 任务状态 → 文案与色调（仅用户侧语义，不含运营指标） */
export const TASK_STATUS: Record<string, { label: string; tone: string }> = {
  succeeded: { label: '已完成', tone: 'ok' },
  failed: { label: '未完成', tone: 'bad' },
  running: { label: '生成中', tone: 'run' },
  queued: { label: '排队中', tone: 'run' },
  pending: { label: '排队中', tone: 'run' },
  cancelled: { label: '已取消', tone: 'muted' },
};
