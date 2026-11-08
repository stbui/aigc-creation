"use strict";
/**
 * 账单兜底清扫（自动退款 / 转人工）。
 *
 * 为什么需要它：进程被杀、容器重启、上游连接被内核掐断时，一次已经预留积分的
 * 调用会**永远不会走到收尾**——积分冻结在 `reserved` / `running`，用户看到
 * 「扣了但没结果」，后台看到一堆挂账。任务路径有自己的租约恢复，代理路径没有。
 *
 * 两段职责，边界不能混：
 *   1. **代理账单**（`taskId=''`）：无条件兜底。`reserved` 超 30 分钟直接退款
 *      （预留后立即置 running，仍是 reserved 说明请求没发出去）；`running`
 *      超 60 分钟转人工（上游可能已计费，不能自动退）。
 *   2. **任务账单**（`taskId!=''`）：**只有运营显式打开
 *      `generate.billingAutoRefund` 才执行**。口径与后台「待核对」队列一致：
 *      uncertain / running 超 40 分钟 / 任务已失败但仍预留。已出作品或正在
 *      补交付（`pendingResult` / `mediaRecoveryError`）的订单必须排除 ——
 *      自动退款会让平台白付上游费用、用户也失去「重试保存」。
 *
 * 默认关闭的原因：待核对订单**可能已经在上游产生费用**，退与不退是运营口径，
 * 不是技术默认。开关打开后每轮重新读，关掉立即停。
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var BillingSweeperService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingSweeperService = exports.TASK_REVIEW_RUNNING_TTL_MS = exports.RUNNING_TTL_MS = exports.RESERVED_TTL_MS = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../../prisma/prisma.service");
const settings_service_1 = require("../../common/settings.service");
const billing_service_1 = require("./billing.service");
/** 预留超过这么久仍未置运行态 = 派发前就中断了 */
exports.RESERVED_TTL_MS = 30 * 60 * 1000;
/** 运行态超过这么久没有收尾 = 执行者已死（上游可能已经计费） */
exports.RUNNING_TTL_MS = 60 * 60 * 1000;
/** 任务账单进入「待核对」的 running 超时（与后台 review 队列同口径） */
exports.TASK_REVIEW_RUNNING_TTL_MS = 40 * 60 * 1000;
/** 单轮处理上限：一轮扫太多会长时间占住事件循环，剩余留到下一轮 */
const BATCH_SIZE = 200;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let BillingSweeperService = BillingSweeperService_1 = class BillingSweeperService {
    constructor(config, prisma, billing, settings) {
        this.config = config;
        this.prisma = prisma;
        this.billing = billing;
        this.settings = settings;
        this.log = new common_1.Logger(BillingSweeperService_1.name);
        this.timer = null;
        this.running = false;
    }
    onModuleInit() {
        if (!(this.config.get('model.billingSweepEnabled') ?? true)) {
            this.log.warn('账单兜底清扫已关闭（MODEL_BILLING_SWEEP_ENABLED=false），挂账只能人工处理');
            return;
        }
        this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
        this.timer.unref?.();
    }
    onModuleDestroy() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    /**
     * 跑一轮；返回本轮处置条数（后台 / 冒烟脚本可直接调用）
     *
     * @param now     判定「过期」的基准时刻
     * @param options TTL 覆盖；不传时用模块默认（30 分钟 / 60 分钟）
     */
    async sweep(now = new Date(), options = {}) {
        if (this.running)
            return { refunded: 0, uncertain: 0 };
        this.running = true;
        try {
            const reservedTtlMs = options.reservedTtlMs ?? exports.RESERVED_TTL_MS;
            const runningTtlMs = options.runningTtlMs ?? exports.RUNNING_TTL_MS;
            const batchSize = options.batchSize ?? BATCH_SIZE;
            const reservedCutoff = new Date(now.getTime() - reservedTtlMs);
            const runningCutoff = new Date(now.getTime() - runningTtlMs);
            const staleReserved = await this.prisma.billingOrder.findMany({
                where: { taskId: '', status: 'reserved', createdAt: { lt: reservedCutoff } },
                select: { id: true },
                orderBy: { createdAt: 'asc' },
                take: batchSize,
            });
            let refunded = 0;
            for (const order of staleReserved) {
                try {
                    await this.billing.refund(order.id, '预留超时未执行，自动退款', 'auto_sweep');
                    refunded += 1;
                }
                catch (error) {
                    this.log.warn(`自动退款失败（账单 ${order.id}）：${messageOf(error)}`);
                }
            }
            const staleRunning = await this.prisma.billingOrder.findMany({
                where: {
                    taskId: '',
                    status: 'running',
                    OR: [{ startedAt: { lt: runningCutoff } }, { startedAt: null, createdAt: { lt: runningCutoff } }],
                },
                select: { id: true },
                orderBy: { createdAt: 'asc' },
                take: batchSize,
            });
            let uncertain = 0;
            for (const order of staleRunning) {
                try {
                    await this.billing.markUncertain(order.id, '中转执行超时，费用状态待核对');
                    uncertain += 1;
                }
                catch (error) {
                    this.log.warn(`转人工失败（账单 ${order.id}）：${messageOf(error)}`);
                }
            }
            // 任务账单的自动退回：只有运营显式打开开关才执行
            const autoRefundTasks = await this.settings.getBoolean('generate.billingAutoRefund');
            const taskRefunded = autoRefundTasks ? await this.sweepTaskReview(now, batchSize) : 0;
            if (refunded > 0 || uncertain > 0 || taskRefunded > 0) {
                this.log.log(`账单清扫：代理自动退款 ${refunded} 笔，代理转人工 ${uncertain} 笔，任务账单自动退回 ${taskRefunded} 笔`);
            }
            return { refunded, uncertain };
        }
        finally {
            this.running = false;
        }
    }
    /**
     * 任务账单的自动退回（「待核对」队列里确定没有交付的那部分）。
     *
     * 排除已出作品 / 正在补交付的订单：上游可能已经产出，自动退款会让平台
     * 白付上游费用，用户也失去「重试保存」。这类订单只能人工处置。
     */
    async sweepTaskReview(now, batchSize) {
        const staleBefore = new Date(now.getTime() - exports.TASK_REVIEW_RUNNING_TTL_MS);
        const failedTasks = await this.prisma.generationTask.findMany({
            where: { status: { in: ['failed', 'cancelled'] } },
            select: { id: true },
        });
        const candidates = await this.prisma.billingOrder.findMany({
            where: {
                taskId: { not: '' },
                OR: [
                    { status: 'uncertain' },
                    { status: 'running', updatedAt: { lt: staleBefore } },
                    { status: 'reserved', taskId: { in: failedTasks.map((task) => task.id) } },
                ],
            },
            select: { id: true, taskId: true },
            orderBy: { createdAt: 'asc' },
            take: batchSize,
        });
        if (candidates.length === 0)
            return 0;
        // 已出作品 / 正在补交付的任务不自动退：它们可能稍后交付成功
        const taskIds = [...new Set(candidates.map((item) => item.taskId).filter((id) => id !== ''))];
        const protectedTasks = taskIds.length > 0
            ? await this.prisma.generationTask.findMany({
                where: {
                    id: { in: taskIds },
                    OR: [
                        { outputAssetId: { not: null } },
                        { pendingResult: { not: null } },
                        { mediaRecoveryError: { not: null } },
                    ],
                },
                select: { id: true },
            })
            : [];
        const protectedIds = new Set(protectedTasks.map((task) => task.id));
        let refunded = 0;
        for (const order of candidates) {
            if (protectedIds.has(order.taskId))
                continue;
            try {
                await this.billing.refund(order.id, '系统自动退回：冻结积分自动退回已开启', 'auto_sweep');
                await this.prisma.billingOrder.updateMany({
                    where: { id: order.id, resolvedBy: '' },
                    data: { resolvedBy: 'system:auto-refund', resolutionNote: '冻结积分自动退回' },
                });
                refunded += 1;
            }
            catch (error) {
                this.log.warn(`任务账单自动退款失败（账单 ${order.id}）：${messageOf(error)}`);
            }
        }
        return refunded;
    }
};
exports.BillingSweeperService = BillingSweeperService;
exports.BillingSweeperService = BillingSweeperService = BillingSweeperService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService,
        billing_service_1.BillingService,
        settings_service_1.SettingsService])
], BillingSweeperService);
function messageOf(error) {
    return error instanceof Error ? error.message : String(error ?? '');
}
//# sourceMappingURL=billing-sweeper.service.js.map