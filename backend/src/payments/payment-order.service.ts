import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AppError } from "../common/app.exception";
import { OrderService } from "../orders/order.service";
import { lockUserRow } from "../account/user-row-lock";
import {
  PaymentConfigService,
  type ResolvedVisiblePayment,
} from "./payment-config.service";
import { SettingsService } from "../common/settings.service";
import { getAdapter } from "./adapters";
import {
  PaymentAdapter,
  PaymentContext,
  PaymentCurrency,
  PaymentProviderId,
  ProviderPaymentResult,
  VisiblePaymentMethod,
  isVisiblePaymentMethod,
} from "./adapters/types";
import { paymentStatusOf } from "./payment-query";

export type PaymentActor =
  | { kind: "user"; userId: string }
  | { kind: "admin"; adminId: string }
  | { kind: "worker" };

/**
 * 一次可查询/可关单的渠道尝试。
 *
 * 不能只看 `Order.channel`：同一订单可能先后发起过支付宝和微信两次支付，
 * 订单上的渠道是**最后一次**发起，而用户可能支付的是更早那次。
 * 回调、查单、关单都必须逐个尝试核对，否则会漏掉已收款的旧尝试。
 */
interface AttemptContext {
  /** 对应 Payment 行；历史单可能没有，为 null */
  paymentId: string | null;
  providerId: PaymentProviderId;
  providerInstanceId: string;
  /** 渠道侧下单返回的单据 id（PayPal order id / Stripe Checkout Session id 等） */
  providerRef?: string;
  /** 渠道侧支付流水号（PayPal capture id / Stripe PaymentIntent id 等） */
  providerTradeNo?: string;
  config: PaymentContext;
  adapter: PaymentAdapter;
}

/** 支付编排租约的所有权凭证；写回 lastError / 释放租约时必须带上。 */
interface PaymentLease {
  closeLeaseAt?: Date;
  intentLeaseAt?: Date;
}

export interface PaymentIntentView {
  orderId: string;
  orderNo: string;
  amountCents: number;
  currency: string;
  providerId: VisiblePaymentMethod | "free";
  configId: string | null;
  configVersion: number | null;
  mode: string;
  payUrl?: string;
  codeUrl?: string;
  schemeUrl?: string;
  clientSecret?: string;
  publishableKey?: string;
  returnUrl?: string;
  checkoutValue: string | null;
  expiresAt: string;
  sandbox: boolean;
  hint?: string | null;
}

export interface PaymentOrderView {
  orderId: string;
  orderNo: string;
  status: string;
  displayStatus: string;
  amountCents: number;
  currency: string;
  /** C 端只暴露支付宝 / 微信 / 免费单；真实渠道（如 epay）永不外泄。 */
  providerId: VisiblePaymentMethod | "free" | "unknown";
  checkoutMode: string | null;
  checkoutValue: string | null;
  expiresAt: string;
  providerPaidAt: string | null;
  creditedAt: string | null;
  closedAt: string | null;
  lastError: string | null;
  payments: Array<{
    id: string;
    status: string;
    providerId: VisiblePaymentMethod | "free" | "unknown";
    providerRef: string | null;
    providerTradeNo: string | null;
    amountCents: number;
    createdAt: string;
  }>;
}

/** 查单节流窗口：2 秒内重复查询直接返回本地视图 */
const QUERY_THROTTLE_MS = 2_000;

/** 规范回调入口；未列出的渠道继续使用带 configId 的旧回调地址。 */
const CANONICAL_NOTIFY_PATHS: Partial<Record<PaymentProviderId, string>> = {
  epay: "easypay",
  alipay: "alipay",
  wechat: "wxpay",
  stripe: "stripe",
};

/**
 * 真实渠道 → C 端可见支付方式。
 *
 * 易支付是一套凭据承载支付宝/微信，只能在 Payment.providerMethod 已固化时
 * 投影成对应按钮；没有历史支付方式的旧单一律 unknown，不能把 epay 暴露给 C 端。
 */
function visibleProviderId(
  channel: string,
  providerMethod: string | null | undefined,
): PaymentOrderView["providerId"] {
  if (isVisiblePaymentMethod(providerMethod)) return providerMethod;
  if (isVisiblePaymentMethod(channel)) return channel;
  if (channel === "free") return "free";
  return "unknown";
}
/** 发起支付租约：渠道下单异常缓慢时，超过该时长允许新请求接管 */
const INTENT_LEASE_MS = 5 * 60_000;

/**
 * 支付编排服务 —— 唯一决定「这笔订单怎么付、付没付、能不能关」的地方。
 *
 * 与旧 `PaymentsService` 的差别：
 *   · 渠道由**数据库配置**决定（多通道并存），不再是单一 env 通道；
 *   · 每次 intent 固定 `providerConfigId/Version`，渠道轮换后历史订单仍可验签；
 *   · 订单状态只经 `OrderService.markPaid` 一条写入路径，本服务不直接写 paid。
 */
@Injectable()
export class PaymentOrderService {
  private readonly logger = new Logger(PaymentOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly configs: PaymentConfigService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * 渠道异步通知地址。
   *
   * EasyPay / 支付宝 / 微信 / Stripe 使用固定公开入口，回调服务会按订单
   * 引用的历史 Payment 反查下单时的配置版本；PayPal / ZPay / 沙箱仍保留
   * 带 configId 的旧入口，兼容尚未迁移的适配器与已写入渠道后台的旧地址。
   *
   * 优先使用渠道配置里保存的 `publicBaseUrl`；没配才回落到全局
   * `PAYMENT_NOTIFY_BASE`，最后才是本机地址。这样多域名/反代部署时，
   * 每个渠道可以指向自己的公网入口，不必重启改环境变量。
   */
  notifyUrl(
    providerId: PaymentProviderId,
    configId: string,
    publicBaseUrl?: string,
  ): string {
    const configuredBase =
      publicBaseUrl?.trim() || process.env.PAYMENT_NOTIFY_BASE?.trim();
    if (providerId !== "sandbox" && !configuredBase) {
      throw new AppError(
        50301,
        "真实支付渠道缺少回调公网地址，请配置渠道 publicBaseUrl 或 PAYMENT_NOTIFY_BASE",
        503,
      );
    }
    const base = (
      configuredBase ||
      `http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 4100}`
    ).replace(/\/$/, "");
    const canonicalPath = CANONICAL_NOTIFY_PATHS[providerId];
    return canonicalPath
      ? `${base}/api/v1/payment/webhook/${canonicalPath}`
      : `${base}/api/v1/payments/callback/${providerId}/${configId}`;
  }

  // ── 发起支付 ────────────────────────────────────────────────────

  async createIntent(input: {
    orderId: string;
    userId: string;
    providerId?: string;
    clientIp?: string;
    clientUserAgent?: string;
  }): Promise<PaymentIntentView> {
    let order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
      include: { items: true, payments: true, membershipPlan: true },
    });
    if (!order) throw new AppError(40400, "订单不存在", 404);
    if (order.userId !== input.userId)
      throw new AppError(40301, "无权支付该订单", 403);
    if (order.status === "paid") throw new AppError(40901, "订单已支付", 409);
    if (order.status !== "pending") {
      throw new AppError(40901, "订单状态已变化，请刷新后重试", 409);
    }

    const currency = (order.currency || "CNY") as PaymentCurrency;

    // 0 元单不经任何渠道：渠道既不能收 0 元，也无法回调
    if (order.paidCents <= 0) {
      await this.orders.markPaid({
        orderId: order.id,
        userId: input.userId,
        payTransactionId: `FREE-${order.orderNo}`,
        channel: "free",
        currency,
        providerStatus: "FREE",
        providerPaidAt: new Date(),
      });
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        amountCents: 0,
        currency,
        providerId: "free",
        configId: null,
        configVersion: null,
        mode: "free",
        checkoutValue: "",
        expiresAt: order.expiresAt.toISOString(),
        sandbox: false,
        hint: "0 元订单已直接完成，无需支付",
      };
    }

    if (order.expiresAt.getTime() <= Date.now()) {
      throw new AppError(40901, "订单已超时关闭", 409);
    }

    const paymentRules = await this.settings.paymentRules();
    if (!paymentRules.enabled) {
      throw new AppError(50301, "支付功能已关闭", 503);
    }

    /*
     * 只解析一次。availableVisible() 再 resolveVisible() 会让轮询/最少金额
     * 在“展示可用”和“真正下单”之间切换实例，甚至把订单写到未展示的实例。
     */
    const options = await this.configs.resolveVisibleOptions(
      currency,
      order.paidCents,
      { includeDailyLimitExceeded: true },
    );
    if (options.length === 0) {
      throw new AppError(
        50301,
        "管理员尚未选择可用支付来源，请联系管理员配置",
        503,
      );
    }
    let method: VisiblePaymentMethod;
    if (!input.providerId) {
      if (options.length > 1) {
        throw new AppError(
          40001,
          "存在多个可用支付方式，请指定 providerId",
          400,
        );
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
    if (!initialConfig.enabled) throw new AppError(50301, "支付渠道已停用", 503);
    const missing = initialAdapter.validateConfig(initialConfig.values);
    if (missing.length > 0) {
      throw new AppError(
        50301,
        `支付渠道未完成配置（缺少 ${missing.join(", ")}）`,
        503,
      );
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
        status: "pending",
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
      if (!latest) throw new AppError(40400, "订单不存在", 404);
      if (latest.status === "paid")
        throw new AppError(40901, "订单已支付", 409);
      if (latest.status !== "pending")
        throw new AppError(40901, "订单状态已变化，请刷新后重试", 409);
      if (latest.expiresAt.getTime() <= Date.now())
        throw new AppError(40901, "订单已超时关闭", 409);
      if (latest.closeStartedAt)
        throw new AppError(40901, "订单正在关闭，请稍后刷新重试", 409);
      throw new AppError(40901, "该订单正在发起另一笔支付，请稍后刷新重试", 409);
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
      if (!fresh) throw new AppError(40400, "订单不存在", 404);
      if (fresh.status === "paid") throw new AppError(40901, "订单已支付", 409);
      if (fresh.status !== "pending")
        throw new AppError(40901, "订单状态已变化，请刷新后重试", 409);
      if (fresh.expiresAt.getTime() <= Date.now())
        throw new AppError(40901, "订单已超时关闭", 409);
      order = fresh;

      /*
       * 同一订单重复发起：必须先确认并关闭旧渠道尝试，再创建新尝试。
       * 只改本地 Payment 状态会留下仍可支付的旧链接；用户支付旧链接后，
       * 订单已由新链接置为 paid，第二笔真实扣款只会被幂等忽略。
       */
      await this.closePendingAttemptsBeforeRetry(order, intentLeaseAt);

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
        Math.min(
          order.expiresAt.getTime(),
          now + config.closeAfterMinutes * 60_000,
        ),
      );

      let checkout: Awaited<ReturnType<PaymentAdapter["createOrder"]>>;
      try {
        checkout = await adapter.createOrder({
          config: context,
          orderId: order.id,
          orderNo: order.orderNo,
          amountCents: order.paidCents,
          currency,
          subject: buildPaymentSubject(order, paymentRules.productNamePrefix, paymentRules.productNameSuffix),
          returnUrl: this.checkoutReturnUrl(order),
          notifyUrl: this.notifyUrl(
            config.providerId,
            config.id,
            config.values.publicBaseUrl,
          ),
          clientIp: input.clientIp,
          clientUserAgent: input.clientUserAgent,
          alipayMobilePrecreateDeepLink:
            paymentRules.alipayMobilePrecreateDeepLink,
          expiresAt,
        });
      } catch (e) {
        const message = truncate((e as Error).message || String(e), 200);
        await this.prisma.payment.updateMany({
          where: { id: payment.id, status: "pending" },
          data: { status: "failed", lastError: message, message },
        });
        await this.prisma.order.updateMany({
          where: { id: order.id, status: "pending" },
          data: { lastError: message, checkoutValue: "" },
        });
        this.logger.error(
          `发起支付失败 (${providerId}) 订单 ${order.orderNo}: ${message}`,
        );
        throw new AppError(50302, "发起支付失败，请稍后重试", 503);
      }

      const checkoutValue =
        checkout.codeUrl ?? checkout.payUrl ?? checkout.clientSecret ?? "";

      // 先落渠道单据 id：即使随后订单状态已变化，也能定位并关闭本次渠道订单。
      if (checkout.providerRef) {
        await this.prisma.payment.updateMany({
          where: { id: payment.id, status: "pending" },
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
          status: "pending",
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
          expiresAt:
            checkout.expiresAt < order.expiresAt
              ? checkout.expiresAt
              : order.expiresAt,
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
          where: { id: payment.id, status: "pending" },
          data: {
            status: "closed",
            closedAt: new Date(),
            lastError: "订单状态已变化",
            message: "订单状态已变化",
          },
        });
        throw new AppError(40901, "订单状态已变化，请刷新后重试", 409);
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
        await this.configs
          .releaseVisibleSelection(claimedSelection)
          .catch((e) => {
            this.logger.warn(
              `回滚支付轮询槽位失败 订单 ${order.orderNo}: ${(e as Error).message}`,
            );
          });
      }
      await this.prisma.order
        .updateMany({
          where: { id: order.id, intentStartedAt: intentLeaseAt },
          data: { intentStartedAt: null },
        })
        .catch((e) => {
          this.logger.warn(
            `释放发起支付租约失败 订单 ${order.orderNo}: ${(e as Error).message}`,
          );
        });
    }
  }

  // ── 查单 ────────────────────────────────────────────────────────

  async query(input: {
    orderId: string;
    actor: PaymentActor;
    /** 用户主动点「刷新支付状态」时绕过 2 秒节流，轮询仍使用节流 */
    force?: boolean;
  }): Promise<PaymentOrderView> {
    const order = await this.loadOrder(input.orderId, input.actor);

    if (order.status !== "pending") return this.view(order);
    if (!order.providerConfigId && !order.checkoutMode) return this.view(order);
    if (
      !input.force &&
      order.lastQueriedAt &&
      Date.now() - order.lastQueriedAt.getTime() < QUERY_THROTTLE_MS
    ) {
      return this.view(order);
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { lastQueriedAt: new Date() },
    });

    let attempts: AttemptContext[];
    try {
      attempts = await this.attemptContexts(order);
    } catch (e) {
      // 配置不可用不能当成「渠道查无此单」；只记录，等运维修复配置
      const message = truncate((e as Error).message, 200);
      await this.prisma.order.update({
        where: { id: order.id },
        data: { lastError: message },
      });
      this.logger.warn(`查单前置检查失败 订单 ${order.orderNo}: ${message}`);
      return this.view(await this.loadOrder(order.id, input.actor));
    }
    if (attempts.length === 0) return this.view(order);

    // 只有**所有**尝试都被渠道明确确认关闭，才允许本地关单。
    // not_found 不参与：渠道配置/商户号填错也会返回 not_found，据此关单会漏掉已付款订单。
    let allExplicitlyClosed = true;

    for (const attempt of attempts) {
      let result: ProviderPaymentResult;
      try {
        result = await attempt.adapter.queryOrder({
          config: attempt.config,
          orderNo: order.orderNo,
          providerRef: attempt.providerRef,
          providerTradeNo: attempt.providerTradeNo,
        });
      } catch (e) {
        // 查询失败不改变本地状态，只写 lastError 供排障
        const message = truncate((e as Error).message, 200);
        await this.prisma.order.update({
          where: { id: order.id },
          data: { lastError: message },
        });
        this.logger.warn(
          `查单失败 订单 ${order.orderNo} (${attempt.providerId}): ${message}`,
        );
        return this.view(await this.loadOrder(order.id, input.actor));
      }

      if (result.state === "paid") {
        try {
          await this.applyPaymentResult({
            orderId: order.id,
            providerId: attempt.providerId,
            configId: attempt.config.configId,
            paymentId: attempt.paymentId ?? undefined,
            providerInstanceId: attempt.providerInstanceId,
            tradeNo: result.tradeNo ?? "",
            amountCents: result.amountCents ?? -1,
            currency: result.currency ?? (order.currency as PaymentCurrency),
            paidAt: result.paidAt ?? new Date(),
            providerStatus: result.providerStatus,
            rawPayload: result.rawPayload,
            providerRef: attempt.providerRef,
          });
        } catch (e) {
          // 金额/币种/状态不符时保留 pending，交给对账/人工处理，不能静默吞掉
          this.logger.error(
            `查单入账失败 订单 ${order.id}: ${(e as Error).message}`,
          );
        }
        return this.view(await this.loadOrder(order.id, input.actor));
      }

      if (result.state === "closed") {
        await this.closeAttempt(attempt.paymentId);
        continue;
      }
      if (result.state === "not_found") {
        allExplicitlyClosed = false;
        continue;
      }
      if (result.state === "failed") {
        const message = truncate(result.error ?? "查单失败", 200);
        await this.prisma.order.update({
          where: { id: order.id },
          data: { lastError: message },
        });
        return this.view(await this.loadOrder(order.id, input.actor));
      }
      // pending：渠道仍在等待支付，不能关单、也不能继续检查别的尝试后下结论
      allExplicitlyClosed = false;
    }

    if (allExplicitlyClosed) await this.localClose(order.id);
    return this.view(await this.loadOrder(order.id, input.actor));
  }

  // ── 关单 ────────────────────────────────────────────────────────

  async close(input: {
    orderId: string;
    actor: PaymentActor;
  }): Promise<PaymentOrderView> {
    const order = await this.loadOrder(input.orderId, input.actor);
    if (order.status === "cancelled") {
      // 幂等修补历史中断：即使已取消，也补做 pending 支付收尾与库存释放。
      await this.localClose(order.id);
      return this.view(await this.loadOrder(order.id, input.actor));
    }
    if (order.status !== "pending") {
      throw new AppError(40901, "订单状态已变化，无法关闭，请刷新后重试", 409);
    }

    const closeLeaseAt = new Date();
    const staleLeaseBefore = new Date(Date.now() - 5 * 60_000);

    /*
     * 抢关单租约：除了防止用户手动关单与 worker 同时执行，还必须与
     * createIntent 的租约互斥。否则关单读取完旧 Payment 后，另一请求可能
     * 新建渠道订单；旧关单随后只关闭了快照中的旧尝试并取消本地订单，
     * 新渠道链接仍可付款。
     */
    const lease = await this.prisma.order.updateMany({
      where: {
        id: order.id,
        status: "pending",
        AND: [
          {
            OR: [
              { closeStartedAt: null },
              { closeStartedAt: { lte: staleLeaseBefore } },
            ],
          },
          {
            OR: [
              { intentStartedAt: null },
              { intentStartedAt: { lte: staleLeaseBefore } },
            ],
          },
        ],
      },
      data: { closeStartedAt: closeLeaseAt },
    });
    if (lease.count === 0)
      return this.view(await this.loadOrder(order.id, input.actor));

    /*
     * 取消频率额度必须在拿到关单租约之后、查单之前预留。
     * 先抢租约可避免同一订单的并发取消重复占额度；额度不足时只需释放租约，
     * 不应向渠道发起任何查单/关单请求。
     */
    let cancelEventId: string | null = null;
    if (input.actor.kind === "user") {
      try {
        cancelEventId = await this.reserveCancelEvent(order.id, input.actor.userId);
      } catch (e) {
        await this.releaseCloseLease(order.id, undefined, { closeLeaseAt });
        throw e;
      }
    }

    let cancelFinalized = false;
    try {
    // 抢到租约后必须重读：等待租约期间可能刚有支付尝试落库。
    const fresh = await this.loadOrder(order.id, input.actor);
    let attempts: AttemptContext[];
    try {
      attempts = await this.attemptContexts(fresh);
    } catch (e) {
      return this.failClose(
        order.id,
        `支付配置不可用，无法查单/关单: ${(e as Error).message}`,
        { closeLeaseAt },
      );
    }

    // 从未发起过支付的空单：本地关闭即可
    if (attempts.length === 0) {
      cancelFinalized = await this.localClose(
        order.id,
        closeLeaseAt,
        cancelEventId ?? undefined,
      );
      this.logger.log(`订单已关闭: ${order.orderNo} by ${input.actor.kind}`);
      return this.view(await this.loadOrder(order.id, input.actor));
    }

    /*
     * 关单前必须逐个尝试验证：渠道查询/关单任一步失败都不能本地关单。
     * 否则「渠道暂时不可达」会被误判成「渠道没收到钱」，用户随后仍能支付，
     * 而回调到达时订单已是 cancelled，直接变成已收款不入账。
     */
    for (const attempt of attempts) {
      const queryInput = {
        config: attempt.config,
        orderNo: order.orderNo,
        providerRef: attempt.providerRef,
        providerTradeNo: attempt.providerTradeNo,
      };

      let queried: ProviderPaymentResult;
      try {
        queried = await attempt.adapter.queryOrder(queryInput);
      } catch (e) {
        return this.failClose(
          order.id,
          `关单前查单失败 (${attempt.providerId}): ${(e as Error).message}`,
          { closeLeaseAt },
        );
      }

      if (queried.state === "paid") {
        await this.creditPaidAttempt(order, attempt, queried, {
          closeLeaseAt,
        });
        throw new AppError(40901, "渠道已支付，订单已入账，请刷新后查看", 409);
      }
      if (queried.state === "failed") {
        return this.failClose(
          order.id,
          `关单前查单失败 (${attempt.providerId}): ${queried.error ?? "未知错误"}`,
          { closeLeaseAt },
        );
      }

      if (queried.state === "pending") {
        let closed: ProviderPaymentResult;
        try {
          closed = await attempt.adapter.closeOrder(queryInput);
        } catch (e) {
          return this.failClose(
            order.id,
            `渠道关单失败 (${attempt.providerId}): ${(e as Error).message}`,
            { closeLeaseAt },
          );
        }
        if (closed.state === "paid") {
          await this.creditPaidAttempt(order, attempt, closed, {
            closeLeaseAt,
          });
          throw new AppError(
            40901,
            "渠道已支付，订单已入账，请刷新后查看",
            409,
          );
        }
        if (closed.state !== "closed" && closed.state !== "not_found") {
          return this.failClose(
            order.id,
            `渠道关单未成功 (${attempt.providerId}): ${closed.error ?? closed.state}`,
            { closeLeaseAt },
          );
        }
      }

      await this.closeAttempt(attempt.paymentId);
    }

    cancelFinalized = await this.localClose(
      order.id,
      closeLeaseAt,
      cancelEventId ?? undefined,
    );
    this.logger.log(`订单已关闭: ${order.orderNo} by ${input.actor.kind}`);
    return this.view(await this.loadOrder(order.id, input.actor));
    } finally {
      if (cancelEventId && !cancelFinalized) {
        await this.releaseCancelReservation(cancelEventId);
      }
    }
  }

  /**
   * 关闭超时未支付订单。所有调用方（旧调度器 / 支付 worker）都必须走这里，
   * 不能自己 `updateMany({status:'cancelled'})` —— 那会绕过渠道查单与库存释放。
   */
  async closeExpired(limit = 50): Promise<number> {
    const expired = await this.prisma.order.findMany({
      where: {
        status: "pending",
        expiresAt: { lte: new Date() },
        OR: [
          { closeStartedAt: null },
          { closeStartedAt: { lte: new Date(Date.now() - 5 * 60_000) } },
        ],
      },
      take: limit,
      select: { id: true },
    });

    let closed = 0;
    for (const item of expired) {
      try {
        const view = await this.close({
          orderId: item.id,
          actor: { kind: "worker" },
        });
        if (view.status === "cancelled") closed += 1;
      } catch (e) {
        // 已支付会抛 409，属正常竞态；其它错误留给下一轮重试
        this.logger.warn(
          `关闭超时订单 ${item.id} 未完成: ${(e as Error).message}`,
        );
      }
    }
    return closed;
  }

  // ── 入账（回调 / 查单 / 对账共用）─────────────────────────────────

  async applyPaymentResult(input: {
    orderId: string;
    providerId: PaymentProviderId;
    configId: string;
    providerConfigVersion?: number;
    paymentMethod?: VisiblePaymentMethod;
    tradeNo: string;
    amountCents: number;
    currency: string;
    paidAt: Date;
    providerStatus?: string;
    rawPayload: string;
    /** 渠道侧下单单据 id；由已知的支付尝试或回调报文带入 */
    providerRef?: string;
    /** 调用方已定位到的支付尝试；不传则按渠道取最新 pending */
    paymentId?: string;
    /** 本次实际入账的服务商实例；不传时从支付尝试或订单恢复 */
    providerInstanceId?: string;
  }): Promise<{ applied: boolean; idempotentHit: boolean }> {
    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
    });
    if (!order) throw new AppError(40400, "订单不存在", 404);

    if (order.status === "paid") {
      /*
       * 只有**同一个渠道交易号**才是幂等重放。
       *
       * 已支付订单收到另一个交易号，说明渠道侧发生了第二笔成功扣款（旧链接
       * 未关干净、用户重复支付等）。旧实现直接按幂等成功返回，第二笔钱既
       * 不落 Payment 也不落异常单；若渠道不支持对账就完全不可见。
       *
       * 这里抛 409，让回调收件箱把差异落到 PaymentExceptionCase；真正的
       * 同号重复回调仍走幂等，不会影响渠道重试。
       */
      const knownTradeNo = order.providerTradeNo ?? "";
      if (input.tradeNo && knownTradeNo && input.tradeNo !== knownTradeNo) {
        const samePayment = await this.prisma.payment.findUnique({
          where: { payTransactionId: input.tradeNo },
          select: { orderId: true },
        });
        if (samePayment?.orderId !== order.id) {
          throw new AppError(
            40901,
            `订单已支付，渠道交易号 ${input.tradeNo} 与已入账交易号 ${knownTradeNo} 不一致`,
            409,
          );
        }
      }
      return { applied: false, idempotentHit: true };
    }
    if (order.status !== "pending") {
      throw new AppError(40901, "订单状态已变化，无法入账，请刷新后重试", 409);
    }
    if (!input.tradeNo) throw new AppError(40001, "缺少渠道交易号", 400);
    if (input.amountCents !== order.paidCents) {
      throw new AppError(
        40901,
        `渠道金额 ${input.amountCents} 分与订单应付 ${order.paidCents} 分不一致`,
        409,
      );
    }
    if ((input.currency || "CNY") !== (order.currency || "CNY")) {
      throw new AppError(
        40901,
        `币种不一致: 渠道 ${input.currency} / 订单 ${order.currency}`,
        409,
      );
    }

    // 只更新**同一渠道**的 pending 尝试；否则跨渠道重试时会把另一笔尝试
    // 改成本次渠道的交易号，后台支付尝试记录会张冠李戴。
    //
    // 对账补单等调用方可能无法提供 paymentId。此时只有在候选唯一时才能
    // 自动归属；同一订单在同一渠道/实例下有多条 pending 尝试时，任何
    // “取最新一条”都会把成功流水挂到错误单据上，必须转人工确认。
    let pendingAttempts: Array<{ id: string; providerInstanceId: string | null }> = [];
    if (!input.paymentId) {
      pendingAttempts = await this.prisma.payment.findMany({
        where: {
          orderId: order.id,
          status: "pending",
          channel: input.providerId,
          ...(input.providerInstanceId
            ? { providerInstanceId: input.providerInstanceId }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, providerInstanceId: true },
      });
      if (pendingAttempts.length > 1) {
        throw new AppError(
          40901,
          `订单存在多条待支付尝试（${pendingAttempts.length} 条），无法确定本次渠道流水归属，请人工核对`,
          409,
        );
      }
    }
    const attempt = input.paymentId ?? pendingAttempts[0];
    const paymentId =
      typeof attempt === "string" ? attempt : attempt?.id;
    const providerInstanceId =
      input.providerInstanceId ??
      (typeof attempt === "string" ? undefined : attempt?.providerInstanceId) ??
      order.providerInstanceId ??
      undefined;

    const result = await this.orders.markPaid({
      orderId: order.id,
      userId: order.userId,
      payTransactionId: input.tradeNo,
      channel: input.providerId,
      currency: input.currency,
      providerConfigId: input.configId,
      providerConfigVersion: input.providerConfigVersion,
      providerMethod: input.paymentMethod,
      providerInstanceId,
      providerStatus: input.providerStatus,
      providerPaidAt: input.paidAt,
      paymentId,
      amountCents: input.amountCents,
      rawPayload: input.rawPayload,
      providerRef: input.providerRef,
    });

    return {
      applied: !result.idempotentHit,
      idempotentHit: result.idempotentHit,
    };
  }

  // ── 视图 ────────────────────────────────────────────────────────

  /** 列出该订单所有可能的渠道尝试。渠道单据 id 不同的尝试不能合并。 */
  private async attemptContexts(order: {
    channel: string;
    providerConfigId: string | null;
    providerInstanceId?: string | null;
    checkoutMode: string | null;
    payments: Array<{
      id: string;
      channel: string;
      providerMethod: string | null;
      status: string;
      providerConfigId: string | null;
      providerInstanceId: string | null;
      providerRef: string | null;
      payTransactionId: string | null;
    }>;
  }): Promise<AttemptContext[]> {
    const contexts: AttemptContext[] = [];
    const seen = new Set<string>();

    for (const payment of order.payments) {
      if (!payment.channel || payment.channel === "free") continue;
      /*
       * PayPal/Stripe 每次 intent 都有独立单据 id，必须逐条核对；只按渠道 + 配置
       * 去重会漏掉更早的 Session。无 providerRef 的 pending 单也不能合并。
       * 只有历史/支付宝/微信这类按商户订单号查询的已结束尝试可按渠道去重。
       */
      const key =
        payment.providerRef ||
        payment.status === "pending" ||
        !payment.payTransactionId
          ? `${payment.channel}:${payment.providerConfigId ?? "latest"}:${payment.providerRef ?? payment.id}`
          : `${payment.channel}:${payment.providerConfigId ?? "latest"}:order`;
      if (seen.has(key)) continue;
      seen.add(key);

      const config = await this.configs.resolveForOrder({
        channel: payment.channel,
        providerConfigId: payment.providerConfigId,
        providerInstanceId: payment.providerInstanceId,
      });
      const adapter = getAdapter(payment.channel);
      if (!config || !adapter) {
        // 不能跳过：跳过会让 close() 误以为所有尝试都已核对完毕
        throw new Error(`支付渠道 ${payment.channel} 的配置不可用`);
      }
      const paymentMethod =
        payment.providerMethod && isVisiblePaymentMethod(payment.providerMethod)
          ? payment.providerMethod
          : payment.channel === "alipay" || payment.channel === "wechat"
            ? payment.channel
            : undefined;
      contexts.push({
        paymentId: payment.id,
        providerId: config.providerId,
        providerInstanceId: config.instanceId,
        providerRef: payment.providerRef ?? undefined,
        providerTradeNo: payment.payTransactionId ?? undefined,
        config: {
          providerId: config.providerId,
          configId: config.id,
          configVersion: config.version,
          ...(paymentMethod ? { paymentMethod } : {}),
          values: config.values,
        },
        adapter,
      });
    }

    // 历史单没有 Payment 行，但有订单级配置时仍要按订单渠道核对一次
    if (
      contexts.length === 0 &&
      (order.providerConfigId || order.checkoutMode)
    ) {
      const config = await this.configs.resolveForOrder({
        channel: order.channel,
        providerConfigId: order.providerConfigId,
        providerInstanceId: order.providerInstanceId,
      });
      const adapter = getAdapter(order.channel);
      if (!config || !adapter)
        throw new Error(`支付渠道 ${order.channel} 的配置不可用`);
      contexts.push({
        paymentId: null,
        providerId: config.providerId,
        providerInstanceId: config.instanceId,
        providerRef: undefined,
        providerTradeNo: undefined,
        config: {
          providerId: config.providerId,
          configId: config.id,
          configVersion: config.version,
          ...(order.channel === "alipay" || order.channel === "wechat"
            ? { paymentMethod: order.channel }
            : {}),
          values: config.values,
        },
        adapter,
      });
    }

    return contexts;
  }

  /** 渠道已确认支付：先核对金额/交易号，再走唯一入账入口。 */
  private async creditPaidAttempt(
    order: { id: string; orderNo: string; providerTradeNo: string | null },
    attempt: AttemptContext,
    result: ProviderPaymentResult,
    lease: PaymentLease,
  ): Promise<void> {
    if (result.amountCents === undefined) {
      return this.failClose(
        order.id,
        `渠道已支付但未返回金额 (${attempt.providerId})，暂不入账，请人工核对`,
        lease,
      );
    }
    const tradeNo = result.tradeNo ?? order.providerTradeNo ?? "";
    if (!tradeNo) {
      return this.failClose(
        order.id,
        `渠道已支付但未返回交易号 (${attempt.providerId})，暂不入账`,
        lease,
      );
    }

    try {
      await this.applyPaymentResult({
        orderId: order.id,
        providerId: attempt.providerId,
        configId: attempt.config.configId,
        paymentId: attempt.paymentId ?? undefined,
        providerInstanceId: attempt.providerInstanceId,
        tradeNo,
        amountCents: result.amountCents,
        currency: result.currency ?? "CNY",
        paidAt: result.paidAt ?? new Date(),
        providerStatus: result.providerStatus,
        rawPayload: result.rawPayload,
        providerRef: attempt.providerRef,
      });
    } catch (e) {
      await this.releaseCloseLease(
        order.id,
        `渠道已支付但入账失败: ${(e as Error).message}`,
        lease,
      );
      throw e;
    }
  }

  /** 本地标记单笔支付尝试为 closed；不动订单状态。 */
  private async closeAttempt(paymentId: string | null): Promise<void> {
    if (!paymentId) return;
    await this.prisma.payment.updateMany({
      where: { id: paymentId, status: "pending" },
      data: { status: "closed", closedAt: new Date() },
    });
  }

  /**
   * 重新发起支付前收尾旧 pending 尝试。
   *
   * 先查单再关单：渠道可能已经收款，直接关单会把真实支付误判为未支付。
   * 任一旧尝试无法确认关闭时宁可拒绝创建新支付，也不能留下两个可支付链接。
   */
  private async closePendingAttemptsBeforeRetry(
    order: {
      id: string;
      orderNo: string;
      channel: string;
      providerConfigId: string | null;
      providerInstanceId?: string | null;
      providerTradeNo: string | null;
      checkoutMode: string | null;
      payments: Array<{
        id: string;
        channel: string;
        providerMethod: string | null;
        status: string;
        providerConfigId: string | null;
        providerInstanceId: string | null;
        providerRef: string | null;
        payTransactionId: string | null;
      }>;
    },
    intentLeaseAt: Date,
  ): Promise<void> {
    const pendingPayments = order.payments.filter(
      (payment) => payment.status === "pending" && payment.channel !== "free",
    );
    if (pendingPayments.length === 0) return;

    let attempts: AttemptContext[];
    try {
      attempts = await this.attemptContexts({ ...order, payments: pendingPayments });
    } catch (e) {
      return this.failClose(
        order.id,
        `旧支付尝试配置不可用，无法确认关闭: ${(e as Error).message}`,
        { intentLeaseAt },
      );
    }

    for (const attempt of attempts) {
      const queryInput = {
        config: attempt.config,
        orderNo: order.orderNo,
        providerRef: attempt.providerRef,
        providerTradeNo: attempt.providerTradeNo,
      };

      let queried: ProviderPaymentResult;
      try {
        queried = await attempt.adapter.queryOrder(queryInput);
      } catch (e) {
        return this.failClose(
          order.id,
          `旧支付尝试查单失败 (${attempt.providerId}): ${(e as Error).message}`,
          { intentLeaseAt },
        );
      }
      if (queried.state === "paid") {
        await this.creditPaidAttempt(order, attempt, queried, {
          intentLeaseAt,
        });
        throw new AppError(40901, "旧支付尝试已支付，订单已入账，请刷新后查看", 409);
      }
      if (queried.state === "failed") {
        return this.failClose(
          order.id,
          `旧支付尝试查单失败 (${attempt.providerId}): ${queried.error ?? "未知错误"}`,
          { intentLeaseAt },
        );
      }

      if (queried.state === "pending") {
        let closed: ProviderPaymentResult;
        try {
          closed = await attempt.adapter.closeOrder(queryInput);
        } catch (e) {
          return this.failClose(
            order.id,
            `旧支付尝试关闭失败 (${attempt.providerId}): ${(e as Error).message}`,
            { intentLeaseAt },
          );
        }
        if (closed.state === "paid") {
          await this.creditPaidAttempt(order, attempt, closed, {
            intentLeaseAt,
          });
          throw new AppError(40901, "旧支付尝试已支付，订单已入账，请刷新后查看", 409);
        }
        if (closed.state !== "closed" && closed.state !== "not_found") {
          return this.failClose(
            order.id,
            `旧支付尝试无法关闭 (${attempt.providerId}): ${closed.error ?? closed.state}`,
            { intentLeaseAt },
          );
        }
      }

      // 渠道明确 closed/not_found，或刚刚关闭成功，才收尾本地尝试。
      await this.closeAttempt(attempt.paymentId);
    }
  }

  /**
   * 关单失败：保留订单 pending 并释放自己持有的租约，等待下一轮重试。
   * 过期请求不能清掉新请求的租约，也不能覆盖新请求写入的 lastError。
   * 绝不能在这里把订单改成 cancelled —— 渠道可能已收款。
   */
  private async failClose(
    orderId: string,
    message: string,
    lease: PaymentLease,
  ): Promise<never> {
    const text = truncate(message, 200);
    await this.prisma.order.updateMany({
      where: {
        id: orderId,
        ...(lease.closeLeaseAt
          ? { closeStartedAt: lease.closeLeaseAt }
          : { intentStartedAt: lease.intentLeaseAt }),
      },
      data: {
        lastError: text,
        ...(lease.closeLeaseAt ? { closeStartedAt: null } : {}),
      },
    });
    throw new AppError(50302, text, 503);
  }

  private async releaseCloseLease(
    orderId: string,
    message?: string,
    lease: PaymentLease = {},
  ): Promise<void> {
    await this.prisma.order.updateMany({
      where: {
        id: orderId,
        ...(lease.closeLeaseAt
          ? { closeStartedAt: lease.closeLeaseAt }
          : lease.intentLeaseAt
            ? { intentStartedAt: lease.intentLeaseAt }
            : {}),
      },
      data: {
        ...(lease.closeLeaseAt ? { closeStartedAt: null } : {}),
        ...(message ? { lastError: truncate(message, 200) } : {}),
      },
    });
  }

  /**
   * 预留一次用户主动取消额度。
   *
   * 用户行锁把「计数 → 写入预留」串行化，避免并发取消同时读到旧计数。
   * 同一订单已有 reserved/consumed 记录时直接复用，不重复计数。
   */
  private async reserveCancelEvent(
    orderId: string,
    userId: string,
  ): Promise<string | null> {
    const rules = await this.settings.paymentRules();
    if (!rules.cancelLimitEnabled) return null;

    const unitMs = rules.cancelWindowUnit === "hour" ? 60 * 60_000 : 60_000;
    const windowMs = Math.max(1, rules.cancelWindowSize) * unitMs;
    const now = new Date();
    const fixedWindowStart = new Date(
      Math.floor(now.getTime() / windowMs) * windowMs,
    );
    const rollingWindowStart = new Date(now.getTime() - windowMs);
    const windowStart =
      rules.cancelWindowMode === "fixed" ? fixedWindowStart : now;
    const windowEnd = new Date(windowStart.getTime() + windowMs);

    return this.prisma.$transaction(async (tx) => {
      await lockUserRow(tx, userId);

      const existing = await tx.orderCancelEvent.findUnique({
        where: { orderId },
        select: { id: true, status: true },
      });
      if (
        existing &&
        (existing.status === "reserved" || existing.status === "consumed")
      ) {
        return existing.id;
      }

      const where: Prisma.OrderCancelEventWhereInput = {
        userId,
        status: { in: ["reserved", "consumed"] },
        NOT: { orderId },
        ...(rules.cancelWindowMode === "fixed"
          ? { windowStart: fixedWindowStart }
          : { reservedAt: { gte: rollingWindowStart } }),
      };
      const used = await tx.orderCancelEvent.count({ where });
      if (used >= rules.cancelLimitMax) {
        throw new AppError(
          42901,
          `取消订单过于频繁，请稍后再试（${rules.cancelWindowSize} ${rules.cancelWindowUnit === "hour" ? "小时" : "分钟"}内最多 ${rules.cancelLimitMax} 次）`,
          429,
        );
      }

      if (existing) {
        await tx.orderCancelEvent.update({
          where: { id: existing.id },
          data: {
            status: "reserved",
            windowMode: rules.cancelWindowMode,
            windowStart,
            windowEnd,
            reservedAt: now,
            consumedAt: null,
            releasedAt: null,
          },
        });
        return existing.id;
      }

      const created = await tx.orderCancelEvent.create({
        data: {
          orderId,
          userId,
          status: "reserved",
          windowMode: rules.cancelWindowMode,
          windowStart,
          windowEnd,
          reservedAt: now,
        },
        select: { id: true },
      });
      return created.id;
    });
  }

  /** 关单未成功时归还预留额度；已被其他路径消费的记录保持 consumed。 */
  private async releaseCancelReservation(eventId: string): Promise<void> {
    await this.prisma.orderCancelEvent.updateMany({
      where: { id: eventId, status: "reserved" },
      data: { status: "released", releasedAt: new Date() },
    });
  }

  /**
   * 本地关单：置 cancelled、关闭 pending 尝试、释放库存，全部同一事务。
   *
   * `closeLeaseAt` 是关单租约所有权。传了就只允许持锁者落终态；不传时用于
   * 查单后的关闭和已取消订单修补，要求当前没有并发 intent/close。
   * 对已 cancelled 的订单仍补做支付收尾和库存释放，修复旧版本中断留下的
   * “订单已取消但库存仍占用”状态。
   */
  private async localClose(
    orderId: string,
    closeLeaseAt?: Date,
    cancelEventId?: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          status: "pending",
          ...(closeLeaseAt
            ? { closeStartedAt: closeLeaseAt }
            : { closeStartedAt: null, intentStartedAt: null }),
        },
        data: {
          status: "cancelled",
          closedAt: new Date(),
          closeStartedAt: null,
          intentStartedAt: null,
          checkoutValue: "",
          lastError: null,
        },
      });

      const current = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      if (updated.count === 0 && current?.status !== "cancelled") return false;

      // 订单关闭后，未完成的支付尝试也必须收尾，否则后台会一直显示 pending。
      await tx.payment.updateMany({
        where: { orderId, status: "pending" },
        data: { status: "closed", closedAt: new Date() },
      });
      // 必须复用同一事务，否则进程中断会留下“已取消但库存仍 reserved”。
      await this.orders.releaseReservation(orderId, tx);
      // 只有订单真正落为 cancelled，取消额度才从 reserved 转为 consumed。
      if (cancelEventId) {
        await tx.orderCancelEvent.updateMany({
          where: { id: cancelEventId, orderId, status: "reserved" },
          data: { status: "consumed", consumedAt: new Date(), releasedAt: null },
        });
      }
      return true;
    });
  }

  private async loadOrder(orderId: string, actor: PaymentActor) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: { orderBy: { createdAt: "desc" } } },
    });
    if (!order) throw new AppError(40400, "订单不存在", 404);
    if (actor.kind === "user" && order.userId !== actor.userId) {
      throw new AppError(40301, "无权查看该订单", 403);
    }
    return order;
  }

  private view(order: {
    id: string;
    orderNo: string;
    status: string;
    paidCents: number;
    currency: string;
    channel: string;
    checkoutMode: string | null;
    checkoutValue: string | null;
    expiresAt: Date;
    providerPaidAt: Date | null;
    paidAt: Date | null;
    closedAt: Date | null;
    lastError: string | null;
    closeStartedAt: Date | null;
    providerConfigId: string | null;
    payments: Array<{
      id: string;
      status: string;
      channel: string;
      providerMethod: string | null;
      providerRef: string | null;
      payTransactionId: string | null;
      amountCents: number;
      createdAt: Date;
    }>;
  }): PaymentOrderView {
    const displayStatus = paymentStatusOf({
      status: order.status,
      closeStartedAt: order.closeStartedAt,
      lastError: order.lastError,
      providerConfigId: order.providerConfigId,
      checkoutMode: order.checkoutMode,
    });
    const terminal =
      displayStatus !== "pending" &&
      displayStatus !== "created" &&
      displayStatus !== "closing";
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      status: order.status,
      displayStatus,
      amountCents: order.paidCents,
      currency: order.currency || "CNY",
      providerId: visibleProviderId(order.channel, order.payments[0]?.providerMethod),
      checkoutMode: order.checkoutMode,
      checkoutValue: terminal ? "" : order.checkoutValue,
      expiresAt: order.expiresAt.toISOString(),
      providerPaidAt: order.providerPaidAt
        ? order.providerPaidAt.toISOString()
        : null,
      creditedAt: order.paidAt ? order.paidAt.toISOString() : null,
      closedAt: order.closedAt ? order.closedAt.toISOString() : null,
      lastError: order.lastError,
      payments: order.payments.map((p) => ({
        id: p.id,
        status: p.status,
        providerId: visibleProviderId(p.channel, p.providerMethod),
        providerRef: p.providerRef,
        providerTradeNo: p.payTransactionId,
        amountCents: p.amountCents,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  private webBase(): string {
    return (process.env.WEB_BASE_URL || "http://localhost:5100").replace(
      /\/$/,
      "",
    );
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
      paymentReturn: "1",
    });
    const sku = order.items?.[0]?.skuSnapshot;
    if (sku)
      return `${this.webBase()}/checkout/${encodeURIComponent(sku)}?${query.toString()}`;
    if (order.membershipPlanId) {
      return `${this.webBase()}/checkout/membership?${query.toString()}`;
    }
    return `${this.webBase()}/orders?${query.toString()}`;
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
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
      if (!name) return "";
      const quantity = item.quantity ?? 1;
      return quantity > 1 ? `${name} ×${quantity}` : name;
    })
    .filter(Boolean);
  const planName = order.membershipPlan?.name?.trim();
  const base = itemNames.length > 0
    ? itemNames.join("、")
    : planName || `订单 ${order.orderNo}`;
  return truncate(`${prefix}${base}${suffix}`.trim(), 120);
}
