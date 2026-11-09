import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AlipayAdapter,
  isMobileUserAgent,
  signWithPrivateKey,
} from './alipay.adapter';
import type { CreateOrderInput, PaymentContext } from './types';

const { privateKey: MERCHANT_PRIVATE_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const { privateKey: ALIPAY_PRIVATE_KEY, publicKey: ALIPAY_PUBLIC_KEY } =
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

const ORDER_NO = 'HJ202611090001';
let fetchMock: ReturnType<typeof vi.fn>;

function makeConfig(): PaymentContext {
  return {
    providerId: 'alipay',
    configId: 'cfg_alipay_1',
    configVersion: 1,
    values: {
      appId: '2026000000000001',
      merchantPrivateKey: MERCHANT_PRIVATE_KEY,
      alipayPublicKey: ALIPAY_PUBLIC_KEY,
      gateway: 'https://openapi.alipay.com/gateway.do',
    },
  };
}

function createInput(
  overrides: Partial<CreateOrderInput> = {},
): CreateOrderInput {
  return {
    config: makeConfig(),
    orderId: 'order_1',
    orderNo: ORDER_NO,
    amountCents: 1005,
    currency: 'CNY',
    subject: '积分 100',
    returnUrl: 'https://app.example.com/checkout?paymentReturn=1',
    notifyUrl: 'https://api.example.com/api/v1/payments/callback/alipay/cfg_alipay_1',
    clientUserAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    expiresAt: new Date(Date.now() + 30 * 60_000),
    ...overrides,
  };
}

function gatewayResponse(
  key: 'alipay_trade_precreate_response' | 'alipay_trade_query_response',
  node: Record<string, unknown>,
) {
  const signed = JSON.stringify(node);
  const raw = JSON.stringify({
    [key]: node,
    sign: signWithPrivateKey(signed, ALIPAY_PRIVATE_KEY),
  });
  return {
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(raw),
  };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('支付宝移动端判定', () => {
  it('识别 iOS / Android / 鸿蒙，桌面浏览器保持 false', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile')).toBe(
      true,
    );
    expect(isMobileUserAgent('Mozilla/5.0 (Linux; Android 15) Mobile')).toBe(true);
    expect(isMobileUserAgent('Mozilla/5.0 (HarmonyOS 5.0)')).toBe(true);
    expect(isMobileUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe(
      false,
    );
    expect(isMobileUserAgent(undefined)).toBe(false);
  });
});

describe('AlipayAdapter.createOrder', () => {
  const adapter = new AlipayAdapter();

  it('移动端开关关闭时走手机网站支付，不调用当面付', async () => {
    const checkout = await adapter.createOrder(createInput());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(checkout.mode).toBe('redirect');
    const url = new URL(String(checkout.payUrl));
    expect(url.searchParams.get('method')).toBe('alipay.trade.wap.pay');
    expect(JSON.parse(String(url.searchParams.get('biz_content')))).toMatchObject({
      out_trade_no: ORDER_NO,
      total_amount: '10.05',
      quit_url: 'https://app.example.com/checkout?paymentReturn=1',
    });
    expect(checkout.schemeUrl).toBeUndefined();
  });

  it('移动端开关开启时调用当面付并返回 App Scheme 与动态二维码', async () => {
    const qrCode = 'https://qr.alipay.com/bax00000000000000000000';
    fetchMock.mockResolvedValueOnce(
      gatewayResponse('alipay_trade_precreate_response', {
        code: '10000',
        msg: 'Success',
        out_trade_no: ORDER_NO,
        qr_code: qrCode,
      }),
    );

    const checkout = await adapter.createOrder(
      createInput({ alipayMobilePrecreateDeepLink: true }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const params = new URLSearchParams(String(fetchMock.mock.calls[0][1].body));
    expect(params.get('method')).toBe('alipay.trade.precreate');
    expect(JSON.parse(String(params.get('biz_content')))).toMatchObject({
      out_trade_no: ORDER_NO,
      total_amount: '10.05',
    });
    expect(checkout).toMatchObject({
      mode: 'qrcode',
      codeUrl: qrCode,
      schemeUrl: `alipays://platformapi/startapp?saId=10000007&qrcode=${encodeURIComponent(qrCode)}`,
    });
    expect(checkout.payUrl).toContain('method=alipay.trade.page.pay');
  });

  it('桌面端当面付失败时回退电脑网站支付', async () => {
    fetchMock.mockResolvedValueOnce(
      gatewayResponse('alipay_trade_precreate_response', {
        code: '40004',
        msg: 'Business Failed',
        sub_code: 'ACQ.PRODUCT_NOT_OPEN',
        sub_msg: '商户未开通当面付',
      }),
    );

    const checkout = await adapter.createOrder(
      createInput({
        clientUserAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36',
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(checkout.mode).toBe('redirect');
    const url = new URL(String(checkout.payUrl));
    expect(url.searchParams.get('method')).toBe('alipay.trade.page.pay');
    expect(checkout.schemeUrl).toBeUndefined();
  });

  it('移动端开关开启但当面付不可用时直接报错，不偷换 WAP', async () => {
    fetchMock.mockResolvedValueOnce(
      gatewayResponse('alipay_trade_precreate_response', {
        code: '40004',
        msg: 'Business Failed',
        sub_code: 'ACQ.PRODUCT_NOT_OPEN',
        sub_msg: '商户未开通当面付',
      }),
    );

    await expect(
      adapter.createOrder(
        createInput({ alipayMobilePrecreateDeepLink: true }),
      ),
    ).rejects.toThrow(/商户未开通当面付/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
