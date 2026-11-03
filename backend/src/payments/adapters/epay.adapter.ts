import { createHash, timingSafeEqual } from 'node:crypto';
import {
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
  isAllowedPublicBase,
  yuanToCents,
} from './types';

const DEFAULT_API_BASE = 'https://epay.jylt.cc';
const REQUEST_TIMEOUT_MS = 15_000;

type EpayType = '1' | '2';

interface EpayApiResponse {
  code?: unknown;
  msg?: unknown;
  data?: unknown;
}

/**
 * 易支付（epay.jylt.cc）API 适配器。
 *
 * 该服务商的协议与常见的 `submit.php?pid=...` 通用易支付协议不同：
 *   · 服务端先调用 `/api/createOrder` 创建订单并取得收银台 URL；
 *   · `/api/getOrder` 返回的 state=2 表示用户已付款但异步通知失败，必须按已支付处理；
 *   · 异步通知使用 GET，签名数据为 `orderId + param + type + price + reallyPrice + key`。
 *
 * 文档没有提供关单和退款 API，因此这两项明确返回 failed，不能伪造成功。
 */
export class EpayAdapter implements PaymentAdapter {
  readonly descriptor: PaymentAdapterDescriptor = {
    id: 'epay',
    name: '易支付',
    icon: 'epay',
    checkoutMode: 'redirect',
    supportedCurrencies: ['CNY'],
    supportsReconciliation: false,
    configFields: [
      {
        name: 'apiBase',
        label: 'API 地址',
        type: 'url',
        required: false,
        default: DEFAULT_API_BASE,
        maxLength: 512,
        description: `默认 ${DEFAULT_API_BASE}；会自动拼接 /api/createOrder 与 /api/getOrder`,
      },
      {
        name: 'mchId',
        label: '商户 ID（mchId）',
        type: 'text',
        required: true,
        identity: true,
        maxLength: 128,
        description: '易支付服务商后台的商户 ID',
      },
      {
        name: 'key',
        label: '通讯密钥',
        type: 'password',
        required: true,
        secret: true,
        maxLength: 512,
        description: '用于创建订单和回调的 MD5 签名，必须与服务商后台一致',
      },
      {
        name: 'type',
        label: '支付类型',
        type: 'select',
        required: true,
        default: '2',
        options: [
          { value: '1', label: '微信支付' },
          { value: '2', label: '支付宝' },
        ],
        description: '文档规定：微信为 1，支付宝为 2',
      },
      {
        name: 'publicBaseUrl',
        label: '回调公网地址（可选）',
        type: 'url',
        required: false,
        default: '',
        description: '例如 https://pay.example.com；留空使用 PAYMENT_NOTIFY_BASE',
      },
    ],
  };

  validateConfig(values: Record<string, string>): string[] {
    const invalid: string[] = [];
    if (!configMchId(values)) invalid.push('mchId');
    if (!values.key?.trim()) invalid.push('key');
    if (!configType(values)) invalid.push('type');
    const apiBase = values.apiBase?.trim();
    if (apiBase && !isAllowedPublicBase(apiBase)) invalid.push('apiBase');
    const publicBaseUrl = values.publicBaseUrl?.trim();
    if (publicBaseUrl && !isAllowedPublicBase(publicBaseUrl)) invalid.push('publicBaseUrl');
    return Array.from(new Set(invalid));
  }

  async createOrder(input: CreateOrderInput): Promise<PaymentCheckout> {
    const values = input.config.values;
    const mchId = configMchId(values);
    const type = configType(values);
    const key = values.key ?? '';
    if (!mchId || !type || !key) throw new Error('易支付商户 ID、通讯密钥或支付类型不完整');
    if (input.currency !== 'CNY') throw new Error('易支付仅支持 CNY');

    const payId = input.orderNo;
    const param = input.orderNo;
    const price = centsToYuan(input.amountCents);
    const params: Record<string, string> = {
      mchId,
      payId,
      type,
      price,
      sign: epayCreateSign(payId, param, type, price, key),
      goodsName: input.subject.slice(0, 50),
      param,
      isHtml: '1',
      notifyUrl: input.notifyUrl,
      returnUrl: input.returnUrl,
    };

    const response = await this.request(values.apiBase, 'createOrder', params);
    const data = response.data;
    const payUrl = extractPayUrl(data);
    if (!payUrl) throw new Error('易支付下单响应缺少有效收银台地址');

    const orderId = asString(isRecord(data) ? data.orderId : undefined).trim();
    return {
      mode: 'redirect',
      payUrl,
      providerRef: orderId || undefined,
      expiresAt: resolveExpiresAt(input.expiresAt, data),
      hint: '请在易支付收银台完成支付；支付结果以验签回调和主动查单为准。',
    };
  }

  async queryOrder(input: QueryOrderInput): Promise<ProviderPaymentResult> {
    const values = input.config.values;
    const mchId = configMchId(values);
    const providerRef = input.providerRef?.trim() ?? '';
    if (!mchId) {
      return {
        state: 'failed',
        orderNo: input.orderNo,
        providerStatus: 'CONFIG_INVALID',
        error: '易支付缺少商户 ID，无法查单',
        rawPayload: '',
      };
    }

    try {
      const response = await this.request(values.apiBase, 'getOrder', {
        mchId,
        ...(providerRef ? { orderId: providerRef } : { payId: input.orderNo }),
      });
      const data = response.data;
      if (!isRecord(data)) {
        return failedQuery(input.orderNo, '易支付查单响应缺少订单数据', response.raw);
      }

      const returnedPayId = asString(data.payId).trim();
      const returnedOrderId = asString(data.orderId).trim();
      if (providerRef) {
        if (returnedOrderId !== providerRef) {
          return failedQuery(input.orderNo, '易支付查单返回的云端订单号不匹配', response.raw);
        }
        if (returnedPayId && returnedPayId !== input.orderNo) {
          return failedQuery(input.orderNo, '易支付查单返回的商户支付单号不匹配', response.raw);
        }
      } else if (returnedPayId !== input.orderNo) {
        return failedQuery(input.orderNo, '易支付查单返回的商户支付单号不匹配', response.raw);
      }

      const state = asInteger(data.state);
      if (state === null) {
        return failedQuery(input.orderNo, '易支付查单响应缺少订单状态', response.raw);
      }

      if (state === 1 || state === 2) {
        const amountCents = paidAmountCents(data);
        if (amountCents === null) {
          return failedQuery(input.orderNo, '易支付已支付订单的金额无效', response.raw);
        }
        return {
          state: 'paid',
          orderNo: input.orderNo,
          tradeNo: returnedOrderId || providerRef || undefined,
          amountCents,
          currency: 'CNY',
          providerStatus: `EPAY_STATE_${state}`,
          rawPayload: response.raw,
        };
      }
      if (state === 0) {
        return {
          state: 'pending',
          orderNo: input.orderNo,
          tradeNo: returnedOrderId || providerRef || undefined,
          currency: 'CNY',
          providerStatus: `EPAY_STATE_${state}`,
          rawPayload: response.raw,
        };
      }
      if (state === -1) {
        return {
          state: 'closed',
          orderNo: input.orderNo,
          tradeNo: returnedOrderId || providerRef || undefined,
          currency: 'CNY',
          providerStatus: `EPAY_STATE_${state}`,
          rawPayload: response.raw,
        };
      }
      if (state === 3) {
        return {
          state: 'failed',
          orderNo: input.orderNo,
          tradeNo: returnedOrderId || providerRef || undefined,
          currency: 'CNY',
          providerStatus: `EPAY_STATE_${state}`,
          error: '易支付账户余额不足，渠道订单创建失败',
          rawPayload: response.raw,
        };
      }
      return failedQuery(input.orderNo, `易支付返回未知订单状态: ${state}`, response.raw);
    } catch (e) {
      return failedQuery(input.orderNo, `易支付查单失败: ${(e as Error).message}`, '');
    }
  }

  async closeOrder(input: CloseOrderInput): Promise<ProviderPaymentResult> {
    return {
      state: 'failed',
      orderNo: input.orderNo,
      providerStatus: 'UNSUPPORTED',
      error: '当前易支付文档没有关单接口；不能确认渠道订单已关闭，禁止本地关单',
      rawPayload: '',
    };
  }

  async verifyNotification(input: NotificationInput): Promise<NotificationResult> {
    const raw = input.rawBody.toString('utf8');
    const values = stringRecord(input.body ?? {});
    const expectedMchId = configMchId(input.config.values);
    if (!expectedMchId || values.mchId?.trim() !== expectedMchId) {
      return { ok: false, ackSuccess: false, reason: '易支付回调商户 ID 不匹配', rawPayload: raw };
    }

    const expectedType = configType(input.config.values);
    if (!expectedType || values.type?.trim() !== expectedType) {
      return { ok: false, ackSuccess: false, reason: '易支付回调支付类型不匹配', rawPayload: raw };
    }

    const orderId = values.orderId?.trim() ?? '';
    const merchantOrderNo = values.param?.trim() ?? '';
    const price = values.price?.trim() ?? '';
    const reallyPrice = values.reallyPrice?.trim() ?? '';
    if (!orderId || !merchantOrderNo || !price || !reallyPrice) {
      return { ok: false, ackSuccess: false, reason: '易支付回调字段不完整', rawPayload: raw };
    }
    if (parseMoneyCents(price) === null || parseMoneyCents(reallyPrice) === null) {
      return { ok: false, ackSuccess: false, reason: '易支付回调金额格式无效', rawPayload: raw };
    }
    if (!verifyEpayCallbackSign(values, input.config.values.key ?? '')) {
      return { ok: false, ackSuccess: false, reason: '易支付回调验签失败', rawPayload: raw };
    }

    return {
      ok: true,
      eventId: `epay:${orderId}:paid`,
      merchantOrderNo,
      providerTradeNo: orderId,
      providerRef: orderId,
      amountCents: yuanToCents(reallyPrice),
      currency: 'CNY',
      state: 'paid',
      providerStatus: 'PAY_SUCCESS',
      ackSuccess: true,
      rawPayload: raw,
    };
  }

  ack(result: NotificationResult): PaymentAck {
    const accepted = result.ok ? result.ackSuccess : false;
    return {
      status: accepted ? 200 : 400,
      body: accepted ? 'success' : 'fail',
      contentType: 'text/plain; charset=utf-8',
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return {
      state: 'failed',
      error: `当前易支付文档没有退款接口，订单 ${input.orderNo} 需在服务商后台退款后人工核对`,
    };
  }

  private async request(
    apiBase: string | undefined,
    endpoint: 'createOrder' | 'getOrder',
    params: Record<string, string>,
  ): Promise<EpayApiResponse & { raw: string }> {
    const url = apiEndpoint(apiBase, endpoint);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const raw = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`易支付响应不是合法 JSON (HTTP ${res.status})`);
    }
    if (!isRecord(parsed)) throw new Error(`易支付响应格式无效 (HTTP ${res.status})`);
    if (!res.ok) {
      throw new Error(
        `易支付 HTTP ${res.status}: ${asString(parsed.msg) || asString(parsed.message) || '请求失败'}`,
      );
    }

    const response = parsed as EpayApiResponse;
    const code = asInteger(response.code);
    if (code !== 1) {
      throw new Error(asString(response.msg) || `易支付 API 返回 code=${String(response.code)}`);
    }
    return { ...response, raw };
  }
}

/**
 * 创建订单签名：md5(payId + param + type + price + 通讯密钥)。
 * 文档示例结果为 7bbd596ce8cee9bed866291b83f7c808。
 */
export function epayCreateSign(
  payId: string,
  param: string,
  type: string,
  price: string,
  key: string,
): string {
  return md5(`${payId}${param}${type}${price}${key ?? ''}`);
}

/** 回调签名：md5(orderId + param + type + price + reallyPrice + 通讯密钥)。 */
export function epayCallbackSign(
  orderId: string,
  param: string,
  type: string,
  price: string,
  reallyPrice: string,
  key: string,
): string {
  return md5(`${orderId}${param}${type}${price}${reallyPrice}${key ?? ''}`);
}

export function verifyEpayCallbackSign(values: Record<string, string>, key: string): boolean {
  const actual = values.sign?.trim().toLowerCase() ?? '';
  if (!/^[a-f0-9]{32}$/.test(actual)) return false;
  const expected = Buffer.from(
    epayCallbackSign(
      values.orderId?.trim() ?? '',
      values.param?.trim() ?? '',
      values.type?.trim() ?? '',
      values.price?.trim() ?? '',
      values.reallyPrice?.trim() ?? '',
      key,
    ),
    'hex',
  );
  const provided = Buffer.from(actual, 'hex');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function md5(value: string): string {
  return createHash('md5').update(value, 'utf8').digest('hex').toLowerCase();
}

function configMchId(values: Readonly<Record<string, string>>): string {
  return (values.mchId || values.pid || '').trim();
}

function configType(values: Readonly<Record<string, string>>): EpayType | '' {
  return normalizeEpayType(values.type || values.payType || '');
}

function normalizeEpayType(value: string): EpayType | '' {
  const normalized = value.trim().toLowerCase();
  if (['1', 'wx', 'wxpay', 'wechat', 'weixin'].includes(normalized)) return '1';
  if (['2', 'ali', 'alipay'].includes(normalized)) return '2';
  return '';
}

function apiEndpoint(apiBase: string | undefined, endpoint: 'createOrder' | 'getOrder'): URL {
  const url = new URL(apiBase?.trim() || DEFAULT_API_BASE);
  let path = url.pathname.replace(/\/+$/, '');
  if (/\/api\/(?:createOrder|getOrder|checkOrder)$/i.test(path)) {
    path = path.replace(/\/[^/]+$/, `/${endpoint}`);
  } else if (/\/api$/i.test(path)) {
    path = `${path}/${endpoint}`;
  } else {
    path = `${path}/api/${endpoint}`;
  }
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url;
}

function extractPayUrl(data: unknown): string {
  let value: unknown = data;
  if (isRecord(data)) {
    value = data.payUrl ?? data.payURL ?? data.url ?? data.redirectUrl;
  }
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace(/\\u003d/gi, '=');
  if (!normalized) return '';

  // 个别服务商会把 JSON 作为 data 字符串返回。
  if (normalized.startsWith('{')) {
    try {
      return extractPayUrl(JSON.parse(normalized));
    } catch {
      return '';
    }
  }
  try {
    const url = new URL(normalized);
    return url.protocol === 'http:' || url.protocol === 'https:' ? normalized : '';
  } catch {
    return '';
  }
}

function resolveExpiresAt(localExpiresAt: Date, data: unknown): Date {
  if (!isRecord(data)) return localExpiresAt;
  const timeOutMinutes = asInteger(data.timeOut);
  if (timeOutMinutes === null || timeOutMinutes <= 0) return localExpiresAt;

  const providerCreatedAt = timestampMs(data.date) ?? Date.now();
  const providerExpiresAt = new Date(providerCreatedAt + timeOutMinutes * 60_000);
  return providerExpiresAt.getTime() < localExpiresAt.getTime() ? providerExpiresAt : localExpiresAt;
}

function timestampMs(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(number) || number <= 0) return null;
  const milliseconds = number < 10_000_000_000 ? number * 1000 : number;
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function paidAmountCents(data: Record<string, unknown>): number | null {
  if (data.reallyPrice !== undefined && data.reallyPrice !== null) {
    return parseMoneyCents(String(data.reallyPrice));
  }
  if (data.price !== undefined && data.price !== null) {
    return parseMoneyCents(String(data.price));
  }
  return null;
}

function parseMoneyCents(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = yuanToCents(normalized);
  return Number.isFinite(cents) ? cents : null;
}

function failedQuery(orderNo: string, error: string, rawPayload: string): ProviderPaymentResult {
  return {
    state: 'failed',
    orderNo,
    providerStatus: 'QUERY_FAILED',
    error,
    rawPayload,
  };
}

function stringRecord(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function asInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number.parseInt(value, 10);
  return null;
}
