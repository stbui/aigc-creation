import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AppError } from "../common/app.exception";
import { decodeCsvBuffer, parseCsv } from "../common/csv";
import { readFirstCsvFromZip } from "../common/archive/zip-reader";
import { PaymentConfigService } from "./payment-config.service";
import { PaymentOrderService } from "./payment-order.service";
import { PaymentExceptionService } from "./payment-exception.service";
import { getAdapter } from "./adapters";
import {
  BillRecord,
  PaymentCurrency,
  PaymentProviderId,
} from "./adapters/types";
import {
  formatShanghai,
  parseDateStrict,
  shanghaiDayRange,
  startOfShanghaiDay,
} from "./payment-query";

export const RECONCILIATION_RESULTS = [
  "matched",
  "recovered",
  "local_order_not_found",
  "provider_record_missing",
  "amount_mismatch",
  "trade_no_mismatch",
  "duplicate_charge",
  "credit_failed",
  "auto_refunded",
  "refund_processing",
  "refund_failed",
] as const;

export type ReconciliationResult = (typeof RECONCILIATION_RESULTS)[number];

/**
 * 仍待人工处置的对账结果。
 *
 * `matched`（一致）、`recovered`（查单确认后已补发）、`auto_refunded`（已自动
 * 原路退款）是三种已经闭环的结果，剩下的每一种都意味着「钱和账对不上，且没人
 * 处理过」。列表的 `abnormal` 筛选、告警、工作台都必须用这一份口径 ——
 * 三处各写一份 `notIn` 必然分叉。
 */
export const RECONCILIATION_OPEN_RESULTS = [
  "local_order_not_found",
  "provider_record_missing",
  "amount_mismatch",
  "trade_no_mismatch",
  "duplicate_charge",
  "credit_failed",
  "refund_processing",
  "refund_failed",
] as const satisfies readonly ReconciliationResult[];

/** 对账运行超过该时长视为进程中断，允许重跑 */
export const RECONCILIATION_RUN_STALE_MS = 30 * 60_000;

/** 对账导出行数上限；超过必须报错而不是静默截断 */
export const RECONCILIATION_EXPORT_LIMIT = 10_000;

export interface RunView {
  id: string;
  providerId: string;
  providerInstanceId: string;
  configId: string | null;
  billDate: string;
  attempt: number;
  source: string;
  fileName: string | null;
  status: string;
  totalItems: number;
  matchItems: number;
  recoveredItems: number;
  errorItems: number;
  error: string | null;
  startedBy: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ItemView {
  id: string;
  orderId: string | null;
  merchantOrderNo: string;
  providerTradeNo: string | null;
  amountCents: number;
  currency: string;
  result: string;
  resolved: boolean;
  detail: string | null;
  createdAt: string;
}

export interface ReconciliationListQuery {
  providerId?: string;
  providerInstanceId?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/**
 * 支付对账。
 *
 * 比对规则的核心原则：**只相信签名查单，不相信上传文件里的「成功」字样**。
 * CSV 导入是兜底通道（渠道账单接口不可用时的最后手段），但它同样会触发一次
 * 渠道查单确认后才补发，否则一个被篡改的 CSV 就能凭空造出积分。
 */
@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: PaymentConfigService,
    private readonly orders: PaymentOrderService,
    private readonly exceptions: PaymentExceptionService,
  ) {}

  // ── 执行 ────────────────────────────────────────────────────────

  async run(input: {
    providerId: PaymentProviderId;
    providerInstanceId: string;
    billDate: string;
    retryFailed?: boolean;
    actorId: string;
  }): Promise<{ run: RunView; reused: boolean }> {
    this.assertBillDate(input.billDate);

    const latest = await this.prisma.paymentReconciliationRun.findFirst({
      where: {
        providerId: input.providerId,
        providerInstanceId: input.providerInstanceId,
        billDate: input.billDate,
      },
      orderBy: { attempt: "desc" },
    });
    if (latest?.status === "running") {
      if (!(await this.recoverIfStale(latest))) {
        throw new AppError(40901, "该账单日的对账正在执行中", 409);
      }
    }
    if (latest?.status === "completed" && !input.retryFailed) {
      return { run: toRunView(latest), reused: true };
    }

    const adapter = getAdapter(input.providerId);
    if (!adapter)
      throw new AppError(40400, `未知支付渠道: ${input.providerId}`, 404);
    if (
      !adapter.descriptor.supportsReconciliation ||
      !adapter.downloadTradeBill
    ) {
      throw new AppError(40001, `渠道 ${input.providerId} 不支持自动对账`, 400);
    }

    const config = await this.configs.latestInstance(
      input.providerId,
      input.providerInstanceId,
    );
    if (!config) {
      throw new AppError(40400, "支付服务商实例不存在", 404);
    }

    const attempt = (latest?.attempt ?? 0) + 1;
    let run = await this.createRunRow({
      providerId: input.providerId,
      providerInstanceId: input.providerInstanceId,
      configId: config.id,
      billDate: input.billDate,
      attempt,
      source: "provider",
      status: "running",
      startedBy: input.actorId,
    });

    let records: BillRecord[];
    try {
      records = await adapter.downloadTradeBill(
        {
          providerId: config.providerId,
          configId: config.id,
          configVersion: config.version,
          values: config.values,
        },
        input.billDate,
      );
    } catch (e) {
      run = await this.prisma.paymentReconciliationRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          error: truncate((e as Error).message, 500),
          completedAt: new Date(),
        },
      });
      this.logger.error(
        `对账账单下载失败 (${input.providerId}/${input.providerInstanceId} ${input.billDate}): ${(e as Error).message}`,
      );
      return { run: toRunView(run), reused: false };
    }

    return {
      run: await this.compare(
        run.id,
        input.providerId,
        input.providerInstanceId,
        config.id,
        records,
        input.billDate,
      ),
      reused: false,
    };
  }

  async importCsv(input: {
    providerId: PaymentProviderId;
    providerInstanceId: string;
    billDate: string;
    file: Buffer;
    fileName: string;
    actorId: string;
  }): Promise<{ run: RunView }> {
    this.assertBillDate(input.billDate);
    const adapter = getAdapter(input.providerId);
    if (!adapter)
      throw new AppError(40400, `未知支付渠道: ${input.providerId}`, 404);
    if (!adapter.descriptor.supportsReconciliation) {
      throw new AppError(40001, `渠道 ${input.providerId} 不支持对账导入`, 400);
    }

    const records = parseBillCsv(
      decodeCsvBuffer(extractImportCsv(input.file, input.providerId)),
      input.providerId,
    );
    if (records.length === 0)
      throw new AppError(40001, "账单没有交易记录", 400);

    const config = await this.configs.latestInstance(
      input.providerId,
      input.providerInstanceId,
    );
    if (!config) {
      throw new AppError(40400, "支付服务商实例不存在", 404);
    }
    const latest = await this.prisma.paymentReconciliationRun.findFirst({
      where: {
        providerId: input.providerId,
        providerInstanceId: input.providerInstanceId,
        billDate: input.billDate,
      },
      orderBy: { attempt: "desc" },
    });
    if (latest?.status === "running" && !(await this.recoverIfStale(latest))) {
      throw new AppError(40901, "该账单日的对账正在执行中", 409);
    }

    const run = await this.createRunRow({
      providerId: input.providerId,
      providerInstanceId: input.providerInstanceId,
      configId: config.id,
      billDate: input.billDate,
      attempt: (latest?.attempt ?? 0) + 1,
      source: "csv",
      fileName: input.fileName,
      status: "running",
      startedBy: input.actorId,
    });

    const compared = await this.compare(
      run.id,
      input.providerId,
      input.providerInstanceId,
      config.id,
      records,
      input.billDate,
    );
    return { run: compared };
  }

  // ── 查询 ────────────────────────────────────────────────────────

  async list(query: ReconciliationListQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;
    const where: Record<string, unknown> = {};
    if (query.providerId) where.providerId = query.providerId;
    if (query.providerInstanceId) {
      where.providerInstanceId = query.providerInstanceId;
    }
    if (query.status) {
      if (!["running", "completed", "failed"].includes(query.status)) {
        throw new AppError(40001, `对账状态非法: ${query.status}`, 400);
      }
      where.status = query.status;
    }
    const range = shanghaiDayRange(query.from, query.to);
    if (range) where.billDate = undefined; // billDate 是字符串, 用下面的日期比较
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

  async items(
    runId: string,
    query: { result?: string; page?: number; pageSize?: number },
  ) {
    const run = await this.prisma.paymentReconciliationRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new AppError(40400, "对账记录不存在", 404);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: Record<string, unknown> = { runId };
    if (query.result && query.result !== "all") {
      if (query.result === "abnormal") {
        where.result = { in: [...RECONCILIATION_OPEN_RESULTS] };
      } else if (
        (RECONCILIATION_RESULTS as readonly string[]).includes(query.result)
      ) {
        where.result = query.result;
      } else {
        throw new AppError(40001, `对账结果筛选值非法: ${query.result}`, 400);
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

  /**
   * 仍待处置对账差异所在的批次：每个「渠道 + 账单日」只取**最新一次已完成**的对账。
   *
   * 重跑会为新批次生成新明细，旧批次的异常行不会因重跑被改写或删除。若按
   * 全表 `result NOT IN (...)` 计数，差异只会单调累加、永远不归零 —— 告警
   * 会长期挂着红点，最后所有人都当它不存在。判定「还欠多少笔」必须按最新
   * 批次算。
   *
   * 返回 run id 列表，调用方自行 count / aggregate（告警要数字，工作台还要金额与样本行）。
   */
  async openRunIds(): Promise<string[]> {
    const runs = await this.prisma.paymentReconciliationRun.findMany({
      where: { status: "completed" },
      orderBy: [{ billDate: "desc" }, { attempt: "desc" }],
      take: 500,
      select: {
        id: true,
        providerId: true,
        providerInstanceId: true,
        billDate: true,
      },
    });
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const run of runs) {
      const key = `${run.providerId}|${run.providerInstanceId}|${run.billDate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(run.id);
    }
    return ids;
  }

  async runsForExport(query: ReconciliationListQuery) {
    const where: Record<string, unknown> = {};
    if (query.providerId) where.providerId = query.providerId;
    if (query.providerInstanceId) {
      where.providerInstanceId = query.providerInstanceId;
    }
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.AND = [
        ...(query.from ? [{ billDate: { gte: query.from } }] : []),
        ...(query.to ? [{ billDate: { lte: query.to } }] : []),
      ];
    }
    // 超过上限直接报错，避免财务拿到被截断的对账运行清单
    const total = await this.prisma.paymentReconciliationRun.count({ where });
    if (total > RECONCILIATION_EXPORT_LIMIT) {
      throw new AppError(
        40001,
        `筛选结果共 ${total} 条，超过单次导出上限 ${RECONCILIATION_EXPORT_LIMIT} 条，请缩小时间范围后重试`,
        400,
      );
    }
    return this.prisma.paymentReconciliationRun.findMany({
      where,
      orderBy: [{ billDate: "desc" }, { attempt: "desc" }],
      take: RECONCILIATION_EXPORT_LIMIT,
    });
  }

  async itemsForExport(runId: string, result?: string) {
    const run = await this.prisma.paymentReconciliationRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new AppError(40400, "对账记录不存在", 404);
    if (run.status !== "completed") {
      throw new AppError(40901, "执行中的对账不能导出明细", 409);
    }
    const where: Record<string, unknown> = { runId };
    if (result && result !== "all") {
      if (result === "abnormal")
        where.result = { in: [...RECONCILIATION_OPEN_RESULTS] };
      else where.result = result;
    }
    const total = await this.prisma.paymentReconciliationItem.count({ where });
    if (total > RECONCILIATION_EXPORT_LIMIT) {
      throw new AppError(
        40001,
        `本次对账共 ${total} 条明细，超过单次导出上限 ${RECONCILIATION_EXPORT_LIMIT} 条，请按结果筛选后分批导出`,
        400,
      );
    }
    return this.prisma.paymentReconciliationItem.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: RECONCILIATION_EXPORT_LIMIT,
    });
  }

  // ── 比对 ────────────────────────────────────────────────────────

  private async compare(
    runId: string,
    providerId: PaymentProviderId,
    providerInstanceId: string,
    configId: string,
    records: BillRecord[],
    billDate: string,
  ): Promise<RunView> {
    let matched = 0;
    let recovered = 0;
    let errors = 0;
    const seenOrderNos = new Set<string>();
    const tradesByOrderNo = new Map<string, Set<string>>();

    for (const record of records) {
      seenOrderNos.add(record.merchantOrderNo);
      const seenTrades =
        tradesByOrderNo.get(record.merchantOrderNo) ?? new Set<string>();
      // 同一交易号重复导出行不是第二笔扣款；保留首行结果，避免 upsert 覆盖。
      if (seenTrades.has(record.providerTradeNo)) continue;
      const previousTradeNo = seenTrades.values().next().value as
        | string
        | undefined;
      seenTrades.add(record.providerTradeNo);
      tradesByOrderNo.set(record.merchantOrderNo, seenTrades);

      const outcome = await this.compareOne(
        runId,
        providerId,
        providerInstanceId,
        configId,
        record,
        previousTradeNo,
      );
      if (outcome === "matched") matched += 1;
      else if (outcome === "recovered" || outcome === "auto_refunded") recovered += 1;
      else errors += 1;
    }

    // 本地已支付但账单没有记录：不降级、不猜，只记录。
    // 老订单可能没有 providerInstanceId，但其 configId 仍属于当前实例版本链。
    const instanceConfigIds = await this.instanceConfigIds(
      providerId,
      providerInstanceId,
    );
    const localPaid = await this.prisma.order.findMany({
      where: {
        channel: providerId,
        status: { in: ["paid", "refunded", "partial_refunded"] },
        providerPaidAt: {
          gte: startOfShanghaiDay(billDate),
          lte: new Date(
            startOfShanghaiDay(billDate).getTime() + 24 * 3600 * 1000 - 1,
          ),
        },
        providerTradeNo: { not: null },
        ...(instanceConfigIds.length > 0
          ? {
              OR: [
                { providerInstanceId },
                { providerConfigId: { in: instanceConfigIds } },
              ],
            }
          : { providerInstanceId }),
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
      if (seenOrderNos.has(order.orderNo)) continue;
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
      await this.exceptions.recordManual({
        providerId,
        orderId: order.id,
        merchantOrderNo: order.orderNo,
        providerTradeNo: order.providerTradeNo,
        amountCents: order.paidCents,
        currency: order.currency || "CNY",
        kind: "provider_record_missing",
        detail: "本地已支付但渠道账单没有该笔记录",
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
    this.logger.log(
      `对账完成 (${providerId}/${providerInstanceId} ${billDate}): 共 ${matched + recovered + errors} 笔, 一致 ${matched}, 补发 ${recovered}, 异常 ${errors}`,
    );
    return toRunView(run);
  }

  private async instanceConfigIds(
    providerId: PaymentProviderId,
    providerInstanceId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.paymentProviderConfig.findMany({
      where: { providerId, instanceId: providerInstanceId },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async compareOne(
    runId: string,
    providerId: PaymentProviderId,
    providerInstanceId: string,
    configId: string,
    record: BillRecord,
    previousTradeNo?: string,
  ): Promise<ReconciliationResult> {
    const order = await this.prisma.order.findUnique({
      where: { orderNo: record.merchantOrderNo },
    });

    const writeItem = async (
      result: ReconciliationResult,
      detail: string,
      orderId?: string | null,
      resolved = false,
    ): Promise<void> => {
      await this.prisma.paymentReconciliationItem.upsert({
        where: {
          runId_merchantOrderNo_providerTradeNo: {
            runId,
            merchantOrderNo: record.merchantOrderNo,
            providerTradeNo: record.providerTradeNo,
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
      if (previousTradeNo) {
        await this.exceptions.recordManual({
          providerId,
          merchantOrderNo: record.merchantOrderNo,
          providerTradeNo: record.providerTradeNo,
          amountCents: record.amountCents,
          currency: record.currency,
          kind: "duplicate_charge",
          detail: `同一商户订单号出现多个渠道交易号（先见 ${previousTradeNo}，本次 ${record.providerTradeNo}），且本地不存在该订单`,
        });
        await writeItem(
          "duplicate_charge",
          `同一商户订单号出现多个渠道交易号（先见 ${previousTradeNo}，本次 ${record.providerTradeNo}），且本地不存在该订单`,
        );
        return "duplicate_charge";
      }
      await this.exceptions.recordManual({
        providerId,
        merchantOrderNo: record.merchantOrderNo,
        providerTradeNo: record.providerTradeNo,
        amountCents: record.amountCents,
        currency: record.currency,
        kind: "local_order_not_found",
        detail: "本地不存在该商户订单号",
      });
      await writeItem("local_order_not_found", "本地不存在该商户订单号");
      return "local_order_not_found";
    }

    if (previousTradeNo) {
      await this.exceptions.recordManual({
        providerId,
        orderId: order.id,
        merchantOrderNo: record.merchantOrderNo,
        providerTradeNo: record.providerTradeNo,
        amountCents: record.amountCents,
        currency: record.currency,
        kind: "duplicate_charge",
        detail: `同一商户订单号出现多个渠道交易号（先见 ${previousTradeNo}，本次 ${record.providerTradeNo}），疑似重复扣款`,
      });
      await writeItem(
        "duplicate_charge",
        `同一商户订单号出现多个渠道交易号（先见 ${previousTradeNo}，本次 ${record.providerTradeNo}），疑似重复扣款`,
        order.id,
      );
      return "duplicate_charge";
    }

    if (order.status === "cancelled") {
      const refund = await this.exceptions.autoRefundCancelledPayment({
        providerId,
        merchantOrderNo: order.orderNo,
        providerTradeNo: record.providerTradeNo,
        amountCents: record.amountCents,
        currency: record.currency,
        detail: "本地订单已取消但渠道账单显示成功，尝试自动原路退款",
      });
      if (refund.outcome === "refunded") {
        await writeItem(
          "auto_refunded",
          "订单已取消，已自动原路退款",
          order.id,
          true,
        );
        return "auto_refunded";
      }
      if (refund.outcome === "refund_processing") {
        await writeItem(
          "refund_processing",
          "订单已取消，渠道退款仍在异步处理中",
          order.id,
        );
        return "refund_processing";
      }
      await writeItem(
        "refund_failed",
        refund.case.lastError ?? "自动退款未能完成，已转人工处理",
        order.id,
      );
      return "refund_failed";
    }

    if (
      order.status === "paid" ||
      order.status === "refunded" ||
      order.status === "partial_refunded"
    ) {
      if (
        order.providerTradeNo &&
        order.providerTradeNo !== record.providerTradeNo
      ) {
        await this.exceptions.recordManual({
          providerId,
          orderId: order.id,
          merchantOrderNo: record.merchantOrderNo,
          providerTradeNo: record.providerTradeNo,
          amountCents: record.amountCents,
          currency: record.currency,
          kind: "trade_no_mismatch",
          detail: `本地交易号 ${order.providerTradeNo} 与账单 ${record.providerTradeNo} 不一致`,
        });
        await writeItem(
          "trade_no_mismatch",
          `本地交易号 ${order.providerTradeNo} 与账单 ${record.providerTradeNo} 不一致`,
          order.id,
        );
        return "trade_no_mismatch";
      }
      if (order.paidCents !== record.amountCents) {
        await this.exceptions.recordManual({
          providerId,
          orderId: order.id,
          merchantOrderNo: record.merchantOrderNo,
          providerTradeNo: record.providerTradeNo,
          amountCents: record.amountCents,
          currency: record.currency,
          kind: "amount_mismatch",
          detail: `本地实付 ${order.paidCents} 分与账单 ${record.amountCents} 分不一致`,
        });
        await writeItem(
          "amount_mismatch",
          `本地实付 ${order.paidCents} 分与账单 ${record.amountCents} 分不一致`,
          order.id,
        );
        return "amount_mismatch";
      }
      await writeItem("matched", "一致", order.id);
      return "matched";
    }

    // 本地 pending，账单显示成功 → 必须用固定配置查单二次确认后才补发
    if (!configId) {
      await this.exceptions.recordManual({
        providerId,
        orderId: order.id,
        merchantOrderNo: record.merchantOrderNo,
        providerTradeNo: record.providerTradeNo,
        amountCents: record.amountCents,
        currency: record.currency,
        kind: "credit_failed",
        detail: "渠道未配置，无法二次查单确认",
      });
      await writeItem(
        "credit_failed",
        "渠道未配置，无法二次查单确认",
        order.id,
      );
      return "credit_failed";
    }
    const adapter = getAdapter(providerId);
    let config;
    try {
      config = await this.configs.byId(configId);
    } catch {
      config = null;
    }
    if (
      !config ||
      !adapter ||
      config.providerId !== providerId ||
      config.instanceId !== providerInstanceId
    ) {
      await this.exceptions.recordManual({
        providerId,
        orderId: order.id,
        merchantOrderNo: record.merchantOrderNo,
        providerTradeNo: record.providerTradeNo,
        amountCents: record.amountCents,
        currency: record.currency,
        kind: "credit_failed",
        detail: "渠道配置缺失，无法二次查单确认",
      });
      await writeItem(
        "credit_failed",
        "渠道配置缺失，无法二次查单确认",
        order.id,
      );
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
        await this.exceptions.recordManual({
          providerId,
          orderId: order.id,
          merchantOrderNo: record.merchantOrderNo,
          providerTradeNo: record.providerTradeNo,
          amountCents: record.amountCents,
          currency: record.currency,
          kind: "credit_failed",
          detail: `账单显示成功但查单结果为 ${queried.state}`,
        });
        await writeItem(
          "credit_failed",
          `账单显示成功但查单结果为 ${queried.state}`,
          order.id,
        );
        return "credit_failed";
      }
      await this.orders.applyPaymentResult({
        orderId: order.id,
        providerId,
        configId: config.id,
        providerInstanceId: config.instanceId,
        tradeNo: queried.tradeNo ?? record.providerTradeNo,
        amountCents: queried.amountCents ?? record.amountCents,
        currency: (queried.currency ?? record.currency) as PaymentCurrency,
        paidAt: queried.paidAt ?? record.paidAt,
        providerStatus: queried.providerStatus,
        rawPayload: queried.rawPayload,
      });
      await writeItem("recovered", "已通过查单确认并自动补发", order.id, true);
      return "recovered";
    } catch (e) {
      await this.exceptions.recordManual({
        providerId,
        orderId: order.id,
        merchantOrderNo: record.merchantOrderNo,
        providerTradeNo: record.providerTradeNo,
        amountCents: record.amountCents,
        currency: record.currency,
        kind: "credit_failed",
        detail: `补发失败: ${(e as Error).message}`,
      });
      await writeItem(
        "credit_failed",
        `补发失败: ${(e as Error).message}`,
        order.id,
      );
      return "credit_failed";
    }
  }

  /**
   * 并发 claim 的兜底：两个请求同时通过 `latest` 检查时，唯一约束
   * `(providerId, providerInstanceId, billDate, attempt)` 只会让一个成功；另一个返回 409
   * 而不是 500。换 Postgres 多实例时仍建议改成行锁。
   */
  private async createRunRow(data: {
    providerId: string;
    providerInstanceId: string;
    configId: string | null;
    billDate: string;
    attempt: number;
    source: string;
    fileName?: string;
    status: string;
    startedBy: string;
  }) {
    try {
      return await this.prisma.paymentReconciliationRun.create({ data });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") {
        throw new AppError(40901, "该账单日的对账正在执行中", 409);
      }
      throw e;
    }
  }

  /**
   * 回收超时未完成的运行（进程崩溃/重启后一直占着「执行中」）。
   * 定时 worker 与手动重跑前都会调用；只处理超过阈值的行。
   */
  async recoverStaleRuns(): Promise<number> {
    const result = await this.prisma.paymentReconciliationRun.updateMany({
      where: {
        status: "running",
        startedAt: { lt: new Date(Date.now() - RECONCILIATION_RUN_STALE_MS) },
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
  private async recoverIfStale(run: {
    id: string;
    startedAt: Date;
  }): Promise<boolean> {
    if (run.startedAt.getTime() > Date.now() - RECONCILIATION_RUN_STALE_MS)
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

  private assertBillDate(billDate: string): void {
    parseDateStrict(billDate);
    const start = startOfShanghaiDay(billDate).getTime();
    // 日期窗口以上海时区为准；不能用 UTC 零点，否则东八区深夜会放行当天账单。
    const todayStart = startOfShanghaiDay(
      formatShanghai(new Date()).slice(0, 10),
    ).getTime();
    if (start >= todayStart)
      throw new AppError(40001, "账单日期不能晚于昨天", 400);
    if (start < todayStart - 90 * 24 * 3600 * 1000) {
      throw new AppError(40001, "只能对账最近 90 天的账单", 400);
    }
  }
}

function extractImportCsv(data: Buffer, providerId: PaymentProviderId): Buffer {
  const isZip =
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    data[2] === 0x03 &&
    data[3] === 0x04;
  if (!isZip) return data;
  if (providerId !== "alipay") {
    throw new AppError(
      40001,
      "只有支付宝账单支持 ZIP 格式，微信请上传 CSV",
      400,
    );
  }
  return readFirstCsvFromZip(data);
}

function parseBillCsv(
  text: string,
  providerId: PaymentProviderId,
): BillRecord[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.replace(/^\uFEFF/, "").trim());
  const col = (name: string) => header.findIndex((h) => h.includes(name));
  const iOrderNo = col("商户订单号") >= 0 ? col("商户订单号") : col("订单号");
  const iTradeNo = col("渠道交易号") >= 0 ? col("渠道交易号") : col("交易号");
  const iAmount = col("金额");
  const iPaidAt = col("支付时间") >= 0 ? col("支付时间") : col("完成时间");
  const iStatus = col("状态");
  if (iOrderNo < 0 || iTradeNo < 0 || iAmount < 0) {
    throw new AppError(
      40001,
      "CSV 表头无法识别（需要：商户订单号 / 渠道交易号 / 金额）",
      400,
    );
  }
  const out: BillRecord[] = [];
  for (const row of rows.slice(1)) {
    const status = iStatus >= 0 ? (row[iStatus] ?? "").trim() : "";
    if (status && !/成功|SUCCESS|paid/i.test(status)) continue;
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
      providerStatus:
        status || (providerId === "alipay" ? "TRADE_SUCCESS" : "SUCCESS"),
    });
  }
  return out;
}

function toRunView(row: {
  id: string;
  providerId: string;
  providerInstanceId: string;
  configId: string | null;
  billDate: string;
  attempt: number;
  source: string;
  fileName: string | null;
  status: string;
  totalItems: number;
  matchItems: number;
  recoveredItems: number;
  errorItems: number;
  error: string | null;
  startedBy: string | null;
  startedAt: Date;
  completedAt: Date | null;
}): RunView {
  return {
    id: row.id,
    providerId: row.providerId,
    providerInstanceId: row.providerInstanceId,
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

function toItemView(row: {
  id: string;
  orderId: string | null;
  merchantOrderNo: string;
  providerTradeNo: string | null;
  amountCents: number;
  currency: string;
  result: string;
  resolved: boolean;
  detail: string | null;
  createdAt: Date;
}): ItemView {
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

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export { formatShanghai };
