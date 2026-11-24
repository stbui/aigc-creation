import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { getAdapter } from './adapters';
import type { PaymentAdapterDescriptor, PaymentProviderId } from './adapters/types';
import { PaymentCipher } from './payment-cipher';
import type { ResolvedPaymentConfig } from './payment-config.types';
import { compareInstanceRows, paymentMethodsOf } from './payment-config.util';

/**
 * 渠道配置的数据平面：追加写版本链的读取、解密与投影。
 *
 * 三件事只在这里做，其他配置 service 要么调它、要么只做编排：
 *   1. `(providerId, instanceId)` 取最新版本，永不跨实例回落；
 *   2. 密文解密成 `values`，解密失败统一抛 50302；
 *   3. 订单已引用实例的身份字段锁定与未完成订单探测。
 *
 * 不发起支付，也不组装后台视图 —— 后者需要告警与字段元数据。
 */
@Injectable()
export class PaymentConfigStore {
  private readonly logger = new Logger(PaymentConfigStore.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PaymentCipher,
  ) {}

  /** 某渠道的全部最新实例，按后台排序返回。 */
  async listInstances(providerId: PaymentProviderId): Promise<ResolvedPaymentConfig[]> {
    const rows = await this.latestRowsByInstance(providerId);
    return rows.sort(compareInstanceRows).map((row) => this.toResolved(row));
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

  /** 按 Payment 引用的 configId 精确解析。 */
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
    return this.latestInstance(adapter.descriptor.id, order.providerInstanceId || 'default');
  }

  /** 每个实例的最新版本；事务内可传入 tx 的 delegate。 */
  async latestRowsByInstance(
    providerId: string,
    delegate: Prisma.TransactionClient['paymentProviderConfig'] = this.prisma.paymentProviderConfig,
  ) {
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

  async latestRow(providerId: string, instanceId: string) {
    return this.prisma.paymentProviderConfig.findFirst({
      where: { providerId, instanceId },
      orderBy: { version: 'desc' },
    });
  }

  valuesFor(row: { configCipher: string }): Record<string, string> {
    return this.decode(row);
  }

  /** 凭据只以密文落库；写入方不接触加密细节。 */
  sealConfig(values: Record<string, string>): string {
    return this.cipher.encrypt(JSON.stringify(values));
  }

  toResolved(
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
      values: values ?? this.valuesFor(row),
    };
  }

  /** 实例身份字段（appId / mchId 等）已有已支付订单时禁止变更。 */
  async identityLockedFields(
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

  async hasOpenOrders(providerId: string, instanceId: string): Promise<boolean> {
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

  async configIdsOfInstance(providerId: string, instanceId: string): Promise<string[]> {
    const delegate = this.prisma
      .paymentProviderConfig as typeof this.prisma.paymentProviderConfig & {
      findMany?: typeof this.prisma.paymentProviderConfig.findMany;
    };
    if (typeof delegate.findMany !== 'function') return [];
    const rows = await delegate.findMany({
      where: { providerId, instanceId },
      select: { id: true },
    });
    return rows.map((row) => row.id);
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
}
