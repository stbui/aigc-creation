/**
 * 支付通道签名实现的**离线交叉校验** (B3)。
 *
 * 为什么需要这个脚本:
 *
 *   支付宝与微信的验签有一个共同陷阱 —— **自己签、自己验**永远通过。签名串
 *   规则写错 (少排序 / 多了 sign_type / 少一个换行), 只要签名与验签两边错得
 *   一致, 本地一路绿灯, 上线后第一条真实回调就验签失败, 日志里只有一句
 *   「回调验签失败」, 完全无法定位。
 *
 *   所以这里按公开文档的规则在脚本里**独立实现一遍签名**, 再用它喂被测代码的
 *   `verifyCallback`。两份独立实现一致才算通过。
 *
 * 不覆盖 (需要真实商户号, 交付时如实标注「已实现未实测」):
 *   · 打向 openapi.alipay.com / api.mch.weixin.qq.com 的预下单 HTTP 往返
 *
 * 运行: cd backend && npx ts-node -T scripts/verify-payment-signatures.ts
 */
import { createCipheriv, createSign, generateKeyPairSync, randomUUID } from 'crypto';
import {
  AlipayPaymentProvider,
  buildSignContent,
  extractSignedNode,
  shanghaiTimestamp,
  verifyWithPublicKey,
} from '../src/payments/alipay.provider';
import { WechatPaymentProvider } from '../src/payments/wechat.provider';
import { SandboxPaymentProvider } from '../src/payments/sandbox.provider';
import { centsToYuan, normalizePem, yuanToCents } from '../src/payments/payment-provider.interface';

let pass = 0;
const fails: string[] = [];

function fmt(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 140 ? s.slice(0, 140) + '…' : s;
}

function ok(name: string, cond: boolean, detail?: unknown): void {
  const suffix = detail === undefined ? '' : ' — ' + fmt(detail);
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${suffix}`);
  } else {
    fails.push(name);
    console.log(`  FAIL  ${name}${suffix}`);
  }
}

/** 生成一对 RSA-2048 密钥 (PEM)。支付宝/微信的 RSA2/RSA2048 都是这个规格 */
function rsaKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

/** RSA-SHA256 签名 (支付宝 RSA2 与微信 SHA256-RSA2048 是同一算法) */
function rsaSign(message: string, privateKeyPem: string): string {
  const s = createSign('RSA-SHA256');
  s.update(message, 'utf8');
  s.end();
  return s.sign(privateKeyPem, 'base64');
}

/**
 * 独立实现支付宝签名串 —— 刻意不复用 provider 的 buildSignContent:
 * 复用了就只剩「同一个 bug 一起通过」。
 */
function alipaySignContent(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type')
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

/** 按微信文档加密 resource: AES-256-GCM, 密文尾部 16 字节追加 authTag */
function wechatEncrypt(plain: string, apiV3Key: string, associatedData: string) {
  const nonce = randomUUID().replace(/-/g, '').slice(0, 12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(apiV3Key, 'utf8'),
    Buffer.from(nonce, 'utf8'),
  );
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64'),
    nonce,
    associated_data: associatedData,
  };
}

async function verifyAlipay(): Promise<void> {
  console.log('\n【支付宝 RSA2】');
  // 「应用」私钥签出站请求, 「支付宝平台」私钥签回调 —— 两把钥匙模拟两个方向
  const app = rsaKeyPair();
  const platform = rsaKeyPair();
  const APP_ID = '2021000000000001';

  process.env.ALIPAY_APP_ID = APP_ID;
  process.env.ALIPAY_PRIVATE_KEY = app.privateKey;
  process.env.ALIPAY_PUBLIC_KEY = platform.publicKey; // 验回调用平台公钥, 不是应用公钥
  process.env.ALIPAY_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';

  const provider = new AlipayPaymentProvider();
  ok('三项配置齐全时视为已配置', provider.isConfigured(), provider.missingConfig());

  // ── 预下单 ──
  const intent = await provider.createIntent({
    orderId: 'o1',
    orderNo: 'HX20261021000001',
    amountCents: 693,
    subject: '货觉AI 订单 HX20261021000001',
    notifyUrl: 'https://example.com/api/v1/payments/callback/alipay',
    returnUrl: 'https://example.com/orders',
  });
  ok('预下单返回 redirect 模式', intent.mode === 'redirect' && !!intent.payUrl);

  const params: Record<string, string> = {};
  new URL(intent.payUrl!).searchParams.forEach((v, k) => {
    params[k] = v;
  });
  ok('金额按「元」两位小数传参', String(params.biz_content).includes('"total_amount":"6.93"'), params.biz_content);
  ok('声明 RSA2', params.sign_type === 'RSA2');
  const tsMs = new Date(String(params.timestamp).replace(' ', 'T') + '+08:00').getTime();
  ok(
    '时间戳为东八区且是当前时刻',
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(params.timestamp)) &&
      Math.abs(tsMs - Date.now()) < 60_000,
    params.timestamp,
  );
  ok('签名串与独立实现一致', alipaySignContent(params) === buildSignContent(params));

  // ── 回调 ──
  const cbParams: Record<string, string> = {
    app_id: APP_ID,
    out_trade_no: 'HX20261021000001',
    trade_no: '2026102122001400000000000001',
    trade_status: 'TRADE_SUCCESS',
    total_amount: '6.93',
    gmt_payment: '2026-10-21 10:20:30',
    notify_time: '2026-10-21 10:20:31',
    sign_type: 'RSA2',
  };
  cbParams.sign = rsaSign(alipaySignContent(cbParams), platform.privateKey);

  const cb = await provider.verifyCallback({ headers: {}, rawBody: '', body: { ...cbParams } });
  ok('回调验签通过', cb.ok === true, cb.reason);
  ok('金额由元换算为分', cb.amountCents === 693, cb.amountCents);
  ok(
    '订单号与交易号解析正确',
    cb.orderNo === 'HX20261021000001' && cb.tradeNo === '2026102122001400000000000001',
  );
  ok('成功回执为纯文本 success', provider.ack(cb).body === 'success');

  // 篡改金额 → 必失败 (签名覆盖 total_amount)
  const cbTampered = await provider.verifyCallback({
    headers: {},
    rawBody: '',
    body: { ...cbParams, total_amount: '0.01' },
  });
  ok('篡改金额导致验签失败', cbTampered.ok === false, cbTampered.reason);
  ok('验签失败回执为 failure (触发重试)', provider.ack(cbTampered).body === 'failure');

  // 签名正确但 app_id 是别家的 → 拒收
  const otherApp: Record<string, string> = { ...cbParams, app_id: '2021999999999999' };
  otherApp.sign = rsaSign(alipaySignContent(otherApp), platform.privateKey);
  const cbOther = await provider.verifyCallback({ headers: {}, rawBody: '', body: otherApp });
  ok('app_id 不匹配拒收', cbOther.ok === false && String(cbOther.reason).includes('app_id'), cbOther.reason);

  // 非成功交易状态: 不入账, 但回执成功让渠道停止重试
  const closed: Record<string, string> = { ...cbParams, trade_status: 'TRADE_CLOSED' };
  closed.sign = rsaSign(alipaySignContent(closed), platform.privateKey);
  const cbClosed = await provider.verifyCallback({ headers: {}, rawBody: '', body: closed });
  ok('非成功状态不入账', cbClosed.ok === false);
  ok(
    '非成功状态回执 success (停止重试)',
    cbClosed.ackSuccess === true && provider.ack(cbClosed).body === 'success',
  );

  // 缺 sign → 直接拒
  const noSign: Record<string, string> = { ...cbParams };
  delete noSign.sign;
  const cbNoSign = await provider.verifyCallback({ headers: {}, rawBody: '', body: noSign });
  ok('缺 sign 拒收', cbNoSign.ok === false && String(cbNoSign.reason).includes('sign'));

  // 金额换算边界
  ok('元→分 四舍五入', yuanToCents('6.93') === 693 && yuanToCents('0.1') === 10);
  ok('分→元 两位小数', centsToYuan(693) === '6.93' && centsToYuan(5) === '0.05');
  ok('非法金额返回 NaN', Number.isNaN(yuanToCents('abc')), yuanToCents('abc'));
  const ts = shanghaiTimestamp(new Date('2026-10-21T02:00:00Z'));
  ok('东八区时间戳按 +08:00 平移', ts === '2026-10-21 10:00:00', ts);

  // ── 退款响应的验签 (2026-10-22) ──
  /*
   * 支付宝退款响应的签名覆盖的是节点值的**原始 JSON 文本**。这里用平台私钥
   * 签一段原文, 再拼成完整响应, 验证 `extractSignedNode` 能原样截出那一段 ——
   * 若它先反序列化再 stringify 回去, 字段顺序/数字格式一变就会验签失败。
   */
  const refundNodeText =
    '{"code":"10000","msg":"Success","trade_no":"2026102122001400000000000001",' +
    '"out_trade_no":"HX20261021000001","refund_fee":"6.93"}';
  const refundSign = rsaSign(refundNodeText, platform.privateKey);
  const refundRaw = `{"alipay_trade_refund_response":${refundNodeText},"sign":"${refundSign}"}`;
  const extracted = extractSignedNode(refundRaw, 'alipay_trade_refund_response');
  ok('退款响应能截出被签名的原文', extracted === refundNodeText, extracted?.slice(0, 40));
  ok(
    '退款响应验签通过',
    Boolean(extracted) && verifyWithPublicKey(extracted!, refundSign, platform.publicKey),
  );
  ok(
    '篡改退款金额导致验签失败',
    verifyWithPublicKey(refundNodeText.replace('6.93', '0.01'), refundSign, platform.publicKey) === false,
  );
  ok('响应缺少 sign 时无法验签', verifyWithPublicKey(refundNodeText, '', platform.publicKey) === false);

  // 凭据缺失 → 明确未配置 (调用方据此返回 503, 不回落沙箱)
  delete process.env.ALIPAY_PRIVATE_KEY;
  const unconfigured = new AlipayPaymentProvider();
  ok('缺私钥时 isConfigured=false', unconfigured.isConfigured() === false, unconfigured.missingConfig());
}

/** 组装一条微信回调请求 (签名 + 加密 resource), 签名串独立实现 */
function wechatCallback(
  bodyObj: unknown,
  platformPrivateKey: string,
  opts: { timestamp?: number } = {},
): { headers: Record<string, string>; rawBody: string; body: Record<string, unknown> } {
  const rawBody = JSON.stringify(bodyObj);
  const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = randomUUID().replace(/-/g, '');
  // 微信回调签名串: 「时间戳\n随机串\n报文\n」, 覆盖原始字节
  const signature = rsaSign(`${timestamp}\n${nonce}\n${rawBody}\n`, platformPrivateKey);
  return {
    headers: {
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signature,
    },
    rawBody,
    body: bodyObj as Record<string, unknown>,
  };
}

async function verifyWechat(): Promise<void> {
  console.log('\n【微信支付 v3】');
  const mch = rsaKeyPair();
  const platform = rsaKeyPair();
  const API_V3_KEY = '0123456789abcdef0123456789abcdef'; // 32 字节

  process.env.WECHAT_MCH_ID = '1900000001';
  process.env.WECHAT_APP_ID = 'wx0000000000000001';
  process.env.WECHAT_API_V3_KEY = API_V3_KEY;
  process.env.WECHAT_SERIAL_NO = 'ABCDEF1234567890';
  // 用字面 \n 的写法, 顺带验证 normalizePem 能还原真实换行
  process.env.WECHAT_PRIVATE_KEY = mch.privateKey.replace(/\n/g, '\\n');
  process.env.WECHAT_PLATFORM_PUBLIC_KEY = platform.publicKey;

  const provider = new WechatPaymentProvider();
  ok('六项配置齐全时视为已配置', provider.isConfigured(), provider.missingConfig());
  ok('normalizePem 还原换行', normalizePem(mch.privateKey.replace(/\n/g, '\\n')).includes('\n'));

  const transaction = JSON.stringify({
    out_trade_no: 'HX20261021000002',
    transaction_id: '4200001234202610210000000001',
    trade_state: 'SUCCESS',
    success_time: '2026-10-21T10:20:30+08:00',
    amount: { total: 1299, currency: 'CNY' },
  });
  const okay = wechatCallback(
    {
      id: 'evt-1',
      event_type: 'TRANSACTION.SUCCESS',
      resource: wechatEncrypt(transaction, API_V3_KEY, 'transaction'),
    },
    platform.privateKey,
  );

  const cb = await provider.verifyCallback(okay);
  ok('回调验签 + 解密通过', cb.ok === true, cb.reason);
  ok('金额解析正确 (分)', cb.amountCents === 1299, cb.amountCents);
  ok(
    '订单号/交易号解析正确',
    cb.orderNo === 'HX20261021000002' && cb.tradeNo === '4200001234202610210000000001',
  );
  const ack = provider.ack(cb);
  ok('回执为 JSON code=SUCCESS', ack.status === 200 && JSON.parse(ack.body).code === 'SUCCESS', ack.body);

  // 篡改报文 → 签名失效 (签名覆盖 body 字节)。
  // 注意金额在密文里, 改它 rawBody 不变, 验签照样通过 —— 故改明文事件 id。
  const tamperedBody = okay.rawBody.replace('evt-1', 'evt-9');
  ok('篡改样本确实改动了报文', tamperedBody !== okay.rawBody);
  const cbTampered = await provider.verifyCallback({ ...okay, rawBody: tamperedBody });
  ok('篡改报文验签失败', cbTampered.ok === false && String(cbTampered.reason).includes('验签'), cbTampered.reason);

  // 时间窗: 6 分钟前的签名必须拒 (防重放)
  const stale = wechatCallback(okay.body, platform.privateKey, {
    timestamp: Math.floor(Date.now() / 1000) - 360,
  });
  const cbStale = await provider.verifyCallback(stale);
  ok(
    '超出 5 分钟窗口拒收',
    cbStale.ok === false && String(cbStale.reason).includes('5 分钟'),
    cbStale.reason,
  );

  // 缺签名头
  const cbNoHeader = await provider.verifyCallback({ headers: {}, rawBody: okay.rawBody, body: okay.body });
  ok('缺签名头拒收', cbNoHeader.ok === false, cbNoHeader.reason);

  /*
   * 出站响应验签 (预下单 / 退款)。
   *
   * 微信的响应体带 Wechatpay-* 三个头, 和回调是同一条规则。不验就等于
   * 无条件信任响应里的 code_url —— 中间人可以把二维码换成自己的收款码。
   * 这里用桩 fetch 喂三份响应, 断言「验签通过才解析、缺头/错签一律抛」。
   * 只验证本地判定逻辑, 不打真实 api.mch.weixin.qq.com。
   */
  const realFetch = globalThis.fetch;
  const preOrderBody = JSON.stringify({ code_url: 'weixin://wxpay/bizpayurl?pr=stub' });
  const signWechatMessage = (message: string) => rsaSign(message, platform.privateKey);
  const stubResponse = (
    body: string,
    headers: Record<string, string>,
  ): Response => new Response(body, { status: 200, headers });
  const wechatRespHeaders = (body: string, opts: { tamper?: boolean; omit?: boolean } = {}) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'stubnonce0123456789abcdef';
    // tamper: 对「另一份内容」签名 —— 签名本身合法, 但不覆盖这份 body
    const message = `${timestamp}\n${nonce}\n${opts.tamper ? body + 'x' : body}\n`;
    const headers = {
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signWechatMessage(message),
    };
    if (opts.omit) delete (headers as Record<string, string>)['wechatpay-signature'];
    return headers;
  };
  const intentInput = {
    orderId: 'o-stub',
    orderNo: 'HX20261021000003',
    amountCents: 100,
    subject: '出站验签冒烟',
    notifyUrl: 'https://example.com/api/v1/payments/callback/wechat',
    returnUrl: 'https://example.com/orders',
  };

  try {
    globalThis.fetch = (async () =>
      stubResponse(preOrderBody, wechatRespHeaders(preOrderBody))) as typeof fetch;
    const verifiedIntent = await provider.createIntent(intentInput).catch((e: Error) => e);
    ok(
      '出站响应验签通过后解析 code_url',
      !(verifiedIntent instanceof Error) && verifiedIntent.codeUrl?.includes('stub'),
      verifiedIntent instanceof Error ? verifiedIntent.message : verifiedIntent.codeUrl,
    );

    globalThis.fetch = (async () =>
      stubResponse(preOrderBody, wechatRespHeaders(preOrderBody, { tamper: true }))) as typeof fetch;
    const tampered = await provider.createIntent(intentInput).catch((e: Error) => e);
    ok(
      '出站响应签名不匹配则拒绝 (不信任 code_url)',
      tampered instanceof Error && tampered.message.includes('验签失败'),
      tampered instanceof Error ? tampered.message : '未抛错',
    );

    globalThis.fetch = (async () =>
      stubResponse(preOrderBody, wechatRespHeaders(preOrderBody, { omit: true }))) as typeof fetch;
    const noHeaders = await provider.createIntent(intentInput).catch((e: Error) => e);
    ok(
      '出站响应缺验签头则拒绝',
      noHeaders instanceof Error && noHeaders.message.includes('缺少验签头'),
      noHeaders instanceof Error ? noHeaders.message : '未抛错',
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  // 非 SUCCESS 状态: 不入账, 但回执必须成功 —— 否则关闭的交易会被推送一整天
  const closedTx = JSON.stringify({
    out_trade_no: 'HX1',
    transaction_id: 'T1',
    trade_state: 'CLOSED',
    amount: { total: 1 },
  });
  const closed = wechatCallback(
    { id: 'evt-2', resource: wechatEncrypt(closedTx, API_V3_KEY, 'transaction') },
    platform.privateKey,
  );
  const cbClosed = await provider.verifyCallback(closed);
  ok('交易非 SUCCESS 不入账', cbClosed.ok === false);
  const closedAck = provider.ack(cbClosed);
  ok(
    '交易非 SUCCESS 回执 SUCCESS (停止重试)',
    cbClosed.ackSuccess === true && closedAck.status === 200 && JSON.parse(closedAck.body).code === 'SUCCESS',
    closedAck.body,
  );

  // 回执失败 → 500 + code=FAIL (渠道会重试)
  const failAck = provider.ack({ ok: false, reason: '入账失败', raw: '' });
  ok('失败回执为 500/FAIL', failAck.status === 500 && JSON.parse(failAck.body).code === 'FAIL', failAck.body);

  // 密钥长度不对 → 报解密失败而不是静默放行
  process.env.WECHAT_API_V3_KEY = 'short-key';
  const badKey = new WechatPaymentProvider();
  const cbBadKey = await badKey.verifyCallback(okay);
  ok(
    'APIv3 密钥长度错误时报解密失败',
    cbBadKey.ok === false && String(cbBadKey.reason).includes('解密'),
    cbBadKey.reason,
  );
  process.env.WECHAT_API_V3_KEY = API_V3_KEY;
}

async function verifySandbox(): Promise<void> {
  console.log('\n【沙箱通道】');
  const sandbox = new SandboxPaymentProvider();
  const cb = await sandbox.verifyCallback({
    headers: {},
    rawBody: '{}',
    body: { orderNo: 'HX1', tradeNo: 'T1', amountCents: 100 },
  });
  ok('非生产环境接收回调', cb.ok === true && cb.amountCents === 100, cb.reason);

  const bad = await sandbox.verifyCallback({ headers: {}, rawBody: '{}', body: { orderNo: 'HX1' } });
  ok('缺交易号拒收', bad.ok === false, bad.reason);

  /*
   * 沙箱退款: 直接成功, 但**不编造**渠道退款单号 (providerRefundId 必须为空)。
   * 编一个出来会让对账以为这笔钱在渠道侧有据可查。
   */
  const refund = await sandbox.refund({
    orderNo: 'HX1',
    outRefundNo: 'rf_sandbox_1',
    amountCents: 100,
    totalCents: 100,
    reason: 'verify-payment-signatures',
  });
  ok('沙箱退款直接成功', refund.state === 'succeeded', refund.state);
  ok('沙箱不返回渠道退款单号', !refund.providerRefundId, refund.providerRefundId);

  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const prod = new SandboxPaymentProvider();
    const cbProd = await prod.verifyCallback({
      headers: {},
      rawBody: '{}',
      body: { orderNo: 'HX1', tradeNo: 'T1', amountCents: 100 },
    });
    ok(
      '生产环境拒绝沙箱回调 (防伪造支付)',
      cbProd.ok === false && String(cbProd.reason).includes('生产'),
      cbProd.reason,
    );
  } finally {
    process.env.NODE_ENV = original;
  }
}

async function main(): Promise<void> {
  await verifyAlipay();
  await verifyWechat();
  await verifySandbox();

  console.log(`\n通过 ${pass} 项`);
  if (fails.length) {
    console.error(`\n失败 ${fails.length} 项:`);
    for (const f of fails) console.error('  x ' + f);
    process.exit(1);
  }
  console.log('支付签名实现与公开规范一致 (支付宝 RSA2 / 微信 v3 AES-GCM / 生产拒收沙箱回调)');
}

void main();
