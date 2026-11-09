import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { SettingsService } from '../common/settings.service';
import { PaymentCipher } from './payment-cipher';
import { allAdapters, getAdapter, requireAdapter } from './adapters';
import {
  PaymentAdapterDescriptor,
  PaymentConfigField,
  PaymentCurrency,
  PaymentProviderId,
  PAYMENT_PROVIDER_IDS,
  PaymentSource,
  VisiblePaymentMethod,
  VISIBLE_PAYMENT_METHODS,
} from './adapters/types';
import { startOfShanghaiDay } from './payment-query';

/** 解密后的实例配置（适配器唯一可用的凭据来源） */
export interface ResolvedPaymentConfig {
  id: string;
  providerId: PaymentProviderId;
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
  paymentMethods: VisiblePaymentMethod[];
  values: Record<string, string>;
}

export interface AdminPaymentProviderInstanceView {
  instanceId: string;
  providerId: PaymentProviderId;
  name: string | null;
  sortOrder: number;
  enabled: boolean;
  configured: boolean;
  closeAfterMinutes: number;
  version: number | null;
  configId: string | null;
  values: Record<string, string>;
  secretConfigured: Record<string, boolean>;
  minAmountCents: number | null;
  maxAmountCents: number | null;
  dailyLimitCents: number | null;
  refundEnabled: boolean;
  paymentMethods: VisiblePaymentMethod[];
  identityLockedFields: string[];
  hasOpenOrders: boolean;
  updatedAt: string | null;
  warnings: Array<{ level: 'danger' | 'warn'; message: string }>;
}

export interface AdminPaymentProviderView {
  id: PaymentProviderId;
  name: string;
  icon: string;
  checkoutMode: string;
  /** 任一实例启用；保留给旧前端/旧调用方 */
  enabled: boolean;
  /** 任一实例配置完整；保留给旧前端/旧调用方 */
  configured: boolean;
  closeAfterMinutes: number;
  version: number | null;
  configId: string | null;
  configEnabled: boolean;
  values: Record<string, string>;
  secretConfigured: Record<string, boolean>;
  configFields: PaymentConfigField[];
  supportedCurrencies: PaymentCurrency[];
  supportsReconciliation: boolean;
  missing: string[];
  identityLockedFields: string[];
  hasOpenOrders: boolean;
  updatedAt: string | null;
  warnings: Array<{ level: 'danger' | 'warn'; message: string }>;
  instances: AdminPaymentProviderInstanceView[];
}

export interface AvailableProviderView {
  id: PaymentProviderId;
  name: string;
  icon: string;
  checkoutMode: string;
  supportedCurrencies: PaymentCurrency[];
  sandbox: boolean;
}

/** C 端唯一可见的支付方式视图；不暴露真实渠道与来源。 */
export interface VisiblePaymentProviderView {
  id: VisiblePaymentMethod;
  name: string;
  icon: 'alipay' | 'wechat';
  checkoutMode: string;
  supportedCurrencies: PaymentCurrency[];
  sandbox: false;
}

export interface ResolvedVisiblePayment {
  method: VisiblePaymentMethod;
  providerId: PaymentProviderId;
  config: ResolvedPaymentConfig;
  /** EasyPay 需要按 C 端支付方式下单与验签；官方渠道不填。 */
  providerMethod?: VisiblePaymentMethod;
}

export interface VisiblePaymentOption {
  view: VisiblePaymentProviderView;
  resolved: ResolvedVisiblePayment;
}

export interface SavePaymentInstanceInput {
  enabled: boolean;
  closeAfterMinutes: number;
  values: Record<string, string>;
  name?: string | null;
  minAmountCents?: number | null;
  maxAmountCents?: number | null;
  dailyLimitCents?: number | null;
  refundEnabled?: boolean;
  paymentMethods?: VisiblePaymentMethod[];
}

/**
 * 支付渠道配置服务。
 *
 * 不可动摇的规则：
 *   1. 追加写：实例配置修改产生新版本；订单/Payment 固定 configId，历史回调
 *      永远能取到当时的密钥。
 *   2. 密钥只进密文：响应只回 secretConfigured。
 *   3. 前台只认来源选择：官方/易支付不可自动回退；来源下无可用实例即隐藏。
 *   4. 实例停用只摘流：不物理删除，历史订单继续依赖 providerConfigId。
 */
@Injectable()
export class PaymentConfigService implements OnModuleInit {
  private readonly logger = new Logger(PaymentConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PaymentCipher,
    private readonly settings: SettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.bootstrapFromEnv();
  }

  // ── 读取 ────────────────────────────────────────────────────────

  /** 后台列表：每个渠道一张卡，卡内包含全部实例。 */
  async listAdmin(): Promise<AdminPaymentProviderView[]> {
    const views: AdminPaymentProviderView[] = [];
    for (const adapter of allAdapters()) {
      views.push(await this.toAdminProviderView(adapter.descriptor));
    }
    return views;
  }

  /** 某渠道的全部最新实例，按后台排序返回。 */
  async listInstances(providerId: PaymentProviderId): Promise<ResolvedPaymentConfig[]> {
    const rows = await this.latestRowsByInstance(providerId);
    return rows
      .sort(compareInstanceRows)
      .map((row) => this.toResolved(row));
  }

  /** 最新默认实例；未配置返回 null。保留旧 API 兼容。 */
  async latest(providerId: PaymentProviderId): Promise<ResolvedPaymentConfig | null> {
    return this.latestInstance(providerId, 'default');
  }

  /** 指定实例的最新版本。 */
  async latestInstance(
    providerId: PaymentProviderId,
    instanceId: string,
  ): Promise<ResolvedPaymentConfig | null> {
    const row = await this.latestRow(providerId, instanceId);
    if (!row) return null;
    return this.toResolved(row);
  }

  /** 按回调 URL 的 configId 精确解析。 */
  async byId(configId: string): Promise<ResolvedPaymentConfig> {
    const row = await this.prisma.paymentProviderConfig.findUnique({ where: { id: configId } });
    if (!row) throw new AppError(40400, '支付配置不存在', 404);
    return this.toResolved(row);
  }

  /**
   * 订单固定版本；历史单无 configId 时只回落到它自己的实例（或旧默认实例），
   * 绝不跨实例、跨渠道。
   */
  async resolveForOrder(order: {
    channel: string;
    providerConfigId: string | null;
    providerInstanceId?: string | null;
  }): Promise<ResolvedPaymentConfig | null> {
    if (order.providerConfigId) {
      const row = await this.prisma.paymentProviderConfig.findUnique({
        where: { id: order.providerConfigId },
      });
      if (row && row.providerId === order.channel) return this.toResolved(row);
      return null;
    }
    const adapter = getAdapter(order.channel);
    if (!adapter) return null;
    return this.latestInstance(
      adapter.descriptor.id,
      order.providerInstanceId || 'default',
    );
  }

  /** 兼容旧调用：任一实例已启用、字段齐全且支持目标币种。 */
  async available(currency: PaymentCurrency): Promise<AvailableProviderView[]> {
    const out: AvailableProviderView[] = [];
    for (const adapter of allAdapters()) {
      const d = adapter.descriptor;
      if (!d.supportedCurrencies.includes(currency)) continue;
      if (d.id === 'sandbox' && process.env.NODE_ENV === 'production') continue;
      const rows = await this.latestRowsByInstance(d.id);
      const usable = rows.some((row) => {
        if (!row.enabled) return false;
        try {
          return adapter.validateConfig(this.valuesFor(d.id, row)).length === 0;
        } catch {
          return false;
        }
      });
      if (!usable) continue;
      out.push({
        id: d.id,
        name: d.name,
        icon: d.icon,
        checkoutMode: d.checkoutMode,
        supportedCurrencies: d.supportedCurrencies,
        sandbox: d.id === 'sandbox',
      });
    }
    return out;
  }

  /** C 端固定可见支付方式；不推进轮询游标。 */
  async availableVisible(
    currency: PaymentCurrency,
    amountCents?: number,
  ): Promise<VisiblePaymentProviderView[]> {
    const options = await this.resolveVisibleOptions(currency, amountCents, false);
    return options.map((option) => option.view);
  }

  /**
   * 一次解析两个按钮及其真实实例。创建订单必须直接消费这里的结果，
   * 不能再次 resolveVisible，否则轮询/最少金额可能在下单前漂移。
   */
  async resolveVisibleOptions(
    currency: PaymentCurrency,
    amountCents?: number,
    advanceCursor = true,
  ): Promise<VisiblePaymentOption[]> {
    const out: VisiblePaymentOption[] = [];
    for (const method of VISIBLE_PAYMENT_METHODS) {
      const resolved = await this.resolveVisible(method, currency, amountCents, advanceCursor);
      if (!resolved) continue;
      const descriptor = requireAdapter(resolved.providerId).descriptor;
      out.push({
        view: {
          id: method,
          name: method === 'alipay' ? '支付宝' : '微信支付',
          icon: method,
          checkoutMode: descriptor.checkoutMode,
          supportedCurrencies: descriptor.supportedCurrencies,
          sandbox: false,
        },
        resolved,
      });
    }
    return out;
  }

  /** 解析某个可见支付方式当前应走的唯一真实实例。 */
  async resolveVisible(
    method: VisiblePaymentMethod,
    currency: PaymentCurrency,
    amountCents?: number,
    advanceCursor = true,
  ): Promise<ResolvedVisiblePayment | null> {
    const source = await this.sourceOf(method);
    if (source === 'unset') return null;

    const providerId: PaymentProviderId = source === 'official' ? method : 'epay';
    const adapter = getAdapter(providerId);
    if (!adapter || !adapter.descriptor.supportedCurrencies.includes(currency)) return null;

    const rows = (await this.latestRowsByInstance(providerId)).sort(compareInstanceRows);
    const eligible: Array<{ row: (typeof rows)[number]; config: ResolvedPaymentConfig }> = [];
    for (const row of rows) {
      if (!row.enabled) continue;
      if (!paymentMethodsOf(row, row.providerId).includes(method)) continue;
      if (amountCents !== undefined) {
        if (row.minAmountCents != null && amountCents < row.minAmountCents) continue;
        if (row.maxAmountCents != null && amountCents > row.maxAmountCents) continue;
      }
      let values: Record<string, string>;
      try {
        values = this.valuesFor(providerId, row);
      } catch (e) {
        this.logger.error(
          `C 端支付实例不可用 (${method} -> ${providerId}/${row.instanceId}) 解密失败: ${(e as Error).message}`,
        );
        continue;
      }
      const missing = adapter.validateConfig(values);
      if (missing.length > 0) continue;
      if (
        this.providerWarnings(adapter.descriptor, row, values, missing).some(
          (warning) => warning.level === 'danger',
        )
      ) {
        continue;
      }
      eligible.push({ row, config: this.toResolved(row, values) });
    }
    if (eligible.length === 0) return null;

    const usage = await this.dailyInstanceUsage(
      providerId,
      eligible.map((item) => item.row.instanceId),
    );
    const withinDailyLimit = eligible.filter(({ row }) => {
      if (row.dailyLimitCents == null) return true;
      const used = usage.get(row.instanceId) ?? 0;
      if (amountCents === undefined) return used < row.dailyLimitCents;
      return used + Math.max(0, amountCents) <= row.dailyLimitCents;
    });
    if (withinDailyLimit.length === 0) return null;

    const strategy = await this.settings.get<string>('payment.loadBalancingStrategy');
    const selected =
      strategy === 'least-amount'
        ? this.leastAmountInstance(withinDailyLimit, usage)
        : await this.roundRobinInstance(providerId, method, withinDailyLimit, advanceCursor);

    return {
      method,
      providerId,
      config: selected.config,
      ...(providerId === 'epay' ? { providerMethod: method } : {}),
    };
  }

  // ── 写入 ────────────────────────────────────────────────────────

  /** 兼容旧路径：默认实例保存新版本。 */
  async saveVersion(
    providerId: string,
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
    return this.saveInstanceVersion(providerId, 'default', input, actorId);
  }

  /** 新建实例；instanceId 只能由服务端生成。 */
  async createInstance(
    providerId: string,
    input: Partial<SavePaymentInstanceInput>,
    actorId: string,
  ): Promise<AdminPaymentProviderInstanceView> {
    const adapter = getAdapter(providerId);
    if (!adapter) throw new AppError(40400, `未知支付渠道: ${providerId}`, 404);

    const rows = await this.latestRowsByInstance(adapter.descriptor.id);
    const instanceId = `pi_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const sortOrder = rows.reduce((max, row) => Math.max(max, row.sortOrder), -10) + 10;
    const defaults = this.defaultMethods(adapter.descriptor.id);
    const paymentMethods = this.normalizePaymentMethods(
      adapter.descriptor.id,
      input.paymentMethods ?? defaults,
    );
    const values = input.values ?? {};
    const enabled = Boolean(input.enabled);
    if (enabled) {
      const missing = adapter.validateConfig(this.normalizeValues(adapter.descriptor.id, values));
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

    const normalized = this.normalizeValues(adapter.descriptor.id, values);
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
        configCipher: this.cipher.encrypt(JSON.stringify(normalized)),
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
          normalized,
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
    const adapter = getAdapter(providerId);
    if (!adapter) throw new AppError(40400, `未知支付渠道: ${providerId}`, 404);

    const current = await this.latestRow(adapter.descriptor.id, instanceId);
    if (!current && instanceId !== 'default') {
      throw new AppError(40400, `支付实例不存在: ${instanceId}`, 404);
    }
    const previous = current ? this.valuesFor(adapter.descriptor.id, current) : {};

    // 未提交的 secret 沿用上一版；显式空串同样视为沿用。
    const merged: Record<string, string> = { ...previous };
    for (const field of adapter.descriptor.configFields) {
      const raw = input.values[field.name];
      if (raw === undefined) continue;
      if (field.secret && raw.trim() === '') continue;
      merged[field.name] = String(raw);
    }

    const locked = await this.identityLockedFields(adapter.descriptor, instanceId);
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

    const name = input.name === undefined
      ? (current?.name ?? null)
      : normalizeName(input.name);
    const sortOrder = current?.sortOrder ?? 0;
    const minAmountCents = input.minAmountCents === undefined
      ? (current?.minAmountCents ?? null)
      : input.minAmountCents;
    const maxAmountCents = input.maxAmountCents === undefined
      ? (current?.maxAmountCents ?? null)
      : input.maxAmountCents;
    const dailyLimitCents = input.dailyLimitCents === undefined
      ? (current?.dailyLimitCents ?? null)
      : input.dailyLimitCents;
    const refundEnabled = input.refundEnabled ?? current?.refundEnabled ?? true;
    const paymentMethods = this.normalizePaymentMethods(
      adapter.descriptor.id,
      input.paymentMethods ?? (current ? paymentMethodsOf(current) : this.defaultMethods(adapter.descriptor.id)),
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
        configCipher: this.cipher.encrypt(JSON.stringify(merged)),
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
    const adapter = getAdapter(providerId);
    if (!adapter) throw new AppError(40400, `未知支付渠道: ${providerId}`, 404);
    const current = await this.latestRowsByInstance(adapter.descriptor.id);
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
    const epayMchId = process.env.EPAY_MCH_ID || process.env.EPAY_PID || '';
    const epayType = normalizeEpayType(
      process.env.EPAY_TYPE || process.env.EPAY_PAY_TYPE || '2',
    );
    const seeds: Array<{ id: PaymentProviderId; values: Record<string, string> }> = [
      { id: 'sandbox', values: {} },
      {
        id: 'alipay',
        values: {
          appId: process.env.ALIPAY_APP_ID ?? '',
          sellerId: process.env.ALIPAY_SELLER_ID ?? '',
          merchantPrivateKey: process.env.ALIPAY_PRIVATE_KEY ?? '',
          alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY ?? '',
          gateway: process.env.ALIPAY_GATEWAY ?? '',
        },
      },
      {
        id: 'wechat',
        values: {
          appId: process.env.WECHAT_APP_ID ?? '',
          mchId: process.env.WECHAT_MCH_ID ?? '',
          merchantSerialNo: process.env.WECHAT_SERIAL_NO ?? '',
          merchantPrivateKey: process.env.WECHAT_PRIVATE_KEY ?? '',
          apiV3Key: process.env.WECHAT_API_V3_KEY ?? '',
          wechatPayPublicKey: process.env.WECHAT_PLATFORM_PUBLIC_KEY ?? '',
          wechatPayPublicKeyId: process.env.WECHAT_PLATFORM_PUBLIC_KEY_ID ?? '',
          apiBase: process.env.WECHAT_API_BASE ?? '',
        },
      },
      {
        id: 'paypal',
        values: {
          clientId: process.env.PAYPAL_CLIENT_ID ?? '',
          clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
          webhookId: process.env.PAYPAL_WEBHOOK_ID ?? '',
          apiBase: process.env.PAYPAL_API_BASE ?? '',
        },
      },
      {
        id: 'stripe',
        values: {
          secretKey: process.env.STRIPE_SECRET_KEY ?? '',
          webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
          apiBase: process.env.STRIPE_API_BASE ?? '',
        },
      },
      {
        id: 'epay',
        values: {
          apiBase: process.env.EPAY_API_BASE || 'https://epay.jylt.cc',
          mchId: epayMchId,
          key: process.env.EPAY_KEY ?? '',
          type: epayType,
        },
      },
      {
        id: 'zpay',
        values: {
          apiBase: process.env.ZPAY_API_BASE || 'https://zpayz.cn',
          pid: process.env.ZPAY_PID ?? '',
          key: process.env.ZPAY_KEY ?? '',
          type: process.env.ZPAY_TYPE || 'alipay',
          cid: process.env.ZPAY_CID ?? '',
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
      const enabled = seed.id === 'sandbox' ? process.env.NODE_ENV !== 'production' : complete;
      const paymentMethods = this.defaultMethods(seed.id);
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
          configCipher: this.cipher.encrypt(JSON.stringify(values)),
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

  private async latestRowsByInstance(providerId: string): Promise<Array<{
    id: string;
    providerId: string;
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
    configDigest: string;
    createdAt: Date;
  }>> {
    const delegate = this.prisma.paymentProviderConfig as typeof this.prisma.paymentProviderConfig & {
      findMany?: typeof this.prisma.paymentProviderConfig.findMany;
    };
    if (typeof delegate.findMany !== 'function') {
      const row = await this.latestRow(providerId, 'default');
      return row ? [row] : [];
    }
    const rows = await delegate.findMany({
      where: { providerId },
      orderBy: [{ instanceId: 'asc' }, { version: 'desc' }],
    });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latest.has(row.instanceId)) latest.set(row.instanceId, row);
    }
    return [...latest.values()];
  }

  private async latestRow(providerId: string, instanceId: string) {
    return this.prisma.paymentProviderConfig.findFirst({
      where: { providerId, instanceId },
      orderBy: { version: 'desc' },
    });
  }

  private async sourceOf(method: VisiblePaymentMethod): Promise<PaymentSource> {
    const raw = await this.settings.get<string>(`payment.${method}Source`);
    return raw === 'official' || raw === 'epay' ? raw : 'unset';
  }

  private decode(row: { configCipher: string }): Record<string, string> {
    if (!row.configCipher) return {};
    try {
      const parsed = JSON.parse(this.cipher.decrypt(row.configCipher)) as Record<string, string>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      this.logger.error(`支付配置解密失败: ${(e as Error).message}`);
      throw new AppError(50302, '支付配置解密失败，请检查 PAYMENT_SECRET_KEY', 503);
    }
  }

  private valuesFor(
    providerId: string,
    row: { configCipher: string },
  ): Record<string, string> {
    return normalizeProviderValues(providerId, this.decode(row));
  }

  private normalizeValues(providerId: string, values: Record<string, string>): Record<string, string> {
    return normalizeProviderValues(providerId, values);
  }

  private toResolved(
    row: {
      id: string;
      providerId: string;
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
    },
    values?: Record<string, string>,
  ): ResolvedPaymentConfig {
    return {
      id: row.id,
      providerId: row.providerId as PaymentProviderId,
      instanceId: row.instanceId,
      name: row.name,
      sortOrder: row.sortOrder,
      version: row.version,
      enabled: row.enabled,
      closeAfterMinutes: row.closeAfterMinutes,
      minAmountCents: row.minAmountCents,
      maxAmountCents: row.maxAmountCents,
      dailyLimitCents: row.dailyLimitCents,
      refundEnabled: row.refundEnabled,
      paymentMethods: paymentMethodsOf(row, row.providerId),
      values: values ?? this.valuesFor(row.providerId, row),
    };
  }

  private async toAdminProviderView(
    descriptor: PaymentAdapterDescriptor,
  ): Promise<AdminPaymentProviderView> {
    const rows = (await this.latestRowsByInstance(descriptor.id)).sort(compareInstanceRows);
    const instances = await Promise.all(
      rows.map((row) => this.toAdminInstanceView(descriptor, row)),
    );
    const legacy = instances[0] ?? null;
    const legacyRow = rows[0] ?? null;
    const adapter = requireAdapter(descriptor.id);
    const legacyMissing = legacyRow
      ? adapter.validateConfig(this.valuesFor(descriptor.id, legacyRow))
      : adapter.validateConfig({});
    return {
      id: descriptor.id,
      name: descriptor.name,
      icon: descriptor.icon,
      checkoutMode: descriptor.checkoutMode,
      enabled: instances.some((instance) => instance.enabled),
      configured: instances.some((instance) => instance.configured),
      closeAfterMinutes: legacy?.closeAfterMinutes ?? 30,
      version: legacy?.version ?? null,
      configId: legacy?.configId ?? null,
      configEnabled: legacy?.enabled ?? false,
      values: legacy?.values ?? {},
      secretConfigured: legacy?.secretConfigured ?? {},
      configFields: descriptor.configFields,
      supportedCurrencies: descriptor.supportedCurrencies,
      supportsReconciliation: descriptor.supportsReconciliation,
      missing: legacyMissing,
      identityLockedFields: legacy?.identityLockedFields ?? [],
      hasOpenOrders: instances.some((instance) => instance.hasOpenOrders),
      updatedAt: legacy?.updatedAt ?? null,
      warnings: legacy?.warnings ?? [],
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
    const values = this.valuesFor(descriptor.id, row);
    const missing = adapter.validateConfig(values);
    const locked = await this.identityLockedFields(descriptor, row.instanceId);
    const hasOpenOrders = await this.hasOpenOrders(descriptor.id, row.instanceId);
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
      warnings: this.providerWarnings(descriptor, row, values, missing, hasOpenOrders),
    };
  }

  /** 渠道可用性告警的唯一来源。 */
  private providerWarnings(
    descriptor: PaymentAdapterDescriptor,
    row: { enabled: boolean } | null,
    values: Record<string, string>,
    missing: string[],
    hasOpenOrders = false,
  ): Array<{ level: 'danger' | 'warn'; message: string }> {
    const warnings: Array<{ level: 'danger' | 'warn'; message: string }> = [];
    if (row?.enabled && missing.length > 0) {
      warnings.push({
        level: 'danger',
        message: `实例已启用但缺少必填项：${missing.join(', ')}。发起支付会返回 503。`,
      });
    }
    if (
      row?.enabled &&
      descriptor.id !== 'sandbox' &&
      missing.length === 0 &&
      !values.publicBaseUrl?.trim() &&
      !process.env.PAYMENT_NOTIFY_BASE?.trim()
    ) {
      warnings.push({
        level: 'danger',
        message:
          '实例已启用但未配置回调公网地址：请在实例配置填写 publicBaseUrl，或设置 PAYMENT_NOTIFY_BASE；否则发起支付会返回 503。',
      });
    }
    if (
      row?.enabled &&
      descriptor.id !== 'sandbox' &&
      process.env.NODE_ENV === 'production' &&
      !process.env.PAYMENT_SECRET_KEY?.trim()
    ) {
      warnings.push({
        level: 'danger',
        message: '生产环境未配置 PAYMENT_SECRET_KEY，支付实例凭据无法安全加密/解密。',
      });
    }
    if (descriptor.id === 'sandbox' && process.env.NODE_ENV === 'production') {
      warnings.push({
        level: 'danger',
        message: '生产环境仍启用沙箱渠道：不会产生真实资金流转，上线前必须停用。',
      });
    }
    if (row?.enabled && hasOpenOrders) {
      warnings.push({
        level: 'warn',
        message: '存在未完成订单引用当前实例，保存新版本不会影响这些订单的验签与查单。',
      });
    }
    return warnings;
  }

  private async identityLockedFields(
    descriptor: PaymentAdapterDescriptor,
    instanceId: string,
  ): Promise<string[]> {
    const identityFields = descriptor.configFields.filter((f) => f.identity).map((f) => f.name);
    if (identityFields.length === 0) return [];
    const configIds = await this.configIdsOfInstance(descriptor.id, instanceId);
    const bound = await this.prisma.order.count({
      where: {
        channel: descriptor.id,
        status: { in: ['paid', 'refunded', 'partial_refunded'] },
        OR: [
          { providerInstanceId: instanceId },
          ...(configIds.length > 0 ? [{ providerConfigId: { in: configIds } }] : []),
        ],
      },
    });
    return bound > 0 ? identityFields : [];
  }

  private async hasOpenOrders(providerId: string, instanceId: string): Promise<boolean> {
    const configIds = await this.configIdsOfInstance(providerId, instanceId);
    const count = await this.prisma.order.count({
      where: {
        channel: providerId,
        status: 'pending',
        OR: [
          { providerInstanceId: instanceId },
          ...(configIds.length > 0 ? [{ providerConfigId: { in: configIds } }] : []),
        ],
      },
    });
    return count > 0;
  }

  private async configIdsOfInstance(providerId: string, instanceId: string): Promise<string[]> {
    const delegate = this.prisma.paymentProviderConfig as typeof this.prisma.paymentProviderConfig & {
      findMany?: typeof this.prisma.paymentProviderConfig.findMany;
    };
    if (typeof delegate.findMany !== 'function') return [];
    const rows = await delegate.findMany({
      where: { providerId, instanceId },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async dailyInstanceUsage(
    providerId: string,
    instanceIds: string[],
  ): Promise<Map<string, number>> {
    const usage = new Map<string, number>();
    if (instanceIds.length === 0) return usage;
    const delegate = (this.prisma as unknown as {
      payment?: { findMany?: typeof this.prisma.payment.findMany };
    }).payment;
    if (typeof delegate?.findMany !== 'function') return usage;
    const today = shanghaiDateKey(new Date());
    const rows = await delegate.findMany({
      where: {
        channel: providerId,
        providerInstanceId: { in: instanceIds },
        status: { in: ['pending', 'succeeded'] },
        createdAt: { gte: startOfShanghaiDay(today) },
      },
      select: { providerInstanceId: true, amountCents: true },
    });
    for (const row of rows) {
      if (!row.providerInstanceId) continue;
      usage.set(
        row.providerInstanceId,
        (usage.get(row.providerInstanceId) ?? 0) + row.amountCents,
      );
    }
    return usage;
  }

  private leastAmountInstance(
    eligible: Array<{ row: { instanceId: string }; config: ResolvedPaymentConfig }>,
    usage: Map<string, number>,
  ): { row: { instanceId: string }; config: ResolvedPaymentConfig } {
    return [...eligible].sort((a, b) => {
      const amountDiff =
        (usage.get(a.row.instanceId) ?? 0) - (usage.get(b.row.instanceId) ?? 0);
      if (amountDiff !== 0) return amountDiff;
      return compareInstanceRows(a.config, b.config);
    })[0];
  }

  private async roundRobinInstance(
    providerId: string,
    method: VisiblePaymentMethod,
    eligible: Array<{ row: { instanceId: string }; config: ResolvedPaymentConfig }>,
    advanceCursor: boolean,
  ): Promise<{ row: { instanceId: string }; config: ResolvedPaymentConfig }> {
    const delegate = (this.prisma as unknown as {
      paymentRoundRobinCursor?: {
        upsert(args: unknown): Promise<{ cursor: number }>;
        updateMany(args: unknown): Promise<{ count: number }>;
      };
    }).paymentRoundRobinCursor;
    if (!delegate) return eligible[0];
    let cursor = 0;
    try {
      const row = await delegate.upsert({
        where: { providerId_method: { providerId, method } },
        create: { providerId, method, cursor: 0 },
        update: {},
        select: { cursor: true },
      });
      cursor = row.cursor;
      const selected = eligible[cursor % eligible.length];
      if (advanceCursor) {
        await delegate.updateMany({
          where: { providerId, method, cursor },
          data: { cursor: { increment: 1 } },
        });
      }
      return selected;
    } catch (e) {
      this.logger.warn(`支付轮询游标读取失败，退回首个实例: ${(e as Error).message}`);
      return eligible[0];
    }
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
    const allowed = this.defaultMethods(providerId);
    const unique = [...new Set(methods)].filter((method) => allowed.includes(method));
    if (unique.length === 0 || unique.length !== new Set(methods).size) {
      throw new AppError(40001, `该渠道支持的支付方式为: ${allowed.join(', ')}`, 400);
    }
    return VISIBLE_PAYMENT_METHODS.filter((method) => unique.includes(method));
  }

  private defaultMethods(providerId: string): VisiblePaymentMethod[] {
    if (providerId === 'alipay') return ['alipay'];
    if (providerId === 'wechat') return ['wechat'];
    return ['alipay', 'wechat'];
  }
}

function compareInstanceRows(
  a: { sortOrder: number; instanceId: string },
  b: { sortOrder: number; instanceId: string },
): number {
  return a.sortOrder - b.sortOrder || a.instanceId.localeCompare(b.instanceId);
}

function defaultPaymentMethods(providerId: string): VisiblePaymentMethod[] {
  if (providerId === 'alipay') return ['alipay'];
  if (providerId === 'wechat') return ['wechat'];
  return ['alipay', 'wechat'];
}

/**
 * 兼容实例字段上线前的旧行：缺少 paymentMethods 时按渠道能力兜底。
 * 已有值必须是该渠道允许的子集；旧默认值里的跨渠道项会被过滤掉。
 */
function paymentMethodsOf(
  row: { paymentMethods?: string | null; providerId?: string },
  providerId?: string,
): VisiblePaymentMethod[] {
  const resolvedProviderId = providerId ?? row.providerId ?? '';
  const allowed = defaultPaymentMethods(resolvedProviderId);
  if (row.paymentMethods == null || row.paymentMethods.trim() === '') {
    return allowed;
  }
  try {
    const parsed = JSON.parse(row.paymentMethods);
    if (!Array.isArray(parsed)) return allowed;
    return parsed.filter(
      (value): value is VisiblePaymentMethod =>
        (value === 'alipay' || value === 'wechat') && allowed.includes(value),
    );
  } catch {
    return allowed;
  }
}

function normalizeName(name: string | null | undefined): string | null {
  const value = String(name ?? '').trim();
  return value ? value.slice(0, 80) : null;
}

function shanghaiDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}`;
}

function digestOfConfig(
  providerId: string,
  instanceId: string,
  enabled: boolean,
  closeAfterMinutes: number,
  minAmountCents: number | null,
  maxAmountCents: number | null,
  dailyLimitCents: number | null,
  refundEnabled: boolean,
  paymentMethods: VisiblePaymentMethod[],
  name: string | null,
  sortOrder: number,
  values: Record<string, string>,
): string {
  const normalized = Object.keys(values)
    .filter((k) => values[k] !== undefined && values[k] !== '')
    .sort()
    .map((k) => `${k}=${values[k]}`)
    .join('\n');
  return createHash('sha256')
    .update(
      [
        providerId,
        instanceId,
        enabled ? 1 : 0,
        closeAfterMinutes,
        minAmountCents ?? '',
        maxAmountCents ?? '',
        dailyLimitCents ?? '',
        refundEnabled ? 1 : 0,
        paymentMethods.join(','),
        name ?? '',
        sortOrder,
        normalized,
      ].join('\n'),
    )
    .digest('hex');
}

/** 兼容 2026-11 新版易支付字段上线前落库的 pid / payType 配置。 */
function normalizeProviderValues(
  providerId: string,
  values: Record<string, string>,
): Record<string, string> {
  if (providerId !== 'epay') return values;
  const normalized = { ...values };
  if (!normalized.mchId?.trim() && normalized.pid?.trim()) {
    normalized.mchId = normalized.pid.trim();
  }
  const type = normalizeEpayType(normalized.type || '') || normalizeEpayType(normalized.payType || '');
  if (type) normalized.type = type;
  return normalized;
}

function normalizeEpayType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (['1', 'wx', 'wxpay', 'wechat', 'weixin'].includes(normalized)) return '1';
  if (['2', 'ali', 'alipay'].includes(normalized)) return '2';
  return '';
}

export const PAYMENT_PROVIDER_ID_LIST = PAYMENT_PROVIDER_IDS;
