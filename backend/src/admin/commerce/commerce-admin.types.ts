/** 商品写入字段。sku 只在创建时给 —— 改 sku 会让历史订单快照与商品对不上号 */
export interface ProductCreateInput {
  sku: string;
  name: string;
  description?: string;
  type?: string;
  priceCents: number;
  originalPriceCents?: number | null;
  credits: number;
  creditsValidDays?: number;
  grantType?: "immediate" | "manual";
  status?: "active" | "offline";
  sortOrder?: number;
  /** CNY | USD */
  currency?: string;
  /** unlimited | periodic | inventory | timed */
  saleStrategy?: string;
  periodDays?: number;
  periodPurchaseLimit?: number;
  stockTotal?: number;
  saleStartAt?: string | null;
  saleEndAt?: string | null;
}

export interface ProductUpdateInput {
  name?: string;
  description?: string;
  priceCents?: number;
  originalPriceCents?: number | null;
  credits?: number;
  creditsValidDays?: number;
  grantType?: "immediate" | "manual";
  status?: "active" | "offline";
  sortOrder?: number;
  currency?: string;
  saleStrategy?: string;
  periodDays?: number;
  periodPurchaseLimit?: number;
  stockTotal?: number;
  saleStartAt?: string | null;
  saleEndAt?: string | null;
}

export interface OrderListQuery {
  status?: string;
  orderNo?: string;
  email?: string;
  channel?: string;
  /**
   * 按商品筛选：只回买过这个 SKU 的订单。
   *
   * 走 `OrderItem.productId` 而不是 SKU 快照字符串 —— 快照里有 SKU 编码，
   * 但同一编码可能对应重建后的新商品；订单项指向的是下单时那件商品本身。
   */
  productId?: string;
  /**
   * 退款状态 (2026-10-29)。
   *
   * 退款状态挂在 `Refund` 而不是订单上：一笔订单可能多次部分退款，且渠道
   * 异步处理时订单仍是 `paid`。告警中心深链到 `?refundState=processing`
   * 时靠这个筛选把「钱已受理但未确认到账」的订单捞出来。
   */
  refundState?: string;
  /** ISO 日期或 yyyy-mm-dd; 含当天 */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export interface PaymentListQuery {
  status?: string;
  from?: string;
  to?: string;
  pageSize?: number;
}

export interface CreditLedgerQuery {
  type?: string;
  /** 业务类型（展示口径）。与 `type` 同时给出时取交集 */
  businessType?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export const ORDER_STATUSES = [
  "pending",
  "paid",
  "cancelled",
  "refunded",
  "partial_refunded",
] as const;

/** `Refund.status` 的合法取值, 与退款落库路径保持一致 */
export const REFUND_STATES = ["processing", "failed", "succeeded"] as const;

export const LEDGER_TYPES = [
  "purchase",
  "grant",
  "consume",
  "admin_adjust",
  "expire",
  "refund_reclaim",
  "reserve",
  "refund",
] as const;

export const PRODUCT_STATUSES = ["active", "offline"] as const;
export const PRODUCT_CURRENCIES = ["CNY", "USD"] as const;
export const SALE_STRATEGIES = ["unlimited", "periodic", "inventory", "timed"] as const;

/**
 * 新建商品的默认排序权重。
 *
 * 取 100 而不是 0: 排序值「小的靠前」, 新商品默认插到现有商品之后,
 * 而不是和排在最前的老商品挤在同一档里。若运营明确要置顶, 在表单里改小即可。
 */
export const PRODUCT_DEFAULT_SORT_ORDER = 100;

/** 导出上限: 再大就不该走同步 HTTP 了, 应改异步任务 + 落文件 */
export const EXPORT_LIMIT = 10_000;

/**
 * 积分导入行数上限。
 *
 * 与批量操作上限 (100) 刻意不同: 补发场景经常是几百人的活动名单,
 * 逐行人工勾选不现实; 但一次点错影响的人数更多, 所以不走分页而是一次跑完
 * 并逐行留结果, 500 行在单请求耗时与影响面之间取平衡。
 */
export const IMPORT_LIMIT = 500;

/** 导出用的中文状态标签。与前端 StatusTag 的文案保持一致 */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "待支付",
  paid: "已支付",
  cancelled: "已取消",
  refunded: "已退款",
  partial_refunded: "部分退款",
};
