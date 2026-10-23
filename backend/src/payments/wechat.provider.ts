import { Logger } from '@nestjs/common';
import { createDecipheriv, createSign, createVerify, randomUUID } from 'crypto';
import {
  PaymentAck,
  PaymentCallbackInput,
  PaymentCallbackResult,
  PaymentChannel,
  PaymentIntentInput,
  PaymentIntentResult,
  PaymentProvider,
  PaymentRefundInput,
  PaymentRefundResult,
  normalizePem,
} from './payment-provider.interface';

/**
 * 微信支付 API v3 (Native 扫码) 通道。
 *
 * 上线前置 (缺任一项即 isConfigured()=false, 调用方返回 503):
 *   WECHAT_MCH_ID / WECHAT_APP_ID / WECHAT_API_V3_KEY /
 *   WECHAT_SERIAL_NO / WECHAT_PRIVATE_KEY / WECHAT_PLATFORM_PUBLIC_KEY
 *
 * 与支付宝的三处关键差异:
 *   1. 请求签名覆盖「方法 + 路径 + 时间戳 + 随机串 + 报文」五行, 不是排序拼接;
 *   2. 回调报文是 **AES-256-GCM 加密**的, 验签通过后还要用 APIv3 密钥解密,
 *      拿到明文才算读到交易号;
 *   3. 回执是 JSON (`{"code":"SUCCESS"}`), 不是纯文本。
 *
 * 回调必须校验时间戳新鲜度 (5 分钟): 微信签名不含随机挑战, 一条被录下的
 * 合法回调可以原样重放, 时间窗是唯一的拦截面。
 */
export class WechatPaymentProvider implements PaymentProvider {
  readonly channel: PaymentChannel = 'wechat';
  private readonly logger = new Logger(WechatPaymentProvider.name);

  private readonly mchId = process.env.WECHAT_MCH_ID ?? '';
  private readonly appId = process.env.WECHAT_APP_ID ?? '';
  private readonly apiV3Key = process.env.WECHAT_API_V3_KEY ?? '';
  private readonly serialNo = process.env.WECHAT_SERIAL_NO ?? '';
  private readonly privateKey = normalizePem(process.env.WECHAT_PRIVATE_KEY);
  private readonly platformPublicKey = normalizePem(process.env.WECHAT_PLATFORM_PUBLIC_KEY);
  private readonly apiBase = process.env.WECHAT_API_BASE || 'https://api.mch.weixin.qq.com';

  isConfigured(): boolean {
    return this.missingConfig().length === 0;
  }

  missingConfig(): string[] {
    const missing: string[] = [];
    if (!this.mchId) missing.push('WECHAT_MCH_ID');
    if (!this.appId) missing.push('WECHAT_APP_ID');
    if (!this.apiV3Key) missing.push('WECHAT_API_V3_KEY');
    if (!this.serialNo) missing.push('WECHAT_SERIAL_NO');
    if (!this.privateKey) missing.push('WECHAT_PRIVATE_KEY');
    if (!this.platformPublicKey) missing.push('WECHAT_PLATFORM_PUBLIC_KEY');
    return missing;
  }

  async createIntent(input: PaymentIntentInput): Promise<PaymentIntentResult> {
    if (!this.isConfigured()) {
      throw new Error(`微信通道缺少配置: ${this.missingConfig().join(', ')}`);
    }

    const path = '/v3/pay/transactions/native';
    const payload = JSON.stringify({
      appid: this.appId,
      mchid: this.mchId,
      description: input.subject.slice(0, 127),
      out_trade_no: input.orderNo,
      time_expire: rfc3339(new Date(Date.now() + 30 * 60 * 1000)),
      notify_url: input.notifyUrl,
      amount: { total: input.amountCents, currency: 'CNY' },
    });

    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomUUID().replace(/-/g, '');
    const signature = this.signRequest('POST', path, timestamp, nonce, payload);

    const res = await fetch(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: {
        Authorization:
          `WECHATPAY2-SHA256-RSA2048 mchid="${this.mchId}",nonce_str="${nonce}",` +
          `signature="${signature}",timestamp="${timestamp}",serial_no="${this.serialNo}"`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: payload,
      signal: AbortSignal.timeout(15000),
    });

    const text = await res.text();
    if (!res.ok) {
      // 微信的错误体是 JSON: {code, message}。直接透出会被当成「系统异常」,
      // 排障时看不到真正的原因 (例如 APPID_MCHID_NOT_MATCH)
      this.logger.error(`微信预下单失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
      throw new Error(`微信预下单失败 (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }

    // 出站响应同样必须验签: 不验就信任响应体里的 code_url, 中间人可把
    // 用户引导到攻击者自己的收款码 (商家侧看不到任何异常)。
    this.verifyResponse(res.headers, text, '微信预下单');

    let codeUrl = '';
    try {
      codeUrl = (JSON.parse(text) as { code_url?: string }).code_url ?? '';
    } catch {
      throw new Error('微信预下单响应不是合法 JSON');
    }
    if (!codeUrl) throw new Error('微信预下单未返回 code_url');

    return {
      channel: 'wechat',
      mode: 'qrcode',
      codeUrl,
      providerRef: input.orderNo,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  }

  /**
   * 原路退款 (`POST /v3/refund/domestic/refunds`)。
   *
   * 与预下单共用同一套 v3 签名（方法+路径+时间戳+随机串+报文五行）。
   *
   * `out_refund_no` = 本地 Refund.id: 微信按它去重, 所以「本地超时后重试」
   * 是安全的, 而**绝不能在重试时换号** —— 那会真的退第二笔。
   *
   * 返回值三种情况都要如实区分:
   *   SUCCESS     钱已退 (同步完成)
   *   PROCESSING  已受理、异步处理中 —— **不能当成功**, 此时既不能扣积分
   *               也不能把订单置 refunded, 否则渠道后来说失败就无从追回
   *   CLOSED/ABNORMAL/其它  失败
   *
   * ⚠ 不传 `notify_url`: 本仓库没有退款回调端点, 传一个不存在的地址只会让
   * 微信一直重试。异步单的状态由运营在商户后台确认（Refund.status 保持
   * processing 就是这个意思）。
   */
  async refund(input: PaymentRefundInput): Promise<PaymentRefundResult> {
    if (!this.isConfigured()) {
      return { state: 'failed', error: `微信通道缺少配置: ${this.missingConfig().join(', ')}` };
    }

    const path = '/v3/refund/domestic/refunds';
    const payload = JSON.stringify({
      out_trade_no: input.orderNo,
      out_refund_no: input.outRefundNo,
      ...(input.reason ? { reason: input.reason.slice(0, 80) } : {}),
      amount: {
        refund: input.amountCents,
        total: input.totalCents,
        currency: 'CNY',
      },
    });

    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomUUID().replace(/-/g, '');
    const signature = this.signRequest('POST', path, timestamp, nonce, payload);

    let text = '';
    try {
      const res = await fetch(`${this.apiBase}${path}`, {
        method: 'POST',
        headers: {
          Authorization:
            `WECHATPAY2-SHA256-RSA2048 mchid="${this.mchId}",nonce_str="${nonce}",` +
            `signature="${signature}",timestamp="${timestamp}",serial_no="${this.serialNo}"`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: payload,
        signal: AbortSignal.timeout(15000),
      });
      text = await res.text();
      if (!res.ok) {
        // 微信错误体是 {code, message}: 直接说 HTTP 状态会让运营看不到
        // NOT_ENOUGH / PARAM_ERROR / ORDER_NOT_EXIST 这类真正原因
        this.logger.error(`微信退款失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
        let detail = text.slice(0, 200);
        try {
          const e = JSON.parse(text) as { code?: string; message?: string };
          if (e.code || e.message) detail = `${e.code ?? ''} ${e.message ?? ''}`.trim();
        } catch {
          /* 非 JSON 错误体原样透出 */
        }
        return { state: 'failed', error: `HTTP ${res.status}: ${detail}`, raw: text.slice(0, 1000) };
      }
      // 退款是资金流出: 不验签就采信响应里的 SUCCESS, 一份伪造响应即可让本地
      // 置 refunded 并回收积分, 而渠道实际没退钱。验签失败按「结果未知」处理,
      // 不落任何本地账 (调用方可用同一退款单号重试)。
      this.verifyResponse(res.headers, text, '微信退款');
    } catch (e) {
      const msg = (e as Error).message || String(e);
      return {
        state: 'failed',
        error: `请求未完成（${msg}）—— 结果未知, 请用同一退款单号重试或到商户后台核对`,
      };
    }

    let json: { refund_id?: string; status?: string } & Record<string, unknown>;
    try {
      json = JSON.parse(text);
    } catch {
      return { state: 'failed', error: '退款响应不是合法 JSON（结果未知）', raw: text.slice(0, 1000) };
    }

    const raw = text.slice(0, 1000);
    const providerRefundId = json.refund_id ? String(json.refund_id) : undefined;
    const status = String(json.status ?? '');
    if (status === 'SUCCESS') return { state: 'succeeded', providerRefundId, raw };
    if (status === 'PROCESSING') return { state: 'processing', providerRefundId, raw };
    return {
      state: 'failed',
      providerRefundId,
      error: `微信退款状态: ${status || 'unknown'}`,
      raw,
    };
  }

  async verifyCallback(input: PaymentCallbackInput): Promise<PaymentCallbackResult> {
    const raw = input.rawBody || '';
    const h = (name: string): string => {
      const v = input.headers?.[name];
      return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
    };

    const timestamp = h('wechatpay-timestamp');
    const nonce = h('wechatpay-nonce');
    const signature = h('wechatpay-signature');

    if (!timestamp || !nonce || !signature) {
      return { ok: false, reason: '缺少微信回调签名头', raw };
    }
    if (!this.isFresh(timestamp)) {
      return { ok: false, reason: '回调时间戳超出 5 分钟窗口 (疑似重放)', raw };
    }

    const message = `${timestamp}\n${nonce}\n${raw}\n`;
    const verifier = createVerify('RSA-SHA256');
    verifier.update(message, 'utf8');
    verifier.end();
    let verified = false;
    try {
      verified = verifier.verify(this.platformPublicKey, signature, 'base64');
    } catch {
      verified = false;
    }
    if (!verified) return { ok: false, reason: '回调验签失败', raw };

    // 验签通过 → 解密 resource
    let payload: {
      out_trade_no?: string;
      transaction_id?: string;
      trade_state?: string;
      success_time?: string;
      amount?: { total?: number };
    };
    try {
      const body = input.body as {
        resource?: { ciphertext?: string; nonce?: string; associated_data?: string };
      };
      const resource = body.resource;
      if (!resource?.ciphertext || !resource?.nonce) {
        return { ok: false, reason: '回调缺少 resource', raw };
      }
      payload = this.decryptResource({
        ciphertext: resource.ciphertext,
        nonce: resource.nonce,
        associated_data: resource.associated_data,
      });
    } catch (e) {
      return { ok: false, reason: `回调解密失败: ${(e as Error).message}`, raw };
    }

    if (payload.trade_state !== 'SUCCESS') {
      return {
        ok: false,
        // 已确认非成功, 回 success 停止重试
        ackSuccess: true,
        reason: `交易状态非成功: ${payload.trade_state ?? 'unknown'}`,
        orderNo: payload.out_trade_no,
        tradeNo: payload.transaction_id,
        amountCents: payload.amount?.total,
        raw,
      };
    }

    return {
      ok: true,
      orderNo: payload.out_trade_no,
      tradeNo: payload.transaction_id,
      amountCents: payload.amount?.total,
      paidAt: payload.success_time ? new Date(payload.success_time) : new Date(),
      raw,
    };
  }

  ack(result: PaymentCallbackResult): PaymentAck {
    // 微信要求 HTTP 200 + {code:'SUCCESS'}; 非 200 会触发重试。
    // 判定用 ackSuccess 而不是 ok: 「交易状态非成功(用户关单)」必须回 SUCCESS
    // 让微信停止重试, 否则一条关闭的交易会被推送 24 小时, 日志被刷满。
    const accepted = result.ackSuccess ?? result.ok;
    const body = accepted
      ? { code: 'SUCCESS', message: '成功' }
      : { code: 'FAIL', message: (result.reason ?? '处理失败').slice(0, 200) };
    return {
      status: accepted ? 200 : 500,
      body: JSON.stringify(body),
      contentType: 'application/json; charset=utf-8',
    };
  }

  // ── 内部 ──────────────────────────────────────────────────────────

  /**
   * 校验微信**出站应答**的签名。
   *
   * 与回调入口同一套算法 (RSA-SHA256, 报文 = timestamp\nnonce\nbody\n),
   * 同样要求时间戳在 5 分钟窗口内 —— 只验签不校验新鲜度, 一份被录下的
   * 合法响应仍可原样重放。
   *
   * 缺签名头、验签失败、时间戳过期一律抛错: 出站响应的来源无法确认时,
   * 不能把里面的 code_url / refund status 当成事实。
   */
  private verifyResponse(headers: Headers, body: string, label: string): void {
    const timestamp = headers.get('wechatpay-timestamp') ?? '';
    const nonce = headers.get('wechatpay-nonce') ?? '';
    const signature = headers.get('wechatpay-signature') ?? '';

    if (!timestamp || !nonce || !signature) {
      throw new Error(`${label}响应缺少验签头 (Wechatpay-Timestamp/Nonce/Signature)，无法确认来源`);
    }
    if (!this.isFresh(timestamp)) {
      throw new Error(`${label}响应时间戳超出 5 分钟窗口 (疑似重放)`);
    }

    const message = `${timestamp}\n${nonce}\n${body}\n`;
    const verifier = createVerify('RSA-SHA256');
    verifier.update(message, 'utf8');
    verifier.end();
    let verified = false;
    try {
      verified = verifier.verify(this.platformPublicKey, signature, 'base64');
    } catch {
      verified = false;
    }
    if (!verified) throw new Error(`${label}响应验签失败 (平台公钥不匹配或报文被篡改)`);
  }

  private signRequest(
    method: string,
    path: string,
    timestamp: string,
    nonce: string,
    body: string,
  ): string {
    const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
    const signer = createSign('RSA-SHA256');
    signer.update(message, 'utf8');
    signer.end();
    return signer.sign(this.privateKey, 'base64');
  }

  private decryptResource(resource: {
    ciphertext: string;
    nonce: string;
    associated_data?: string;
  }): {
    out_trade_no?: string;
    transaction_id?: string;
    trade_state?: string;
    success_time?: string;
    amount?: { total?: number };
  } {
    const key = Buffer.from(this.apiV3Key, 'utf8');
    if (key.length !== 32) {
      throw new Error('WECHAT_API_V3_KEY 必须是 32 字节');
    }
    const raw = Buffer.from(resource.ciphertext, 'base64');
    // GCM 密文尾部 16 字节是认证标签, 必须单独取出, 否则解密必失败
    const authTag = raw.subarray(raw.length - 16);
    const data = raw.subarray(0, raw.length - 16);

    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'));
    decipher.setAuthTag(authTag);
    if (resource.associated_data) {
      decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
    }
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(plain);
  }

  private isFresh(timestamp: string): boolean {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    return Math.abs(Date.now() / 1000 - ts) <= 300;
  }
}

/** 微信要求的 RFC3339 时间 (带 +08:00 偏移) */
export function rfc3339(d: Date): string {
  const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
    `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}+08:00`
  );
}
