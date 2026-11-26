/**
 * 系统信息页的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 拆出这一层的原因：页面要展示的是「读数 + 它意味着什么」，不是原始字段。
 * 枚举取值换中文、负载写成可朗读的句子、状态分布按数量排序、阈值判定给
 * 文字结论，全部是纯函数，放在这里既能单测，也不会把页面编排撑长。
 *
 * 目录内文件不直接引 `src/lib/*` 或 `~/admin-ui/lib/*`，格式化一律经由本文件。
 */

import {
  formatBytes,
  formatDateTime,
  formatDecimal,
  formatDuration,
  formatMonthDayTime,
  formatNumber,
} from '~/admin-ui/radar';

/* 外部工具转出：格式化 */
export {
  formatBytes,
  formatDateTime,
  formatDecimal,
  formatDuration,
  formatMonthDayTime,
  formatNumber,
};

/**
 * 枚举值 → 中文；未登记的取值原样返回，空值显示「—」。
 *
 * 不隐藏未知值：后端新增状态时，页面出现一个陌生原值，比整行消失更容易
 * 被发现并补进映射表。
 */
export function labelOf(labels: Record<string, string>, value: string | null | undefined): string {
  if (!value) return '—';
  return labels[value] ?? value;
}

/** 比率 → `95.0%`；没有样本时显示「—」，不写成 0%。 */
export function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

/** 没有样本的耗时统一给「—」，与 0 ms 区分开。 */
export function durationOrDash(ms: number | null): string {
  return ms === null ? '—' : formatDuration(ms);
}

/** 负载均值：`0.12 / 0.34 / 0.56（1 / 5 / 15 分钟）`；平台不提供时说明原因。 */
export function loadavgText(loadavg: number[]): string {
  if (loadavg.length === 0) return '当前平台不提供';
  return `${loadavg.map((value) => formatDecimal(value, 2)).join(' / ')}（1 / 5 / 15 分钟）`;
}

/**
 * 状态 / 类型分布 → `已完成 95 · 失败 5`。
 *
 * 按数量降序，读的人先看到占比最大的那一项；键映射不上时保留原值，
 * 不在页面上静默吞掉一个非零计数。
 */
export function countSummary(
  counts: Record<string, number>,
  labels: Record<string, string>,
): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return '—';
  return entries
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => `${labels[key] ?? key} ${formatNumber(count)}`)
    .join(' · ');
}

/** 堆使用率（%）；堆总量为 0 时给 0，避免除零。 */
export function heapUsagePct(usedBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return Math.round((usedBytes / totalBytes) * 100);
}

/** 堆使用率的结论；判定与进度条同阈值，文字与颜色一起表达。 */
export function heapUsageHint(pct: number): { tone?: 'warn' | 'danger'; hint?: string } {
  if (pct >= 90) return { tone: 'danger', hint: '接近上限' };
  if (pct >= 75) return { tone: 'warn', hint: '偏高' };
  return {};
}

/**
 * 事件循环延迟的结论。
 *
 * 阈值来自排障经验：20 ms 以上开始影响接口响应，100 ms 以上说明有同步阻塞
 * 正在拖慢整个进程。结论同时用文字给出，不单靠颜色——色觉障碍用户也必须
 * 能看出「这个数有问题」。
 */
export function eventLoopHint(ms: number): { tone?: 'warn' | 'danger'; hint?: string } {
  if (ms > 100) return { tone: 'danger', hint: '阻塞明显' };
  if (ms > 20) return { tone: 'warn', hint: '偏高' };
  return {};
}

/** 任务成功率的结论；无终态样本时不判定。 */
export function successRateHint(rate: number | null): { tone?: 'warn' | 'danger'; hint?: string } {
  if (rate === null) return {};
  if (rate < 0.9) return { tone: 'danger', hint: '异常' };
  if (rate < 0.98) return { tone: 'warn', hint: '偏低' };
  return {};
}

/**
 * 冷却键 → 可读对象：`channel:abc` → `渠道（abc）`。
 *
 * 键本身是内部标识；值班时要认的是「哪条渠道 / 哪个模型被停用」，id 用于
 * 回后台定位，所以两段都保留，只补一个中文前缀并加括号区分。
 */
export function coolingKeyLabel(key: string): string {
  const separator = key.indexOf(':');
  const kind = separator === -1 ? key : key.slice(0, separator);
  const id = separator === -1 ? '' : key.slice(separator + 1);
  const labels: Record<string, string> = {
    channel: '渠道',
    'channel-model': '渠道模型',
    route: '线路',
  };
  const prefix = labels[kind] ?? kind;
  return id ? `${prefix}（${id}）` : prefix;
}

/**
 * 冷却列表 → `渠道（abc）至 11-26 18:30、渠道模型（def）至 11-26 18:35`。
 *
 * 解封时间是值班最关心的信息：知道「什么时候会自己恢复」才判断得出要不要
 * 现在去后台手动解除。时间走统一格式化，与列表页同一时区口径。
 */
export function coolingSummary(keys: Array<{ key: string; until: string }>): string {
  return keys.map(({ key, until }) => `${coolingKeyLabel(key)}${untilSuffix(until)}`).join('、');
}

/** 解封时间的衔接词：能解析就给具体时刻，解析不了就直接说时间未知。 */
function untilSuffix(until: string): string {
  const formatted = formatMonthDayTime(until);
  return formatted === '—' ? ' 解封时间未知' : `至 ${formatted}`;
}
