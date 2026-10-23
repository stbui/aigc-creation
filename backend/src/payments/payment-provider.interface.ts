/**
 * 支付通道抽象 (B3)。
 *
 * 与模型通道同构的三层结构:
 *
 *   PaymentsService (业务编排)
 *     └─ PaymentProvider (通道协议: 沙箱 / 支付宝 / 微信)
 *          └─ node:crypto (签名 / 验签 / 解密, 零新增依赖)
 *
 * 只做三件事: 发起支付、验签解析回调、回给渠道确认响应。
 * **订单状态怎么改不在这里** —— 那是 PaymentsService 与 OrderService 的职责,
 * 通道层不知道也不该知道「paid 之后要发积分」。
 */

export type PaymentChannel = 'sandbox' | 'alipay' | 'wechat';

/** 支持的通道白名单, 用于 DTO 与路由参数校验 */
export const PAYMENT_CHANNELS: PaymentChannel[] = ['sandbox', 'alipay', 'wechat'];

export function isPaymentChannel(v: string): v is PaymentChannel {
  return (PAYMENT_CHANNELS as string[]).includes(v);
}

export interface PaymentIntentInput {
  orderId: string;
  orderNo: string;
  amountCents: number;
  /** 商品描述, 计入渠道侧账单标题 */
  subject: string;
  /** 支付完成后的回跳页 (前端地址) */
  returnUrl?: string;
  /** 渠道异步通知地址 (必须是渠道能访问到的公网地址) */
  notifyUrl: string;
}

export interface PaymentIntentResult {
  channel: PaymentChannel;
  /**
   * 前端怎么拉起支付:
   *   redirect 跳转渠道收银台 (支付宝网页支付)
   *   qrcode   展示二维码让用户扫码 (微信 Native)
   *   sandbox  走站内沙箱模拟页 (POST /orders/:id/pay)
   */
  mode: 'redirect' | 'qrcode' | 'sandbox';
  /** 跳转地址 */
  payUrl?: string;
  /** 二维码内容 (mode=qrcode) */
  codeUrl?: string;
  /** 渠道侧的预下单标识 (可选留痕) */
  providerRef?: string;
  /** 本单的支付截止时间 (与订单 expiresAt 保持一致) */
  expiresAt: string;
  /** 给人看的补充说明 (沙箱会用到) */
  hint?: string;
}

export interface PaymentCallbackInput {
  /** 渠道请求头 (微信验签要用) */
  headers: Record<string, string | string[] | undefined>;
  /** 原始报文字节。验签必须基于原始字节, 不能基于反序列化后的对象 */
  rawBody: string;
  /** 已解析的请求体 (支付宝表单 / 微信 JSON) */
  body: Record<string, unknown>;
}

export interface PaymentCallbackResult {
  ok: boolean;
  /** 验签失败 / 业务校验失败的原因 (会写进日志与响应, 不含敏感信息) */
  reason?: string;
  /** 商户订单号 */
  orderNo?: string;
  /** 渠道交易号 —— 幂等去重键 */
  tradeNo?: string;
  /** 渠道实收金额 (整数分) */
  amountCents?: number;
  paidAt?: Date;
  /** 原始报文 (落 Payment.rawPayload) */
  raw: string;
  /**
   * 回给渠道的确认是否算「已收到并处理」。
   *
   * 默认等于 ok, 但两者语义不同:
   *   · 交易状态非成功 (如用户关单) —— 我们确实处理完了, 应回成功让渠道停止重试;
   *   · 金额不符 / 订单不存在 —— 我们没处理成功, 必须回失败: 让渠道继续重试,
   *     同时差异已落对账表, 由人介入。回成功会让渠道彻底放弃, 钱就永远对不上了。
   */
  ackSuccess?: boolean;
}

export interface PaymentRefundInput {
  /** 商户订单号 (下单时用的那个) */
  orderNo: string;
  /**
   * 商户退款单号 —— **幂等键**。
   *
   * 由调用方生成并先落库 (Refund.id), 渠道侧重试同一退款单不会重复退钱。
   * 不允许在 provider 内部现生成: 那样一次「本地超时但渠道成功」的重试
   * 会变成第二笔退款。
   */
  outRefundNo: string;
  /** 本次退款金额 (整数分) */
  amountCents: number;
  /** 原订单实付金额 (整数分)。微信 v3 必填, 用于校验总额 */
  totalCents: number;
  reason?: string;
}

export interface PaymentRefundResult {
  /**
   * 渠道侧的退款结论:
   *   succeeded  钱已原路退回 (同步完成的通道)
   *   processing 渠道已受理但异步处理中 (微信可能返回 PROCESSING)
   *   failed     渠道明确拒绝 / 无法确认
   */
  state: 'succeeded' | 'processing' | 'failed';
  /** 渠道退款单号 (对账与申诉时的外部证据) */
  providerRefundId?: string;
  /** 失败原因 / 渠道返回说明 (不含凭据) */
  error?: string;
  /** 渠道原始响应片段 (落 Refund.detail, 便于事后核对) */
  raw?: string;
}

export interface PaymentAck {
  status: number;
  body: string;
  contentType: string;
}

export interface PaymentProvider {
  readonly channel: PaymentChannel;
  /**
   * 凭据是否齐全。
   *
   * ⚠ 缺凭据时**不得静默降级为沙箱**: 那会让「生产环境配置漏了」
   * 表现为「支付一直成功但一分钱没收到」。调用方据此返回 503。
   */
  isConfigured(): boolean;
  /** 缺哪些环境变量 (用于启动告警与 503 文案, 不返回凭据值) */
  missingConfig(): string[];
  createIntent(input: PaymentIntentInput): Promise<PaymentIntentResult>;
  /**
   * 原路退款。
   *
   * ⚠ **必须真的调渠道**, 不允许「只改本地库、假装退过钱」—— 那笔钱
   * 实际上还在商户账户里, 而订单状态已变成 refunded, 事后无从发现。
   * 凭据不全时由调用方 (PaymentProviderFactory.active/byChannel) 抛 503。
   *
   * 返回 `failed` 不代表没有副作用: 网络超时等情况下渠道可能已受理。
   * 因此 `outRefundNo` 必须由调用方先落库 —— 重试才是安全的。
   */
  refund(input: PaymentRefundInput): Promise<PaymentRefundResult>;
  /** 验签 + 解析。验签失败返回 ok:false, **不抛异常** */
  verifyCallback(input: PaymentCallbackInput): Promise<PaymentCallbackResult>;
  /** 回给渠道的确认响应 */
  ack(result: PaymentCallbackResult): PaymentAck;
}

/**
 * 把 PEM 里的字面 `\n` 还原成换行。
 *
 * .env 是单行格式, 多行私钥只能写成一行并用 `\n` 转义。粘贴时反向操作
 * (把真实换行贴进 .env) 会让后续几行变成独立的键值, 报错信息完全对不上号,
 * 故这里两种形态都接受。
 */
export function normalizePem(raw: string | undefined): string {
  if (!raw) return '';
  const v = raw.trim().replace(/\\n/g, '\n');
  if (v.includes('-----BEGIN')) return v;
  // 只给了裸 base64: 补成 PKCS#8 私钥 / SPKI 公钥
  return v;
}

/** 分 → 元, 保留两位小数 (支付宝金额字段用元) */
export function centsToYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 元 → 分。非法输入返回 NaN, 由调用方判定 */
export function yuanToCents(yuan: string | number): number {
  return Math.round(Number(yuan) * 100);
}
