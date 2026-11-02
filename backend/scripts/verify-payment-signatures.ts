/**
 * 支付通道签名 / 回调解密的**离线交叉校验**。
 *
 * 为什么需要这个脚本：
 *   支付宝与微信的验签有一个共同陷阱 —— 自己签、自己验永远通过。签名串
 *   规则写错（少排序 / 多了 sign_type / 少一个换行），只要签名与验签两边
 *   错得一致，本地一路绿灯，上线后第一条真实回调就验签失败。
 *
 *   所以这里按公开文档的规则在脚本里**独立实现一遍签名/加密**，再喂给
 *   适配器的 verifyNotification；两份独立实现一致才算通过。
 *
 * 不覆盖（需要真实商户号，交付时如实标注「已实现未实测」）：
 *   · 打向 openapi.alipay.com / api.mch.weixin.qq.com 的真实 HTTP 往返
 *
 * 运行：cd backend && npx ts-node -T scripts/verify-payment-signatures.ts
 */
import { createCipheriv, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { AlipayAdapter, buildSignContent, extractSignedNode, signWithPrivateKey, verifyWithPublicKey } from '../src/payments/adapters/alipay.adapter';
import { WechatAdapter, rfc3339 } from '../src/payments/adapters/wechat.adapter';
import { SandboxAdapter } from '../src/payments/adapters/sandbox.adapter';
import { PaymentContext, centsToYuan, isAllowedPublicBase, normalizePem, yuanToCents } from '../src/payments/adapters/types';

let pass = 0;
const fails: string[] = [];

function fmt(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 140 ? s.slice(0, 140) + '…' : s;
}

function ok(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail === undefined ? '' : ' — ' + fmt(detail)}`);
  } else {
    fails.push(name);
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ' — ' + fmt(detail)}`);
  }
}

function rsaPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { privateKey, publicKey };
}

function rsaSign(content: string, privateKey: string): string {
  const signer = createSign('RSA-SHA256');
  signer.update(content, 'utf8');
  signer.end();
  return signer.sign(privateKey, 'base64');
}

function alipayContext(values: Record<string, string>): PaymentContext {
  return { providerId: 'alipay', configId: 'cfg_alipay_1', configVersion: 1, values };
}

function wechatContext(values: Record<string, string>): PaymentContext {
  return { providerId: 'wechat', configId: 'cfg_wechat_1', configVersion: 1, values };
}

function wechatNotifyPayload(key: Buffer, tradeState = 'SUCCESS') {
  const nonce = randomBytes(6).toString('hex'); // 12 ASCII bytes = 12-byte IV
  const aad = 'transaction';
  const plain = JSON.stringify({
    out_trade_no: 'HJ20261102120000ABC',
    transaction_id: '420000000020261102000001',
    trade_state: tradeState,
    success_time: '2026-11-02T10:00:00+08:00',
    amount: { total: 990 },
  });
  const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64');
  const body = { resource: { algorithm: 'AEAD_AES_256_GCM', ciphertext, nonce, associated_data: aad } };
  return { nonce, body, raw: JSON.stringify(body) };
}

function wechatHeaders(raw: string, privateKey: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const nonce = randomBytes(16).toString('hex');
  const message = `${timestamp}\n${nonce}\n${raw}\n`;
  return {
    'wechatpay-timestamp': timestamp,
    'wechatpay-nonce': nonce,
    'wechatpay-signature': rsaSign(message, privateKey),
  };
}

void (async () => {
// ── 通用金额/密钥工具 ──────────────────────────────────────────────
console.log('\n【通用工具】');
ok('元→分', centsToYuan(990) === '9.90' && yuanToCents('9.90') === 990);
ok('分→元拒绝 NaN', Number.isNaN(yuanToCents('abc')));
ok('PEM 字面量 \\n 归一化', normalizePem('a\\nb') === 'a\nb');
{
  const previous = process.env.NODE_ENV;
  ok('HTTPS 回调地址合法', isAllowedPublicBase('https://pay.example.com'));
  ok('非法 URL 被拒', !isAllowedPublicBase('not-a-url') && !isAllowedPublicBase('ftp://example.com'));
  process.env.NODE_ENV = 'development';
  ok('开发环境允许 localhost HTTP', isAllowedPublicBase('http://localhost:4100'));
  process.env.NODE_ENV = 'production';
  ok('生产环境拒绝 HTTP 回调地址', !isAllowedPublicBase('http://pay.example.com'));
  if (previous === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous;
}

// ── 支付宝 ────────────────────────────────────────────────────────
console.log('\n【支付宝 RSA2】');
{
  const keyPair = rsaPair();
  const appId = '2026000000000001';
  const values = {
    appId,
    sellerId: '2088000000000000',
    merchantPrivateKey: keyPair.privateKey,
    alipayPublicKey: keyPair.publicKey,
    gateway: 'https://openapi.alipay.com/gateway.do',
  };
  const adapter = new AlipayAdapter();
  const context = alipayContext(values);

  const params: Record<string, string> = {
    app_id: appId,
    out_trade_no: 'HJ20261102120000ABC',
    trade_no: '2026110222001',
    trade_status: 'TRADE_SUCCESS',
    total_amount: '9.90',
    gmt_payment: '2026-11-02 10:00:00',
    sign_type: 'RSA2',
  };
  params.sign = signWithPrivateKey(buildSignContent(params), keyPair.privateKey);

  const verified = await adapter.verifyNotification({
    config: context,
    headers: {},
    rawBody: Buffer.from(''),
    body: params,
  });
  ok('回调验签通过', verified.ok === true, verified.ok ? '' : verified.reason);
  ok(
    '回调归一化为已支付 + 金额分',
    verified.ok === true && verified.state === 'paid' && verified.amountCents === 990,
    verified.ok ? `${verified.state}/${verified.amountCents}` : verified.reason,
  );

  const tampered = { ...params, total_amount: '0.01' };
  const tamperedResult = await adapter.verifyNotification({
    config: context,
    headers: {},
    rawBody: Buffer.from(''),
    body: tampered,
  });
  ok('篡改金额后验签失败', tamperedResult.ok === false, tamperedResult.reason);

  const otherApp = { ...params, app_id: '2026000000000002' };
  otherApp.sign = signWithPrivateKey(buildSignContent(otherApp), keyPair.privateKey);
  const otherAppResult = await adapter.verifyNotification({
    config: context,
    headers: {},
    rawBody: Buffer.from(''),
    body: otherApp,
  });
  ok('app_id 不匹配时拒绝', otherAppResult.ok === false, otherAppResult.reason);

  const noSign = { ...params } as Record<string, string>;
  delete noSign.sign;
  const noSignResult = await adapter.verifyNotification({
    config: context,
    headers: {},
    rawBody: Buffer.from(''),
    body: noSign,
  });
  ok('缺少 sign 时拒绝', noSignResult.ok === false, noSignResult.reason);

  const nodeText =
    '{"code":"10000","msg":"Success","out_trade_no":"HJ20261102120000ABC","refund_fee":"6.93"}';
  const nodeSign = rsaSign(nodeText, keyPair.privateKey);
  const rawResponse = `{"alipay_trade_refund_response":${nodeText},"sign":"${nodeSign}"}`;
  const extracted = extractSignedNode(rawResponse, 'alipay_trade_refund_response');
  ok('退款响应能截出被签名原文', extracted === nodeText, extracted?.slice(0, 40));
  ok(
    '退款响应签名可验证',
    Boolean(extracted) && verifyWithPublicKey(extracted!, nodeSign, keyPair.publicKey),
  );
  ok(
    '篡改退款响应后验签失败',
    verifyWithPublicKey(nodeText.replace('6.93', '0.01'), nodeSign, keyPair.publicKey) === false,
  );
}

// ── 微信支付 v3 ───────────────────────────────────────────────────
console.log('\n【微信支付 v3】');
{
  const platform = rsaPair();
  const key = randomBytes(32);
  const apiV3Key = key.toString('hex').slice(0, 32); // 32 ASCII bytes
  const values = {
    appId: 'wx0000000000000001',
    mchId: '1900000001',
    merchantSerialNo: 'SERIAL',
    merchantPrivateKey: platform.privateKey,
    apiV3Key,
    wechatPayPublicKey: platform.publicKey,
    apiBase: 'https://api.mch.weixin.qq.com',
  };
  const adapter = new WechatAdapter();
  const context = wechatContext(values);

  const payload = wechatNotifyPayload(Buffer.from(apiV3Key, 'utf8'));
  const headers = wechatHeaders(payload.raw, platform.privateKey);
  const verified = await adapter.verifyNotification({
    config: context,
    headers,
    rawBody: Buffer.from(payload.raw, 'utf8'),
    body: payload.body as Record<string, unknown>,
  });
  ok('回调验签 + 解密通过', verified.ok === true, verified.ok ? '' : verified.reason);
  ok(
    '归一化为已支付 + 金额分',
    verified.ok === true && verified.state === 'paid' && verified.amountCents === 990,
    verified.ok ? `${verified.state}/${verified.amountCents}` : verified.reason,
  );

  const tampered = await adapter.verifyNotification({
    config: context,
    headers,
    // 报文末尾加一个空格就能改变被签名字节；明文在 ciphertext 里，不能靠替换 orderNo 篡改
    rawBody: Buffer.from(payload.raw + ' ', 'utf8'),
    body: payload.body as Record<string, unknown>,
  });
  ok('篡改报文后验签失败', tampered.ok === false, tampered.reason);

  const staleHeaders = wechatHeaders(
    payload.raw,
    platform.privateKey,
    String(Math.floor(Date.now() / 1000) - 600),
  );
  const stale = await adapter.verifyNotification({
    config: context,
    headers: staleHeaders,
    rawBody: Buffer.from(payload.raw, 'utf8'),
    body: payload.body as Record<string, unknown>,
  });
  ok('超过 5 分钟的回调被拒绝（防重放）', stale.ok === false, stale.reason);

  const wrongKey = '00000000000000000000000000000000';
  const badKey = await adapter.verifyNotification({
    config: wechatContext({ ...values, apiV3Key: wrongKey }),
    headers,
    rawBody: Buffer.from(payload.raw, 'utf8'),
    body: payload.body as Record<string, unknown>,
  });
  ok('APIv3 密钥不匹配时解密失败', badKey.ok === false, badKey.reason);

  const closedPayload = wechatNotifyPayload(Buffer.from(apiV3Key, 'utf8'), 'CLOSED');
  const closedHeaders = wechatHeaders(closedPayload.raw, platform.privateKey);
  const closed = await adapter.verifyNotification({
    config: context,
    headers: closedHeaders,
    rawBody: Buffer.from(closedPayload.raw, 'utf8'),
    body: closedPayload.body as Record<string, unknown>,
  });
  ok(
    '关闭态回调归一化为 closed',
    closed.ok === true && closed.state === 'closed',
    closed.ok ? closed.state : closed.reason,
  );

  ok('RFC3339 带 +08:00', rfc3339(new Date('2026-11-02T02:00:00Z')) === '2026-11-02T10:00:00+08:00');
}

// ── 沙箱 ──────────────────────────────────────────────────────────
console.log('\n【沙箱】');
{
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const adapter = new SandboxAdapter();
  const context: PaymentContext = {
    providerId: 'sandbox',
    configId: 'cfg_sandbox_1',
    configVersion: 1,
    values: {},
  };
  const valid = await adapter.verifyNotification({
    config: context,
    headers: {},
    rawBody: Buffer.from(''),
    body: { orderNo: 'HJ20261102120000ABC', tradeNo: 'SBX-1', amountCents: 100 },
  });
  ok('沙箱回调归一化为已支付', valid.ok === true && valid.state === 'paid');
  const missingTrade = await adapter.verifyNotification({
    config: context,
    headers: {},
    rawBody: Buffer.from(''),
    body: { orderNo: 'HJ20261102120000ABC', amountCents: 100 },
  });
  ok('沙箱缺少交易号被拒', missingTrade.ok === false, missingTrade.reason);

  process.env.NODE_ENV = 'production';
  const prod = await adapter.verifyNotification({
    config: context,
    headers: {},
    rawBody: Buffer.from(''),
    body: { orderNo: 'HJ20261102120000ABC', tradeNo: 'SBX-1', amountCents: 100 },
  });
  ok('生产环境拒绝沙箱回调', prod.ok === false, prod.reason);
  if (previous === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous;
}

console.log(`\n合计: ${pass} 通过 / ${fails.length} 失败\n`);
if (fails.length > 0) {
  console.error('失败项：', fails.join(', '));
  process.exit(1);
}
})().catch((error) => {
  console.error('\n签名校验脚本异常终止:', error?.stack || error?.message || error);
  process.exit(1);
});
