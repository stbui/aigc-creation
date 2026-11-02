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

/** 分 → 元文本 */
export function yuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 元输入 → 分。非法返回 null, 不做静默兜底 */
export function yuanToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  return cents > 0 ? cents : null;
}
