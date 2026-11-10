/**
 * 账户中心页面的纯函数 —— 目录内文件的唯一本页工具来源。
 *
 * 本页的外部依赖 (接口 / 组件 / hook) 分别走 `api.ts` / `components.ts` /
 * `hooks.ts`; 这里只放不依赖 React 的金额、日期与导出文件名换算。
 */

/**
 * 分 → 「¥39.00」。
 *
 * 金额一律由后端下发整数分，前端只做展示格式化 —— 不在这一层做任何汇率或折扣计算。
 */
export function fmtYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

/** 日期（不含时分） */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 日期 + 时分；消息列表用短格式 (省略年份) */
export function fmtDateTime(iso: string | null | undefined, short = false): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    ...(short ? {} : { year: 'numeric' }),
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 个人数据导出的文件名: 账号 + 导出日期 */
export function exportFilenameOf(profileId: string | undefined): string {
  return `huojue-account-${profileId ?? 'me'}-${new Date().toISOString().slice(0, 10)}.json`;
}

/** JSON 下载不是账户页专属能力，统一由 `lib/download.ts` 提供；此处保留出口，调用方路径不变。 */
export { downloadJson } from '../../lib/download';
