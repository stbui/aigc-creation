/**
 * 素材库页面的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定: `library/` 下的文件不从 `src/lib/*` 直接取东西, 一律经由本文件 ——
 * 日期分组、能力名与下载扩展名集中可见, 换实现只改一处。
 * 目录内新增外部工具引用时在这里补一行 re-export。
 */

/** 上传前的图片格式校验, 与后端解码白名单同源 */
export { isSupportedImageFile } from '../../lib/constants';
/** 能力 id → 展示名 / 工具页路径 */
export { capabilityName, toolPath } from '../../lib/capabilities';

/** 日期分组：今天 / 昨天 / 近 7 天 / 更早。按本地时区切日，与作品页的日期筛选同口径 */
export function dateBucket(iso: string): { key: string; label: string; sort: number } {
  const ts = new Date(iso).getTime();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  if (ts >= today) return { key: 'today', label: '今天', sort: 0 };
  if (ts >= today - 86400000) return { key: 'yesterday', label: '昨天', sort: 1 };
  if (ts >= today - 6 * 86400000) return { key: 'week', label: '近 7 天', sort: 2 };
  return { key: 'earlier', label: '更早', sort: 3 };
}

/** 下载文件名扩展名；跟真实格式走，缺省 png */
export function assetExtension(format: string | null | undefined): string {
  return (format || 'png').toLowerCase().replace(/^\./, '') || 'png';
}
