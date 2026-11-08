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
var PaymentWorkerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentWorkerService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const payment_order_service_1 = require("./payment-order.service");
const payment_notification_service_1 = require("./payment-notification.service");
const payment_reconciliation_service_1 = require("./payment-reconciliation.service");
const payment_config_service_1 = require("./payment-config.service");
const adapters_1 = require("./adapters");
const TICK_MS = 15_000;
/** 通知处理租约回收阈值 */
const PROCESSING_STALE_MS = 5 * 60_000;
/** 查单轮询：pending 订单上次查单超过 30 秒 */
const QUERY_INTERVAL_MS = 30_000;
/** 自动对账时间（Asia/Shanghai） */
const AUTO_RECONCILE_HOUR = 10;
const AUTO_RECONCILE_MINUTE = 15;
/**
 * 支付后台任务。
 *
 * 串行执行，任一步失败只记日志、不中断后续步骤。单实例串行即可：
 * 多实例部署时必须改用数据库租约或拆成独立进程，不能只靠内存锁。
 *
 * `PAYMENT_WORKER_ENABLED=false` 仅用于测试/排障，不改变接口行为。
 */
let PaymentWorkerService = PaymentWorkerService_1 = class PaymentWorkerService {
    constructor(prisma, orders, notifications, reconciliation, configs) {
        this.prisma = prisma;
        this.orders = orders;
        this.notifications = notifications;
        this.reconciliation = reconciliation;
        this.configs = configs;
        this.logger = new common_1.Logger(PaymentWorkerService_1.name);
        this.timer = null;
        this.running = false;
        this.lastAutoReconcileDate = null;
    }
    onModuleInit() {
        if (process.env.PAYMENT_WORKER_ENABLED === 'false') {
            this.logger.warn('支付后台任务已禁用 (PAYMENT_WORKER_ENABLED=false)');
            return;
        }
        // 启动后 15 秒起跑，不阻塞 Nest 启动
        this.timer = setTimeout(() => void this.loop(), TICK_MS);
        this.logger.log(`支付后台任务已启动（每 ${TICK_MS / 1000}s 一次）`);
    }
    onModuleDestroy() {
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = null;
    }
    async loop() {
        try {
            await this.tick();
        }
        catch (e) {
            this.logger.error(`支付后台任务异常: ${e.message}`);
        }
        finally {
            this.timer = setTimeout(() => void this.loop(), TICK_MS);
        }
    }
    /** 测试直接调用 */
    async tick() {
        if (this.running)
            return;
        this.running = true;
        try {
            await this.recycleStaleNotifications();
            await this.processDueNotifications();
            await this.reconciliation.recoverStaleRuns();
            await this.closeExpiredOrders();
            await this.queryPendingOrders();
            await this.autoReconcile();
        }
        finally {
            this.running = false;
        }
    }
    async recycleStaleNotifications() {
        const stale = await this.prisma.paymentNotification.updateMany({
            where: { status: 'processing', updatedAt: { lt: new Date(Date.now() - PROCESSING_STALE_MS) } },
            data: { status: 'failed', nextAttemptAt: new Date() },
        });
        if (stale.count > 0)
            this.logger.warn(`回收卡住的通知: ${stale.count} 条`);
    }
    async processDueNotifications() {
        const due = await this.prisma.paymentNotification.findMany({
            where: { status: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: new Date() } },
            orderBy: { nextAttemptAt: 'asc' },
            take: 50,
            select: { id: true },
        });
        for (const item of due) {
            try {
                await this.notifications.retry(item.id);
            }
            catch (e) {
                this.logger.error(`通知重试失败 ${item.id}: ${e.message}`);
            }
        }
    }
    async closeExpiredOrders() {
        // 统一走 PaymentOrderService.closeExpired：关单前逐个渠道查单、失败不本地关单。
        // 不要在 worker 里直接 updateMany 改 cancelled（旧调度器正是这么漏掉已付款订单的）。
        const closed = await this.orders.closeExpired(50);
        if (closed > 0)
            this.logger.log(`超时订单已关闭: ${closed} 笔`);
    }
    async queryPendingOrders() {
        const cutoff = new Date(Date.now() - QUERY_INTERVAL_MS);
        const pending = await this.prisma.order.findMany({
            where: {
                status: 'pending',
                expiresAt: { gt: new Date() },
                channel: { notIn: ['free'] },
                AND: [
                    { OR: [{ providerConfigId: { not: null } }, { checkoutMode: { not: null } }] },
                    { OR: [{ lastQueriedAt: null }, { lastQueriedAt: { lt: cutoff } }] },
                ],
            },
            take: 20,
            select: { id: true },
        });
        for (const item of pending) {
            try {
                await this.orders.query({ orderId: item.id, actor: { kind: 'worker' } });
            }
            catch (e) {
                this.logger.warn(`轮询查单 ${item.id} 失败: ${e.message}`);
            }
        }
    }
    /** 本地 10:15 后，对昨日已启用且支持对账的渠道各跑一次 */
    async autoReconcile() {
        const now = new Date();
        const shanghai = new Date(now.getTime() + 8 * 3600 * 1000);
        const hour = shanghai.getUTCHours();
        const minute = shanghai.getUTCMinutes();
        if (hour < AUTO_RECONCILE_HOUR || (hour === AUTO_RECONCILE_HOUR && minute < AUTO_RECONCILE_MINUTE)) {
            return;
        }
        const yesterday = new Date(shanghai.getTime() - 24 * 3600 * 1000);
        const p = (n) => String(n).padStart(2, '0');
        const billDate = `${yesterday.getUTCFullYear()}-${p(yesterday.getUTCMonth() + 1)}-${p(yesterday.getUTCDate())}`;
        if (this.lastAutoReconcileDate === billDate)
            return;
        for (const adapter of (0, adapters_1.allAdapters)()) {
            if (!adapter.descriptor.supportsReconciliation)
                continue;
            const config = await this.configs.latest(adapter.descriptor.id);
            if (!config?.enabled)
                continue;
            try {
                await this.reconciliation.run({
                    providerId: adapter.descriptor.id,
                    billDate,
                    actorId: 'worker',
                });
            }
            catch (e) {
                this.logger.error(`自动对账失败 (${adapter.descriptor.id} ${billDate}): ${e.message}`);
            }
        }
        this.lastAutoReconcileDate = billDate;
        this.logger.log(`自动对账已触发: ${billDate}`);
    }
};
exports.PaymentWorkerService = PaymentWorkerService;
exports.PaymentWorkerService = PaymentWorkerService = PaymentWorkerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        payment_order_service_1.PaymentOrderService,
        payment_notification_service_1.PaymentNotificationService,
        payment_reconciliation_service_1.PaymentReconciliationService,
        payment_config_service_1.PaymentConfigService])
], PaymentWorkerService);
//# sourceMappingURL=payment-worker.service.js.map