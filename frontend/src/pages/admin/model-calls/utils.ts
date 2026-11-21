import { formatBytes, formatDateTime, formatDuration, formatNumber } from '~/admin-ui/radar';
import type { ModelCallFilterValues } from './types';

/**
 * 调用记录的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 */

export { formatBytes, formatDateTime, formatDuration, formatNumber };

/** 回环地址：开发态与「同机反代」下最常见，直接标成「本机」比一串数字好读 */
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '0.0.0.0']);

/**
 * 调用记录的「来源 IP」展示值。
 *
 * 三种情况分开：
 *   · 空串 → 「未知」：历史数据没有这一列，脚本 / 定时任务也没有请求上下文。
 *     不能写「本机」，那会把「不知道」伪装成一个具体结论；
 *   · 回环 → 「本机 · 127.0.0.1」：明确是本机，同时保留原值供复制比对；
 *   · 其余 → 原样 IP。
 */
export function formatClientIp(ip: string): string {
  const value = String(ip ?? '').trim();
  if (value === '') return '未知';
  return LOOPBACK_IPS.has(value) ? `本机 · ${value}` : value;
}

/**
 * 报文体积展示。
 *
 * `0` 显示「—」而不是「0 B」：这列对历史数据是默认值 0，本身分不清「真的
 * 没发任何字节（如 GET 轮询）」与「这条记录没测过」。写成「0 B」会让人以为
 * 测量过且为零，反而误导；「—」表示「没有可用的测量值」，两种情况都成立。
 */
export function formatPayloadBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  // `formatBytes` 对 KB 及以上固定保留一位小数（如 `278.0 KB`）。整数字节量
  // 尾部这个 `.0` 没有信息量，去掉后读起来更接近样本里的 `278 KB`。
  return formatBytes(bytes).replace(/\.0 (B|KB|MB|GB|TB)$/, ' $1');
}

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
