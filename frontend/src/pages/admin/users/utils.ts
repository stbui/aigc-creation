/**
 * 用户管理的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 */

export { cn } from '~/admin-ui/lib/cn';
export { formatDateTime, formatYuan } from '../../../admin-ui/lib/format';
// 纯 URL 拼接工具（不发请求），与下方 admin*Href 同类；不放 api.ts。
export { assetThumbUrl } from '../../../lib/api';
export {
  adminAssetHref,
  adminCreditHref,
  adminOrderDetailHref,
  adminOrderHref,
  adminTaskHref,
  adminTasksHref,
} from '../../../lib/admin-links';
