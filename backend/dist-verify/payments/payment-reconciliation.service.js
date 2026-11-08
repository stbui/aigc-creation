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
var PaymentReconciliationService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatShanghai = exports.PaymentReconciliationService = exports.RECONCILIATION_EXPORT_LIMIT = exports.RECONCILIATION_RUN_STALE_MS = exports.RECONCILIATION_RESULTS = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const app_exception_1 = require("../common/app.exception");
const csv_1 = require("../common/csv");
const zip_reader_1 = require("../common/archive/zip-reader");
const payment_config_service_1 = require("./payment-config.service");
const payment_order_service_1 = require("./payment-order.service");
const adapters_1 = require("./adapters");
const payment_query_1 = require("./payment-query");
Object.defineProperty(exports, "formatShanghai", { enumerable: true, get: function () { return payment_query_1.formatShanghai; } });
exports.RECONCILIATION_RESULTS = [
    "matched",
    "recovered",
    "local_order_not_found",
    "provider_record_missing",
    "amount_mismatch",
    "trade_no_mismatch",
    "credit_failed",
];
/** 对账运行超过该时长视为进程中断，允许重跑 */
exports.RECONCILIATION_RUN_STALE_MS = 30 * 60_000;
/** 对账导出行数上限；超过必须报错而不是静默截断 */
exports.RECONCILIATION_EXPORT_LIMIT = 10_000;
/**
 * 支付对账。
 *
 * 比对规则的核心原则：**只相信签名查单，不相信上传文件里的「成功」字样**。
 * CSV 导入是兜底通道（渠道账单接口不可用时的最后手段），但它同样会触发一次
 * 渠道查单确认后才补发，否则一个被篡改的 CSV 就能凭空造出积分。
 */
let PaymentReconciliationService = PaymentReconciliationService_1 = class PaymentReconciliationService {
    constructor(prisma, configs, orders) {
        this.prisma = prisma;
        this.configs = configs;
        this.orders = orders;
        this.logger = new common_1.Logger(PaymentReconciliationService_1.name);
    }
    // ── 执行 ────────────────────────────────────────────────────────
    async run(input) {
        this.assertBillDate(input.billDate);
        const latest = await this.prisma.paymentReconciliationRun.findFirst({
            where: { providerId: input.providerId, billDate: input.billDate },
            orderBy: { attempt: "desc" },
        });
        if (latest?.status === "running") {
            if (!(await this.recoverIfStale(latest))) {
                throw new app_exception_1.AppError(40901, "该账单日的对账正在执行中", 409);
            }
        }
        if (latest?.status === "completed" && !input.retryFailed) {
            return { run: toRunView(latest), reused: true };
        }
        const adapter = (0, adapters_1.getAdapter)(input.providerId);
        if (!adapter)
            throw new app_exception_1.AppError(40400, `未知支付渠道: ${input.providerId}`, 404);
        if (!adapter.descriptor.supportsReconciliation ||
            !adapter.downloadTradeBill) {
            throw new app_exception_1.AppError(40001, `渠道 ${input.providerId} 不支持自动对账`, 400);
        }
        const config = await this.configs.latest(input.providerId);
        if (!config)
            throw new app_exception_1.AppError(50301, "渠道未完成配置，无法对账", 503);
        const attempt = (latest?.attempt ?? 0) + 1;
        let run = await this.createRunRow({
            providerId: input.providerId,
            configId: config.id,
            billDate: input.billDate,
            attempt,
            source: "provider",
            status: "running",
            startedBy: input.actorId,
        });
        let records;
        try {
            records = await adapter.downloadTradeBill({
                providerId: config.providerId,
                configId: config.id,
                configVersion: config.version,
                values: config.values,
            }, input.billDate);
        }
        catch (e) {
            run = await this.prisma.paymentReconciliationRun.update({
                where: { id: run.id },
                data: {
                    status: "failed",
                    error: truncate(e.message, 500),
                    completedAt: new Date(),
                },
            });
            this.logger.error(`对账账单下载失败 (${input.providerId} ${input.billDate}): ${e.message}`);
            return { run: toRunView(run), reused: false };
        }
        return {
            run: await this.compare(run.id, input.providerId, config.id, records, input.billDate),
            reused: false,
        };
    }
    async importCsv(input) {
        this.assertBillDate(input.billDate);
        const adapter = (0, adapters_1.getAdapter)(input.providerId);
        if (!adapter)
            throw new app_exception_1.AppError(40400, `未知支付渠道: ${input.providerId}`, 404);
        if (!adapter.descriptor.supportsReconciliation) {
            throw new app_exception_1.AppError(40001, `渠道 ${input.providerId} 不支持对账导入`, 400);
        }
        const records = parseBillCsv((0, csv_1.decodeCsvBuffer)(extractImportCsv(input.file, input.providerId)), input.providerId);
        if (records.length === 0)
            throw new app_exception_1.AppError(40001, "账单没有交易记录", 400);
        const config = await this.configs.latest(input.providerId);
        const latest = await this.prisma.paymentReconciliationRun.findFirst({
            where: { providerId: input.providerId, billDate: input.billDate },
            orderBy: { attempt: "desc" },
        });
        if (latest?.status === "running" && !(await this.recoverIfStale(latest))) {
            throw new app_exception_1.AppError(40901, "该账单日的对账正在执行中", 409);
        }
        const run = await this.createRunRow({
            providerId: input.providerId,
            configId: config?.id ?? null,
            billDate: input.billDate,
            attempt: (latest?.attempt ?? 0) + 1,
            source: "csv",
            fileName: input.fileName,
            status: "running",
            startedBy: input.actorId,
        });
        const compared = await this.compare(run.id, input.providerId, config?.id ?? "", records, input.billDate);
        return { run: compared };
    }
    // ── 查询 ────────────────────────────────────────────────────────
    async list(query) {
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 30;
        const where = {};
        if (query.providerId)
            where.providerId = query.providerId;
        if (query.status) {
            if (!["running", "completed", "failed"].includes(query.status)) {
                throw new app_exception_1.AppError(40001, `对账状态非法: ${query.status}`, 400);
            }
            where.status = query.status;
        }
        const range = (0, payment_query_1.shanghaiDayRange)(query.from, query.to);
        if (range)
            where.billDate = undefined; // billDate 是字符串, 用下面的日期比较
        if (query.from || query.to) {
            where.AND = [
                ...(query.from ? [{ billDate: { gte: query.from } }] : []),
                ...(query.to ? [{ billDate: { lte: query.to } }] : []),
            ];
        }
        const [rows, total] = await Promise.all([
            this.prisma.paymentReconciliationRun.findMany({
                where,
                orderBy: [{ billDate: "desc" }, { attempt: "desc" }, { id: "asc" }],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            this.prisma.paymentReconciliationRun.count({ where }),
        ]);
        return { items: rows.map(toRunView), total, page, pageSize };
    }
    async items(runId, query) {
        const run = await this.prisma.paymentReconciliationRun.findUnique({
            where: { id: runId },
        });
        if (!run)
            throw new app_exception_1.AppError(40400, "对账记录不存在", 404);
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 50;
        const where = { runId };
        if (query.result && query.result !== "all") {
            if (query.result === "abnormal") {
                where.result = { notIn: ["matched", "recovered"] };
            }
            else if (exports.RECONCILIATION_RESULTS.includes(query.result)) {
                where.result = query.result;
            }
            else {
                throw new app_exception_1.AppError(40001, `对账结果筛选值非法: ${query.result}`, 400);
            }
        }
        const [rows, total] = await Promise.all([
            this.prisma.paymentReconciliationItem.findMany({
                where,
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            this.prisma.paymentReconciliationItem.count({ where }),
        ]);
        return {
            run: toRunView(run),
            items: rows.map(toItemView),
            total,
            page,
            pageSize,
        };
    }
    async runsForExport(query) {
        const where = {};
        if (query.providerId)
            where.providerId = query.providerId;
        if (query.status)
            where.status = query.status;
        if (query.from || query.to) {
            where.AND = [
                ...(query.from ? [{ billDate: { gte: query.from } }] : []),
                ...(query.to ? [{ billDate: { lte: query.to } }] : []),
            ];
        }
        // 超过上限直接报错，避免财务拿到被截断的对账运行清单
        const total = await this.prisma.paymentReconciliationRun.count({ where });
        if (total > exports.RECONCILIATION_EXPORT_LIMIT) {
            throw new app_exception_1.AppError(40001, `筛选结果共 ${total} 条，超过单次导出上限 ${exports.RECONCILIATION_EXPORT_LIMIT} 条，请缩小时间范围后重试`, 400);
        }
        return this.prisma.paymentReconciliationRun.findMany({
            where,
            orderBy: [{ billDate: "desc" }, { attempt: "desc" }],
            take: exports.RECONCILIATION_EXPORT_LIMIT,
        });
    }
    async itemsForExport(runId, result) {
        const run = await this.prisma.paymentReconciliationRun.findUnique({
            where: { id: runId },
        });
        if (!run)
            throw new app_exception_1.AppError(40400, "对账记录不存在", 404);
        if (run.status !== "completed") {
            throw new app_exception_1.AppError(40901, "执行中的对账不能导出明细", 409);
        }
        const where = { runId };
        if (result && result !== "all") {
            if (result === "abnormal")
                where.result = { notIn: ["matched", "recovered"] };
            else
                where.result = result;
        }
        const total = await this.prisma.paymentReconciliationItem.count({ where });
        if (total > exports.RECONCILIATION_EXPORT_LIMIT) {
            throw new app_exception_1.AppError(40001, `本次对账共 ${total} 条明细，超过单次导出上限 ${exports.RECONCILIATION_EXPORT_LIMIT} 条，请按结果筛选后分批导出`, 400);
        }
        return this.prisma.paymentReconciliationItem.findMany({
            where,
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: exports.RECONCILIATION_EXPORT_LIMIT,
        });
    }
    // ── 比对 ────────────────────────────────────────────────────────
    async compare(runId, providerId, configId, records, billDate) {
        let matched = 0;
        let recovered = 0;
        let errors = 0;
        const seenOrderNos = new Set();
        for (const record of records) {
            seenOrderNos.add(record.merchantOrderNo);
            const outcome = await this.compareOne(runId, providerId, configId, record);
            if (outcome === "matched")
                matched += 1;
            else if (outcome === "recovered")
                recovered += 1;
            else
                errors += 1;
        }
        // 本地已支付但账单没有记录：不降级、不猜，只记录
        const localPaid = await this.prisma.order.findMany({
            where: {
                channel: providerId,
                status: "paid",
                providerPaidAt: {
                    gte: (0, payment_query_1.startOfShanghaiDay)(billDate),
                    lte: new Date((0, payment_query_1.startOfShanghaiDay)(billDate).getTime() + 24 * 3600 * 1000 - 1),
                },
                providerTradeNo: { not: null },
            },
            select: {
                id: true,
                orderNo: true,
                providerTradeNo: true,
                paidCents: true,
                currency: true,
            },
        });
        for (const order of localPaid) {
            if (seenOrderNos.has(order.orderNo))
                continue;
            await this.prisma.paymentReconciliationItem.create({
                data: {
                    runId,
                    providerId,
                    orderId: order.id,
                    merchantOrderNo: order.orderNo,
                    providerTradeNo: order.providerTradeNo,
                    amountCents: order.paidCents,
                    currency: order.currency || "CNY",
                    result: "provider_record_missing",
                    detail: "本地已支付但渠道账单没有该笔记录",
                },
            });
            errors += 1;
        }
        const run = await this.prisma.paymentReconciliationRun.update({
            where: { id: runId },
            data: {
                status: "completed",
                completedAt: new Date(),
                totalItems: matched + recovered + errors,
                matchItems: matched,
                recoveredItems: recovered,
                errorItems: errors,
                error: null,
            },
        });
        this.logger.log(`对账完成 (${providerId} ${billDate}): 共 ${matched + recovered + errors} 笔, 一致 ${matched}, 补发 ${recovered}, 异常 ${errors}`);
        return toRunView(run);
    }
    async compareOne(runId, providerId, configId, record) {
        const order = await this.prisma.order.findUnique({
            where: { orderNo: record.merchantOrderNo },
        });
        const writeItem = async (result, detail, orderId, resolved = false) => {
            await this.prisma.paymentReconciliationItem.upsert({
                where: {
                    runId_merchantOrderNo: {
                        runId,
                        merchantOrderNo: record.merchantOrderNo,
                    },
                },
                create: {
                    runId,
                    providerId,
                    orderId: orderId ?? null,
                    merchantOrderNo: record.merchantOrderNo,
                    providerTradeNo: record.providerTradeNo,
                    amountCents: record.amountCents,
                    currency: record.currency,
                    result,
                    resolved,
                    detail: truncate(detail, 200),
                },
                update: { result, resolved, detail: truncate(detail, 200) },
            });
        };
        if (!order) {
            await writeItem("local_order_not_found", "本地不存在该商户订单号");
            return "local_order_not_found";
        }
        if (order.status === "cancelled") {
            await writeItem("credit_failed", "本地订单已取消但渠道账单显示成功，需人工补单或退款", order.id);
            return "credit_failed";
        }
        if (order.status === "paid" ||
            order.status === "refunded" ||
            order.status === "partial_refunded") {
            if (order.providerTradeNo &&
                order.providerTradeNo !== record.providerTradeNo) {
                await writeItem("trade_no_mismatch", `本地交易号 ${order.providerTradeNo} 与账单 ${record.providerTradeNo} 不一致`, order.id);
                return "trade_no_mismatch";
            }
            if (order.paidCents !== record.amountCents) {
                await writeItem("amount_mismatch", `本地实付 ${order.paidCents} 分与账单 ${record.amountCents} 分不一致`, order.id);
                return "amount_mismatch";
            }
            await writeItem("matched", "一致", order.id);
            return "matched";
        }
        // 本地 pending，账单显示成功 → 必须用固定配置查单二次确认后才补发
        if (!configId) {
            await writeItem("credit_failed", "渠道未配置，无法二次查单确认", order.id);
            return "credit_failed";
        }
        const config = await this.configs.latest(providerId);
        const adapter = (0, adapters_1.getAdapter)(providerId);
        if (!config || !adapter) {
            await writeItem("credit_failed", "渠道配置缺失，无法二次查单确认", order.id);
            return "credit_failed";
        }
        try {
            const queried = await adapter.queryOrder({
                config: {
                    providerId: config.providerId,
                    configId: config.id,
                    configVersion: config.version,
                    values: config.values,
                },
                orderNo: order.orderNo,
                providerTradeNo: record.providerTradeNo,
            });
            if (queried.state !== "paid") {
                await writeItem("credit_failed", `账单显示成功但查单结果为 ${queried.state}`, order.id);
                return "credit_failed";
            }
            await this.orders.applyPaymentResult({
                orderId: order.id,
                providerId,
                configId: config.id,
                tradeNo: queried.tradeNo ?? record.providerTradeNo,
                amountCents: queried.amountCents ?? record.amountCents,
                currency: (queried.currency ?? record.currency),
                paidAt: queried.paidAt ?? record.paidAt,
                providerStatus: queried.providerStatus,
                rawPayload: queried.rawPayload,
            });
            await writeItem("recovered", "已通过查单确认并自动补发", order.id, true);
            return "recovered";
        }
        catch (e) {
            await writeItem("credit_failed", `补发失败: ${e.message}`, order.id);
            return "credit_failed";
        }
    }
    /**
     * 并发 claim 的兜底：两个请求同时通过 `latest` 检查时，唯一约束
     * `(providerId, billDate, attempt)` 只会让一个成功；另一个返回 409
     * 而不是 500。换 Postgres 多实例时仍建议改成行锁。
     */
    async createRunRow(data) {
        try {
            return await this.prisma.paymentReconciliationRun.create({ data });
        }
        catch (e) {
            if (e?.code === "P2002") {
                throw new app_exception_1.AppError(40901, "该账单日的对账正在执行中", 409);
            }
            throw e;
        }
    }
    /**
     * 回收超时未完成的运行（进程崩溃/重启后一直占着「执行中」）。
     * 定时 worker 与手动重跑前都会调用；只处理超过阈值的行。
     */
    async recoverStaleRuns() {
        const result = await this.prisma.paymentReconciliationRun.updateMany({
            where: {
                status: "running",
                startedAt: { lt: new Date(Date.now() - exports.RECONCILIATION_RUN_STALE_MS) },
            },
            data: {
                status: "failed",
                error: "执行超时（进程中断或长时间未完成），已自动回收，可重新执行",
                completedAt: new Date(),
            },
        });
        if (result.count > 0) {
            this.logger.warn(`回收超时未完成的对账运行: ${result.count} 条`);
        }
        return result.count;
    }
    /** 返回 true 表示该 running 行已过期并被回收，可以继续新建 attempt */
    async recoverIfStale(run) {
        if (run.startedAt.getTime() > Date.now() - exports.RECONCILIATION_RUN_STALE_MS)
            return false;
        await this.prisma.paymentReconciliationRun.update({
            where: { id: run.id },
            data: {
                status: "failed",
                error: "执行超时（进程中断或长时间未完成），已自动回收，可重新执行",
                completedAt: new Date(),
            },
        });
        this.logger.warn(`对账运行超时回收: ${run.id}`);
        return true;
    }
    assertBillDate(billDate) {
        (0, payment_query_1.parseDateStrict)(billDate);
        const start = (0, payment_query_1.startOfShanghaiDay)(billDate).getTime();
        const yesterday = new Date(Date.now() - 8 * 3600 * 1000);
        const todayStart = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate())).getTime();
        if (start >= todayStart)
            throw new app_exception_1.AppError(40001, "账单日期不能晚于昨天", 400);
        if (start < todayStart - 90 * 24 * 3600 * 1000) {
            throw new app_exception_1.AppError(40001, "只能对账最近 90 天的账单", 400);
        }
    }
};
exports.PaymentReconciliationService = PaymentReconciliationService;
exports.PaymentReconciliationService = PaymentReconciliationService = PaymentReconciliationService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        payment_config_service_1.PaymentConfigService,
        payment_order_service_1.PaymentOrderService])
], PaymentReconciliationService);
function extractImportCsv(data, providerId) {
    const isZip = data.length >= 4 &&
        data[0] === 0x50 &&
        data[1] === 0x4b &&
        data[2] === 0x03 &&
        data[3] === 0x04;
    if (!isZip)
        return data;
    if (providerId !== "alipay") {
        throw new app_exception_1.AppError(40001, "只有支付宝账单支持 ZIP 格式，微信请上传 CSV", 400);
    }
    return (0, zip_reader_1.readFirstCsvFromZip)(data);
}
function parseBillCsv(text, providerId) {
    const rows = (0, csv_1.parseCsv)(text);
    if (rows.length < 2)
        return [];
    const header = rows[0].map((h) => h.replace(/^\uFEFF/, "").trim());
    const col = (name) => header.findIndex((h) => h.includes(name));
    const iOrderNo = col("商户订单号") >= 0 ? col("商户订单号") : col("订单号");
    const iTradeNo = col("渠道交易号") >= 0 ? col("渠道交易号") : col("交易号");
    const iAmount = col("金额");
    const iPaidAt = col("支付时间") >= 0 ? col("支付时间") : col("完成时间");
    const iStatus = col("状态");
    if (iOrderNo < 0 || iTradeNo < 0 || iAmount < 0) {
        throw new app_exception_1.AppError(40001, "CSV 表头无法识别（需要：商户订单号 / 渠道交易号 / 金额）", 400);
    }
    const out = [];
    for (const row of rows.slice(1)) {
        const status = iStatus >= 0 ? (row[iStatus] ?? "").trim() : "";
        if (status && !/成功|SUCCESS|paid/i.test(status))
            continue;
        const merchantOrderNo = (row[iOrderNo] ?? "").trim();
        const providerTradeNo = (row[iTradeNo] ?? "").trim();
        const rawAmount = (row[iAmount] ?? "").trim();
        const amountCents = rawAmount.includes(".")
            ? Math.round(Number.parseFloat(rawAmount) * 100)
            : Number.parseInt(rawAmount, 10);
        if (!merchantOrderNo || !providerTradeNo || !Number.isFinite(amountCents))
            continue;
        const paidRaw = iPaidAt >= 0 ? (row[iPaidAt] ?? "").trim() : "";
        out.push({
            merchantOrderNo,
            providerTradeNo,
            amountCents,
            currency: "CNY",
            paidAt: paidRaw
                ? new Date(paidRaw.replace(" ", "T") + "+08:00")
                : new Date(),
            providerStatus: status || (providerId === "alipay" ? "TRADE_SUCCESS" : "SUCCESS"),
        });
    }
    return out;
}
function toRunView(row) {
    return {
        id: row.id,
        providerId: row.providerId,
        configId: row.configId,
        billDate: row.billDate,
        attempt: row.attempt,
        source: row.source,
        fileName: row.fileName,
        status: row.status,
        totalItems: row.totalItems,
        matchItems: row.matchItems,
        recoveredItems: row.recoveredItems,
        errorItems: row.errorItems,
        error: row.error,
        startedBy: row.startedBy,
        startedAt: row.startedAt.toISOString(),
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    };
}
function toItemView(row) {
    return {
        id: row.id,
        orderId: row.orderId,
        merchantOrderNo: row.merchantOrderNo,
        providerTradeNo: row.providerTradeNo,
        amountCents: row.amountCents,
        currency: row.currency,
        result: row.result,
        resolved: row.resolved,
        detail: row.detail,
        createdAt: row.createdAt.toISOString(),
    };
}
function truncate(value, max) {
    return value.length > max ? value.slice(0, max) : value;
}
//# sourceMappingURL=payment-reconciliation.service.js.map