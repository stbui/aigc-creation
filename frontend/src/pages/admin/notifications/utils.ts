/**
 * 消息通知页的本地工具函数入口。
 */

/** 后台统一的时间展示；空值显示破折号 */
export { formatDateTime as fmtTime } from '~/admin-ui/radar';

/* 通道名与错误转写由 `src/lib/email-status.ts` 维护，与邮箱配置页共用一份口径 */
export { deliveryProviderLabel, emailErrorText } from '../../../lib/email-status';
