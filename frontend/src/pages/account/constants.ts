import type { OrderStatus } from '../../types/api';

/**
 * 账户中心页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 状态文案、密码下限与确认词这些「改一处就得全改」的值集中在这里:
 * 修改密码弹窗与提交逻辑、注销弹窗与提交逻辑必须用同一个字面值，
 * 否则会出现「按钮要求 A、提交校验 B」的死角。
 *
 * 约定: `account/` 下的文件不从 `src/lib/constants` 直接取东西,
 * 一律经由本文件或 `./components` —— 目录内新增共享常量时在这里补一行。
 */

/** 订单状态 → 中文标签 */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: '待支付',
  paid: '已支付',
  cancelled: '已取消',
  refunded: '已退款',
  partial_refunded: '部分退款',
};

/** 新密码最少位数 (前端先拦一道, 后端仍会校验) */
export const MIN_PASSWORD_LENGTH = 6;

/** 账户卡片容器（白底 + 描边 + 面板圆角）。各卡共用一份，改一处全页一致。 */
export const ACCOUNT_CARD = 'min-w-0 rounded-xl border border-border bg-card px-5 py-[18px] max-[640px]:p-4';

/** 账户卡片标题行（图标 + 标题，可选右侧动作）。 */
export const ACCOUNT_CARD_HEAD = 'mb-3.5 flex items-center gap-2 text-foreground';

/** 订单状态 → 中文标签 */
export const ORDER_STATUS_TONE: Record<OrderStatus, string> = {
  pending: 'bg-warn-soft text-warn-text',
  paid: 'bg-success-soft text-success-text',
  cancelled: 'bg-danger-soft text-[color:var(--danger-soft-text)]',
  refunded: 'bg-danger-soft text-[color:var(--danger-soft-text)]',
  partial_refunded: 'bg-danger-soft text-[color:var(--danger-soft-text)]',
};

/** 注销账号需要用户逐字输入的确认词 */
export const DELETE_CONFIRM_WORD = '注销';

/** 最近消息取几条 */
export const RECENT_MESSAGES_LIMIT = 5;

/** 最近订单展示几笔 (后端已倒序) */
export const RECENT_ORDER_LIMIT = 3;
