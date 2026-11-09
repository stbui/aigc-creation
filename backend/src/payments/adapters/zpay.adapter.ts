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

const DEFAULT_API_BASE = 'https://zpayz.cn';
const REQUEST_TIMEOUT_MS = 15_000;
/**
 * 回调触发的确认查单超时。
 *
 * 渠道要求通知应答在 5 秒内返回纯文本 success，所以这次查单不能沿用 15 秒
 * 的常规超时；超时即按「未确认」拒绝，让渠道按 0/15/15/30… 的策略重试。
 */
const CONFIRM_QUERY_TIMEOUT_MS = 3_000;

type ZpayType = 'alipay' | 'wxpay';

interface ZpayApiResponse extends Record<string, unknown> {
  code?: unknown;
  msg?: unknown;
}

/**
 * ZPay 聚合支付适配器。
 *
 * 协议来源：https://zpayz.cn/doc.html
 *   · 创建订单：POST /mapi.php（multipart form-data）；
 *   · 查单：GET /api.php?act=order；
 *   · 退款：POST /api.php?act=refund；
 *   · 异步通知：GET，返回纯文本 success 才算接收成功。
 *
 * 下单必须带用户真实 IP。这里只接受编排层从 `req.ip` 注入的 `clientIp`，
 * 绝不接受前端自报值；`device` 只按服务端读到的 UA 粗分类，不采信前端自报。
 * 回调按文档第 5 条「强烈建议收到通知后再查单确认」执行：验签通过后用独立的
 * 3 秒超时主动查单，核对状态、金额与渠道订单号，全部一致才应答 success。
 * 查单超时或未确认一律应答 fail，让渠道重试 —— 绝不凭通知内容直接入账。
 */
export class ZpayAdapter implements PaymentAdapter {
  readonly descriptor: PaymentAdapterDescriptor = {
    id: 'zpay',
    name: 'ZPay',
    icon: 'zpay',
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
        description: `默认 ${DEFAULT_API_BASE}；适配器自动拼接 /mapi.php 与 /api.php`,
      },
      {
        name: 'pid',
        label: '商户 ID（pid）',
        type: 'text',
        required: true,
        identity: true,
        maxLength: 128,
        description: 'ZPay 商户后台的商户 ID',
      },
      {
        name: 'cid',
        label: '支付渠道 ID（可选）',
        type: 'text',
        required: false,
        default: '',
        maxLength: 128,
        description: '支持多个渠道，用英文逗号隔开；留空由 ZPay 随机选择',
      },
      {
        name: 'key',
        label: '商户密钥',
        type: 'password',
        required: true,
        secret: true,
        maxLength: 512,
        description: '用于订单签名、回调验签及查单/退款接口认证',
      },
      {
        name: 'type',
        label: '支付方式',
        type: 'select',
        required: true,
        default: 'alipay',
        options: [
          { value: 'alipay', label: '支付宝' },
          { value: 'wxpay', label: '微信支付' },
        ],
        description: '文档取值：支付宝 alipay，微信支付 wxpay',
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
    if (!configPid(values)) invalid.push('pid');
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
    const pid = configPid(values);
    const type = configType(values);
    const key = values.key?.trim() ?? '';
    const clientIp = input.clientIp?.trim() ?? '';
    const cid = values.cid?.trim() ?? '';
    if (!pid || !type || !key) throw new Error('ZPay 商户 ID、商户密钥或支付方式不完整');
    if (!clientIp) throw new Error('ZPay 下单缺少用户 IP，无法创建支付');
    if (input.currency !== 'CNY') throw new Error('ZPay 仅支持 CNY');

    const unsigned: Record<string, string> = {
      pid,
      ...(cid ? { cid } : {}),
      type,
      out_trade_no: input.orderNo,
      notify_url: input.notifyUrl,
      name: input.subject.slice(0, 100),
      money: centsToYuan(input.amountCents),
      clientip: clientIp,
      device: detectDevice(input.clientUserAgent),
      param: input.orderNo,
      sign_type: 'MD5',
    };
    const params = { ...unsigned, sign: zpaySign(unsigned, key) };
    const response = await this.request(apiEndpoint(values.apiBase, 'mapi.php'), {
      method: 'POST',
      body: toFormData(params),
    });

    const tradeNo = asString(response.trade_no).trim();
    const orderId = asString(response.O_id).trim();
    const directPayUrl = firstHttpUrl(response.payurl, response.payurl2);
    const qrcode = firstHttpUrl(response.qrcode);
    const qrcodeImage = firstHttpUrl(response.img);
    if (!directPayUrl && !qrcode && !qrcodeImage) {
      throw new Error('ZPay 下单响应缺少有效支付地址或二维码');
    }

    return {
      mode: directPayUrl ? 'redirect' : qrcode ? 'qrcode' : 'qrcode-image',
      payUrl: directPayUrl || undefined,
      codeUrl: directPayUrl ? undefined : qrcode || qrcodeImage,
      providerRef: tradeNo || orderId || undefined,
      expiresAt: input.expiresAt,
      hint: '请在 ZPay 收银台完成支付；支付结果以验签回调和主动查单为准。',
    };
  }

  async queryOrder(
    input: QueryOrderInput,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<ProviderPaymentResult> {
    const values = input.config.values;
    const pid = configPid(values);
    const key = values.key?.trim() ?? '';
    if (!pid || !key) return failedQuery(input.orderNo, 'ZPay 缺少商户 ID 或商户密钥，无法查单');

    try {
      const url = apiEndpoint(values.apiBase, 'api.php');
      url.searchParams.set('act', 'order');
      url.searchParams.set('pid', pid);
      url.searchParams.set('key', key);
      url.searchParams.set('out_trade_no', input.orderNo);
      const response = await this.request(url, { method: 'GET' }, timeoutMs);

      const returnedOrderNo = asString(response.out_trade_no).trim();
      if (returnedOrderNo !== input.orderNo) {
        return failedQuery(input.orderNo, 'ZPay 查单返回的商户订单号不匹配');
      }

      const returnedTradeNo = asString(response.trade_no).trim();
      const expectedTradeNo = input.providerRef?.trim() ?? '';
      if (expectedTradeNo && returnedTradeNo && returnedTradeNo !== expectedTradeNo) {
        return failedQuery(input.orderNo, 'ZPay 查单返回的渠道订单号不匹配');
      }

      const status = asInteger(response.status);
      if (status === null) return failedQuery(input.orderNo, 'ZPay 查单响应缺少有效订单状态');
      if (status === 1) {
        const amountCents = parseMoneyCents(asString(response.money));
        if (amountCents === null) {
          return failedQuery(input.orderNo, 'ZPay 已支付订单的金额无效');
        }
        if (!returnedTradeNo) return failedQuery(input.orderNo, 'ZPay 已支付订单缺少渠道订单号');
        return {
          state: 'paid',
          orderNo: input.orderNo,
          tradeNo: returnedTradeNo,
          amountCents,
          currency: 'CNY',
          providerStatus: 'ZPAY_STATUS_1',
          rawPayload: JSON.stringify(response),
        };
      }
      if (status === 0) {
        return {
          state: 'pending',
          orderNo: input.orderNo,
          tradeNo: returnedTradeNo || expectedTradeNo || undefined,
          currency: 'CNY',
          providerStatus: 'ZPAY_STATUS_0',
          rawPayload: JSON.stringify(response),
        };
      }
      return failedQuery(input.orderNo, `ZPay 返回未知订单状态: ${status}`);
    } catch (e) {
      return failedQuery(input.orderNo, `ZPay 查单失败: ${(e as Error).message}`);
    }
  }

  async closeOrder(input: CloseOrderInput): Promise<ProviderPaymentResult> {
    return {
      state: 'failed',
      orderNo: input.orderNo,
      providerStatus: 'UNSUPPORTED',
      error: 'ZPay 文档没有关单接口；不能确认渠道订单已关闭，禁止本地关单',
      rawPayload: '',
    };
  }

  async verifyNotification(input: NotificationInput): Promise<NotificationResult> {
    const raw = input.rawBody.toString('utf8');
    const values = stringRecord(input.body ?? {});
    const pid = configPid(input.config.values);
    const key = input.config.values.key?.trim() ?? '';
    const expectedType = configType(input.config.values);

    if (!pid || !key || !expectedType) {
      return { ok: false, ackSuccess: false, reason: 'ZPay 渠道配置不完整', rawPayload: raw };
    }
    if (values.pid?.trim() !== pid) {
      return { ok: false, ackSuccess: false, reason: 'ZPay 回调商户 ID 不匹配', rawPayload: raw };
    }
    if (values.type && configType({ type: values.type }) !== expectedType) {
      return { ok: false, ackSuccess: false, reason: 'ZPay 回调支付方式不匹配', rawPayload: raw };
    }
    if (values.sign_type && values.sign_type.trim().toUpperCase() !== 'MD5') {
      return { ok: false, ackSuccess: false, reason: 'ZPay 回调签名类型不是 MD5', rawPayload: raw };
    }

    const tradeNo = values.trade_no?.trim() ?? '';
    const merchantOrderNo = values.out_trade_no?.trim() ?? '';
    const money = values.money?.trim() ?? '';
    const tradeStatus = values.trade_status?.trim() ?? '';
    if (!tradeNo || !merchantOrderNo || !money || !values.name?.trim()) {
      return { ok: false, ackSuccess: false, reason: 'ZPay 回调字段不完整', rawPayload: raw };
    }
    const amountCents = parseMoneyCents(money);
    if (amountCents === null) {
      return { ok: false, ackSuccess: false, reason: 'ZPay 回调金额格式无效', rawPayload: raw };
    }
    if (!verifyZpaySign(values, key)) {
      return { ok: false, ackSuccess: false, reason: 'ZPay 回调验签失败', rawPayload: raw };
    }
    if (tradeStatus !== 'TRADE_SUCCESS') {
      return { ok: false, ackSuccess: false, reason: `ZPay 回调不是成功状态: ${tradeStatus || 'empty'}`, rawPayload: raw };
    }

    /*
     * 文档第 5 条「强烈建议收到通知后再查单确认」。这次查单用独立短超时，
     * 保证整个应答仍在渠道要求的 5 秒窗口内；查单超时或未确认即拒绝，
     * 让渠道按既定策略重试，绝不凭通知内容直接入账。
     */
    const queried = await this.queryOrder(
      {
        config: input.config,
        orderNo: merchantOrderNo,
        providerRef: tradeNo,
      },
      CONFIRM_QUERY_TIMEOUT_MS,
    );
    if (queried.state !== 'paid') {
      return {
        ok: false,
        ackSuccess: false,
        reason: `ZPay 回调主动查单未确认支付: ${queried.error || queried.providerStatus || queried.state}`,
        rawPayload: raw,
      };
    }
    if (queried.amountCents !== amountCents) {
      return { ok: false, ackSuccess: false, reason: 'ZPay 回调金额与查单金额不一致', rawPayload: raw };
    }
    if (queried.tradeNo && queried.tradeNo !== tradeNo) {
      return { ok: false, ackSuccess: false, reason: 'ZPay 回调订单号与查单结果不一致', rawPayload: raw };
    }

    return {
      ok: true,
      eventId: `zpay:${tradeNo}:paid`,
      merchantOrderNo,
      providerTradeNo: tradeNo,
      providerRef: tradeNo,
      amountCents,
      currency: 'CNY',
      state: 'paid',
      providerStatus: tradeStatus,
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
    const values = input.config.values;
    const pid = configPid(values);
    const key = values.key?.trim() ?? '';
    if (!pid || !key) return { state: 'failed', error: 'ZPay 缺少商户 ID 或商户密钥，无法退款' };

    const tradeNo = input.providerTradeNo?.trim() || input.providerRef?.trim() || '';
    const params: Record<string, string> = {
      pid,
      key,
      money: centsToYuan(input.amountCents),
      ...(tradeNo ? { trade_no: tradeNo } : { out_trade_no: input.orderNo }),
    };

    try {
      const url = apiEndpoint(values.apiBase, 'api.php');
      url.searchParams.set('act', 'refund');
      const response = await this.request(url, { method: 'POST', body: toFormData(params) });
      return { state: 'succeeded', raw: JSON.stringify(response) };
    } catch (e) {
      return { state: 'failed', error: `ZPay 退款失败: ${(e as Error).message}` };
    }
  }

  private async request(
    url: URL,
    init: RequestInit,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<ZpayApiResponse> {
    /*
     * 刻意不发送 `Accept: application/json`。
     *
     * 实测 ZPay 会按 Accept 头切换序列化方式：带 `application/json` 时，
     * `/mapi.php` 与 `/api.php` 都返回**二次编码**的 JSON 字符串
     * （`"{\"code\":0,...}"`），而不是文档里的 JSON 对象。
     * 直接 `JSON.parse` 得到的会是字符串，`isRecord` 判定失败，
     * 于是渠道明明正常应答却被判成「响应格式无效」——表现为一启用就下单失败。
     * 用通配的 Accept 拿到的是文档描述的原始 JSON 对象。
     */
    const res = await fetch(url, {
      ...init,
      headers: { Accept: '*/*' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`ZPay 响应不是合法 JSON (HTTP ${res.status})`);
    }
    // 兜底：万一渠道仍按二次编码应答，解一层再判格式，避免误报为协议错误。
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        throw new Error(`ZPay 响应格式无效 (HTTP ${res.status})`);
      }
    }
    if (!isRecord(parsed)) throw new Error(`ZPay 响应格式无效 (HTTP ${res.status})`);

    const response = parsed as ZpayApiResponse;
    if (!res.ok) {
      throw new Error(`ZPay HTTP ${res.status}: ${asString(response.msg) || '请求失败'}`);
    }
    const code = asInteger(response.code);
    if (code !== 1) {
      throw new Error(asString(response.msg) || `ZPay API 返回 code=${String(response.code)}`);
    }
    return response;
  }
}

/** ZPay MD5 签名：参数名 ASCII 升序，排除 sign/sign_type/空值，末尾直接拼密钥。 */
export function zpaySign(params: Record<string, string>, key: string): string {
  const content = Object.keys(params)
    .filter((name) => name !== 'sign' && name !== 'sign_type')
    .filter((name) => params[name] !== undefined && params[name] !== null && params[name] !== '')
    .sort()
    .map((name) => `${name}=${params[name]}`)
    .join('&');
  return createHash('md5').update(`${content}${key ?? ''}`, 'utf8').digest('hex').toLowerCase();
}

export function verifyZpaySign(params: Record<string, string>, key: string): boolean {
  const actual = params.sign?.trim().toLowerCase() ?? '';
  if (!/^[a-f0-9]{32}$/.test(actual)) return false;
  const expected = Buffer.from(zpaySign(params, key), 'hex');
  const provided = Buffer.from(actual, 'hex');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function configPid(values: Readonly<Record<string, string>>): string {
  return values.pid?.trim() ?? '';
}

function configType(values: Readonly<Record<string, string>>): ZpayType | '' {
  const normalized = (values.type ?? '').trim().toLowerCase();
  if (['alipay', 'ali'].includes(normalized)) return 'alipay';
  if (['wxpay', 'wx', 'wechat', 'weixin'].includes(normalized)) return 'wxpay';
  return '';
}

/**
 * 文档 `device` 取值：pc / mobile / qq / wechat / alipay，默认 pc。
 * 只按 UA 做粗分类；判不出来就回落 pc，渠道只用它决定拉起哪种收银台形态。
 */
function detectDevice(
  userAgent: string | undefined,
): 'pc' | 'mobile' | 'qq' | 'wechat' | 'alipay' {
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua) return 'pc';
  if (ua.includes('micromessenger')) return 'wechat';
  if (ua.includes('alipayclient')) return 'alipay';
  if (ua.includes('mqqbrowser') || ua.includes('qqbrowser')) return 'qq';
  if (/(android|iphone|ipod|ipad|harmonyos|mobile)/.test(ua)) return 'mobile';
  return 'pc';
}

function apiEndpoint(apiBase: string | undefined, endpoint: 'mapi.php' | 'api.php'): URL {
  const url = new URL(apiBase?.trim() || DEFAULT_API_BASE);
  let path = url.pathname.replace(/\/+$/, '');
  if (/\/(?:mapi|api|submit)\.php$/i.test(path)) {
    path = path.replace(/\/[^/]+$/, `/${endpoint}`);
  } else if (!path) {
    path = `/${endpoint}`;
  } else {
    path = `${path}/${endpoint}`;
  }
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url;
}

function toFormData(params: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(params)) form.set(name, value);
  return form;
}

function firstHttpUrl(...values: unknown[]): string {
  for (const value of values) {
    const normalized = asString(value).trim().replace(/\\u003d/gi, '=');
    if (!normalized) continue;
    try {
      const url = new URL(normalized);
      if (url.protocol === 'http:' || url.protocol === 'https:') return normalized;
    } catch {
      // 继续尝试下一个候选字段
    }
  }
  return '';
}

function parseMoneyCents(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = yuanToCents(normalized);
  return Number.isFinite(cents) ? cents : null;
}

function failedQuery(orderNo: string, error: string): ProviderPaymentResult {
  return {
    state: 'failed',
    orderNo,
    providerStatus: 'QUERY_FAILED',
    error,
    rawPayload: '',
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
