import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { SettingsService } from '../common/settings.service';
import { allAdapters, getAdapter, requireAdapter } from './adapters';
import {
  PAYMENT_CURRENCIES,
  VISIBLE_PAYMENT_METHODS,
  type PaymentAdapter,
  type PaymentCurrency,
  type PaymentProviderId,
  type PaymentSource,
  type VisiblePaymentMethod,
} from './adapters/types';
import { paymentConfigWarnings } from './payment-config-warning';
import { PaymentConfigStore } from './payment-config-store';
import type {
  AvailableProviderView,
  ReserveVisiblePaymentAttemptInput,
  ReservedVisiblePaymentAttempt,
  ResolvedPaymentConfig,
  ResolvedVisiblePayment,
  VisiblePaymentOption,
  VisiblePaymentProviderView,
} from './payment-config.types';
import { compareInstanceRows, paymentMethodsOf, shanghaiDateKey } from './payment-config.util';
import { startOfShanghaiDay } from './payment-query';

/** 配置行类型直接取自数据平面，新增列时不用两处同步。 */
type ConfigRow = Awaited<ReturnType<PaymentConfigStore['latestRowsByInstance']>>[number];

/**
 * C 端支付方式的选路与支付尝试预占。
 *
 * 只回答两件事：**这个按钮现在能不能显示**、**这次支付落到哪个实例**。
 * 后者必须原子：展示与下单之间可能已有并发订单吃掉日限额，因此
 * `reserveVisiblePaymentAttempt` 在一个事务内锁实例行、重读用量、写 pending Payment。
 *
 * 来源（官方 / 易支付）由管理员设置决定，不可自动回退；来源下无可用实例即隐藏。
 */
@Injectable()
export class PaymentRoutingService {
  private readonly logger = new Logger(PaymentRoutingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
    private readonly store: PaymentConfigStore,
  ) {}

  /** 任一实例已启用、字段齐全且支持目标币种。 */
  async available(currency: PaymentCurrency): Promise<AvailableProviderView[]> {
    const out: AvailableProviderView[] = [];
    for (const adapter of allAdapters()) {
      const d = adapter.descriptor;
      if (!d.supportedCurrencies.includes(currency)) continue;
      if (d.id === 'sandbox' && this.config.get<string>('app.env') === 'production') continue;
      const rows = await this.store.latestRowsByInstance(d.id);
      const usable = rows.some((row) => {
        if (!row.enabled) return false;
        try {
          return adapter.validateConfig(this.store.valuesFor(row)).length === 0;
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
    const options = await this.resolveVisibleOptions(currency, amountCents);
    return options.map((option) => option.view);
  }

  /**
   * 币种白名单校验与归一化。
   *
   * 放在本 service 而非 controller: 白名单是支付域规则, 且「默认币种配置
   * 被改坏」与「用户传了非法币种」都应在这里给出一致的拒绝语义。
   */
  normalizeCurrency(currency?: string | null): PaymentCurrency {
    if (!currency) return 'CNY';
    if (!(PAYMENT_CURRENCIES as string[]).includes(currency)) {
      throw new AppError(40001, `不支持的币种: ${currency}`, 400);
    }
    return currency as PaymentCurrency;
  }

  /**
   * 一次解析两个按钮及其真实实例。创建订单必须直接消费这里的结果，
   * 不能再次 resolveVisible，否则轮询/最少金额可能在下单前漂移。
   */
  async resolveVisibleOptions(
    currency: PaymentCurrency,
    amountCents?: number,
    options?: { includeDailyLimitExceeded?: boolean },
  ): Promise<VisiblePaymentOption[]> {
    const out: VisiblePaymentOption[] = [];
    for (const method of VISIBLE_PAYMENT_METHODS) {
      const resolved = await this.resolveVisible(method, currency, amountCents, options);
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
    options?: { includeDailyLimitExceeded?: boolean },
  ): Promise<ResolvedVisiblePayment | null> {
    const source = await this.sourceOf(method);
    if (source === 'unset') return null;

    const providerId: PaymentProviderId = source === 'official' ? method : 'epay';
    const adapter = getAdapter(providerId);
    if (!adapter || !adapter.descriptor.supportedCurrencies.includes(currency)) return null;

    const rows = (await this.store.latestRowsByInstance(providerId)).sort(compareInstanceRows);
    const eligible = this.eligibleInstances(adapter, rows, method, amountCents);
    if (eligible.length === 0) return null;

    const usage = await this.dailyInstanceUsage(
      providerId,
      eligible.map((item) => item.row.instanceId),
    );
    const withinDailyLimit = options?.includeDailyLimitExceeded
      ? eligible
      : eligible.filter(({ row }) => {
          if (row.dailyLimitCents == null) return true;
          const used = usage.get(row.instanceId) ?? 0;
          if (amountCents === undefined) return used < row.dailyLimitCents;
          return used + Math.max(0, amountCents) <= row.dailyLimitCents;
        });
    if (withinDailyLimit.length === 0) return null;

    const strategy = await this.settings.get<string>('payment.loadBalancingStrategy');
    let selected: { row: { instanceId: string }; config: ResolvedPaymentConfig };
    let roundRobin: ResolvedVisiblePayment['roundRobin'];
    if (strategy === 'least-amount') {
      selected = this.leastAmountInstance(withinDailyLimit, usage);
    } else {
      const rotation = await this.roundRobinInstance(providerId, method, withinDailyLimit);
      selected = rotation.selected;
      roundRobin = rotation.snapshot;
    }

    return {
      method,
      providerId,
      config: selected.config,
      ...(providerId === 'epay' ? { providerMethod: method } : {}),
      ...(roundRobin ? { roundRobin } : {}),
    };
  }

  /**
   * 原子预占一笔支付尝试。
   *
   * 只在 resolveVisible() 里看日限额不够：展示与发起支付之间可能已有并发订单
   * 占用额度。这里在一个事务内重新读取来源和实例最新版本、锁定候选配置行、
   * 汇总当日用量，并在同一事务写入 pending Payment。后到事务会等待前一笔
   * 提交后再读取用量，因此两个并发请求不能同时越过同一实例的日限额。
   */
  async reserveVisiblePaymentAttempt(
    input: ReserveVisiblePaymentAttemptInput,
  ): Promise<ReservedVisiblePaymentAttempt> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new AppError(40001, '支付金额必须为正整数（分）', 400);
    }

    return this.prisma.$transaction(async (tx) => {
      const source = await this.sourceOf(input.method);
      if (source === 'unset') {
        throw new AppError(50301, '管理员尚未选择可用支付来源，请联系管理员配置', 503);
      }
      const providerId: PaymentProviderId = source === 'official' ? input.method : 'epay';
      if (input.resolved && input.resolved.providerId !== providerId) {
        throw new AppError(50301, '支付来源已变更，请刷新页面后重试', 503);
      }
      const adapter = getAdapter(providerId);
      if (!adapter || !adapter.descriptor.supportedCurrencies.includes(input.currency)) {
        throw new AppError(50301, '当前支付方式不支持该币种', 503);
      }

      const preliminary = (
        await this.store.latestRowsByInstance(providerId, tx.paymentProviderConfig)
      ).sort(compareInstanceRows);
      if (preliminary.length === 0) {
        throw new AppError(50301, '管理员尚未选择可用支付来源，请联系管理员配置', 503);
      }

      /*
       * SQLite 的交互式事务是 deferred，先读后写仍可能让两个事务读到同一份
       * 用量。no-op UPDATE 会先取得实例配置行写锁；锁按 instanceId 固定排序，
       * 避免多实例并发时形成反向加锁。锁后再重读最新版本，防止用旧配置建单。
       */
      const instanceIds = preliminary
        .map((row) => row.instanceId)
        .sort((a, b) => a.localeCompare(b));
      for (const instanceId of instanceIds) {
        await tx.$executeRaw`
          UPDATE "PaymentProviderConfig"
          SET "version" = "version"
          WHERE "providerId" = ${providerId}
            AND "instanceId" = ${instanceId}
        `;
      }

      const rows = (
        await this.store.latestRowsByInstance(providerId, tx.paymentProviderConfig)
      ).sort(compareInstanceRows);
      const eligible = this.eligibleInstances(adapter, rows, input.method, input.amountCents);
      if (eligible.length === 0) {
        throw new AppError(50301, '支付渠道未完成配置或当前金额不在可支付范围内', 503);
      }

      const strategy = await this.settings.get<string>('payment.loadBalancingStrategy');
      let claimedCursor: number | null = null;
      if (strategy !== 'least-amount') {
        const cursor = await tx.paymentRoundRobinCursor.upsert({
          where: { providerId_method: { providerId, method: input.method } },
          create: { providerId, method: input.method, cursor: 1 },
          update: { cursor: { increment: 1 } },
          select: { cursor: true },
        });
        claimedCursor = Math.max(1, cursor.cursor);
      }

      const usage = await this.dailyInstanceUsage(
        providerId,
        eligible.map((item) => item.row.instanceId),
        tx.payment,
      );
      const withinDailyLimit = eligible.filter(({ row }) => {
        if (row.dailyLimitCents == null) return true;
        return (usage.get(row.instanceId) ?? 0) + input.amountCents <= row.dailyLimitCents;
      });
      if (withinDailyLimit.length === 0) {
        throw new AppError(50301, '支付实例已达每日限额，请稍后重试或更换支付方式', 503);
      }

      const selected =
        strategy === 'least-amount'
          ? this.leastAmountInstance(withinDailyLimit, usage)
          : withinDailyLimit[
              claimedCursor == null ? 0 : (claimedCursor - 1) % withinDailyLimit.length
            ];
      if (!selected) {
        throw new AppError(50301, '支付负载均衡暂不可用，请稍后重试', 503);
      }

      const payment = await tx.payment.create({
        data: {
          orderId: input.orderId,
          userId: input.userId,
          channel: providerId,
          providerMethod: input.method,
          amountCents: input.amountCents,
          currency: input.currency,
          status: 'pending',
          providerConfigId: selected.config.id,
          providerConfigVersion: selected.config.version,
          providerInstanceId: selected.config.instanceId,
        },
      });

      return {
        payment,
        resolved: {
          method: input.method,
          providerId,
          config: selected.config,
          ...(providerId === 'epay' ? { providerMethod: input.method } : {}),
          ...(claimedCursor == null
            ? {}
            : {
                roundRobin: {
                  providerId,
                  method: input.method,
                  cursor: claimedCursor,
                  eligibleInstances: eligible.map((item) => ({
                    instanceId: item.row.instanceId,
                    config: item.config,
                  })),
                },
              }),
        },
      };
    });
  }

  /**
   * 创建渠道订单前原子领取轮询槽位。
   *
   * 先读 cursor 再在下单后提交会让并发请求读到同一个值并命中同一实例。
   * 这里用单条 upsert 完成「读取并递增」，再按领取到的序号确定实例；
   * 渠道失败时通过 releaseVisibleSelection() 做条件回滚，只有没有后续
   * 领取者时才归还槽位，绝不会把游标减到已分配序号之前。
   */
  async claimVisibleSelection(resolved: ResolvedVisiblePayment): Promise<ResolvedVisiblePayment> {
    const snapshot = resolved.roundRobin;
    if (!snapshot || snapshot.eligibleInstances.length === 0) return resolved;
    const delegate = (
      this.prisma as unknown as {
        paymentRoundRobinCursor?: {
          upsert(args: unknown): Promise<{ cursor: number }>;
        };
      }
    ).paymentRoundRobinCursor;
    if (!delegate) return resolved;

    try {
      const claimed = await delegate.upsert({
        where: {
          providerId_method: {
            providerId: snapshot.providerId,
            method: snapshot.method,
          },
        },
        create: { providerId: snapshot.providerId, method: snapshot.method, cursor: 1 },
        update: { cursor: { increment: 1 } },
        select: { cursor: true },
      });
      const selected =
        snapshot.eligibleInstances[
          (Math.max(1, claimed.cursor) - 1) % snapshot.eligibleInstances.length
        ];
      return {
        ...resolved,
        config: selected.config,
        roundRobin: { ...snapshot, cursor: claimed.cursor },
      };
    } catch (e) {
      this.logger.error(`支付轮询游标领取失败: ${(e as Error).message}`);
      throw new AppError(50301, '支付负载均衡暂不可用，请稍后重试', 503);
    }
  }

  /** 本次领取尚未产生渠道订单时归还槽位；已被后续请求越过则保持不回滚。 */
  async releaseVisibleSelection(resolved: ResolvedVisiblePayment): Promise<void> {
    const snapshot = resolved.roundRobin;
    if (!snapshot) return;
    const delegate = (
      this.prisma as unknown as {
        paymentRoundRobinCursor?: {
          updateMany(args: unknown): Promise<{ count: number }>;
        };
      }
    ).paymentRoundRobinCursor;
    if (!delegate) return;
    try {
      await delegate.updateMany({
        where: {
          providerId: snapshot.providerId,
          method: snapshot.method,
          cursor: snapshot.cursor,
        },
        data: { cursor: { decrement: 1 } },
      });
    } catch (e) {
      this.logger.warn(`支付轮询游标回滚失败: ${(e as Error).message}`);
    }
  }

  // ── 内部 ────────────────────────────────────────────────────────

  /**
   * 候选实例过滤的唯一实现：展示与预占必须用同一套口径，
   * 否则会出现「按钮可见、下单报渠道未配置」。
   */
  private eligibleInstances(
    adapter: PaymentAdapter,
    rows: ConfigRow[],
    method: VisiblePaymentMethod,
    amountCents?: number,
  ): Array<{ row: ConfigRow; config: ResolvedPaymentConfig }> {
    const eligible: Array<{ row: ConfigRow; config: ResolvedPaymentConfig }> = [];
    for (const row of rows) {
      if (!row.enabled) continue;
      if (!paymentMethodsOf(row, adapter.descriptor.id).includes(method)) continue;
      if (amountCents !== undefined) {
        if (row.minAmountCents != null && amountCents < row.minAmountCents) continue;
        if (row.maxAmountCents != null && amountCents > row.maxAmountCents) continue;
      }
      let values: Record<string, string>;
      try {
        values = this.store.valuesFor(row);
      } catch (e) {
        this.logger.error(
          `C 端支付实例不可用 (${method} -> ${adapter.descriptor.id}/${row.instanceId}) 解密失败: ${(e as Error).message}`,
        );
        continue;
      }
      const missing = adapter.validateConfig(values);
      if (missing.length > 0) continue;
      if (
        paymentConfigWarnings(adapter.descriptor, row, values, missing, this.config).some(
          (warning) => warning.level === 'danger',
        )
      ) {
        continue;
      }
      eligible.push({ row, config: this.store.toResolved(row, values) });
    }
    return eligible;
  }

  private async sourceOf(method: VisiblePaymentMethod): Promise<PaymentSource> {
    const raw = await this.settings.get<string>(`payment.${method}Source`);
    return raw === 'official' || raw === 'epay' ? raw : 'unset';
  }

  private async dailyInstanceUsage(
    providerId: string,
    instanceIds: string[],
    delegate: Prisma.TransactionClient['payment'] = this.prisma.payment,
  ): Promise<Map<string, number>> {
    const usage = new Map<string, number>();
    if (instanceIds.length === 0) return usage;
    if (typeof delegate?.findMany !== 'function') return usage;
    const today = shanghaiDateKey(new Date());
    const rows = await delegate.findMany({
      where: {
        channel: providerId,
        providerInstanceId: { in: instanceIds },
        status: { in: ['pending', 'succeeded'] },
        createdAt: { gte: startOfShanghaiDay(today) },
      },
      select: {
        id: true,
        orderId: true,
        providerInstanceId: true,
        amountCents: true,
        status: true,
        createdAt: true,
      },
    });
    const byOrder = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = byOrder.get(row.orderId) ?? [];
      group.push(row);
      byOrder.set(row.orderId, group);
    }
    for (const orderRows of byOrder.values()) {
      const succeeded = orderRows
        .filter((row) => row.status === 'succeeded')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const pending = orderRows
        .filter((row) => row.status === 'pending')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const row = succeeded ?? pending;
      if (!row) continue;
      if (!row.providerInstanceId) continue;
      usage.set(row.providerInstanceId, (usage.get(row.providerInstanceId) ?? 0) + row.amountCents);
    }
    return usage;
  }

  private leastAmountInstance(
    eligible: Array<{ row: { instanceId: string }; config: ResolvedPaymentConfig }>,
    usage: Map<string, number>,
  ): { row: { instanceId: string }; config: ResolvedPaymentConfig } {
    return [...eligible].sort((a, b) => {
      const amountDiff = (usage.get(a.row.instanceId) ?? 0) - (usage.get(b.row.instanceId) ?? 0);
      if (amountDiff !== 0) return amountDiff;
      return compareInstanceRows(a.config, b.config);
    })[0];
  }

  private async roundRobinInstance(
    providerId: string,
    method: VisiblePaymentMethod,
    eligible: Array<{ row: { instanceId: string }; config: ResolvedPaymentConfig }>,
  ): Promise<{
    selected: { row: { instanceId: string }; config: ResolvedPaymentConfig };
    snapshot?: ResolvedVisiblePayment['roundRobin'];
  }> {
    const delegate = (
      this.prisma as unknown as {
        paymentRoundRobinCursor?: {
          upsert(args: unknown): Promise<{ cursor: number }>;
          updateMany(args: unknown): Promise<{ count: number }>;
        };
      }
    ).paymentRoundRobinCursor;
    if (!delegate) return { selected: eligible[0] };
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
      return {
        selected,
        snapshot: {
          providerId: providerId as PaymentProviderId,
          method,
          cursor,
          eligibleInstances: eligible.map((item) => ({
            instanceId: item.row.instanceId,
            config: item.config,
          })),
        },
      };
    } catch (e) {
      this.logger.error(`支付轮询游标读取失败: ${(e as Error).message}`);
      throw new AppError(50301, '支付负载均衡暂不可用，请稍后重试', 503);
    }
  }
}
