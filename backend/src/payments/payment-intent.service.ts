import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../common/app.exception';
import { SettingsService } from '../common/settings.service';
import { OrderService } from '../orders/order.service';
import { PrismaService } from '../prisma/prisma.service';
import { getAdapter } from './adapters';
import {
  isVisiblePaymentMethod,
  PaymentAdapter,
  PaymentContext,
  PaymentCurrency,
  PaymentProviderId,
  VisiblePaymentMethod,
} from './adapters/types';
import { PaymentAttemptService } from './payment-attempt.service';
import { PaymentConfigService, type ResolvedVisiblePayment } from './payment-config.service';
import type { PaymentIntentView } from './payment-order.types';
import { truncate } from './payment-order.util';

/** 规范回调入口；未列出的渠道没有可用的回调地址，不能发起支付。 */
const CANONICAL_NOTIFY_PATHS: Partial<Record<PaymentProviderId, string>> = {
  epay: 'easypay',
  alipay: 'alipay',
  wechat: 'wxpay',
  stripe: 'stripe',
};

/** 发起支付租约：渠道下单异常缓慢时，超过该时长允许新请求接管 */
const INTENT_LEASE_MS = 5 * 60_000;

/** 发起支付入参。`providerId` 省略时要求可用来源唯一，否则返回 400。 */
export interface CreatePaymentIntentInput {
  orderId: string;
  userId: string;
  providerId?: string;
  clientIp?: string;
  clientUserAgent?: string;
}

/**
 * 发起支付编排。
 *
 * 只决定「这笔订单怎么付」：渠道解析、配置版本固定、租约、渠道下单与
 * 写回本地 checkout；入账、查单、关单各有独立服务。
 */
@Injectable()
export class PaymentIntentService {
  private readonly logger = new Logger(PaymentIntentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly configs: PaymentConfigService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
    private readonly attempts: PaymentAttemptService,
  ) {}

  /**
   * 渠道异步通知地址。
   *
   * 只提供规范公开入口，URL 不携带 configId：回调服务会按订单引用的历史
   * Payment 反查下单时的配置版本。没有规范入口的渠道（PayPal / ZPay / 沙箱）
   * 直接拒绝发起支付，不生成一个没有接收方的地址。
   *
   * 优先使用渠道配置里保存的 `publicBaseUrl`；没配才回落到全局
   * `PAYMENT_NOTIFY_BASE`。这样多域名/反代部署时，每个渠道可以指向自己的
   * 公网入口，不必重启改环境变量。
   */
  notifyUrl(providerId: PaymentProviderId, publicBaseUrl?: string): string {
    const canonicalPath = CANONICAL_NOTIFY_PATHS[providerId];
    if (!canonicalPath) {
      throw new AppError(50301, `支付渠道 ${providerId} 没有规范回调地址，暂不支持发起支付`, 503);
    }
    const configuredBase =
      publicBaseUrl?.trim() || (this.config.get<string>('payment.notifyBase') ?? '').trim();
    if (!configuredBase) {
      throw new AppError(
        50301,
        '真实支付渠道缺少回调公网地址，请配置渠道 publicBaseUrl 或 PAYMENT_NOTIFY_BASE',
        503,
      );
    }
    const base = configuredBase.replace(/\/$/, '');
    return `${base}/api/v1/payment/webhook/${canonicalPath}`;
  }

  async createIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentView> {
    let order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
      include: { items: true, payments: true, membershipPlan: true },
    });
    if (!order) throw new AppError(40400, '订单不存在', 404);
    if (order.userId !== input.userId) throw new AppError(40301, '无权支付该订单', 403);
    if (order.status === 'paid') throw new AppError(40901, '订单已支付', 409);
    if (order.status !== 'pending') {
      throw new AppError(40901, '订单状态已变化，请刷新后重试', 409);
    }

    const currency = (order.currency || 'CNY') as PaymentCurrency;

    // 0 元单不经任何渠道：渠道既不能收 0 元，也无法回调
    if (order.paidCents <= 0) {
      await this.orders.markPaid({
        orderId: order.id,
        userId: input.userId,
        payTransactionId: `FREE-${order.orderNo}`,
        channel: 'free',
        currency,
        providerStatus: 'FREE',
        providerPaidAt: new Date(),
      });
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        amountCents: 0,
        currency,
        providerId: 'free',
        configId: null,
        configVersion: null,
        mode: 'free',
        checkoutValue: '',
        expiresAt: order.expiresAt.toISOString(),
        sandbox: false,
        hint: '0 元订单已直接完成，无需支付',
      };
    }

    if (order.expiresAt.getTime() <= Date.now()) {
      throw new AppError(40901, '订单已超时关闭', 409);
    }

    const paymentRules = await this.settings.paymentRules();
    if (!paymentRules.enabled) {
      throw new AppError(50301, '支付功能已关闭', 503);
    }

    /*
     * 只解析一次。availableVisible() 再 resolveVisible() 会让轮询/最少金额
     * 在“展示可用”和“真正下单”之间切换实例，甚至把订单写到未展示的实例。
     */
    const options = await this.configs.resolveVisibleOptions(currency, order.paidCents, {
      includeDailyLimitExceeded: true,
    });
    if (options.length === 0) {
      throw new AppError(50301, '管理员尚未选择可用支付来源，请联系管理员配置', 503);
    }
    let method: VisiblePaymentMethod;
    if (!input.providerId) {
      if (options.length > 1) {
        throw new AppError(40001, '存在多个可用支付方式，请指定 providerId', 400);
      }
      method = options[0].view.id;
    } else if (!isVisiblePaymentMethod(input.providerId)) {
      throw new AppError(40001, `支付方式不可用: ${input.providerId}`, 400);
    } else {
      method = input.providerId;
    }
    const selectedOption = options.find((option) => option.view.id === method);
    if (!selectedOption) {
      throw new AppError(40001, `支付方式不可用: ${method}`, 400);
    }
    const resolved = selectedOption.resolved;
    const { config: initialConfig, providerId: initialProviderId } = resolved;
    const initialAdapter = getAdapter(initialProviderId);
    if (!initialAdapter) {
      throw new AppError(40001, `未知支付渠道: ${initialProviderId}`, 400);
    }
    if (!initialConfig.enabled) throw new AppError(50301, '支付渠道已停用', 503);
    const missing = initialAdapter.validateConfig(initialConfig.values);
    if (missing.length > 0) {
      throw new AppError(50301, `支付渠道未完成配置（缺少 ${missing.join(', ')}）`, 503);
    }

    /*
     * 发起支付租约必须覆盖「关闭旧尝试 → 渠道下单 → 写回本地」全过程。
     *
     * 只在数据库事务里防重不够：渠道下单是网络 IO，事务外仍会有两个请求
     * 同时看到“没有旧尝试”，各自创建一个可支付链接。用户付了其中任一笔，
     * 另一笔只能退款，严重时形成真实重复扣款。
     */
    const intentLeaseAt = new Date();
    const intentClaim = await this.prisma.order.updateMany({
      where: {
        id: order.id,
        status: 'pending',
        expiresAt: { gt: intentLeaseAt },
        closeStartedAt: null,
        OR: [
          { intentStartedAt: null },
          {
            intentStartedAt: {
              lte: new Date(intentLeaseAt.getTime() - INTENT_LEASE_MS),
            },
          },
        ],
      },
      data: { intentStartedAt: intentLeaseAt },
    });
    if (intentClaim.count === 0) {
      const latest = await this.prisma.order.findUnique({
        where: { id: order.id },
        select: { status: true, expiresAt: true, closeStartedAt: true },
      });
      if (!latest) throw new AppError(40400, '订单不存在', 404);
      if (latest.status === 'paid') throw new AppError(40901, '订单已支付', 409);
      if (latest.status !== 'pending')
        throw new AppError(40901, '订单状态已变化，请刷新后重试', 409);
      if (latest.expiresAt.getTime() <= Date.now())
        throw new AppError(40901, '订单已超时关闭', 409);
      if (latest.closeStartedAt) throw new AppError(40901, '订单正在关闭，请稍后刷新重试', 409);
      throw new AppError(40901, '该订单正在发起另一笔支付，请稍后刷新重试', 409);
    }

    let claimedSelection: ResolvedVisiblePayment | undefined;
    let intentSucceeded = false;
    try {
      // 拿到租约后重新读取：上一笔 intent 可能刚好在本请求等待期间提交，
      // 旧快照里没有它的 Payment，直接用于关单会漏关。
      const fresh = await this.prisma.order.findUnique({
        where: { id: order.id },
        include: { items: true, payments: true, membershipPlan: true },
      });
      if (!fresh) throw new AppError(40400, '订单不存在', 404);
      if (fresh.status === 'paid') throw new AppError(40901, '订单已支付', 409);
      if (fresh.status !== 'pending')
        throw new AppError(40901, '订单状态已变化，请刷新后重试', 409);
      if (fresh.expiresAt.getTime() <= Date.now()) throw new AppError(40901, '订单已超时关闭', 409);
      order = fresh;

      /*
       * 同一订单重复发起：必须先确认并关闭旧渠道尝试，再创建新尝试。
       * 只改本地 Payment 状态会留下仍可支付的旧链接；用户支付旧链接后，
       * 订单已由新链接置为 paid，第二笔真实扣款只会被幂等忽略。
       */
      await this.attempts.closePendingAttemptsBeforeRetry(order, intentLeaseAt);

      /*
       * 实例选择、最新配置校验、日限额检查和 pending Payment 写入必须在同一
       * 事务内完成。仅在这里 claim 轮询槽位仍不够：两个订单可能选中同一实例，
       * 各自在事务外读到相同用量，随后同时越过实例日限额。
       */
      const reserved = await this.configs.reserveVisiblePaymentAttempt({
        method: resolved.method,
        currency,
        amountCents: order.paidCents,
        orderId: order.id,
        userId: input.userId,
        resolved,
      });
      claimedSelection = reserved.resolved;
      const providerId = claimedSelection.providerId;
      const config = claimedSelection.config;
      const adapter = getAdapter(providerId);
      if (!adapter) throw new AppError(40001, `未知支付渠道: ${providerId}`, 400);
      const context: PaymentContext = {
        providerId: config.providerId,
        configId: config.id,
        configVersion: config.version,
        ...(claimedSelection.providerMethod
          ? { paymentMethod: claimedSelection.providerMethod }
          : {}),
        values: config.values,
      };
      const payment = reserved.payment;

      const now = Date.now();
      const expiresAt = new Date(
        Math.min(order.expiresAt.getTime(), now + config.closeAfterMinutes * 60_000),
      );

      let checkout: Awaited<ReturnType<PaymentAdapter['createOrder']>>;
      try {
        checkout = await adapter.createOrder({
          config: context,
          orderId: order.id,
          orderNo: order.orderNo,
          amountCents: order.paidCents,
          currency,
          subject: buildPaymentSubject(
            order,
            paymentRules.productNamePrefix,
            paymentRules.productNameSuffix,
          ),
          returnUrl: this.checkoutReturnUrl(order),
          notifyUrl: this.notifyUrl(config.providerId, config.values.publicBaseUrl),
          clientIp: input.clientIp,
          clientUserAgent: input.clientUserAgent,
          alipayMobilePrecreateDeepLink: paymentRules.alipayMobilePrecreateDeepLink,
          expiresAt,
        });
      } catch (e) {
        const message = truncate((e as Error).message || String(e), 200);
        await this.prisma.payment.updateMany({
          where: { id: payment.id, status: 'pending' },
          data: { status: 'failed', lastError: message, message },
        });
        await this.prisma.order.updateMany({
          where: { id: order.id, status: 'pending' },
          data: { lastError: message, checkoutValue: '' },
        });
        this.logger.error(`发起支付失败 (${providerId}) 订单 ${order.orderNo}: ${message}`);
        throw new AppError(50302, '发起支付失败，请稍后重试', 503);
      }

      const checkoutValue = checkout.codeUrl ?? checkout.payUrl ?? checkout.clientSecret ?? '';

      // 先落渠道单据 id：即使随后订单状态已变化，也能定位并关闭本次渠道订单。
      if (checkout.providerRef) {
        await this.prisma.payment.updateMany({
          where: { id: payment.id, status: 'pending' },
          data: { providerRef: checkout.providerRef },
        });
      }

      /*
       * 条件更新必须同时校验订单状态和租约所有权。
       * 渠道下单期间订单可能已被回调置为 paid（或用户取消）；也可能因渠道超时
       * 导致租约过期并被新请求接管。此时旧请求不能覆盖新 checkout。
       */
      const updated = await this.prisma.order.updateMany({
        where: {
          id: order.id,
          status: 'pending',
          intentStartedAt: intentLeaseAt,
        },
        data: {
          channel: providerId,
          providerConfigId: config.id,
          providerConfigVersion: config.version,
          providerInstanceId: config.instanceId,
          checkoutMode: checkout.mode,
          checkoutValue,
          checkoutExpiresAt: checkout.expiresAt,
          expiresAt: checkout.expiresAt < order.expiresAt ? checkout.expiresAt : order.expiresAt,
          lastError: null,
          lastQueriedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        // 订单状态已变化：把刚创建的渠道订单关掉，避免用户再付一次
        try {
          await adapter.closeOrder({
            config: context,
            orderNo: order.orderNo,
            providerRef: checkout.providerRef,
          });
        } catch (e) {
          this.logger.warn(
            `订单状态已变化，关闭新渠道订单失败 (${providerId}): ${(e as Error).message}`,
          );
        }
        await this.prisma.payment.updateMany({
          where: { id: payment.id, status: 'pending' },
          data: {
            status: 'closed',
            closedAt: new Date(),
            lastError: '订单状态已变化',
            message: '订单状态已变化',
          },
        });
        throw new AppError(40901, '订单状态已变化，请刷新后重试', 409);
      }

      intentSucceeded = true;

      this.logger.log(
        `发起支付: 订单 ${order.orderNo} 方式 ${resolved.method} -> 渠道 ${providerId} v${config.version} 金额 ${order.paidCents} 分`,
      );

      return {
        orderId: order.id,
        orderNo: order.orderNo,
        amountCents: order.paidCents,
        currency,
        providerId: resolved.method,
        configId: config.id,
        configVersion: config.version,
        mode: checkout.mode,
        payUrl: checkout.payUrl,
        codeUrl: checkout.codeUrl,
        schemeUrl: checkout.schemeUrl,
        clientSecret: checkout.clientSecret,
        publishableKey: checkout.publishableKey,
        returnUrl: this.checkoutReturnUrl(order),
        checkoutValue,
        expiresAt: checkout.expiresAt.toISOString(),
        sandbox: false,
        hint: checkout.hint ?? null,
      };
    } finally {
      if (claimedSelection && !intentSucceeded) {
        await this.configs.releaseVisibleSelection(claimedSelection).catch((e) => {
          this.logger.warn(`回滚支付轮询槽位失败 订单 ${order.orderNo}: ${(e as Error).message}`);
        });
      }
      await this.prisma.order
        .updateMany({
          where: { id: order.id, intentStartedAt: intentLeaseAt },
          data: { intentStartedAt: null },
        })
        .catch((e) => {
          this.logger.warn(`释放发起支付租约失败 订单 ${order.orderNo}: ${(e as Error).message}`);
        });
    }
  }

  private webBase(): string {
    return (this.config.get<string>('app.webBase') || 'http://localhost:5100').replace(/\/$/, '');
  }

  /**
   * 渠道收银台完成后的返回地址。
   *
   * 必须回到“这张订单”的结算页，而不是订单列表：前端据此主动查单，
   * 支付宝同步跳回时即使异步通知尚未到达，也能立即向渠道核实并展示结果。
   */
  private checkoutReturnUrl(order: {
    id: string;
    membershipPlanId?: string | null;
    items?: Array<{ skuSnapshot: string }>;
  }): string {
    const query = new URLSearchParams({
      orderId: order.id,
      paymentReturn: '1',
    });
    const sku = order.items?.[0]?.skuSnapshot;
    if (sku) return `${this.webBase()}/checkout/${encodeURIComponent(sku)}?${query.toString()}`;
    if (order.membershipPlanId) {
      return `${this.webBase()}/checkout/membership?${query.toString()}`;
    }
    return `${this.webBase()}/orders?${query.toString()}`;
  }
}

function buildPaymentSubject(
  order: {
    orderNo: string;
    items: Array<{ nameSnapshot?: string | null; quantity?: number | null }>;
    membershipPlan?: { name?: string | null } | null;
  },
  prefix: string,
  suffix: string,
): string {
  const itemNames = order.items
    .map((item) => {
      const name = item.nameSnapshot?.trim();
      if (!name) return '';
      const quantity = item.quantity ?? 1;
      return quantity > 1 ? `${name} ×${quantity}` : name;
    })
    .filter(Boolean);
  const planName = order.membershipPlan?.name?.trim();
  const base = itemNames.length > 0 ? itemNames.join('、') : planName || `订单 ${order.orderNo}`;
  return truncate(`${prefix}${base}${suffix}`.trim(), 120);
}
