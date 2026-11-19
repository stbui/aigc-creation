import type { ModelCallFilterValues } from './types';

/**
 * 调用记录的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 */

export { formatDateTime, formatDuration } from '~/admin-ui/radar';

/**
 * 地址栏 → 筛选初值。
 *
 * 读取在 `useState` 初始化里同步完成（见 `useModelCallFilters`），避免先按空
 * 条件查一次再查第二次。这里只做字符串搬运，不做选项白名单校验：非法值后端
 * 会忽略，前端若静默改写用户分享出来的链接（下拉显示变了、地址栏没变），
 * 反而更难解释。
 */
export function readInitialFilters(
  searchParams: URLSearchParams,
): ModelCallFilterValues {
  return {
    status: searchParams.get('status') ?? undefined,
    requestKind: searchParams.get('requestKind') ?? undefined,
    source: searchParams.get('source') ?? undefined,
    operation: searchParams.get('operation') ?? undefined,
    billable: searchParams.get('billable') ?? undefined,
    model: searchParams.get('model') ?? '',
    channelId: searchParams.get('channelId') ?? '',
    taskId: searchParams.get('taskId') ?? '',
    userId: searchParams.get('userId') ?? '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
  };
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 已生效条件（`useAdminList` 的 `params`）→ 与草稿同形的展示值。
 *
 * chip 文案与空态判断都读这里，不直接读 `params`：`params` 里还混着
 * `page` / `pageSize`，逐字段取值容易漏掉一个条件却看不出来。
 */
export function readAppliedFilters(
  params: Record<string, unknown>,
): ModelCallFilterValues {
  return {
    status: optionalText(params.status),
    requestKind: optionalText(params.requestKind),
    source: optionalText(params.source),
    operation: optionalText(params.operation),
    billable: optionalText(params.billable),
    model: text(params.model),
    channelId: text(params.channelId),
    taskId: text(params.taskId),
    userId: text(params.userId),
    from: text(params.from),
    to: text(params.to),
  };
}

/**
 * 任一筛选生效：空态文案与「清除筛选」入口据此切换。
 *
 * 必须只认这 11 个条件，不能对 `params` 整体取真值 —— 分页数字恒为真，
 * 结果就是空列表也一直显示「没有符合条件的记录」。
 */
export function hasAnyFilter(values: ModelCallFilterValues): boolean {
  return [
    values.status,
    values.requestKind,
    values.source,
    values.operation,
    values.billable,
    values.model,
    values.channelId,
    values.taskId,
    values.userId,
    values.from,
    values.to,
  ].some(Boolean);
}

/**
 * 时间条件的 chip 文案。只填一头时给出「起 / 截至」，否则用户看不出这半截
 * 范围到底排除了哪一侧。
 */
export function dateChipLabel(from: string, to: string): string | null {
  if (from && to) return `时间：${from} ~ ${to}`;
  if (from) return `时间：${from} 起`;
  if (to) return `时间：截至 ${to}`;
  return null;
}
