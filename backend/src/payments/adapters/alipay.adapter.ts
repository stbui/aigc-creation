import { Logger } from '@nestjs/common';
import { createHash, createSign, createVerify } from 'node:crypto';
import {
  BillRecord,
  CloseOrderInput,
  CreateOrderInput,
  NotificationInput,
  NotificationResult,
  PaymentAck,
  PaymentAdapter,
  PaymentAdapterDescriptor,
  PaymentCheckout,
  PaymentContext,
  ProviderPaymentResult,
  QueryOrderInput,
  RefundInput,
  RefundResult,
  centsToYuan,
  normalizePem,
  yuanToCents,
} from './types';
import { parseCsv } from '../../common/csv';

/**
 * 支付宝（电脑网站支付）适配器 —— RSA2 签名，零新增依赖。
 *
 * 关键细节（每条都对应过真实故障）：
 *   · 签名串**不 URL 编码**，只去空值 + 去 sign/sign_type + 字典序 + `k=v&` 拼接；
 *   · 回调验签用**支付宝公钥**，不是应用公钥 —— 填反时表现为「回调一律失败」；
 *   · 时间戳按 +08:00 生成，服务器时区不是东八区时用本地时间会被判非法；
 *   · 金额单位是元且两位小数，本地一律整数分，只在边界转换。
 */
export class AlipayAdapter implements PaymentAdapter {
  private readonly logger = new Logger(AlipayAdapter.name);

  readonly descriptor: PaymentAdapterDescriptor = {
    id: 'alipay',
    name: '支付宝',
    icon: 'alipay',
    checkoutMode: 'redirect',
    supportedCurrencies: ['CNY'],
    supportsReconciliation: true,
    configFields: [
      { name: 'appId', label: 'App ID', type: 'text', required: true, identity: true, maxLength: 64 },
      { name: 'sellerId', label: 'Seller ID（可选）', type: 'text', required: false, identity: true, maxLength: 64 },
      {
        name: 'merchantPrivateKey',
        label: '应用私钥（PEM）',
        type: 'textarea',
        required: true,
        secret: true,
        description: 'PKCS#8 格式，-----BEGIN PRIVATE KEY-----',
      },
      {
        name: 'alipayPublicKey',
        label: '支付宝公钥（PEM）',
        type: 'textarea',
        required: true,
        secret: true,
        description: '用于验签回调与网关响应，不是应用公钥',
      },
      {
        name: 'gateway',
        label: '网关地址',
        type: 'url',
        required: false,
        default: 'https://openapi.alipay.com/gateway.do',
        description: '只允许官方生产 / 沙箱域名',
      },
    ],
  };

  validateConfig(values: Record<string, string>): string[] {
    const missing: string[] = [];
    if (!values.appId?.trim()) missing.push('appId');
    if (!values.merchantPrivateKey?.trim()) missing.push('merchantPrivateKey');
    if (!values.alipayPublicKey?.trim()) missing.push('alipayPublicKey');
    const gateway = values.gateway?.trim();
    if (gateway && !isAllowedGateway(gateway)) missing.push('gateway');
    return missing;
  }

  async createOrder(input: CreateOrderInput): Promise<PaymentCheckout> {
    const v = input.config.values;
    const params: Record<string, string> = {
      app_id: v.appId,
      method: 'alipay.trade.page.pay',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: shanghaiTimestamp(),
      version: '1.0',
      notify_url: input.notifyUrl,
      return_url: input.returnUrl,
      biz_content: JSON.stringify({
        out_trade_no: input.orderNo,
        total_amount: centsToYuan(input.amountCents),
        subject: input.subject.slice(0, 256),
        timeout_express: minutesToExpress(input.expiresAt),
      }),
    };
    params.sign = signWithPrivateKey(buildSignContent(params), normalizePem(v.merchantPrivateKey));

    const query = Object.entries(params)
      .map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`)
      .join('&');
    const gateway = v.gateway?.trim() || 'https://openapi.alipay.com/gateway.do';

    return {
      mode: 'redirect',
      payUrl: `${gateway}?${query}`,
      providerRef: input.orderNo,
      expiresAt: input.expiresAt,
    };
  }

  async queryOrder(input: QueryOrderInput): Promise<ProviderPaymentResult> {
    const result = await this.callGateway(input.config, 'alipay.trade.query', {
      out_trade_no: input.orderNo,
    });
    if (!result.ok) {
      if (result.code === 'ACQ.TRADE_NOT_EXIST') {
        return { state: 'not_found', orderNo: input.orderNo, providerStatus: result.code, rawPayload: result.raw };
      }
      return {
        state: 'failed',
        orderNo: input.orderNo,
        error: result.message,
        providerStatus: result.code,
        rawPayload: result.raw,
      };
    }
    return mapTradeStatus(input.orderNo, result.node, result.raw);
  }

  async closeOrder(input: CloseOrderInput): Promise<ProviderPaymentResult> {
    const result = await this.callGateway(input.config, 'alipay.trade.close', {
      out_trade_no: input.orderNo,
    });
    if (!result.ok) {
      if (result.code === 'ACQ.TRADE_NOT_EXIST') {
        return { state: 'not_found', orderNo: input.orderNo, providerStatus: result.code, rawPayload: result.raw };
      }
      return {
        state: 'failed',
        orderNo: input.orderNo,
        error: result.message,
        providerStatus: result.code,
        rawPayload: result.raw,
      };
    }
    return {
      state: 'closed',
      orderNo: input.orderNo,
      providerStatus: 'TRADE_CLOSED',
      rawPayload: result.raw,
    };
  }

  async verifyNotification(input: NotificationInput): Promise<NotificationResult> {
    const raw = input.rawBody.toString('utf8');
    const params = toStringRecord(input.body);
    const sign = params.sign ?? '';
    if (!sign) return { ok: false, ackSuccess: false, reason: '缺少 sign', rawPayload: raw };
    if (params.sign_type && params.sign_type !== 'RSA2') {
      return { ok: false, ackSuccess: false, reason: `不支持的 sign_type: ${params.sign_type}`, rawPayload: raw };
    }

    const content = buildSignContent(params, ['sign', 'sign_type']);
    if (!verifyWithPublicKey(content, sign, normalizePem(input.config.values.alipayPublicKey))) {
      return { ok: false, ackSuccess: false, reason: '回调验签失败', rawPayload: raw };
    }
    if (params.app_id && params.app_id !== input.config.values.appId) {
      return { ok: false, ackSuccess: false, reason: 'app_id 不匹配', rawPayload: raw };
    }

    const tradeStatus = params.trade_status ?? '';
    const tradeNo = params.trade_no ?? '';
    const orderNo = params.out_trade_no ?? '';
    const amountCents = yuanToCents(params.total_amount ?? '0');
    const eventId = tradeNo || `alipay:${hashOf(raw)}`;

    if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
      if (!orderNo || !tradeNo || !Number.isFinite(amountCents)) {
        return { ok: false, ackSuccess: false, reason: '回调字段不完整', rawPayload: raw };
      }
      return {
        ok: true,
        eventId,
        merchantOrderNo: orderNo,
        providerTradeNo: tradeNo,
        amountCents,
        currency: 'CNY',
        state: 'paid',
        paidAt: params.gmt_payment ? new Date(params.gmt_payment.replace(' ', 'T') + '+08:00') : new Date(),
        providerStatus: tradeStatus,
        ackSuccess: true,
        rawPayload: raw,
      };
    }

    if (tradeStatus === 'TRADE_CLOSED') {
      return {
        ok: true,
        eventId,
        merchantOrderNo: orderNo,
        providerTradeNo: tradeNo || orderNo,
        amountCents: Number.isFinite(amountCents) ? amountCents : 0,
        currency: 'CNY',
        state: 'closed',
        providerStatus: tradeStatus,
        // 已确认非成功：回 success 让支付宝停止重试，本地不置 paid
        ackSuccess: true,
        reason: '交易已关闭',
        rawPayload: raw,
      };
    }

    return {
      ok: false,
      ackSuccess: false,
      reason: `交易状态非成功: ${tradeStatus || 'unknown'}`,
      rawPayload: raw,
    };
  }

  ack(result: NotificationResult): PaymentAck {
    const accepted = result.ok ? result.ackSuccess : false;
    return {
      status: 200,
      body: accepted ? 'success' : 'failure',
      contentType: 'text/plain; charset=utf-8',
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const result = await this.callGateway(input.config, 'alipay.trade.refund', {
      out_trade_no: input.orderNo,
      refund_amount: centsToYuan(input.amountCents),
      out_request_no: input.outRefundNo,
      ...(input.reason ? { refund_reason: input.reason.slice(0, 256) } : {}),
    });
    if (!result.ok) return { state: 'failed', error: result.message, raw: result.raw };
    const refundFee = String(result.node.refund_fee ?? '');
    return {
      state: 'succeeded',
      providerRefundId: refundFee ? `ALI-${input.outRefundNo}` : undefined,
      raw: result.raw,
    };
  }

  /**
   * 下载对账单（`alipay.data.dataservice.bill.downloadurl.query`）。
   *
   * 支付宝返回的是**临时下载链接**，账单本身是 CSV（或 ZIP 打包）。这里只取
   * CSV 形式：`bill_type=trade`。任何一步失败都抛错，由对账服务把 run 置 failed，
   * 绝不返回空数组伪装「当天没有交易」。
   */
  async downloadTradeBill(config: PaymentContext, billDate: string): Promise<BillRecord[]> {
    const result = await this.callGateway(config, 'alipay.data.dataservice.bill.downloadurl.query', {
      bill_type: 'trade',
      bill_date: billDate,
    });
    if (!result.ok) throw new Error(`支付宝账单下载失败: ${result.message}`);
    const url = String(result.node.bill_download_url ?? '');
    if (!url) throw new Error('支付宝账单下载失败: 未返回下载地址');

    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`支付宝账单下载失败: HTTP ${res.status}`);
    const text = await res.text();
    return parseAlipayBillCsv(text);
  }

  /** 统一网关调用：签名 → POST → 验签 → 取业务节点 */
  private async callGateway(
    config: PaymentContext,
    method: string,
    biz: Record<string, unknown>,
  ): Promise<{ ok: boolean; code: string; message: string; node: Record<string, unknown>; raw: string }> {
    const v = config.values;
    const params: Record<string, string> = {
      app_id: v.appId,
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: shanghaiTimestamp(),
      version: '1.0',
      biz_content: JSON.stringify(biz),
    };
    params.sign = signWithPrivateKey(buildSignContent(params), normalizePem(v.merchantPrivateKey));
    const gateway = v.gateway?.trim() || 'https://openapi.alipay.com/gateway.do';

    const res = await fetch(gateway, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, code: `HTTP_${res.status}`, message: `网关 HTTP ${res.status}`, node: {}, raw };
    }

    const nodeKey = `${method.replace(/\./g, '_')}_response`;
    let node: Record<string, unknown> = {};
    try {
      node = (JSON.parse(raw) as Record<string, Record<string, unknown>>)[nodeKey] ?? {};
    } catch {
      return { ok: false, code: 'BAD_JSON', message: '网关响应不是合法 JSON', node: {}, raw };
    }

    // 响应验签：不验就信任 code=10000，中间人可把「失败」改成「成功」
    const signed = extractSignedNode(raw, nodeKey);
    const sign = (JSON.parse(raw) as { sign?: string }).sign;
    if (signed && sign) {
      const ok = verifyWithPublicKey(signed, sign, normalizePem(v.alipayPublicKey));
      if (!ok) {
        return { ok: false, code: 'BAD_SIGN', message: '网关响应验签失败', node: {}, raw };
      }
    } else if (method !== 'alipay.data.dataservice.bill.downloadurl.query') {
      this.logger.warn(`支付宝网关响应缺少签名: ${method}`);
    }

    const code = String(node.code ?? '');
    const subCode = String(node.sub_code ?? '');
    const ok = code === '10000';
    return {
      ok,
      code: subCode || code,
      message: String(node.sub_msg ?? node.msg ?? '未知错误'),
      node,
      raw,
    };
  }
}

function mapTradeStatus(
  orderNo: string,
  node: Record<string, unknown>,
  raw: string,
): ProviderPaymentResult {
  const tradeStatus = String(node.trade_status ?? '');
  const tradeNo = String(node.trade_no ?? '');
  const amountCents = yuanToCents(String(node.total_amount ?? '0'));
  const base = {
    orderNo,
    tradeNo: tradeNo || undefined,
    amountCents: Number.isFinite(amountCents) ? amountCents : undefined,
    currency: 'CNY' as const,
    providerStatus: tradeStatus,
    rawPayload: raw,
  };
  if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
    return {
      ...base,
      state: 'paid',
      paidAt: node.gmt_payment ? new Date(String(node.gmt_payment).replace(' ', 'T') + '+08:00') : new Date(),
    };
  }
  if (tradeStatus === 'TRADE_CLOSED') return { ...base, state: 'closed' };
  if (tradeStatus === 'WAIT_BUYER_PAY') return { ...base, state: 'pending' };
  return { ...base, state: 'failed', error: `未知交易状态: ${tradeStatus || 'empty'}` };
}

function parseAlipayBillCsv(text: string): BillRecord[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => header.findIndex((h) => h.includes(name));
  const iOrderNo = col('商户订单号');
  const iTradeNo = col('支付宝交易号');
  const iAmount = col('订单金额');
  const iPaidAt = col('完成时间');
  const iStatus = col('交易状态');
  if (iOrderNo < 0 || iTradeNo < 0 || iAmount < 0) {
    throw new Error('支付宝账单表头无法识别');
  }
  const out: BillRecord[] = [];
  for (const row of rows.slice(1)) {
    const status = iStatus >= 0 ? (row[iStatus] ?? '').trim() : '交易成功';
    if (status && !status.includes('成功')) continue;
    const merchantOrderNo = (row[iOrderNo] ?? '').trim();
    const providerTradeNo = (row[iTradeNo] ?? '').trim();
    const amountCents = yuanToCents(row[iAmount] ?? '0');
    if (!merchantOrderNo || !providerTradeNo || !Number.isFinite(amountCents)) continue;
    const paidRaw = iPaidAt >= 0 ? (row[iPaidAt] ?? '').trim() : '';
    out.push({
      merchantOrderNo,
      providerTradeNo,
      amountCents,
      currency: 'CNY',
      paidAt: paidRaw ? new Date(paidRaw.replace(' ', 'T') + '+08:00') : new Date(),
      providerStatus: status || 'TRADE_SUCCESS',
    });
  }
  return out;
}

function isAllowedGateway(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return (
      u.hostname === 'openapi.alipay.com' ||
      u.hostname === 'openapi-sandbox.dl.alipaydev.com' ||
      (process.env.NODE_ENV !== 'production' && u.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

function minutesToExpress(expiresAt: Date): string {
  const minutes = Math.max(1, Math.min(1440, Math.round((expiresAt.getTime() - Date.now()) / 60000)));
  return `${minutes}m`;
}

function hashOf(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function buildSignContent(params: Record<string, string>, exclude: string[] = ['sign', 'sign_type']): string {
  return Object.keys(params)
    .filter((k) => !exclude.includes(k))
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

export function extractSignedNode(raw: string, nodeKey: string): string | null {
  const keyToken = `"${nodeKey}"`;
  const keyIdx = raw.indexOf(keyToken);
  if (keyIdx < 0) return null;
  const colonIdx = raw.indexOf(':', keyIdx + keyToken.length);
  if (colonIdx < 0) return null;
  const signIdx = raw.lastIndexOf(',"sign"');
  if (signIdx < 0 || signIdx <= colonIdx) return null;
  return raw.slice(colonIdx + 1, signIdx);
}

export function signWithPrivateKey(content: string, privateKeyPem: string): string {
  const signer = createSign('RSA-SHA256');
  signer.update(content, 'utf8');
  signer.end();
  return signer.sign(privateKeyPem, 'base64');
}

export function verifyWithPublicKey(content: string, signature: string, publicKeyPem: string): boolean {
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(content, 'utf8');
    verifier.end();
    return verifier.verify(publicKeyPem, signature, 'base64');
  } catch {
    return false;
  }
}

export function shanghaiTimestamp(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())} ` +
    `${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}`
  );
}

function toStringRecord(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body ?? {})) {
    if (v === undefined || v === null) continue;
    out[k] = Array.isArray(v) ? String(v[0]) : String(v);
  }
  return out;
}
