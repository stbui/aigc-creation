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

/**
 * 把导出数据落成 JSON 下载。
 *
 * 用一次性 object URL：点击后立即 revoke，避免长页面常驻时累积未释放的 blob。
 */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
