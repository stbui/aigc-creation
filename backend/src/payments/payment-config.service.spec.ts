import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PaymentConfigService,
  type ResolvedPaymentConfig,
  type ResolvedVisiblePayment,
} from './payment-config.service';
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

type InstanceRow = ProviderRow & {
  instanceId: string;
  name: string | null;
  sortOrder: number;
  minAmountCents: number | null;
  maxAmountCents: number | null;
  dailyLimitCents: number | null;
  refundEnabled: boolean;
  paymentMethods: string;
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
  cursorDelegate?: {
    upsert?: (args: unknown) => Promise<{ cursor: number }>;
    updateMany?: (args: unknown) => Promise<{ count: number }>;
  };
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
    paymentRoundRobinCursor: input.cursorDelegate,
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

function instanceRow(
  providerId: PaymentProviderId,
  values: Record<string, string>,
  overrides: Partial<InstanceRow> = {},
): InstanceRow {
  return {
    ...row(providerId, values),
    instanceId: 'default',
    name: null,
    sortOrder: 0,
    minAmountCents: null,
    maxAmountCents: null,
    dailyLimitCents: null,
    refundEnabled: true,
    paymentMethods: JSON.stringify(['alipay', 'wechat']),
    ...overrides,
  };
}

function makeReserveService(input: {
  rows: InstanceRow[];
  usage?: Array<Record<string, unknown>>;
  sources?: Partial<Record<'alipay' | 'wechat', string>>;
}) {
  const cursor = {
    upsert: vi.fn().mockResolvedValue({ cursor: 1 }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma: Record<string, any> = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    paymentProviderConfig: {
      findMany: vi.fn(async () => input.rows),
      findFirst: vi.fn(async () => input.rows[0] ?? null),
    },
    payment: {
      findMany: vi.fn().mockResolvedValue(input.usage ?? []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'payment-created',
        ...data,
      })),
    },
    paymentRoundRobinCursor: cursor,
  };
  prisma.$transaction = vi.fn(
    async (work: (tx: Record<string, any>) => unknown) => work(prisma),
  );
  const settings = {
    get: vi.fn(async (key: string) => {
      if (key === 'payment.alipaySource') return input.sources?.alipay ?? 'official';
      if (key === 'payment.wechatSource') return input.sources?.wechat ?? 'unset';
      if (key === 'payment.loadBalancingStrategy') return 'round-robin';
      return null;
    }),
  };
  const cipher = { decrypt: vi.fn((cipherText: string) => cipherText) };
  const service = new PaymentConfigService(
    prisma as never,
    cipher as never,
    settings as never,
  );
  return { service, prisma, cursor, settings };
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

describe('PaymentConfigService.claimVisibleSelection', () => {
  function resolvedSelection(configs: ResolvedPaymentConfig[]): ResolvedVisiblePayment {
    return {
      method: 'alipay',
      providerId: 'alipay',
      config: configs[0],
      roundRobin: {
        providerId: 'alipay',
        method: 'alipay',
        cursor: 0,
        eligibleInstances: configs.map((config) => ({
          instanceId: config.instanceId,
          config,
        })),
      },
    };
  }

  it('用原子 upsert 领取序号并按新序号选择实例', async () => {
    const upsert = vi
      .fn()
      .mockResolvedValueOnce({ cursor: 1 })
      .mockResolvedValueOnce({ cursor: 2 });
    const { service } = makeService({
      cursorDelegate: { upsert, updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    });
    const configs = [
      { ...row('alipay', ALIPAY_VALUES), instanceId: 'instance_a' },
      { ...row('alipay', ALIPAY_VALUES, { id: 'cfg_alipay_v2' }), instanceId: 'instance_b' },
    ].map((item) => ({
      id: item.id,
      providerId: item.providerId,
      instanceId: item.instanceId,
      name: null,
      sortOrder: 0,
      version: item.version,
      enabled: true,
      closeAfterMinutes: item.closeAfterMinutes,
      minAmountCents: null,
      maxAmountCents: null,
      dailyLimitCents: null,
      refundEnabled: true,
      paymentMethods: ['alipay'] as ResolvedPaymentConfig['paymentMethods'],
      values: ALIPAY_VALUES,
    }));

    const first = await service.claimVisibleSelection(resolvedSelection([...configs]));
    const second = await service.claimVisibleSelection(first);

    expect(first.config.instanceId).toBe('instance_a');
    expect(second.config.instanceId).toBe('instance_b');
    expect(upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: { providerId: 'alipay', method: 'alipay', cursor: 1 },
        update: { cursor: { increment: 1 } },
        select: { cursor: true },
      }),
    );
  });

  it('只有当前领取仍是游标末尾时才条件回滚', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const { service } = makeService({
      cursorDelegate: {
        upsert: vi.fn().mockResolvedValue({ cursor: 2 }),
        updateMany,
      },
    });
    const config = {
      id: 'cfg_alipay_v1',
      providerId: 'alipay' as const,
      instanceId: 'instance_a',
      name: null,
      sortOrder: 0,
      version: 1,
      enabled: true,
      closeAfterMinutes: 30,
      minAmountCents: null,
      maxAmountCents: null,
      dailyLimitCents: null,
      refundEnabled: true,
      paymentMethods: ['alipay' as const],
      values: ALIPAY_VALUES,
    };

    const claimed = await service.claimVisibleSelection(resolvedSelection([config]));
    await service.releaseVisibleSelection(claimed);

    expect(updateMany).toHaveBeenCalledWith({
      where: { providerId: 'alipay', method: 'alipay', cursor: 2 },
      data: { cursor: { decrement: 1 } },
    });
  });
});

describe('PaymentConfigService.reserveVisiblePaymentAttempt', () => {
  it('在限额检查前先领取串行锁，并拒绝会突破每日限额的新支付', async () => {
    const limited = instanceRow('alipay', ALIPAY_VALUES, {
      dailyLimitCents: 1000,
    });
    const { service, prisma, cursor } = makeReserveService({
      rows: [limited],
      usage: [
        {
          id: 'pay-existing',
          orderId: 'order-existing',
          providerInstanceId: 'default',
          amountCents: 950,
          status: 'pending',
          createdAt: new Date(),
        },
      ],
    });

    await expect(
      service.reserveVisiblePaymentAttempt({
        method: 'alipay',
        currency: 'CNY',
        amountCents: 100,
        orderId: 'order-new',
        userId: 'user-new',
      }),
    ).rejects.toThrow(/每日限额/);

    expect(cursor.upsert).toHaveBeenCalledOnce();
    expect(cursor.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.payment.findMany.mock.invocationCallOrder[0],
    );
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('创建 Payment 时重新读取最新实例配置，不使用旧 resolve 快照', async () => {
    const rows = [instanceRow('alipay', ALIPAY_VALUES)];
    const { service, prisma } = makeReserveService({ rows });

    const stale = await service.resolveVisible('alipay', 'CNY', 100);
    expect(stale?.config.version).toBe(1);

    rows[0] = instanceRow('alipay', ALIPAY_VALUES, {
      id: 'cfg_alipay_v2',
      version: 2,
      dailyLimitCents: 5000,
    });

    const reserved = await service.reserveVisiblePaymentAttempt({
      method: 'alipay',
      currency: 'CNY',
      amountCents: 100,
      orderId: 'order-new',
      userId: 'user-new',
    });

    expect(reserved.resolved.config).toMatchObject({
      id: 'cfg_alipay_v2',
      version: 2,
      dailyLimitCents: 5000,
    });
    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerConfigId: 'cfg_alipay_v2',
        providerConfigVersion: 2,
      }),
    });
  });

  it('展示后支付来源被切换时拒绝旧路由并提示刷新', async () => {
    const rows = [instanceRow('alipay', ALIPAY_VALUES)];
    const { service, prisma, settings } = makeReserveService({
      rows,
      sources: { alipay: 'official' },
    });
    const stale = await service.resolveVisible('alipay', 'CNY', 100);
    expect(stale?.providerId).toBe('alipay');

    settings.get.mockImplementation(async (key: string) => {
      if (key === 'payment.alipaySource') return 'epay';
      if (key === 'payment.loadBalancingStrategy') return 'round-robin';
      return null;
    });

    await expect(
      service.reserveVisiblePaymentAttempt({
        method: 'alipay',
        currency: 'CNY',
        amountCents: 100,
        orderId: 'order-new',
        userId: 'user-new',
        resolved: stale!,
      }),
    ).rejects.toThrow(/支付来源已变更/);

    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('实例金额范围在创建支付尝试时再次校验', async () => {
    const rows = [instanceRow('alipay', ALIPAY_VALUES)];
    const { service, prisma } = makeReserveService({ rows });
    const stale = await service.resolveVisible('alipay', 'CNY', 100);
    expect(stale).not.toBeNull();

    rows[0] = instanceRow('alipay', ALIPAY_VALUES, {
      id: 'cfg_alipay_v2',
      version: 2,
      maxAmountCents: 50,
    });

    await expect(
      service.reserveVisiblePaymentAttempt({
        method: 'alipay',
        currency: 'CNY',
        amountCents: 100,
        orderId: 'order-new',
        userId: 'user-new',
        resolved: stale!,
      }),
    ).rejects.toThrow(/金额不在可支付范围/);

    expect(prisma.payment.create).not.toHaveBeenCalled();
  });
});
