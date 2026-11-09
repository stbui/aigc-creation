/**
 * 支付域的前端类型（`/admin/payments` 三个标签页：渠道 / 对账 / 异常）。
 *
 * 与 `types/api.d.ts` 分开放：那一份是旧接口的存量集合，本文件承载
 * `src/payments/**` 新后端的契约（渠道配置版本化、T+1 对账、异常单）。
 * 支付订单本身与商品订单是同一张 `Order` 表，列表类型在 `types/api.d.ts`，
 * 本文件不再重复定义一份投影。
 * 字段名与后端投影逐字一致 —— 两边改名不同步是这类后台最难查的错。
 *
 * 金额一律整数分；`secret` 字段后端只回「是否已配置」，绝不回明文。
 */

/* ────────────────────────── 分页信封 ────────────────────────── */

/** 后台列表统一分页信封 */
export interface AdminPageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/* ────────────────────────── 支付渠道 ────────────────────────── */

/** 支付通道标识，与后端 `PAYMENT_PROVIDER_IDS` 一致 */
export type PaymentProviderId =
  "sandbox" | "alipay" | "wechat" | "paypal" | "stripe" | "epay" | "zpay";

/** 支持的结算币种 */
export type PaymentCurrency = "CNY" | "USD";

/**
 * 渠道配置字段元数据。
 *
 * 后端按渠道声明该渠道需要哪些配置项，前端**按这份声明渲染表单** ——
 * 支付宝要 appId / 私钥，微信要商户号 / 证书，字段集由适配器给出，
 * 加一家渠道不必改前端。
 */
export interface PaymentConfigField {
  name: string;
  label: string;
  /** 密钥类字段：后端只回 `secretConfigured[name]`，不回明文 */
  secret?: boolean;
  type?: "text" | "password" | "textarea" | "number" | "select";
  required?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  /** 身份字段（如商户号）：已有订单绑定后不可改 */
  identity?: boolean;
  default?: string;
  /** 后端给的字段说明（如「ZPay 商户后台的商户 ID」） */
  description?: string;
}

/**
 * 后台看到的支付渠道（只读视图）。
 *
 * `values` 只含非密字段；`secretConfigured` 只含「是否已配置」布尔。
 */
export interface AdminPaymentProviderView {
  id: PaymentProviderId;
  name: string;
  icon: string;
  /** sandbox=站内模拟 | redirect=网站跳转 | qrcode=扫码支付 | qrcode-image=二维码图片 */
  checkoutMode: string;
  enabled: boolean;
  /** 必填项齐全 = 凭据够用 */
  configured: boolean;
  closeAfterMinutes: number;
  /** 配置版本号；null = 从未配置 */
  version: number | null;
  configId: string | null;
  configEnabled: boolean;
  values: Record<string, string>;
  secretConfigured: Record<string, boolean>;
  configFields: PaymentConfigField[];
  supportedCurrencies: PaymentCurrency[];
  supportsReconciliation: boolean;
  /** 缺失的必填项名 */
  missing: string[];
  /** 已被订单绑定、不可修改的字段名 */
  identityLockedFields: string[];
  hasOpenOrders: boolean;
  updatedAt: string | null;
  warnings: Array<{ level: "danger" | "warn"; message: string }>;
}

/** 渠道配置保存入参 */
export interface PaymentProviderConfigUpdate {
  enabled: boolean;
  closeAfterMinutes: number;
  values: Record<string, string>;
}

/** 站点支付设置 */
export interface AdminPaymentSettings {
  defaultCurrency: PaymentCurrency;
}

/* ────────────────────────── 对账 ────────────────────────── */

/**
 * 对账运行。
 *
 * 与旧的「人工导入批次」不是一回事：渠道账单由 worker 每日 10:15 自动下载，
 * 失败可手工重跑；系统比对后自动补发积分，页面只展示结果，不提供「改钱」入口。
 */
export interface AdminReconciliationRun {
  id: string;
  providerId: string;
  configId: string | null;
  billDate: string;
  /** 第几次执行（同一账单日重跑会递增） */
  attempt: number;
  /** provider=渠道下载 | csv=CSV 兜底导入 */
  source: string;
  fileName: string | null;
  status: string;
  totalItems: number;
  matchItems: number;
  recoveredItems: number;
  errorItems: number;
  error: string | null;
  startedBy: string | null;
  startedAt: string;
  completedAt: string | null;
}

/** 对账差异明细行 */
export interface AdminReconciliationItem {
  id: string;
  orderId: string | null;
  merchantOrderNo: string;
  providerTradeNo: string | null;
  amountCents: number;
  currency: string;
  /** matched / recovered / amount_mismatch / duplicate_charge 等 */
  result: string;
  resolved: boolean;
  detail: string | null;
  createdAt: string;
}

/** 支付异常补偿单。真实资金差异必须在这里闭环，而不是只留在对账批次明细。 */
export interface AdminPaymentException {
  id: string;
  providerId: string;
  orderId: string | null;
  merchantOrderNo: string;
  providerTradeNo: string | null;
  amountCents: number;
  currency: string;
  kind: string;
  status: string;
  priority: string;
  ownerId: string | null;
  slaDueAt: string;
  overdue: boolean;
  refundId: string | null;
  refundStatus: string | null;
  providerRefundId: string | null;
  resolution: string | null;
  lastError: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PaymentExceptionStatus =
  | "open"
  | "auto_refund_pending"
  | "refunded"
  | "manual_review"
  | "closed";

/** 对账差异类型 → 文案与色调的唯一映射 */
export const RECONCILIATION_RESULT_LABELS: Record<
  string,
  { label: string; tone: "success" | "danger" | "warn" }
> = {
  matched: { label: "一致", tone: "success" },
  recovered: { label: "已补发", tone: "success" },
  auto_refunded: { label: "已自动退款", tone: "success" },
  refund_processing: { label: "退款处理中", tone: "warn" },
  refund_failed: { label: "退款失败", tone: "danger" },
  amount_mismatch: { label: "金额不符", tone: "danger" },
  trade_no_mismatch: { label: "交易号不符", tone: "danger" },
  duplicate_charge: { label: "疑似重复扣款", tone: "danger" },
  local_order_not_found: { label: "本地缺单", tone: "danger" },
  provider_record_missing: { label: "渠道缺单", tone: "danger" },
  credit_failed: { label: "补发失败", tone: "danger" },
  missing_local: { label: "本地缺单", tone: "danger" },
  missing_channel: { label: "渠道缺单", tone: "danger" },
  duplicate: { label: "重复交易", tone: "warn" },
  provider_error: { label: "渠道异常", tone: "danger" },
};
