import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentConfigService } from './payment-config.service';
import type { PaymentProviderId } from './adapters/types';

type ProviderRow = {
  id: string;
  providerId: PaymentProviderId;
  version: number;
  enabled: boolean;
  closeAfterMinutes: number;
  configCipher: string;
  configDigest: string;
  createdAt: Date;
};

const ALIPAY_VALUES = {
  appId: '2026000000000001',
  merchantPrivateKey: '-----BEGIN PRIVATE KEY-----\napp\n-----END PRIVATE KEY-----',
  alipayPublicKey: '-----BEGIN PUBLIC KEY-----\nalipay\n-----END PUBLIC KEY-----',
};

const WECHAT_VALUES = {
  appId: 'wx-app-id',
  mchId: '1900000001',
  merchantSerialNo: 'SERIAL-001',
  merchantPrivateKey: '-----BEGIN PRIVATE KEY-----\nmerchant\n-----END PRIVATE KEY-----',
  apiV3Key: '12345678901234567890123456789012',
  wechatPayPublicKey: '-----BEGIN PUBLIC KEY-----\nwechat\n-----END PUBLIC KEY-----',
  wechatPayPublicKeyId: 'PUB_KEY_ID_0000000000000000000000000000000000000000000000000000000000000000',
};

const EPAY_VALUES = {
  apiBase: 'https://epay.example.com',
  mchId: 'epay-merchant',
  key: 'epay-secret',
};

const originalNotifyBase = process.env.PAYMENT_NOTIFY_BASE;

function row(
  providerId: PaymentProviderId,
  values: Record<string, string>,
  overrides: Partial<ProviderRow> = {},
): ProviderRow {
  return {
    id: `cfg_${providerId}_v1`,
    providerId,
    version: 1,
    enabled: true,
    closeAfterMinutes: 30,
    configCipher: JSON.stringify(values),
    configDigest: `digest_${providerId}`,
    createdAt: new Date('2026-11-09T00:00:00.000Z'),
    ...overrides,
  };
}

function makeService(input: {
  sources?: Partial<Record<'alipay' | 'wechat', string>>;
  rows?: Partial<Record<PaymentProviderId, ProviderRow>>;
  decrypt?: (cipherText: string) => string;
}) {
  const prisma = {
    paymentProviderConfig: {
      findFirst: vi.fn(async ({ where }: { where: { providerId: PaymentProviderId } }) =>
        input.rows?.[where.providerId] ?? null,
      ),
    },
    order: {
      count: vi.fn().mockResolvedValue(0),
    },
  };
  const cipher = {
    decrypt: vi.fn((cipherText: string) =>
      input.decrypt ? input.decrypt(cipherText) : cipherText,
    ),
  };
  const settings = {
    get: vi.fn(async (key: string) => {
      if (key === 'payment.alipaySource') return input.sources?.alipay ?? 'unset';
      if (key === 'payment.wechatSource') return input.sources?.wechat ?? 'unset';
      return null;
    }),
  };
  const service = new PaymentConfigService(
    prisma as never,
    cipher as never,
    settings as never,
  );
  return { service, prisma, cipher, settings };
}

beforeEach(() => {
  process.env.PAYMENT_NOTIFY_BASE = 'https://pay.example.com';
});

afterEach(() => {
  if (originalNotifyBase === undefined) {
    delete process.env.PAYMENT_NOTIFY_BASE;
  } else {
    process.env.PAYMENT_NOTIFY_BASE = originalNotifyBase;
  }
});

describe('PaymentConfigService.resolveVisible', () => {
  it('管理员未选择来源时返回 null，不自动回退到任何已配置渠道', async () => {
    const { service, prisma } = makeService({
      rows: {
        alipay: row('alipay', ALIPAY_VALUES),
        epay: row('epay', EPAY_VALUES),
      },
    });

    await expect(service.resolveVisible('alipay', 'CNY')).resolves.toBeNull();
    expect(prisma.paymentProviderConfig.findFirst).not.toHaveBeenCalled();
  });

  it('官方来源只解析对应官方适配器', async () => {
    const { service } = makeService({
      sources: { alipay: 'official', wechat: 'official' },
      rows: {
        alipay: row('alipay', ALIPAY_VALUES),
        wechat: row('wechat', WECHAT_VALUES),
        epay: row('epay', EPAY_VALUES),
      },
    });

    await expect(service.resolveVisible('alipay', 'CNY')).resolves.toMatchObject({
      method: 'alipay',
      providerId: 'alipay',
      config: { id: 'cfg_alipay_v1', providerId: 'alipay' },
    });
    await expect(service.resolveVisible('wechat', 'CNY')).resolves.toMatchObject({
      method: 'wechat',
      providerId: 'wechat',
      config: { id: 'cfg_wechat_v1', providerId: 'wechat' },
    });
  });

  it('易支付来源解析为 epay，并固化可见支付方式', async () => {
    const { service } = makeService({
      sources: { alipay: 'epay', wechat: 'epay' },
      rows: { epay: row('epay', EPAY_VALUES) },
    });

    await expect(service.resolveVisible('alipay', 'CNY')).resolves.toMatchObject({
      method: 'alipay',
      providerId: 'epay',
      providerMethod: 'alipay',
    });
    await expect(service.resolveVisible('wechat', 'CNY')).resolves.toMatchObject({
      method: 'wechat',
      providerId: 'epay',
      providerMethod: 'wechat',
    });
  });

  it('渠道停用、必填项缺失、币种不支持时隐藏', async () => {
    const disabled = makeService({
      sources: { alipay: 'official' },
      rows: { alipay: row('alipay', ALIPAY_VALUES, { enabled: false }) },
    });
    await expect(disabled.service.resolveVisible('alipay', 'CNY')).resolves.toBeNull();

    const incomplete = makeService({
      sources: { alipay: 'official' },
      rows: { alipay: row('alipay', { appId: 'only-app-id' }) },
    });
    await expect(incomplete.service.resolveVisible('alipay', 'CNY')).resolves.toBeNull();

    const wrongCurrency = makeService({
      sources: { alipay: 'official' },
      rows: { alipay: row('alipay', ALIPAY_VALUES) },
    });
    await expect(wrongCurrency.service.resolveVisible('alipay', 'USD')).resolves.toBeNull();
  });

  it('配置解密失败时只隐藏当前方式，不向列表抛错', async () => {
    const { service } = makeService({
      sources: { alipay: 'official' },
      rows: { alipay: row('alipay', ALIPAY_VALUES) },
      decrypt: () => {
        throw new Error('bad key');
      },
    });

    await expect(service.resolveVisible('alipay', 'CNY')).resolves.toBeNull();
  });

  it('后台同款 danger 告警会阻止前台暴露按钮', async () => {
    delete process.env.PAYMENT_NOTIFY_BASE;
    const { service } = makeService({
      sources: { alipay: 'official' },
      rows: { alipay: row('alipay', ALIPAY_VALUES) },
    });

    await expect(service.resolveVisible('alipay', 'CNY')).resolves.toBeNull();
  });

  it('非法来源值按 unset 处理', async () => {
    const { service } = makeService({
      sources: { alipay: 'unknown' },
      rows: { alipay: row('alipay', ALIPAY_VALUES) },
    });

    await expect(service.resolveVisible('alipay', 'CNY')).resolves.toBeNull();
  });
});

describe('PaymentConfigService.availableVisible', () => {
  it('只返回固定顺序的支付宝/微信，不暴露真实渠道名', async () => {
    const { service } = makeService({
      sources: { alipay: 'epay', wechat: 'official' },
      rows: {
        epay: row('epay', EPAY_VALUES),
        wechat: row('wechat', WECHAT_VALUES),
      },
    });

    const visible = await service.availableVisible('CNY');

    expect(visible.map((item) => item.id)).toEqual(['alipay', 'wechat']);
    expect(visible.map((item) => item.name)).toEqual(['支付宝', '微信支付']);
    expect(visible.every((item) => item.sandbox === false)).toBe(true);
    expect(visible.some((item) => (item.id as string) === 'epay')).toBe(false);
  });

  it('任一方式未选择或来源不可用时只隐藏该项', async () => {
    const { service } = makeService({
      sources: { alipay: 'unset', wechat: 'official' },
      rows: { wechat: row('wechat', WECHAT_VALUES) },
    });

    const visible = await service.availableVisible('CNY');

    expect(visible.map((item) => item.id)).toEqual(['wechat']);
  });
});
