import { Injectable, OnModuleInit } from '@nestjs/common';
import type { PaymentCurrency, PaymentProviderId, VisiblePaymentMethod } from './adapters/types';
import { PaymentConfigAdminService } from './payment-config-admin.service';
import { PaymentConfigStore } from './payment-config-store';
import type {
  AdminPaymentProviderInstanceView,
  AdminPaymentProviderView,
  AvailableProviderView,
  ReserveVisiblePaymentAttemptInput,
  ReservedVisiblePaymentAttempt,
  ResolvedPaymentConfig,
  ResolvedVisiblePayment,
  SavePaymentInstanceInput,
  VisiblePaymentOption,
  VisiblePaymentProviderView,
} from './payment-config.types';
import { PaymentRoutingService } from './payment-routing.service';

export type {
  AdminPaymentProviderInstanceView,
  AdminPaymentProviderView,
  AvailableProviderView,
  ReserveVisiblePaymentAttemptInput,
  ReservedVisiblePaymentAttempt,
  ResolvedPaymentConfig,
  ResolvedVisiblePayment,
  SavePaymentInstanceInput,
  VisiblePaymentOption,
  VisiblePaymentProviderView,
} from './payment-config.types';

/**
 * 支付渠道配置服务的门面。
 *
 * 不可动摇的规则：
 *   1. 追加写：实例配置修改产生新版本；订单/Payment 固定 configId，历史回调
 *      永远能取到当时的密钥。
 *   2. 密钥只进密文：响应只回 secretConfigured。
 *   3. 前台只认来源选择：官方/易支付不可自动回退；来源下无可用实例即隐藏。
 *   4. 实例停用只摘流：不物理删除，历史订单继续依赖 providerConfigId。
 *
 * 实现按平面拆开，门面只做委托，调用方（网关、订单、worker、后台）不随内部
 * 拆分而改动：
 *
 *   store    版本链读取、解密、按订单解析、身份字段锁定
 *   console  后台视图、版本化保存、排序、env 首启引导
 *   routing  C 端可见方式选路、负载均衡、支付尝试预占
 */
@Injectable()
export class PaymentConfigService implements OnModuleInit {
  constructor(
    private readonly store: PaymentConfigStore,
    private readonly admin: PaymentConfigAdminService,
    private readonly routing: PaymentRoutingService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.admin.bootstrapFromEnv();
  }

  // ── 读取 ────────────────────────────────────────────────────────

  /** 后台列表：每个渠道一张卡，卡内包含全部实例。 */
  listAdmin(): Promise<AdminPaymentProviderView[]> {
    return this.admin.listAdmin();
  }

  /** 某渠道的全部最新实例，按后台排序返回。 */
  listInstances(providerId: PaymentProviderId): Promise<ResolvedPaymentConfig[]> {
    return this.store.listInstances(providerId);
  }

  /** 指定实例的最新版本。 */
  latestInstance(
    providerId: PaymentProviderId,
    instanceId: string,
  ): Promise<ResolvedPaymentConfig | null> {
    return this.store.latestInstance(providerId, instanceId);
  }

  /** 按 Payment 引用的 configId 精确解析。 */
  byId(configId: string): Promise<ResolvedPaymentConfig> {
    return this.store.byId(configId);
  }

  /**
   * 订单固定版本；历史单无 configId 时只回落到它自己的实例（或旧默认实例），
   * 绝不跨实例、跨渠道。
   */
  resolveForOrder(order: {
    channel: string;
    providerConfigId: string | null;
    providerInstanceId?: string | null;
  }): Promise<ResolvedPaymentConfig | null> {
    return this.store.resolveForOrder(order);
  }

  /** 任一实例已启用、字段齐全且支持目标币种。 */
  available(currency: PaymentCurrency): Promise<AvailableProviderView[]> {
    return this.routing.available(currency);
  }

  /** C 端固定可见支付方式；不推进轮询游标。 */
  availableVisible(
    currency: PaymentCurrency,
    amountCents?: number,
  ): Promise<VisiblePaymentProviderView[]> {
    return this.routing.availableVisible(currency, amountCents);
  }

  /** 币种白名单校验与归一化。 */
  normalizeCurrency(currency?: string | null): PaymentCurrency {
    return this.routing.normalizeCurrency(currency);
  }

  /**
   * 一次解析两个按钮及其真实实例。创建订单必须直接消费这里的结果，
   * 不能再次 resolveVisible，否则轮询/最少金额可能在下单前漂移。
   */
  resolveVisibleOptions(
    currency: PaymentCurrency,
    amountCents?: number,
    options?: { includeDailyLimitExceeded?: boolean },
  ): Promise<VisiblePaymentOption[]> {
    return this.routing.resolveVisibleOptions(currency, amountCents, options);
  }

  /** 解析某个可见支付方式当前应走的唯一真实实例。 */
  resolveVisible(
    method: VisiblePaymentMethod,
    currency: PaymentCurrency,
    amountCents?: number,
    options?: { includeDailyLimitExceeded?: boolean },
  ): Promise<ResolvedVisiblePayment | null> {
    return this.routing.resolveVisible(method, currency, amountCents, options);
  }

  /** 原子预占一笔支付尝试（事务内锁定实例、重读用量、写 pending Payment）。 */
  reserveVisiblePaymentAttempt(
    input: ReserveVisiblePaymentAttemptInput,
  ): Promise<ReservedVisiblePaymentAttempt> {
    return this.routing.reserveVisiblePaymentAttempt(input);
  }

  /** 创建渠道订单前原子领取轮询槽位。 */
  claimVisibleSelection(resolved: ResolvedVisiblePayment): Promise<ResolvedVisiblePayment> {
    return this.routing.claimVisibleSelection(resolved);
  }

  /** 本次领取尚未产生渠道订单时归还槽位；已被后续请求越过则保持不回滚。 */
  releaseVisibleSelection(resolved: ResolvedVisiblePayment): Promise<void> {
    return this.routing.releaseVisibleSelection(resolved);
  }

  // ── 写入 ────────────────────────────────────────────────────────

  /** 新建实例；instanceId 只能由服务端生成。 */
  createInstance(
    providerId: string,
    input: Partial<SavePaymentInstanceInput>,
    actorId: string,
  ): Promise<AdminPaymentProviderInstanceView> {
    return this.admin.createInstance(providerId, input, actorId);
  }

  /** 指定实例保存新版本。 */
  saveInstanceVersion(
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
    return this.admin.saveInstanceVersion(providerId, instanceId, input, actorId);
  }

  /** 拖拽排序只改最新行的展示顺序，不改凭据/版本链。 */
  reorderInstances(
    providerId: string,
    instanceIds: string[],
    actorId: string,
  ): Promise<AdminPaymentProviderView> {
    return this.admin.reorderInstances(providerId, instanceIds, actorId);
  }

  /** env → v1；仅当库内完全没有该渠道配置时生效。 */
  bootstrapFromEnv(): Promise<void> {
    return this.admin.bootstrapFromEnv();
  }
}
