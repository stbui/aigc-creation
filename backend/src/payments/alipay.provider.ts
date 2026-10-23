import { Logger } from '@nestjs/common';
import { createSign, createVerify } from 'crypto';
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
  centsToYuan,
  normalizePem,
  yuanToCents,
} from './payment-provider.interface';

/**
 * 支付宝(网页支付)通道 —— RSA2 签名, 零新增依赖。
 *
 * 上线前置 (缺任一项即 isConfigured()=false, 调用方返回 503):
 *   ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY (应用私钥) / ALIPAY_PUBLIC_KEY (支付宝公钥)
 *
 * 关键细节:
 *   · 签名串**不 URL 编码**, 只排序 + `k=v&` 拼接; 值里的空格/中文原样参与。
 *   · 回调验签用的是**支付宝公钥**, 不是应用公钥 —— 两者常被填反,
 *     填反时表现为「回调一律验签失败」, 日志里只能看到 ok:false。
 *   · 时间戳必须按 +08:00 生成: 服务器时区不是东八区时, 用本地时间会让
 *     支付宝判定 timestamp 非法。
 *   · 金额单位是**元**且必须两位小数, 本地一律用整数分, 边界处转换。
 */
export class AlipayPaymentProvider implements PaymentProvider {
  readonly channel: PaymentChannel = 'alipay';
  private readonly logger = new Logger(AlipayPaymentProvider.name);

  private readonly appId = process.env.ALIPAY_APP_ID ?? '';
  private readonly privateKey = normalizePem(process.env.ALIPAY_PRIVATE_KEY);
  private readonly alipayPublicKey = normalizePem(process.env.ALIPAY_PUBLIC_KEY);
  private readonly gateway = process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do';
  /**
   * 沙箱网关: https://openapi-sandbox.dl.alipaydev.com/gateway.do
   * 通过 ALIPAY_GATEWAY 切换, 不在代码里按 NODE_ENV 猜 —— test 档也可能
   * 需要打正式网关做小额的真人验证。
   */
  private readonly charset = 'utf-8';
  private readonly signType = 'RSA2';

  isConfigured(): boolean {
    return this.missingConfig().length === 0;
  }

  missingConfig(): string[] {
    const missing: string[] = [];
    if (!this.appId) missing.push('ALIPAY_APP_ID');
    if (!this.privateKey) missing.push('ALIPAY_PRIVATE_KEY');
    if (!this.alipayPublicKey) missing.push('ALIPAY_PUBLIC_KEY');
    return missing;
  }

  async createIntent(input: PaymentIntentInput): Promise<PaymentIntentResult> {
    if (!this.isConfigured()) {
      throw new Error(`支付宝通道缺少配置: ${this.missingConfig().join(', ')}`);
    }

    const bizContent = JSON.stringify({
      out_trade_no: input.orderNo,
      total_amount: centsToYuan(input.amountCents),
      subject: input.subject,
      // 超时时间与本地订单过期时间保持同一口径 (30 分钟)
      timeout_express: '30m',
    });

    const params: Record<string, string> = {
      app_id: this.appId,
      method: 'alipay.trade.page.pay',
      format: 'JSON',
      charset: this.charset,
      sign_type: this.signType,
      timestamp: shanghaiTimestamp(),
      version: '1.0',
      notify_url: input.notifyUrl,
      biz_content: bizContent,
    };
    if (input.returnUrl) params.return_url = input.returnUrl;

    params.sign = signWithPrivateKey(buildSignContent(params), this.privateKey);

    const query = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    return {
      channel: 'alipay',
      mode: 'redirect',
      payUrl: `${this.gateway}?${query}`,
      providerRef: input.orderNo,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  }

  /**
   * 原路退款 (`alipay.trade.refund`)。
   *
   * 与网页支付的差别只有两处: biz_content 的字段名 (`refund_amount` /
   * `out_request_no`), 以及这次是**我们主动请求并要读回响应** ——
   * 故响应必须验签: 退款是资金动作, 一条被中间人改写的
   * `{"code":"10000"}` 会让系统把「没退成」记成「退成了」。
   *
   * `out_request_no` = 本地 Refund.id: 同一笔退款的重复请求由支付宝去重。
   */
  async refund(input: PaymentRefundInput): Promise<PaymentRefundResult> {
    if (!this.isConfigured()) {
      return { state: 'failed', error: `支付宝通道缺少配置: ${this.missingConfig().join(', ')}` };
    }

    const bizContent = JSON.stringify({
      out_trade_no: input.orderNo,
      refund_amount: centsToYuan(input.amountCents),
      out_request_no: input.outRefundNo,
      ...(input.reason ? { refund_reason: input.reason.slice(0, 256) } : {}),
    });

    const params: Record<string, string> = {
      app_id: this.appId,
      method: 'alipay.trade.refund',
      format: 'JSON',
      charset: this.charset,
      sign_type: this.signType,
      timestamp: shanghaiTimestamp(),
      version: '1.0',
      biz_content: bizContent,
    };
    params.sign = signWithPrivateKey(buildSignContent(params), this.privateKey);

    let text = '';
    try {
      const res = await fetch(this.gateway, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(15000),
      });
      text = await res.text();
      if (!res.ok) {
        this.logger.error(`支付宝退款失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
        return { state: 'failed', error: `HTTP ${res.status}: ${text.slice(0, 200)}`, raw: text.slice(0, 1000) };
      }
    } catch (e) {
      /*
       * 网络层失败 = **结果未知**。不能当成「没退成」重试同一单以外的动作,
       * 但可以安全地用同一个 outRefundNo 重试 —— 支付宝按 out_request_no 去重。
       * 文案必须说清这一点, 否则运营会另建一笔退款。
       */
      const msg = (e as Error).message || String(e);
      return {
        state: 'failed',
        error: `请求未完成（${msg}）—— 结果未知, 请用同一退款单号重试或到商户后台核对`,
      };
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return { state: 'failed', error: '退款响应不是合法 JSON（结果未知）', raw: text.slice(0, 1000) };
    }

    const node = json?.alipay_trade_refund_response;
    if (!node || typeof node !== 'object') {
      return { state: 'failed', error: '退款响应缺少 alipay_trade_refund_response（结果未知）', raw: text.slice(0, 1000) };
    }

    /*
     * 验签。缺签或被篡改一律不给「成功」—— 这时本地与渠道的状态可能不一致,
     * 只能报失败并指向商户后台核对, 让人的判断补上系统的盲区。
     */
    const sign = typeof json.sign === 'string' ? json.sign : '';
    if (!sign) {
      return { state: 'failed', error: '退款响应不含签名（结果未知）', raw: text.slice(0, 1000) };
    }
    const content = extractSignedNode(text, 'alipay_trade_refund_response');
    if (!content || !verifyWithPublicKey(content, sign, this.alipayPublicKey)) {
      return { state: 'failed', error: '退款响应验签失败（结果未知）', raw: text.slice(0, 1000) };
    }

    const raw = text.slice(0, 1000);
    const code = String(node.code ?? '');
    const subMsg = String(node.sub_msg ?? node.msg ?? '');
    if (code === '10000') {
      return {
        state: 'succeeded',
        providerRefundId: node.trade_no ? String(node.trade_no) : undefined,
        raw,
      };
    }
    /*
     * 20000 = 服务不可用, 属于「结果未知」而不是「被拒绝」; 与 4xxxx(业务失败)
     * 分开表述, 否则运营会以为这笔钱已经被支付宝挡住了。
     */
    const unknown = code === '20000';
    return {
      state: 'failed',
      error: `${unknown ? '支付宝服务暂不可用（结果未知）' : '支付宝拒绝退款'}: ${code}${subMsg ? ` ${subMsg}` : ''}`,
      raw,
    };
  }

  async verifyCallback(input: PaymentCallbackInput): Promise<PaymentCallbackResult> {
    const raw = input.rawBody || '';
    const params = toStringRecord(input.body);

    const sign = params.sign;
    if (!sign) return { ok: false, reason: '缺少 sign', raw };

    // 回调声明的 sign_type 必须是我们支持的, 否则按 RSA2 验必然失败
    if (params.sign_type && params.sign_type.toUpperCase() !== this.signType) {
      return { ok: false, reason: `不支持的 sign_type: ${params.sign_type}`, raw };
    }

    const content = buildSignContent(params, ['sign', 'sign_type']);
    if (!verifyWithPublicKey(content, sign, this.alipayPublicKey)) {
      return { ok: false, reason: '回调验签失败', raw };
    }

    // 验签通过只说明报文的完整性; 业务归属还要核对 app_id,
    // 否则同一个支付宝公钥下的其它应用的回调也能被本系统接受
    if (params.app_id && params.app_id !== this.appId) {
      return { ok: false, reason: 'app_id 不匹配', raw };
    }

    const tradeStatus = params.trade_status ?? '';
    const paid = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED';
    if (!paid) {
      // 非成功状态也 ack 成功 (让支付宝停止重试), 但不要把订单置为已支付
      return {
        ok: false,
        // 已经处理完 (确认非成功), 回 success 停止重试
        ackSuccess: true,
        reason: `交易状态非成功: ${tradeStatus || 'unknown'}`,
        orderNo: params.out_trade_no,
        tradeNo: params.trade_no,
        amountCents: yuanToCents(params.total_amount ?? '0'),
        raw,
      };
    }

    const amountCents = yuanToCents(params.total_amount ?? '');
    if (!Number.isFinite(amountCents)) {
      return { ok: false, reason: 'total_amount 无法解析', raw };
    }

    return {
      ok: true,
      orderNo: params.out_trade_no,
      tradeNo: params.trade_no,
      amountCents,
      paidAt: params.gmt_payment ? new Date(params.gmt_payment.replace(' ', 'T') + '+08:00') : new Date(),
      raw,
    };
  }

  ack(result: PaymentCallbackResult): PaymentAck {
    // 支付宝要求: 处理成功回纯文本 success, 其余回 failure (会触发重试)
    const accepted = result.ackSuccess ?? result.ok;
    return {
      status: 200,
      body: accepted ? 'success' : 'failure',
      contentType: 'text/plain; charset=utf-8',
    };
  }
}

/**
 * 按支付宝规范拼签名串: 去空值 → 去 sign/sign_type → 按键名字典序 → `k=v&k=v`。
 *
 * 导出供验签脚本做独立交叉校验 (脚本按同一规范自己拼一遍, 再用私钥签,
 * 能验证 provider 的验签实现没有「自己签自己验」的假通过)。
 */
export function buildSignContent(
  params: Record<string, string>,
  exclude: string[] = ['sign', 'sign_type'],
): string {
  return Object.keys(params)
    .filter((k) => !exclude.includes(k))
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

/**
 * 从支付宝网关的 JSON 响应里截出**被签名的那一段原文**。
 *
 * 支付宝的响应形如 `{"alipay_trade_refund_response":{...},"sign":"..."}`,
 * 签名覆盖的是节点值的**原始 JSON 文本**, 不是反序列化后再 stringify 的结果
 * —— 后者字段顺序、空格、数字格式都可能变, 验签必然失败。
 *
 * 用 `,最后出现的 "sign"` 定位右边界: 节点内部也可能有名为 sign 的字段,
 * 但顶层 sign 一定在所有节点之后。
 */
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

export function verifyWithPublicKey(
  content: string,
  signature: string,
  publicKeyPem: string,
): boolean {
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(content, 'utf8');
    verifier.end();
    return verifier.verify(publicKeyPem, signature, 'base64');
  } catch {
    // 公钥格式错误同样按验签失败处理 —— 绝不能因为异常而放过一条回调
    return false;
  }
}

/** 东八区时间戳 `yyyy-MM-dd HH:mm:ss` */
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
