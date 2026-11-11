/**
 * 工单处理的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 */

import type { TicketStatus } from '../../../types/api';

export { formatDateTime, formatYuanPlain } from '../../../admin-ui/lib/format';
export { cn } from '../../../admin-ui/lib/cn';
export {
  adminAssetHref,
  adminCreditHref,
  adminOrderDetailHref,
  adminOrderHref,
  adminUserDetailHref,
} from '../../../lib/admin-links';

/** 状态流转动作的界面文案（与目标状态一一对应） */
export function transitionLabel(to: TicketStatus): string {
  return to === 'processing'
    ? '受理'
    : to === 'resolved'
      ? '标记已解决'
      : to === 'closed'
        ? '关闭工单'
        : '重新打开';
}
