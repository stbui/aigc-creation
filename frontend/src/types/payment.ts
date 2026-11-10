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

import type { OrderStatus } from "./api";

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

/** C 端固定展示的两种支付方式，与真实渠道解耦。 */
export type VisiblePaymentMethod = "alipay" | "wechat";

/** 管理员为某个可见支付按钮选择的唯一来源。 */
export type PaymentSource = "unset" | "official" | "epay";

/**
 * 发起支付的结果（`POST /payments/:orderId/intent`）。
 *
 * `providerId` 是 C 端可见支付方式，不是真实渠道：易支付订单同样投影为
 * `alipay` / `wechat`，不得向前端暴露 `epay`。
 */
export interface PaymentIntent {
  orderId: string;
  orderNo: string;
  amountCents: number;
  currency: string;
  providerId: VisiblePaymentMethod | "free";
  configId: string | null;
  configVersion: number | null;
  mode:
    | "redirect"
    | "qrcode"
    | "qrcode-image"
    | "payment-element"
    | "sandbox"
    | "free";
  payUrl?: string;
  codeUrl?: string;
  /** Stripe Payment Element 初始化参数 */
  clientSecret?: string;
  publishableKey?: string;
  /** 支付宝移动端当面付 Scheme；桌面端与微信订单为空 */
  schemeUrl?: string;
  /** 渠道支付完成后回跳地址；旧后端可能不返回 */
  returnUrl?: string;
  checkoutValue: string | null;
  expiresAt: string;
  hint?: string | null;
  sandbox: boolean;
}

/** `GET /payments/settings` 的公开视图。 */
export interface PaymentSettingsView {
  enabled: boolean;
  defaultCurrency: string;
  providers: PaymentProviderInfo[];
  /** 充值页帮助图片地址；空串表示不展示 */
  helpImage: string;
  /** 充值页帮助文字；空串表示不展示 */
  helpText: string;
}

/** `GET /payments/providers` 的可用支付方式。 */
export interface PaymentProviderInfo {
  id: VisiblePaymentMethod;
  name: string;
  icon: VisiblePaymentMethod;
  checkoutMode:
    | "redirect"
    | "qrcode"
    | "qrcode-image"
    | "payment-element"
    | "sandbox";
  supportedCurrencies: string[];
  sandbox: false;
}

/** 支付状态轮询（`GET /payments/:orderId/status` / `POST /payments/:orderId/query`）。 */
export interface PaymentStatusResult {
  orderId: string;
  orderNo: string;
  status: OrderStatus;
  displayStatus: string;
  amountCents: number;
  currency: string;
  providerId: VisiblePaymentMethod | "free" | "unknown";
  checkoutMode: string | null;
  checkoutValue: string | null;
  expiresAt: string;
  providerPaidAt: string | null;
  creditedAt: string | null;
  closedAt: string | null;
  lastError: string | null;
  payments: Array<{
    id: string;
    status: string;
    providerId: VisiblePaymentMethod | "free" | "unknown";
    providerRef: string | null;
    providerTradeNo: string | null;
    amountCents: number;
    createdAt: string;
  }>;
}

/** 发票状态：待开具 | 已开具 | 已驳回 | 已冲红 */
export type InvoiceStatus = "pending" | "issued" | "rejected" | "red_flushed";

/** 发票（C 端） */
export interface Invoice {
  id: string;
  invoiceNo: string;
  orderId: string;
  orderNo: string | null;
  amountCents: number;
  kind: "personal" | "company";
  title: string;
  taxNo: string | null;
  email: string | null;
  content: string;
  status: InvoiceStatus;
  rejectReason: string | null;
  issuedAt: string | null;
  redFlushedAt: string | null;
  redFlushedBy: string | null;
  redFlushReason: string | null;
  createdAt: string;
  fileUrl: string | null;
  hasStoredFile: boolean;
}

export interface CreateInvoicePayload {
  orderId: string;
  kind: "personal" | "company";
  title: string;
  taxNo?: string;
  email?: string;
  content?: string;
}

/** 后台发票行（附带申请人信息） */
export interface AdminInvoice extends Invoice {
  userEmail: string | null;
  userName: string | null;
}

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
  type?: "text" | "password" | "textarea" | "number" | "url" | "select";
  required?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  /** 身份字段（如商户号）：已有订单绑定后不可改 */
  identity?: boolean;
  default?: string;
  /** 后端给的字段说明（如「ZPay 商户后台的商户 ID」） */
  description?: string;
  maxLength?: number;
}

/**
 * 渠道下的一个可独立启停、限额和轮询的服务商实例。
 *
 * `instanceId` 是稳定身份；后台改名不会影响历史订单、回调、查单与退款。
 * 金额单位均为分，`null` 表示不限。
 */
export interface AdminPaymentProviderInstanceView {
  instanceId: string;
  providerId: PaymentProviderId;
  /** 管理员自定义实例名；null 时界面按 instanceId 兜底展示 */
  name: string | null;
  sortOrder: number;
  enabled: boolean;
  configured: boolean;
  closeAfterMinutes: number;
  version: number | null;
  configId: string | null;
  /** 只含非密字段；密字段只回 `secretConfigured` */
  values: Record<string, string>;
  secretConfigured: Record<string, boolean>;
  minAmountCents: number | null;
  maxAmountCents: number | null;
  dailyLimitCents: number | null;
  refundEnabled: boolean;
  paymentMethods: VisiblePaymentMethod[];
  identityLockedFields: string[];
  hasOpenOrders: boolean;
  updatedAt: string | null;
  warnings: Array<{ level: "danger" | "warn"; message: string }>;
}

/**
 * 后台看到的支付渠道（只读视图）。
 *
 * 顶层字段保留为 `default`/首个实例的兼容投影。新界面必须读取
 * `instances[]`，不能仅凭顶层 `enabled/configured` 推断整个渠道状态。
 */
export interface AdminPaymentProviderView {
  id: PaymentProviderId;
  name: string;
  icon: string;
  /** sandbox=站内模拟 | redirect=网站跳转 | qrcode=扫码支付 | qrcode-image=二维码图片 */
  checkoutMode: string;
  /** 任一实例启用 */
  enabled: boolean;
  /** 任一实例配置完整 */
  configured: boolean;
  closeAfterMinutes: number;
  /** 首个实例的配置版本；null = 从未配置 */
  version: number | null;
  configId: string | null;
  configEnabled: boolean;
  values: Record<string, string>;
  secretConfigured: Record<string, boolean>;
  configFields: PaymentConfigField[];
  supportedCurrencies: PaymentCurrency[];
  supportsReconciliation: boolean;
  /** 首个实例缺失的必填项名 */
  missing: string[];
  /** 首个实例中已被订单绑定、不可修改的字段名 */
  identityLockedFields: string[];
  hasOpenOrders: boolean;
  updatedAt: string | null;
  warnings: Array<{ level: "danger" | "warn"; message: string }>;
  /** 渠道下全部实例，按 sortOrder 升序 */
  instances: AdminPaymentProviderInstanceView[];
}

/** 渠道实例配置保存入参 */
export interface PaymentProviderConfigUpdate {
  enabled: boolean;
  closeAfterMinutes: number;
  values: Record<string, string>;
  name?: string | null;
  minAmountCents?: number | null;
  maxAmountCents?: number | null;
  dailyLimitCents?: number | null;
  refundEnabled?: boolean;
  paymentMethods?: VisiblePaymentMethod[];
}

/** 新建实例入参；新实例默认停用，补齐配置后再启用。 */
export interface PaymentProviderInstanceCreate {
  name?: string | null;
  values?: Record<string, string>;
  closeAfterMinutes?: number;
  minAmountCents?: number | null;
  maxAmountCents?: number | null;
  dailyLimitCents?: number | null;
  refundEnabled?: boolean;
  paymentMethods?: VisiblePaymentMethod[];
}

/** 实例排序入参必须恰好包含当前渠道全部实例。 */
export interface PaymentProviderInstanceOrder {
  instanceIds: string[];
}

/** 站点支付设置 */
export interface AdminPaymentSettings {
  defaultCurrency: PaymentCurrency;
  alipaySource: PaymentSource;
  wechatSource: PaymentSource;
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
  providerInstanceId: string;
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
  /** 失败退款是渠道明确拒绝，还是结果未知；仅 failed 时有值 */
  refundFailureKind: 'definitive' | 'unknown' | null;
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
