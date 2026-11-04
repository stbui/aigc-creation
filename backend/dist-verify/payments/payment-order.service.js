"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PaymentOrderService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentOrderService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const app_exception_1 = require("../common/app.exception");
const order_service_1 = require("../orders/order.service");
const payment_config_service_1 = require("./payment-config.service");
const adapters_1 = require("./adapters");
const payment_query_1 = require("./payment-query");
/** 查单节流窗口：2 秒内重复查询直接返回本地视图 */
const QUERY_THROTTLE_MS = 2_000;
/**
 * 支付编排服务 —— 唯一决定「这笔订单怎么付、付没付、能不能关」的地方。
 *
 * 与旧 `PaymentsService` 的差别：
 *   · 渠道由**数据库配置**决定（多通道并存），不再是单一 env 通道；
 *   · 每次 intent 固定 `providerConfigId/Version`，渠道轮换后历史订单仍可验签；
 *   · 订单状态只经 `OrderService.markPaid` 一条写入路径，本服务不直接写 paid。
 */
let PaymentOrderService = PaymentOrderService_1 = class PaymentOrderService {
    constructor(prisma, orders, configs) {
        this.prisma = prisma;
        this.orders = orders;
        this.configs = configs;
        this.logger = new common_1.Logger(PaymentOrderService_1.name);
    }
    /**
     * 渠道异步通知地址：带上 configId，回调才能定位到当时的密钥版本。
     *
     * 优先使用渠道配置里保存的 `publicBaseUrl`；没配才回落到全局
     * `PAYMENT_NOTIFY_BASE`，最后才是本机地址。这样多域名/反代部署时，
     * 每个渠道可以指向自己的公网入口，不必重启改环境变量。
     */
    notifyUrl(providerId, configId, publicBaseUrl) {
        const configuredBase = publicBaseUrl?.trim() || process.env.PAYMENT_NOTIFY_BASE?.trim();
        if (providerId !== "sandbox" && !configuredBase) {
            throw new app_exception_1.AppError(50301, "真实支付渠道缺少回调公网地址，请配置渠道 publicBaseUrl 或 PAYMENT_NOTIFY_BASE", 503);
        }
        const base = (configuredBase ||
            `http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 4100}`).replace(/\/$/, "");
        return `${base}/api/v1/payments/callback/${providerId}/${configId}`;
    }
    // ── 发起支付 ────────────────────────────────────────────────────
    async createIntent(input) {
        const order = await this.prisma.order.findUnique({
            where: { id: input.orderId },
            include: { items: true },
        });
        if (!order)
            throw new app_exception_1.AppError(40400, "订单不存在", 404);
        if (order.userId !== input.userId)
            throw new app_exception_1.AppError(40301, "无权支付该订单", 403);
        if (order.status === "paid")
            throw new app_exception_1.AppError(40901, "订单已支付", 409);
        if (order.status !== "pending") {
            throw new app_exception_1.AppError(40901, `订单当前状态不可支付: ${order.status}`, 409);
        }
        const currency = (order.currency || "CNY");
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
            throw new app_exception_1.AppError(40901, "订单已超时关闭", 409);
        }
        const available = await this.configs.available(currency);
        if (available.length === 0) {
            throw new app_exception_1.AppError(50301, "当前没有可用的支付渠道，请联系管理员配置", 503);
        }
        let providerId = input.providerId;
        if (!providerId) {
            if (available.length > 1) {
                throw new app_exception_1.AppError(40001, "存在多个可用支付渠道，请指定 providerId", 400);
            }
            providerId = available[0].id;
        }
        if (!available.some((p) => p.id === providerId)) {
            throw new app_exception_1.AppError(40001, `支付渠道不可用: ${providerId}`, 400);
        }
        const config = await this.configs.latest(providerId);
        if (!config)
            throw new app_exception_1.AppError(50301, "支付渠道未完成配置", 503);
        const adapter = (0, adapters_1.getAdapter)(providerId);
        if (!adapter)
            throw new app_exception_1.AppError(40001, `未知支付渠道: ${providerId}`, 400);
        if (!config.enabled)
            throw new app_exception_1.AppError(50301, "支付渠道已停用", 503);
        const missing = adapter.validateConfig(config.values);
        if (missing.length > 0) {
            throw new app_exception_1.AppError(50301, `支付渠道未完成配置（缺少 ${missing.join(", ")}）`, 503);
        }
        const context = {
            providerId: config.providerId,
            configId: config.id,
            configVersion: config.version,
            values: config.values,
        };
        // 同一订单重复发起：旧 pending 尝试先关闭，再创建新尝试
        await this.prisma.payment.updateMany({
            where: { orderId: order.id, status: "pending" },
            data: { status: "closed", closedAt: new Date() },
        });
        const payment = await this.prisma.payment.create({
            data: {
                orderId: order.id,
                userId: input.userId,
                channel: providerId,
                amountCents: order.paidCents,
                currency,
                status: "pending",
                providerConfigId: config.id,
                providerConfigVersion: config.version,
            },
        });
        const now = Date.now();
        const expiresAt = new Date(Math.min(order.expiresAt.getTime(), now + config.closeAfterMinutes * 60_000));
        let checkout;
        try {
            checkout = await adapter.createOrder({
                config: context,
                orderId: order.id,
                orderNo: order.orderNo,
                amountCents: order.paidCents,
                currency,
                subject: `货觉AI 订单 ${order.orderNo}`,
                returnUrl: this.checkoutReturnUrl(order),
                notifyUrl: this.notifyUrl(config.providerId, config.id, config.values.publicBaseUrl),
                clientIp: input.clientIp,
                expiresAt,
            });
        }
        catch (e) {
            const message = truncate(e.message || String(e), 200);
            await this.prisma.payment.updateMany({
                where: { id: payment.id, status: "pending" },
                data: { status: "failed", lastError: message, message },
            });
            await this.prisma.order.updateMany({
                where: { id: order.id, status: "pending" },
                data: { lastError: message, checkoutValue: "" },
            });
            this.logger.error(`发起支付失败 (${providerId}) 订单 ${order.orderNo}: ${message}`);
            throw new app_exception_1.AppError(50302, `发起支付失败: ${message}`, 503);
        }
        const checkoutValue = checkout.payUrl ?? checkout.codeUrl ?? "";
        // 先落渠道单据 id：即使随后订单状态已变化，也能定位并关闭本次渠道订单。
        if (checkout.providerRef) {
            await this.prisma.payment.updateMany({
                where: { id: payment.id, status: "pending" },
                data: { providerRef: checkout.providerRef },
            });
        }
        /*
         * 条件更新只在订单仍 pending 时写入。
         * 渠道下单期间订单可能已被回调置为 paid（或用户取消），无条件 update 会把
         * paid 单的 channel/config 覆盖回这次 intent，甚至返回一个可再次支付的链接。
         */
        const updated = await this.prisma.order.updateMany({
            where: { id: order.id, status: "pending" },
            data: {
                channel: providerId,
                providerConfigId: config.id,
                providerConfigVersion: config.version,
                checkoutMode: checkout.mode,
                checkoutValue,
                checkoutExpiresAt: checkout.expiresAt,
                expiresAt: checkout.expiresAt < order.expiresAt
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
            }
            catch (e) {
                this.logger.warn(`订单状态已变化，关闭新渠道订单失败 (${providerId}): ${e.message}`);
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
            throw new app_exception_1.AppError(40901, "订单状态已变化，请刷新后重试", 409);
        }
        this.logger.log(`发起支付: 订单 ${order.orderNo} 渠道 ${providerId} v${config.version} 金额 ${order.paidCents} 分`);
        return {
            orderId: order.id,
            orderNo: order.orderNo,
            amountCents: order.paidCents,
            currency,
            providerId,
            configId: config.id,
            configVersion: config.version,
            mode: checkout.mode,
            payUrl: checkout.payUrl,
            codeUrl: checkout.codeUrl,
            checkoutValue,
            expiresAt: checkout.expiresAt.toISOString(),
            sandbox: providerId === "sandbox",
            hint: checkout.hint ?? null,
        };
    }
    // ── 查单 ────────────────────────────────────────────────────────
    async query(input) {
        const order = await this.loadOrder(input.orderId, input.actor);
        if (order.status !== "pending")
            return this.view(order);
        if (!order.providerConfigId && !order.checkoutMode)
            return this.view(order);
        if (!input.force &&
            order.lastQueriedAt &&
            Date.now() - order.lastQueriedAt.getTime() < QUERY_THROTTLE_MS) {
            return this.view(order);
        }
        await this.prisma.order.update({
            where: { id: order.id },
            data: { lastQueriedAt: new Date() },
        });
        let attempts;
        try {
            attempts = await this.attemptContexts(order);
        }
        catch (e) {
            // 配置不可用不能当成「渠道查无此单」；只记录，等运维修复配置
            const message = truncate(e.message, 200);
            await this.prisma.order.update({
                where: { id: order.id },
                data: { lastError: message },
            });
            this.logger.warn(`查单前置检查失败 订单 ${order.orderNo}: ${message}`);
            return this.view(await this.loadOrder(order.id, input.actor));
        }
        if (attempts.length === 0)
            return this.view(order);
        // 只有**所有**尝试都被渠道明确确认关闭，才允许本地关单。
        // not_found 不参与：渠道配置/商户号填错也会返回 not_found，据此关单会漏掉已付款订单。
        let allExplicitlyClosed = true;
        for (const attempt of attempts) {
            let result;
            try {
                result = await attempt.adapter.queryOrder({
                    config: attempt.config,
                    orderNo: order.orderNo,
                    providerRef: attempt.providerRef,
                    providerTradeNo: attempt.providerTradeNo,
                });
            }
            catch (e) {
                // 查询失败不改变本地状态，只写 lastError 供排障
                const message = truncate(e.message, 200);
                await this.prisma.order.update({
                    where: { id: order.id },
                    data: { lastError: message },
                });
                this.logger.warn(`查单失败 订单 ${order.orderNo} (${attempt.providerId}): ${message}`);
                return this.view(await this.loadOrder(order.id, input.actor));
            }
            if (result.state === "paid") {
                try {
                    await this.applyPaymentResult({
                        orderId: order.id,
                        providerId: attempt.providerId,
                        configId: attempt.config.configId,
                        paymentId: attempt.paymentId ?? undefined,
                        tradeNo: result.tradeNo ?? "",
                        amountCents: result.amountCents ?? -1,
                        currency: result.currency ?? order.currency,
                        paidAt: result.paidAt ?? new Date(),
                        providerStatus: result.providerStatus,
                        rawPayload: result.rawPayload,
                        providerRef: attempt.providerRef,
                    });
                }
                catch (e) {
                    // 金额/币种/状态不符时保留 pending，交给对账/人工处理，不能静默吞掉
                    this.logger.error(`查单入账失败 订单 ${order.id}: ${e.message}`);
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
        if (allExplicitlyClosed)
            await this.localClose(order.id);
        return this.view(await this.loadOrder(order.id, input.actor));
    }
    // ── 关单 ────────────────────────────────────────────────────────
    async close(input) {
        const order = await this.loadOrder(input.orderId, input.actor);
        if (order.status === "cancelled")
            return this.view(order);
        if (order.status !== "pending") {
            throw new app_exception_1.AppError(40901, `订单当前状态不可关闭: ${order.status}`, 409);
        }
        // 抢关单租约：条件更新，防止用户手动关单与 worker 同时执行
        const lease = await this.prisma.order.updateMany({
            where: {
                id: order.id,
                status: "pending",
                OR: [
                    { closeStartedAt: null },
                    { closeStartedAt: { lte: new Date(Date.now() - 5 * 60_000) } },
                ],
            },
            data: { closeStartedAt: new Date() },
        });
        if (lease.count === 0)
            return this.view(await this.loadOrder(order.id, input.actor));
        let attempts;
        try {
            attempts = await this.attemptContexts(order);
        }
        catch (e) {
            return this.failClose(order.id, `支付配置不可用，无法查单/关单: ${e.message}`);
        }
        // 从未发起过支付的空单：本地关闭即可
        if (attempts.length === 0) {
            await this.localClose(order.id);
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
            let queried;
            try {
                queried = await attempt.adapter.queryOrder(queryInput);
            }
            catch (e) {
                return this.failClose(order.id, `关单前查单失败 (${attempt.providerId}): ${e.message}`);
            }
            if (queried.state === "paid") {
                await this.creditPaidAttempt(order, attempt, queried);
                throw new app_exception_1.AppError(40901, "渠道已支付，订单已入账，请刷新后查看", 409);
            }
            if (queried.state === "failed") {
                return this.failClose(order.id, `关单前查单失败 (${attempt.providerId}): ${queried.error ?? "未知错误"}`);
            }
            if (queried.state === "pending") {
                let closed;
                try {
                    closed = await attempt.adapter.closeOrder(queryInput);
                }
                catch (e) {
                    return this.failClose(order.id, `渠道关单失败 (${attempt.providerId}): ${e.message}`);
                }
                if (closed.state === "paid") {
                    await this.creditPaidAttempt(order, attempt, closed);
                    throw new app_exception_1.AppError(40901, "渠道已支付，订单已入账，请刷新后查看", 409);
                }
                if (closed.state !== "closed" && closed.state !== "not_found") {
                    return this.failClose(order.id, `渠道关单未成功 (${attempt.providerId}): ${closed.error ?? closed.state}`);
                }
            }
            await this.closeAttempt(attempt.paymentId);
        }
        await this.localClose(order.id);
        this.logger.log(`订单已关闭: ${order.orderNo} by ${input.actor.kind}`);
        return this.view(await this.loadOrder(order.id, input.actor));
    }
    /**
     * 关闭超时未支付订单。所有调用方（旧调度器 / 支付 worker）都必须走这里，
     * 不能自己 `updateMany({status:'cancelled'})` —— 那会绕过渠道查单与库存释放。
     */
    async closeExpired(limit = 50) {
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
                if (view.status === "cancelled")
                    closed += 1;
            }
            catch (e) {
                // 已支付会抛 409，属正常竞态；其它错误留给下一轮重试
                this.logger.warn(`关闭超时订单 ${item.id} 未完成: ${e.message}`);
            }
        }
        return closed;
    }
    // ── 入账（回调 / 查单 / 对账共用）─────────────────────────────────
    async applyPaymentResult(input) {
        const order = await this.prisma.order.findUnique({
            where: { id: input.orderId },
        });
        if (!order)
            throw new app_exception_1.AppError(40400, "订单不存在", 404);
        if (order.status === "paid")
            return { applied: false, idempotentHit: true };
        if (order.status !== "pending") {
            throw new app_exception_1.AppError(40901, `订单当前状态不可入账: ${order.status}`, 409);
        }
        if (!input.tradeNo)
            throw new app_exception_1.AppError(40001, "缺少渠道交易号", 400);
        if (input.amountCents !== order.paidCents) {
            throw new app_exception_1.AppError(40901, `渠道金额 ${input.amountCents} 分与订单应付 ${order.paidCents} 分不一致`, 409);
        }
        if ((input.currency || "CNY") !== (order.currency || "CNY")) {
            throw new app_exception_1.AppError(40901, `币种不一致: 渠道 ${input.currency} / 订单 ${order.currency}`, 409);
        }
        // 只更新**同一渠道**的 pending 尝试；否则跨渠道重试时会把另一笔尝试
        // 改成本次渠道的交易号，后台支付尝试记录会张冠李戴。
        const paymentId = input.paymentId ??
            (await this.prisma.payment.findFirst({
                where: {
                    orderId: order.id,
                    status: "pending",
                    channel: input.providerId,
                },
                orderBy: { createdAt: "desc" },
                select: { id: true },
            }))?.id;
        const result = await this.orders.markPaid({
            orderId: order.id,
            userId: order.userId,
            payTransactionId: input.tradeNo,
            channel: input.providerId,
            currency: input.currency,
            providerConfigId: input.configId,
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
    async attemptContexts(order) {
        const contexts = [];
        const seen = new Set();
        for (const payment of order.payments) {
            if (!payment.channel || payment.channel === "free")
                continue;
            /*
             * PayPal/Stripe 每次 intent 都有独立单据 id，必须逐条核对；只按渠道 + 配置
             * 去重会漏掉更早的 Session。无 providerRef 的 pending 单也不能合并。
             * 只有历史/支付宝/微信这类按商户订单号查询的已结束尝试可按渠道去重。
             */
            const key = payment.providerRef ||
                payment.status === "pending" ||
                !payment.payTransactionId
                ? `${payment.channel}:${payment.providerConfigId ?? "latest"}:${payment.providerRef ?? payment.id}`
                : `${payment.channel}:${payment.providerConfigId ?? "latest"}:order`;
            if (seen.has(key))
                continue;
            seen.add(key);
            const config = await this.configs.resolveForOrder({
                channel: payment.channel,
                providerConfigId: payment.providerConfigId,
            });
            const adapter = (0, adapters_1.getAdapter)(payment.channel);
            if (!config || !adapter) {
                // 不能跳过：跳过会让 close() 误以为所有尝试都已核对完毕
                throw new Error(`支付渠道 ${payment.channel} 的配置不可用`);
            }
            contexts.push({
                paymentId: payment.id,
                providerId: config.providerId,
                providerRef: payment.providerRef ?? undefined,
                providerTradeNo: payment.payTransactionId ?? undefined,
                config: {
                    providerId: config.providerId,
                    configId: config.id,
                    configVersion: config.version,
                    values: config.values,
                },
                adapter,
            });
        }
        // 历史单没有 Payment 行，但有订单级配置时仍要按订单渠道核对一次
        if (contexts.length === 0 &&
            (order.providerConfigId || order.checkoutMode)) {
            const config = await this.configs.resolveForOrder({
                channel: order.channel,
                providerConfigId: order.providerConfigId,
            });
            const adapter = (0, adapters_1.getAdapter)(order.channel);
            if (!config || !adapter)
                throw new Error(`支付渠道 ${order.channel} 的配置不可用`);
            contexts.push({
                paymentId: null,
                providerId: config.providerId,
                providerRef: undefined,
                providerTradeNo: undefined,
                config: {
                    providerId: config.providerId,
                    configId: config.id,
                    configVersion: config.version,
                    values: config.values,
                },
                adapter,
            });
        }
        return contexts;
    }
    /** 渠道已确认支付：先核对金额/交易号，再走唯一入账入口。 */
    async creditPaidAttempt(order, attempt, result) {
        if (result.amountCents === undefined) {
            return this.failClose(order.id, `渠道已支付但未返回金额 (${attempt.providerId})，暂不入账，请人工核对`);
        }
        const tradeNo = result.tradeNo ?? order.providerTradeNo ?? "";
        if (!tradeNo) {
            return this.failClose(order.id, `渠道已支付但未返回交易号 (${attempt.providerId})，暂不入账`);
        }
        try {
            await this.applyPaymentResult({
                orderId: order.id,
                providerId: attempt.providerId,
                configId: attempt.config.configId,
                paymentId: attempt.paymentId ?? undefined,
                tradeNo,
                amountCents: result.amountCents,
                currency: result.currency ?? "CNY",
                paidAt: result.paidAt ?? new Date(),
                providerStatus: result.providerStatus,
                rawPayload: result.rawPayload,
                providerRef: attempt.providerRef,
            });
        }
        catch (e) {
            await this.releaseCloseLease(order.id, `渠道已支付但入账失败: ${e.message}`);
            throw e;
        }
    }
    /** 本地标记单笔支付尝试为 closed；不动订单状态。 */
    async closeAttempt(paymentId) {
        if (!paymentId)
            return;
        await this.prisma.payment.updateMany({
            where: { id: paymentId, status: "pending" },
            data: { status: "closed", closedAt: new Date() },
        });
    }
    /**
     * 关单失败：保留订单 pending 并释放关单租约，等待下一轮重试。
     * 绝不能在这里把订单改成 cancelled —— 渠道可能已收款。
     */
    async failClose(orderId, message) {
        const text = truncate(message, 200);
        await this.prisma.order.update({
            where: { id: orderId },
            data: { lastError: text, closeStartedAt: null },
        });
        throw new app_exception_1.AppError(50302, text, 503);
    }
    async releaseCloseLease(orderId, message) {
        await this.prisma.order.update({
            where: { id: orderId },
            data: {
                closeStartedAt: null,
                ...(message ? { lastError: truncate(message, 200) } : {}),
            },
        });
    }
    /** 本地关单：置 cancelled、清空 checkout、关闭 pending 尝试、释放库存。幂等 */
    async localClose(orderId) {
        const updated = await this.prisma.order.updateMany({
            where: { id: orderId, status: "pending" },
            data: {
                status: "cancelled",
                closedAt: new Date(),
                closeStartedAt: null,
                checkoutValue: "",
                lastError: null,
            },
        });
        if (updated.count > 0) {
            // 订单关闭后，未完成的支付尝试也必须收尾，否则后台会一直显示 pending
            await this.prisma.payment.updateMany({
                where: { orderId, status: "pending" },
                data: { status: "closed", closedAt: new Date() },
            });
            await this.orders.releaseReservation(orderId);
        }
    }
    async loadOrder(orderId, actor) {
        const order = await this.prisma.order.findUnique({
            where: { id: orderId },
            include: { payments: { orderBy: { createdAt: "desc" } } },
        });
        if (!order)
            throw new app_exception_1.AppError(40400, "订单不存在", 404);
        if (actor.kind === "user" && order.userId !== actor.userId) {
            throw new app_exception_1.AppError(40301, "无权查看该订单", 403);
        }
        return order;
    }
    view(order) {
        const displayStatus = (0, payment_query_1.paymentStatusOf)({
            status: order.status,
            closeStartedAt: order.closeStartedAt,
            lastError: order.lastError,
            providerConfigId: order.providerConfigId,
            checkoutMode: order.checkoutMode,
        });
        const terminal = displayStatus !== "pending" &&
            displayStatus !== "created" &&
            displayStatus !== "closing";
        return {
            orderId: order.id,
            orderNo: order.orderNo,
            status: order.status,
            displayStatus,
            amountCents: order.paidCents,
            currency: order.currency || "CNY",
            providerId: order.channel,
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
                providerId: p.channel,
                providerRef: p.providerRef,
                providerTradeNo: p.payTransactionId,
                amountCents: p.amountCents,
                createdAt: p.createdAt.toISOString(),
            })),
        };
    }
    webBase() {
        return (process.env.WEB_BASE_URL || "http://localhost:5100").replace(/\/$/, "");
    }
    /**
     * 渠道收银台完成后的返回地址。
     *
     * 必须回到“这张订单”的结算页，而不是订单列表：前端据此主动查单，
     * 支付宝同步跳回时即使异步通知尚未到达，也能立即向渠道核实并展示结果。
     */
    checkoutReturnUrl(order) {
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
};
exports.PaymentOrderService = PaymentOrderService;
exports.PaymentOrderService = PaymentOrderService = PaymentOrderService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        order_service_1.OrderService,
        payment_config_service_1.PaymentConfigService])
], PaymentOrderService);
function truncate(value, max) {
    return value.length > max ? value.slice(0, max) : value;
}
//# sourceMappingURL=payment-order.service.js.map