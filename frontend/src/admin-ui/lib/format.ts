/**
 * 后台展示用的格式化函数。
 *
 * 全部是纯函数，不碰 React。放一处的理由：同一个日期在列表、抽屉、导出里
 * 出现三次，各页自己写 `toLocaleString('zh-CN')` 迟早出现两种写法。
 *
 * ## 为什么不用 `toLocaleString`
 *
 * `toLocaleString` 的输出跟两件环境因素绑定：
 *
 * 1. **浏览器时区**。运营在北京看到 `18:16`，出差到伦敦看到 `10:16`，与渠道
 *    账单差 8 小时；对账「完成时间」这类字段尤其致命。
 * 2. **分隔符**。`en` 系 locale 下是 `11/3/2026`，`zh-CN` 下是 `2026/11/3`
 *    —— 同一个字段在两张表里长得不像，扫读时得先做心理转换。
 *
 * 后台口径是北京时间，所以这里不依赖 `Intl` 的时区推导，直接对 UTC 时间戳
 * 加固定偏移。当前无夏令时，偏移可视为常量。
 */

/** 固定东八区偏移。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * ISO → 东八区的年/月/日/时/分/秒（已补零）。
 * 无法解析返回 `null`，由各格式化函数决定兜底文案。
 */
function shanghaiParts(iso: string): [string, string, string, string, string, string] | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return [
    String(shifted.getUTCFullYear()),
    pad(shifted.getUTCMonth() + 1),
    pad(shifted.getUTCDate()),
    pad(shifted.getUTCHours()),
    pad(shifted.getUTCMinutes()),
    pad(shifted.getUTCSeconds()),
  ];
}

/**
 * ISO 字符串 → `2026-11-03 10:20:25`（固定东八区）。
 *
 * 列表、抽屉、详情、导出**统一**用它。空值与无法解析一律 `—`：后台不该把
 * 原始脏值直接摆到运营面前（早期版本让无法解析的值原样返回，结果列表里
 * 混进过 `Invalid Date`）。
 *
 * 与后端 `formatShanghai` 同口径：三处看到的都是同一时刻。
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parts = shanghaiParts(iso);
  if (!parts) return '—';
  return `${parts[0]}-${parts[1]}-${parts[2]} ${parts[3]}:${parts[4]}:${parts[5]}`;
}

/** ISO 字符串 → `2026-11-03`（固定东八区）。有效期区间这类只到日的场景用它。 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parts = shanghaiParts(iso);
  if (!parts) return '—';
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

/** 只取时分秒 `10:20:25`（固定东八区），用于「最后一次成功」这类同日内比较。 */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parts = shanghaiParts(iso);
  if (!parts) return '—';
  return `${parts[3]}:${parts[4]}:${parts[5]}`;
}

/**
 * ISO 字符串 → `11-11 18:16`（固定东八区，月-日 时:分）。
 *
 * 紧凑档：单元格宽度紧、同屏要比较多个时刻，年份和秒都是噪声。
 * 队列、限时活动窗口用它；**不要**为了省宽度各页自己拼 —— 早先有三处
 * 各拼一次，分隔符在 `11/11` 和 `11-11` 之间来回。
 */
export function formatMonthDayTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parts = shanghaiParts(iso);
  if (!parts) return '—';
  return `${parts[1]}-${parts[2]} ${parts[3]}:${parts[4]}`;
}

/** 只取时分 `18:16`（固定东八区）。同日内的时间标签用它，跨天请用 {@link formatMonthDayTime}。 */
export function formatHm(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parts = shanghaiParts(iso);
  if (!parts) return '—';
  return `${parts[3]}:${parts[4]}`;
}

/**
 * 耗时。超过一分钟就折成「分 / 小时」——
 * 失败任务的耗时可能是几十分钟到几小时，只到「分」会把 46 小时写成 2779 分。
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) return `${minutes}分${seconds}秒`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}小时${rest}分` : `${hours}小时`;
}

/** 相对时间：`刚刚 / 3 分钟前 / 2 小时前 / 5 天前`。 */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return String(iso);
  const diff = Date.now() - time;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

/** 分 → `¥12.34`。金额一律以「分」为整数在前后端间传输。 */
export function formatYuan(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  return `¥${(cents / 100).toFixed(2)}`;
}

/**
 * 分 → 裸金额文本（不带货币符号），例如 `12.34`。
 *
 * 表格单元格、表单回填与「¥{yuan(...)}」拼接场景由调用方决定符号，
 * 后台多数列表页用的是这个口径，不要换成 `formatYuan`。
 */
export function formatYuanPlain(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 字节 → `1.2 MB`。 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${index === 0 ? value : value.toFixed(1)} ${units[index]}`;
}

/** 数字加千分位。统计卡与计数列统一用它，保证 `tabular-nums` 对齐后不跳宽。 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('zh-CN');
}

/**
 * 值班塔刻度高度：对数映射耗时到 8–24px。
 *
 * 线性映射会让 5 秒和 60 秒挤在同样高度；对数把短任务拉开，又不让一个
 * 超时任务把整排刻度压成一条线。
 */
export function tickHeight(durationMs: number, dense = false): number {
  const min = dense ? 4 : 8;
  const max = dense ? 14 : 24;
  const clamped = Math.min(Math.max(durationMs, 0), 60_000);
  const ratio = Math.log1p(clamped / 1000) / Math.log1p(60);
  return Math.round(min + (max - min) * ratio);
}
