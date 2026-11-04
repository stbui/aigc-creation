/**
 * 积分账本的常量、选项表与结构类型。
 *
 * 只放静态数据与类型，不放函数与请求 —— 流水类型的中文映射是**展示口径**，
 * 后端 `CreditLedger.type` 才是事实源；遇到未登记的取值由界面原样显示。
 */

/** 流水类型 → 中文。未知类型原样显示, 便于发现未登记的取值 */
export const LEDGER_LABELS: Record<string, string> = {
  purchase: '购买获得',
  grant: '发放',
  consume: '生成消耗',
  admin_adjust: '人工调整',
  expire: '到期回收',
  refund_reclaim: '退款扣回',
  reserve: '预授权冻结',
  refund: '预授权退回',
};

/** 批次来源 → 中文 */
export const SOURCE_LABELS: Record<string, string> = {
  purchase: '购买',
  grant: '发放',
  admin_adjust: '人工',
  refund_reclaim: '退款扣回',
};

export const LEDGER_OPTIONS = Object.entries(LEDGER_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** CSV 导入结果每页行数。结果是一次性返回的, 分页只在客户端做。 */
export const IMPORT_PAGE_SIZE = 10;

/** 批量调整的一行输入 */
export interface BatchAdjustItem {
  userId: string;
  delta: number;
  reason?: string;
}

/** 批量调整的单行结果 */
export interface BatchAdjustRow {
  userId: string;
  success: boolean;
  balance?: number;
  message?: string;
  /** 命中幂等键：这一行是重试提交，本次没有真正发放 */
  idempotentHit?: boolean;
}

/** 批量调整接口返回 */
export interface BatchAdjustResult {
  total: number;
  succeeded: number;
  failed: number;
  idempotentHits: number;
  results: BatchAdjustRow[];
}
