/* ────────────────────────────────────────────────────────────────
   积分账本（C 端 `/credits` 流水展示口径）

   自 `admin-console.ts` 拆出：该文件已 653 行、触及体积棘轮上限，
   而积分账本与后台账号 / 设置 / 商品订单互不依赖，是天然的切面。
   `admin-console.ts` 保留同名出口，调用方路径不变。
   ──────────────────────────────────────────────────────────────── */

/**
 * 积分业务类型（展示口径）。
 *
 * 与 `CreditLedgerEntry.type` 分层: `type` 是账本动作, 本类型是触发场景。
 * 扣费类只有一个 `creative_image` —— 电商生图 / AI修图 / AI视频三组能力
 * 在积分口径上统一叫「创意生图扣费」。
 */
export type CreditBusinessType =
  | "checkin_streak"
  | "new_user_gift"
  | "purchase"
  | "membership_grant"
  | "invite_reward"
  | "creative_image"
  | "credit_expire"
  | "admin_adjust"
  | "refund"
  | "other";

export interface CreditLedgerEntry {
  id: string;
  type: string;
  /** 业务类型: 后端恒有值（历史行按 type 兜底推导） */
  businessType: CreditBusinessType;
  /** 有符号: 正为获得, 负为消耗 */
  amount: number;
  balanceAfter: number;
  lotId: string | null;
  /** 支付订单 id（充值 / 购买积分包），与生成账单不是同一张表 */
  paymentOrderId: string | null;
  /** 生成账单 id（任务扣费 / 退款） */
  billingOrderId: string | null;
  taskId: string | null;
  reason: string | null;
  createdAt: string;
}

/** GET /credits/ledger?limit=&offset=&type=&direction=income|expense */
export interface CreditLedgerPage {
  items: CreditLedgerEntry[];
  total: number;
  limit: number;
  offset: number;
}
