import { createCipheriv, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WechatAdapter } from './wechat.adapter';
import type { CreateOrderInput, NotificationInput, PaymentContext } from './types';

const PUBLIC_KEY_ID = 'PUB_KEY_ID_TEST';
const API_V3_KEY = '0123456789abcdef0123456789abcdef';
const ORDER_NO = 'HJ202611090001';
const TRANSACTION_ID = '420000000020261109000001';

const platform = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

let fetchMock: ReturnType<typeof vi.fn>;

function makeConfig(overrides: Record<string, string> = {}): PaymentContext {
  return {
    providerId: 'wechat',
    configId: 'cfg_wechat_1',
    configVersion: 1,
    values: {
      appId: 'wx0000000000000001',
      mchId: '1900000001',
      merchantSerialNo: 'MERCHANT_SERIAL',
      merchantPrivateKey: platform.privateKey,
      apiV3Key: API_V3_KEY,
      wechatPayPublicKey: platform.publicKey,
      wechatPayPublicKeyId: PUBLIC_KEY_ID,
      apiBase: 'https://api.mch.weixin.qq.com',
      ...overrides,
    },
  };
}

function signHeaders(
  raw: string,
  options: { serial?: string; timestamp?: string } = {},
): Record<string, string> {
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString('hex');
  const message = `${timestamp}\n${nonce}\n${raw}\n`;
  const signer = createSign('RSA-SHA256');
  signer.update(message, 'utf8');
  signer.end();

  return {
    'wechatpay-timestamp': timestamp,
    'wechatpay-nonce': nonce,
    'wechatpay-signature': signer.sign(platform.privateKey, 'base64'),
    'wechatpay-serial': options.serial ?? PUBLIC_KEY_ID,
  };
}

function notificationInput(
  options: { config?: PaymentContext; serial?: string | null } = {},
): NotificationInput {
  const nonce = randomBytes(6).toString('hex');
  const associatedData = 'transaction';
  const plain = JSON.stringify({
    out_trade_no: ORDER_NO,
    transaction_id: TRANSACTION_ID,
    trade_state: 'SUCCESS',
    success_time: '2026-11-09T10:00:00+08:00',
    amount: { total: 990 },
  });
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(API_V3_KEY, 'utf8'), Buffer.from(nonce, 'utf8'));
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64');
  const body = {
    resource: {
      algorithm: 'AEAD_AES_256_GCM',
      ciphertext,
      nonce,
      associated_data: associatedData,
    },
  };
  const raw = JSON.stringify(body);
  const headers = signHeaders(raw, { serial: options.serial ?? PUBLIC_KEY_ID });
  if (options.serial === null) delete headers['wechatpay-serial'];

  return {
    config: options.config ?? makeConfig(),
    headers,
    rawBody: Buffer.from(raw, 'utf8'),
    body,
  };
}

function createOrderInput(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    config: makeConfig(),
    orderId: 'order_1',
    orderNo: ORDER_NO,
    amountCents: 990,
    currency: 'CNY',
    subject: '积分 100',
    returnUrl: 'https://app.example.com/checkout',
    notifyUrl: 'https://api.example.com/api/v1/payment/webhook/wxpay',
    expiresAt: new Date(Date.now() + 30 * 60_000),
    ...overrides,
  };
}

function signedGatewayResponse(body: unknown, serial = PUBLIC_KEY_ID): Response {
  const raw = JSON.stringify(body);
  const headers = new Headers(signHeaders(raw, { serial }));
  headers.set('Content-Type', 'application/json');
  return new Response(raw, { status: 200, headers });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WechatAdapter.verifyNotification', () => {
  const adapter = new WechatAdapter();

  it('Wechatpay-Serial 与配置公钥 ID 一致时才接受回调', async () => {
    await expect(adapter.verifyNotification(notificationInput())).resolves.toMatchObject({
      ok: true,
      eventId: TRANSACTION_ID,
      merchantOrderNo: ORDER_NO,
      providerTradeNo: TRANSACTION_ID,
      amountCents: 990,
      state: 'paid',
    });
  });

  it('未配置公钥 ID 时仍接受有效签名，但缺少 Wechatpay-Serial 仍拒绝', async () => {
    const config = makeConfig({ wechatPayPublicKeyId: '' });
    await expect(adapter.verifyNotification(notificationInput({ config }))).resolves.toMatchObject({
      ok: true,
      merchantOrderNo: ORDER_NO,
      amountCents: 990,
    });

    await expect(
      adapter.verifyNotification(notificationInput({ config, serial: null })),
    ).resolves.toMatchObject({
      ok: false,
      reason: '缺少微信回调签名头',
    });
  });

  it('未配置公钥 ID 时篡改签名仍拒绝回调', async () => {
    const input = notificationInput({ config: makeConfig({ wechatPayPublicKeyId: '' }) });
    input.headers['wechatpay-signature'] = Buffer.from('tampered').toString('base64');

    await expect(adapter.verifyNotification(input)).resolves.toMatchObject({
      ok: false,
      reason: '回调验签失败',
    });
  });

  it('缺少 Wechatpay-Serial 时拒绝回调', async () => {
    await expect(
      adapter.verifyNotification(notificationInput({ serial: null })),
    ).resolves.toMatchObject({
      ok: false,
      reason: '缺少微信回调签名头',
    });
  });

  it('Wechatpay-Serial 与配置公钥 ID 不一致时拒绝回调', async () => {
    await expect(
      adapter.verifyNotification(notificationInput({ serial: 'PUB_KEY_ID_OTHER' })),
    ).resolves.toMatchObject({
      ok: false,
      reason: '回调公钥 ID 与配置不匹配',
    });
  });
});

describe('WechatAdapter 网关响应验签', () => {
  const adapter = new WechatAdapter();

  it('响应 Wechatpay-Serial 与配置一致且签名有效时接受', async () => {
    fetchMock.mockResolvedValueOnce(
      signedGatewayResponse({ code_url: 'weixin://wxpay/bizpayurl?pr=test' }),
    );

    await expect(adapter.createOrder(createOrderInput())).resolves.toMatchObject({
      mode: 'qrcode',
      codeUrl: 'weixin://wxpay/bizpayurl?pr=test',
    });
  });

  it('未配置公钥 ID 时仍接受有效响应签名', async () => {
    fetchMock.mockResolvedValueOnce(
      signedGatewayResponse(
        { code_url: 'weixin://wxpay/bizpayurl?pr=test' },
        'UNCONFIGURED_PUB_KEY_ID',
      ),
    );

    await expect(
      adapter.createOrder(
        createOrderInput({ config: makeConfig({ wechatPayPublicKeyId: '' }) }),
      ),
    ).resolves.toMatchObject({
      mode: 'qrcode',
      codeUrl: 'weixin://wxpay/bizpayurl?pr=test',
    });
  });

  it('未配置公钥 ID 时篡改响应签名仍拒绝', async () => {
    const response = signedGatewayResponse({ code_url: 'weixin://wxpay/bizpayurl?pr=test' });
    response.headers.set('wechatpay-signature', Buffer.from('tampered').toString('base64'));
    fetchMock.mockResolvedValueOnce(response);

    await expect(
      adapter.createOrder(
        createOrderInput({ config: makeConfig({ wechatPayPublicKeyId: '' }) }),
      ),
    ).rejects.toThrow('响应验签失败');
  });

  it('响应 Wechatpay-Serial 与配置不一致时拒绝', async () => {
    fetchMock.mockResolvedValueOnce(
      signedGatewayResponse(
        { code_url: 'weixin://wxpay/bizpayurl?pr=test' },
        'PUB_KEY_ID_OTHER',
      ),
    );

    await expect(adapter.createOrder(createOrderInput())).rejects.toThrow(
      '微信预下单响应公钥 ID 与配置不匹配',
    );
  });
});

describe('WechatAdapter.refund', () => {
  const adapter = new WechatAdapter();

  it('渠道退款关闭时标记为渠道明确失败', async () => {
    fetchMock.mockResolvedValueOnce(
      signedGatewayResponse({ refund_id: '503000000020261109000001', status: 'CLOSED' }),
    );

    await expect(
      adapter.refund({
        config: makeConfig(),
        orderNo: ORDER_NO,
        outRefundNo: 'RF202611090001',
        amountCents: 990,
        totalCents: 990,
        providerTradeNo: TRANSACTION_ID,
      }),
    ).resolves.toMatchObject({
      state: 'failed',
      failureKind: 'definitive',
      providerRefundId: '503000000020261109000001',
    });
  });

  it('网络异常时保留 unknown，要求同号重试或核对渠道', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket timeout'));

    await expect(
      adapter.refund({
        config: makeConfig(),
        orderNo: ORDER_NO,
        outRefundNo: 'RF202611090002',
        amountCents: 990,
        totalCents: 990,
        providerTradeNo: TRANSACTION_ID,
      }),
    ).resolves.toMatchObject({
      state: 'failed',
      failureKind: 'unknown',
      error: expect.stringContaining('同一退款单号'),
    });
  });
});
