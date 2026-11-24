import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { requireAdapter, allAdapters, getAdapter } from './adapters';
import {
  VISIBLE_PAYMENT_METHODS,
  type PaymentAdapterDescriptor,
  type PaymentProviderId,
  type VisiblePaymentMethod,
} from './adapters/types';
import { PaymentConfigStore } from './payment-config-store';
import type {
  AdminPaymentProviderInstanceView,
  AdminPaymentProviderView,
  SavePaymentInstanceInput,
} from './payment-config.types';
import {
  compareInstanceRows,
  defaultPaymentMethods,
  digestOfConfig,
  normalizeName,
  paymentMethodsOf,
} from './payment-config.util';
import { paymentConfigWarnings } from './payment-config-warning';

/**
 * 后台配置平面：版本化保存、实例视图与 env 首启引导。
 *
 * 面向 `/admin/payments` 的渠道卡片，不处理 HTTP（控制器在 `src/admin/payments/`）。
 * 不可动摇的两条：**追加写**（每次保存新增版本，旧订单继续用旧密文验签）、
 * **密钥只进密文**（响应只回 `secretConfigured`）。
 */
@Injectable()
export class PaymentConfigAdminService {
  private readonly logger = new Logger(PaymentConfigAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly store: PaymentConfigStore,
  ) {}

  /** 后台列表：每个渠道一张卡，卡内包含全部实例。 */
  async listAdmin(): Promise<AdminPaymentProviderView[]> {
    const views: AdminPaymentProviderView[] = [];
    for (const adapter of allAdapters()) {
      views.push(await this.toAdminProviderView(adapter.descriptor));
    }
    return views;
  }

  /** 新建实例；instanceId 只能由服务端生成。 */
  async createInstance(
    providerId: string,
    input: Partial<SavePaymentInstanceInput>,
    actorId: string,
  ): Promise<AdminPaymentProviderInstanceView> {
    const adapter = requireAdapterOrThrow(providerId);

    const rows = await this.store.latestRowsByInstance(adapter.descriptor.id);
    const instanceId = `pi_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const sortOrder = rows.reduce((max, row) => Math.max(max, row.sortOrder), -10) + 10;
    const defaults = defaultPaymentMethods(adapter.descriptor.id);
    const paymentMethods = this.normalizePaymentMethods(
      adapter.descriptor.id,
      input.paymentMethods ?? defaults,
    );
    const values = input.values ?? {};
    const enabled = Boolean(input.enabled);
    if (enabled) {
      const missing = adapter.validateConfig(values);
      if (missing.length > 0) {
        throw new AppError(40001, `实例启用前必须补齐字段: ${missing.join(', ')}`, 400);
      }
    }
    this.validateInstanceInput({
      closeAfterMinutes: input.closeAfterMinutes ?? 30,
      minAmountCents: input.minAmountCents ?? null,
      maxAmountCents: input.maxAmountCents ?? null,
      dailyLimitCents: input.dailyLimitCents ?? null,
    });

    const row = await this.prisma.paymentProviderConfig.create({
      data: {
        providerId: adapter.descriptor.id,
        instanceId,
        name: normalizeName(input.name),
        sortOrder,
        version: 1,
        enabled,
        closeAfterMinutes: input.closeAfterMinutes ?? 30,
        minAmountCents: input.minAmountCents ?? null,
        maxAmountCents: input.maxAmountCents ?? null,
        dailyLimitCents: input.dailyLimitCents ?? null,
        refundEnabled: input.refundEnabled ?? true,
        paymentMethods: JSON.stringify(paymentMethods),
        configCipher: this.store.sealConfig(values),
        configDigest: digestOfConfig(
          adapter.descriptor.id,
          instanceId,
          enabled,
          input.closeAfterMinutes ?? 30,
          input.minAmountCents ?? null,
          input.maxAmountCents ?? null,
          input.dailyLimitCents ?? null,
          input.refundEnabled ?? true,
          paymentMethods,
          normalizeName(input.name),
          sortOrder,
          values,
        ),
        createdBy: actorId,
      },
    });
    return this.toAdminInstanceView(adapter.descriptor, row);
  }

  /** 指定实例保存新版本。 */
  async saveInstanceVersion(
    providerId: string,
    instanceId: string,
    input: {
      enabled: boolean;
      closeAfterMinutes: number;
      values: Record<string, string>;
      name?: string | null;
      minAmountCents?: number | null;
      maxAmountCents?: number | null;
      dailyLimitCents?: number | null;
      refundEnabled?: boolean;
      paymentMethods?: VisiblePaymentMethod[];
    },
    actorId: string,
  ): Promise<{ provider: AdminPaymentProviderView; unchanged: boolean }> {
    const adapter = requireAdapterOrThrow(providerId);

    const current = await this.store.latestRow(adapter.descriptor.id, instanceId);
    if (!current && instanceId !== 'default') {
      throw new AppError(40400, `支付实例不存在: ${instanceId}`, 404);
    }
    const previous = current ? this.store.valuesFor(current) : {};

    // 未提交的 secret 沿用上一版；显式空串同样视为沿用。
    const merged: Record<string, string> = { ...previous };
    for (const field of adapter.descriptor.configFields) {
      const raw = input.values[field.name];
      if (raw === undefined) continue;
      if (field.secret && raw.trim() === '') continue;
      merged[field.name] = String(raw);
    }

    const locked = await this.store.identityLockedFields(adapter.descriptor, instanceId);
    for (const name of locked) {
      if (merged[name] !== previous[name]) {
        throw new AppError(40001, `字段 ${name} 已有订单绑定，不能修改`, 400);
      }
    }

    const missing = adapter.validateConfig(merged);
    if (input.enabled && missing.length > 0) {
      throw new AppError(40001, `实例启用前必须补齐字段: ${missing.join(', ')}`, 400);
    }
    this.validateInstanceInput({
      closeAfterMinutes: input.closeAfterMinutes,
      minAmountCents: input.minAmountCents ?? null,
      maxAmountCents: input.maxAmountCents ?? null,
      dailyLimitCents: input.dailyLimitCents ?? null,
    });

    const name = input.name === undefined ? (current?.name ?? null) : normalizeName(input.name);
    const sortOrder = current?.sortOrder ?? 0;
    const minAmountCents =
      input.minAmountCents === undefined ? (current?.minAmountCents ?? null) : input.minAmountCents;
    const maxAmountCents =
      input.maxAmountCents === undefined ? (current?.maxAmountCents ?? null) : input.maxAmountCents;
    const dailyLimitCents =
      input.dailyLimitCents === undefined
        ? (current?.dailyLimitCents ?? null)
        : input.dailyLimitCents;
    const refundEnabled = input.refundEnabled ?? current?.refundEnabled ?? true;
    const paymentMethods = this.normalizePaymentMethods(
      adapter.descriptor.id,
      input.paymentMethods ??
        (current
          ? paymentMethodsOf(current, adapter.descriptor.id)
          : defaultPaymentMethods(adapter.descriptor.id)),
    );

    const digest = digestOfConfig(
      adapter.descriptor.id,
      instanceId,
      input.enabled,
      input.closeAfterMinutes,
      minAmountCents,
      maxAmountCents,
      dailyLimitCents,
      refundEnabled,
      paymentMethods,
      name,
      sortOrder,
      merged,
    );
    if (current && current.configDigest === digest) {
      return {
        provider: await this.toAdminProviderView(adapter.descriptor),
        unchanged: true,
      };
    }

    const version = (current?.version ?? 0) + 1;
    await this.prisma.paymentProviderConfig.create({
      data: {
        providerId: adapter.descriptor.id,
        instanceId,
        name,
        sortOrder,
        version,
        enabled: input.enabled,
        closeAfterMinutes: input.closeAfterMinutes,
        minAmountCents,
        maxAmountCents,
        dailyLimitCents,
        refundEnabled,
        paymentMethods: JSON.stringify(paymentMethods),
        configCipher: this.store.sealConfig(merged),
        configDigest: digest,
        createdBy: actorId,
      },
    });
    this.logger.log(
      `支付实例配置新版本: ${adapter.descriptor.id}/${instanceId} v${version} by ${actorId}`,
    );
    return {
      provider: await this.toAdminProviderView(adapter.descriptor),
      unchanged: false,
    };
  }

  /** 拖拽排序只改最新行的展示顺序，不改凭据/版本链。 */
  async reorderInstances(
    providerId: string,
    instanceIds: string[],
    _actorId: string,
  ): Promise<AdminPaymentProviderView> {
    const adapter = requireAdapterOrThrow(providerId);
    const current = await this.store.latestRowsByInstance(adapter.descriptor.id);
    const known = new Set(current.map((row) => row.instanceId));
    if (
      instanceIds.length !== known.size ||
      new Set(instanceIds).size !== instanceIds.length ||
      instanceIds.some((id) => !known.has(id))
    ) {
      throw new AppError(40001, '实例排序列表必须恰好包含当前渠道全部实例', 400);
    }
    await this.prisma.$transaction(
      instanceIds.map((instanceId, index) =>
        this.prisma.paymentProviderConfig.updateMany({
          where: { providerId: adapter.descriptor.id, instanceId },
          data: { sortOrder: (index + 1) * 10 },
        }),
      ),
    );
    return this.toAdminProviderView(adapter.descriptor);
  }

  /** env → v1；仅当库内完全没有该渠道配置时生效。 */
  async bootstrapFromEnv(): Promise<void> {
    const get = (key: string): string => this.config.get<string>(key) ?? '';
    const epayType = get('payment.epay.type') || '2';
    const seeds: Array<{ id: PaymentProviderId; values: Record<string, string> }> = [
      { id: 'sandbox', values: {} },
      {
        id: 'alipay',
        values: {
          appId: get('payment.alipay.appId'),
          sellerId: get('payment.alipay.sellerId'),
          merchantPrivateKey: get('payment.alipay.privateKey'),
          alipayPublicKey: get('payment.alipay.publicKey'),
          gateway: get('payment.alipay.gateway'),
        },
      },
      {
        id: 'wechat',
        values: {
          appId: get('payment.wechat.appId'),
          mchId: get('payment.wechat.mchId'),
          merchantSerialNo: get('payment.wechat.serialNo'),
          merchantPrivateKey: get('payment.wechat.privateKey'),
          apiV3Key: get('payment.wechat.apiV3Key'),
          wechatPayPublicKey: get('payment.wechat.platformPublicKey'),
          wechatPayPublicKeyId: get('payment.wechat.platformPublicKeyId'),
          apiBase: get('payment.wechat.apiBase'),
        },
      },
      {
        id: 'paypal',
        values: {
          clientId: get('payment.paypal.clientId'),
          clientSecret: get('payment.paypal.clientSecret'),
          webhookId: get('payment.paypal.webhookId'),
          apiBase: get('payment.paypal.apiBase'),
        },
      },
      {
        id: 'stripe',
        values: {
          secretKey: get('payment.stripe.secretKey'),
          publishableKey: get('payment.stripe.publishableKey'),
          webhookSecret: get('payment.stripe.webhookSecret'),
          apiBase: get('payment.stripe.apiBase'),
        },
      },
      {
        id: 'epay',
        values: {
          apiBase: get('payment.epay.apiBase') || 'https://epay.jylt.cc',
          mchId: get('payment.epay.mchId'),
          key: get('payment.epay.key'),
          type: epayType,
        },
      },
      {
        id: 'zpay',
        values: {
          apiBase: get('payment.zpay.apiBase') || 'https://zpayz.cn',
          pid: get('payment.zpay.pid'),
          key: get('payment.zpay.key'),
          type: get('payment.zpay.type') || 'alipay',
          cid: get('payment.zpay.cid'),
        },
      },
    ];

    for (const seed of seeds) {
      const exists = await this.prisma.paymentProviderConfig.findFirst({
        where: { providerId: seed.id },
        select: { id: true },
      });
      if (exists) continue;

      const adapter = requireAdapter(seed.id);
      const values = Object.fromEntries(Object.entries(seed.values).filter(([, v]) => v !== ''));
      const complete = adapter.validateConfig(values).length === 0;
      const enabled =
        seed.id === 'sandbox' ? this.config.get<string>('app.env') !== 'production' : complete;
      const paymentMethods = defaultPaymentMethods(seed.id);
      await this.prisma.paymentProviderConfig.create({
        data: {
          providerId: seed.id,
          instanceId: 'default',
          name: null,
          sortOrder: 0,
          version: 1,
          enabled,
          closeAfterMinutes: 30,
          minAmountCents: null,
          maxAmountCents: null,
          dailyLimitCents: null,
          refundEnabled: true,
          paymentMethods: JSON.stringify(paymentMethods),
          configCipher: this.store.sealConfig(values),
          configDigest: digestOfConfig(
            seed.id,
            'default',
            enabled,
            30,
            null,
            null,
            null,
            true,
            paymentMethods,
            null,
            0,
            values,
          ),
          createdBy: 'bootstrap',
        },
      });
      this.logger.log(`支付渠道配置初始化: ${seed.id}/default v1 (enabled=${enabled})`);
    }
  }

  // ── 内部 ────────────────────────────────────────────────────────

  private async toAdminProviderView(
    descriptor: PaymentAdapterDescriptor,
  ): Promise<AdminPaymentProviderView> {
    const rows = (await this.store.latestRowsByInstance(descriptor.id)).sort(compareInstanceRows);
    const instances = await Promise.all(
      rows.map((row) => this.toAdminInstanceView(descriptor, row)),
    );
    const primary = instances[0] ?? null;
    const primaryRow = rows[0] ?? null;
    const adapter = requireAdapter(descriptor.id);
    const primaryMissing = primaryRow
      ? adapter.validateConfig(this.store.valuesFor(primaryRow))
      : adapter.validateConfig({});
    return {
      id: descriptor.id,
      name: descriptor.name,
      icon: descriptor.icon,
      checkoutMode: descriptor.checkoutMode,
      enabled: instances.some((instance) => instance.enabled),
      configured: instances.some((instance) => instance.configured),
      closeAfterMinutes: primary?.closeAfterMinutes ?? 30,
      version: primary?.version ?? null,
      configId: primary?.configId ?? null,
      configEnabled: primary?.enabled ?? false,
      values: primary?.values ?? {},
      secretConfigured: primary?.secretConfigured ?? {},
      configFields: descriptor.configFields,
      supportedCurrencies: descriptor.supportedCurrencies,
      supportsReconciliation: descriptor.supportsReconciliation,
      missing: primaryMissing,
      identityLockedFields: primary?.identityLockedFields ?? [],
      hasOpenOrders: instances.some((instance) => instance.hasOpenOrders),
      updatedAt: primary?.updatedAt ?? null,
      warnings: primary?.warnings ?? [],
      instances,
    };
  }

  private async toAdminInstanceView(
    descriptor: PaymentAdapterDescriptor,
    row: {
      id: string;
      instanceId: string;
      name: string | null;
      sortOrder: number;
      version: number;
      enabled: boolean;
      closeAfterMinutes: number;
      minAmountCents: number | null;
      maxAmountCents: number | null;
      dailyLimitCents: number | null;
      refundEnabled: boolean;
      paymentMethods: string;
      configCipher: string;
      createdAt: Date;
    },
  ): Promise<AdminPaymentProviderInstanceView> {
    const adapter = requireAdapter(descriptor.id);
    const values = this.store.valuesFor(row);
    const missing = adapter.validateConfig(values);
    const locked = await this.store.identityLockedFields(descriptor, row.instanceId);
    const hasOpenOrders = await this.store.hasOpenOrders(descriptor.id, row.instanceId);
    const publicValues: Record<string, string> = {};
    const secretConfigured: Record<string, boolean> = {};
    for (const field of descriptor.configFields) {
      if (field.secret) {
        secretConfigured[field.name] = Boolean(values[field.name]);
      } else {
        publicValues[field.name] = values[field.name] ?? field.default ?? '';
      }
    }
    return {
      instanceId: row.instanceId,
      providerId: descriptor.id,
      name: row.name,
      sortOrder: row.sortOrder,
      enabled: row.enabled,
      configured: missing.length === 0,
      closeAfterMinutes: row.closeAfterMinutes,
      version: row.version,
      configId: row.id,
      values: publicValues,
      secretConfigured,
      minAmountCents: row.minAmountCents,
      maxAmountCents: row.maxAmountCents,
      dailyLimitCents: row.dailyLimitCents,
      refundEnabled: row.refundEnabled,
      paymentMethods: paymentMethodsOf(row, descriptor.id),
      identityLockedFields: locked,
      hasOpenOrders,
      updatedAt: row.createdAt.toISOString(),
      warnings: paymentConfigWarnings(descriptor, row, values, missing, this.config, hasOpenOrders),
    };
  }

  private validateInstanceInput(input: {
    closeAfterMinutes: number;
    minAmountCents: number | null;
    maxAmountCents: number | null;
    dailyLimitCents: number | null;
  }): void {
    if (input.closeAfterMinutes < 5 || input.closeAfterMinutes > 1440) {
      throw new AppError(40001, '自动关闭时间必须在 5-1440 分钟之间', 400);
    }
    for (const [label, value] of [
      ['单笔最小金额', input.minAmountCents],
      ['单笔最大金额', input.maxAmountCents],
      ['每日限额', input.dailyLimitCents],
    ] as const) {
      if (value != null && (!Number.isInteger(value) || value < 0)) {
        throw new AppError(40001, `${label}必须是非负整数（分）`, 400);
      }
    }
    if (
      input.minAmountCents != null &&
      input.maxAmountCents != null &&
      input.minAmountCents > input.maxAmountCents
    ) {
      throw new AppError(40001, '单笔最小金额不能大于单笔最大金额', 400);
    }
  }

  private normalizePaymentMethods(
    providerId: string,
    methods: VisiblePaymentMethod[],
  ): VisiblePaymentMethod[] {
    const allowed = defaultPaymentMethods(providerId);
    const unique = [...new Set(methods)].filter((method) => allowed.includes(method));
    if (unique.length === 0 || unique.length !== new Set(methods).size) {
      throw new AppError(40001, `该渠道支持的支付方式为: ${allowed.join(', ')}`, 400);
    }
    return VISIBLE_PAYMENT_METHODS.filter((method) => unique.includes(method));
  }
}

/** 未知渠道统一 404，避免三个入口各写一遍。 */
function requireAdapterOrThrow(providerId: string) {
  const adapter = getAdapter(providerId);
  if (!adapter) throw new AppError(40400, `未知支付渠道: ${providerId}`, 404);
  return adapter;
}
