/**
 * 生成账单的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 金额只在微积分边界换算（`toCredits` / `toCreditsInput`），页面不重算
 * 任何计费口径。
 */

import { toCredits, toCreditsInput } from '../../../lib/microcredits';

export { toCredits, toCreditsInput };

/** 时间展示（统一实现在 admin-ui/lib/format.ts） */
/** 后台统一的时间展示；空值显示破折号 */
export { formatDateTime as fmtTime } from '~/admin-ui/radar';

/** 跨模块深链（用户 / 任务 / 渠道调用记录） */
export { adminModelCallsHref, adminTaskHref, adminUserDetailHref } from '../../../lib/admin-links';

/** 跨模块上下文链接（回跳带 context / done 标记） */
export { readAdminActionContext, readAdminDone, withAdminDone } from '../../../lib/admin-context-link';

export { formatDateTime } from '~/admin-ui/radar';
