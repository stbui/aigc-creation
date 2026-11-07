/**
 * 订单管理的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 */

export { cn } from '../../../admin-ui/lib/cn';
export {
  adminCreditHref,
  adminOrderDetailHref,
  adminTasksHref,
  adminUserDetailHref,
} from '../../../lib/admin-links';

/** 分 → 元文本（统一实现在 admin-ui/lib/format.ts） */
export { formatYuanPlain as yuan } from '../../../admin-ui/primitives';

/** 后台统一的时间展示；空值显示破折号，不用空白单元格 */
export { formatDateTimeLoose as fmtTime } from '../../../admin-ui/primitives';

/** 元输入 → 分。非法返回 null, 不做静默兜底 */
export function yuanToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  return cents > 0 ? cents : null;
}
