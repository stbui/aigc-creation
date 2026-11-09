import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { PaymentCipher } from './payment-cipher';
import { allAdapters, getAdapter, requireAdapter } from './adapters';
import {
  PaymentAdapterDescriptor,
  PaymentConfigField,
  PaymentCurrency,
  PaymentProviderId,
  PAYMENT_PROVIDER_IDS,
} from './adapters/types';

/** 解密后的渠道配置（适配器唯一可用的凭据来源） */
export interface ResolvedPaymentConfig {
  id: string;
  providerId: PaymentProviderId;
  version: number;
  enabled: boolean;
  closeAfterMinutes: number;
  values: Record<string, string>;
}

export interface AdminPaymentProviderView {
  id: PaymentProviderId;
  name: string;
  icon: string;
  checkoutMode: string;
  enabled: boolean;
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
}

export interface AvailableProviderView {
  id: PaymentProviderId;
  name: string;
  icon: string;
  checkoutMode: string;
  supportedCurrencies: PaymentCurrency[];
  sandbox: boolean;
}

/**
 * 支付渠道配置服务。
 *
 * 三条不可动摇的规则：
 *   1. **追加写**：任何修改都产生新版本；旧订单固定 `providerConfigId`，
 *      因此历史订单的回调验签永远能取到当时的密钥。
 *   2. **密钥只进密文**：任何响应都不回传 `configCipher`，secret 字段只回
 *      `secretConfigured[name]=true`。
 *   3. **缺凭据不降级沙箱**：`available()` 直接过滤掉不可用渠道；真正发起支付时
 *      才抛 503，让前端如实提示「支付暂不可用」。
 */
@Injectable()
export class PaymentConfigService implements OnModuleInit {
  private readonly logger = new Logger(PaymentConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PaymentCipher,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.bootstrapFromEnv();
  }

  // ── 读取 ────────────────────────────────────────────────────────

  /** 后台列表：非密钥字段回显；密钥只回 secretConfigured */
  async listAdmin(): Promise<AdminPaymentProviderView[]> {
    const views: AdminPaymentProviderView[] = [];
    for (const adapter of allAdapters()) {
      const latest = await this.latestRow(adapter.descriptor.id);
      views.push(await this.toAdminView(adapter.descriptor, latest));
    }
    return views;
  }

  /** 最新版本；未配置返回 null */
  async latest(providerId: PaymentProviderId): Promise<ResolvedPaymentConfig | null> {
    const row = await this.latestRow(providerId);
    if (!row) return null;
    return this.toResolved(row);
  }

  /** 按回调 URL 的 configId 精确解析；不存在/渠道不匹配抛 4xx */
  async byId(configId: string): Promise<ResolvedPaymentConfig> {
    const row = await this.prisma.paymentProviderConfig.findUnique({ where: { id: configId } });
    if (!row) throw new AppError(40400, '支付配置不存在', 404);
    return this.toResolved(row);
  }

  /** 订单固定版本；历史单无 configId 时回落到同渠道最新版本 */
  async resolveForOrder(order: {
    channel: string;
    providerConfigId: string | null;
  }): Promise<ResolvedPaymentConfig | null> {
    if (order.providerConfigId) {
      const row = await this.prisma.paymentProviderConfig.findUnique({
        where: { id: order.providerConfigId },
      });
      // 必须同时校验渠道：跨渠道重试后 Order.channel 与旧配置可能不属于同一渠道，
      // 拿错配置去验签/退款会直接失败，甚至把 A 渠道的密钥交给 B 适配器。
      if (row && row.providerId === order.channel) return this.toResolved(row);
    }
    const adapter = getAdapter(order.channel);
    if (!adapter) return null;
    return this.latest(adapter.descriptor.id);
  }

  /** C 端可选渠道：已启用、字段齐全、支持目标币种；生产过滤沙箱 */
  async available(currency: PaymentCurrency): Promise<AvailableProviderView[]> {
    const out: AvailableProviderView[] = [];
    for (const adapter of allAdapters()) {
      const d = adapter.descriptor;
      if (!d.supportedCurrencies.includes(currency)) continue;
      if (d.id === 'sandbox' && process.env.NODE_ENV === 'production') continue;
      const row = await this.latestRow(d.id);
      if (!row || !row.enabled) continue;
      const values = this.valuesFor(d.id, row);
      if (adapter.validateConfig(values).length > 0) continue;
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

  /** 保存新版本；空密钥沿用上一版；摘要相同返回当前版本且 unchanged=true */
  async saveVersion(
    providerId: string,
    input: { enabled: boolean; closeAfterMinutes: number; values: Record<string, string> },
    actorId: string,
  ): Promise<{ provider: AdminPaymentProviderView; unchanged: boolean }> {
    const adapter = getAdapter(providerId);
    if (!adapter) throw new AppError(40400, `未知支付渠道: ${providerId}`, 404);

    const current = await this.latestRow(adapter.descriptor.id);
    const previous = current ? this.valuesFor(adapter.descriptor.id, current) : {};

    // 合并：未提交的 secret 字段沿用上一版；显式空串同样视为沿用（不允许删除密钥）
    const merged: Record<string, string> = { ...previous };
    for (const field of adapter.descriptor.configFields) {
      const raw = input.values[field.name];
      if (raw === undefined) continue;
      if (field.secret && raw.trim() === '') continue;
      merged[field.name] = String(raw);
    }

    // 身份字段保护：已有订单绑定过该渠道时不允许改 appId / mchId 等
    const locked = await this.identityLockedFields(adapter.descriptor);
    for (const name of locked) {
      if (merged[name] !== previous[name]) {
        throw new AppError(40001, `字段 ${name} 已有订单绑定，不能修改`, 400);
      }
    }

    const missing = adapter.validateConfig(merged);
    if (input.enabled && missing.length > 0) {
      throw new AppError(40001, `渠道启用前必须补齐字段: ${missing.join(', ')}`, 400);
    }
    if (input.closeAfterMinutes < 5 || input.closeAfterMinutes > 1440) {
      throw new AppError(40001, '自动关闭时间必须在 5-1440 分钟之间', 400);
    }

    const digest = digestOfConfig(adapter.descriptor.id, input.enabled, input.closeAfterMinutes, merged);
    if (current && current.configDigest === digest) {
      return { provider: await this.toAdminView(adapter.descriptor, current), unchanged: true };
    }

    const version = (current?.version ?? 0) + 1;
    const row = await this.prisma.paymentProviderConfig.create({
      data: {
        providerId: adapter.descriptor.id,
        version,
        enabled: input.enabled,
        closeAfterMinutes: input.closeAfterMinutes,
        configCipher: this.cipher.encrypt(JSON.stringify(merged)),
        configDigest: digest,
        createdBy: actorId,
      },
    });
    this.logger.log(`支付渠道配置新版本: ${adapter.descriptor.id} v${version} by ${actorId}`);
    return { provider: await this.toAdminView(adapter.descriptor, row), unchanged: false };
  }

  /** env → v1；只执行一次。仅当库内完全没有该渠道配置时生效 */
  async bootstrapFromEnv(): Promise<void> {
    const epayMchId = process.env.EPAY_MCH_ID || process.env.EPAY_PID || '';
    const epayType = normalizeEpayType(
      process.env.EPAY_TYPE || process.env.EPAY_PAY_TYPE || '2',
    );
    const seeds: Array<{ id: PaymentProviderId; values: Record<string, string> }> = [
      {
        id: 'sandbox',
        values: {},
      },
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
      // 沙箱在非生产环境默认启用；真实渠道只有凭据齐全才启用，避免「已启用但不可用」
      const enabled = seed.id === 'sandbox' ? process.env.NODE_ENV !== 'production' : complete;

      await this.prisma.paymentProviderConfig.create({
        data: {
          providerId: seed.id,
          version: 1,
          enabled,
          closeAfterMinutes: 30,
          configCipher: this.cipher.encrypt(JSON.stringify(values)),
          configDigest: digestOfConfig(seed.id, enabled, 30, values),
          createdBy: 'bootstrap',
        },
      });
      this.logger.log(`支付渠道配置初始化: ${seed.id} v1 (enabled=${enabled})`);
    }
  }

  // ── 内部 ────────────────────────────────────────────────────────

  private async latestRow(providerId: string) {
    return this.prisma.paymentProviderConfig.findFirst({
      where: { providerId },
      orderBy: { version: 'desc' },
    });
  }

  private decode(row: { configCipher: string }): Record<string, string> {
    if (!row.configCipher) return {};
    try {
      const parsed = JSON.parse(this.cipher.decrypt(row.configCipher)) as Record<string, string>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      // 解密失败必须暴露，不能当成空配置 —— 空配置会让渠道「看起来未配置」，
      // 掩盖真正的密钥丢失
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

  private toResolved(row: {
    id: string;
    providerId: string;
    version: number;
    enabled: boolean;
    closeAfterMinutes: number;
    configCipher: string;
  }): ResolvedPaymentConfig {
    return {
      id: row.id,
      providerId: row.providerId as PaymentProviderId,
      version: row.version,
      enabled: row.enabled,
      closeAfterMinutes: row.closeAfterMinutes,
      values: this.valuesFor(row.providerId, row),
    };
  }

  private async toAdminView(
    descriptor: PaymentAdapterDescriptor,
    row: {
      id: string;
      version: number;
      enabled: boolean;
      closeAfterMinutes: number;
      configCipher: string;
      createdAt: Date;
    } | null,
  ): Promise<AdminPaymentProviderView> {
    const adapter = requireAdapter(descriptor.id);
    const values = row ? this.valuesFor(descriptor.id, row) : {};
    const missing = adapter.validateConfig(values);
    const locked = await this.identityLockedFields(descriptor);
    const hasOpenOrders = await this.hasOpenOrders(descriptor.id);

    const publicValues: Record<string, string> = {};
    const secretConfigured: Record<string, boolean> = {};
    for (const field of descriptor.configFields) {
      if (field.secret) {
        secretConfigured[field.name] = Boolean(values[field.name]);
      } else {
        publicValues[field.name] = values[field.name] ?? field.default ?? '';
      }
    }

    const warnings: Array<{ level: 'danger' | 'warn'; message: string }> = [];
    if (row?.enabled && missing.length > 0) {
      warnings.push({
        level: 'danger',
        message: `渠道已启用但缺少必填项：${missing.join(', ')}。发起支付会返回 503。`,
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
          '渠道已启用但未配置回调公网地址：请在渠道配置填写 publicBaseUrl，或设置 PAYMENT_NOTIFY_BASE；否则发起支付会返回 503。',
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
        message: '生产环境未配置 PAYMENT_SECRET_KEY，支付渠道凭据无法安全加密/解密。',
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
        message: '存在未完成订单引用当前渠道，保存新版本不会影响这些订单的验签与查单。',
      });
    }

    return {
      id: descriptor.id,
      name: descriptor.name,
      icon: descriptor.icon,
      checkoutMode: descriptor.checkoutMode,
      enabled: Boolean(row?.enabled),
      configured: missing.length === 0,
      closeAfterMinutes: row?.closeAfterMinutes ?? 30,
      version: row?.version ?? null,
      configId: row?.id ?? null,
      configEnabled: Boolean(row?.enabled),
      values: publicValues,
      secretConfigured,
      configFields: descriptor.configFields,
      supportedCurrencies: descriptor.supportedCurrencies,
      supportsReconciliation: descriptor.supportsReconciliation,
      missing,
      identityLockedFields: locked,
      hasOpenOrders,
      updatedAt: row?.createdAt ? row.createdAt.toISOString() : null,
      warnings,
    };
  }

  private async identityLockedFields(descriptor: PaymentAdapterDescriptor): Promise<string[]> {
    const identityFields = descriptor.configFields.filter((f) => f.identity).map((f) => f.name);
    if (identityFields.length === 0) return [];
    const bound = await this.prisma.order.count({
      where: { channel: descriptor.id, status: { in: ['paid', 'refunded', 'partial_refunded'] } },
    });
    return bound > 0 ? identityFields : [];
  }

  private async hasOpenOrders(providerId: string): Promise<boolean> {
    const count = await this.prisma.order.count({
      where: { channel: providerId, status: 'pending' },
    });
    return count > 0;
  }
}

function digestOfConfig(
  providerId: string,
  enabled: boolean,
  closeAfterMinutes: number,
  values: Record<string, string>,
): string {
  const normalized = Object.keys(values)
    .filter((k) => values[k] !== undefined && values[k] !== '')
    .sort()
    .map((k) => `${k}=${values[k]}`)
    .join('\n');
  return createHash('sha256')
    .update(`${providerId}\n${enabled ? 1 : 0}\n${closeAfterMinutes}\n${normalized}`)
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
