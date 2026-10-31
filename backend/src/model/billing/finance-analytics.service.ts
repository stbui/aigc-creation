/**
 * 财务分析（`GET /api/v1/admin/analytics/finance`）。
 *
 * 只读聚合，不改任何金额。所有口径都以 `BillingOrder` 为准 —— 积分账本记的是
 * 「资金流向」，账单记的是「这次生成该收多少、实际收了多少」，两者对不上时
 * 要能一眼看出是「没结算」还是「结算金额不同」。
 *
 * 三个口径定义（页面文案必须与之一致，否则运营会按自己的理解算第二套）：
 *   · **实收** = `status='settled'` 的 `actualAmountMicrocredits` 之和；
 *   · **已退** = 全部订单的 `refundedAmountMicrocredits` 之和（含人工退款）；
 *   · **净收入** = 实收 - 已退。
 * 未结算（reserved / running / uncertain）单独列为「挂账」，绝不并入实收 ——
 * 把不确定的钱算成收入是财务页最不能犯的错。
 *
 * 为什么在内存里聚合而不是 SQL `groupBy`：SQLite 的 BigInt 求和会溢出成浮点，
 * 且需要按「日 / 模型 / 渠道 / 场景」四种维度切同一批数据。单页区间上限 366 天，
 * 账单量在十万级以内的内存聚合代价可以接受；超出这个量级应先上专用数仓。
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { badRequest } from '../domain/json';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 默认看最近 30 天；单次查询上限 366 天（超过说明该用导出而不是在线聚合） */
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 366;
/** 分维度榜单只取前 N，页面不需要「第 47 名模型」 */
const TOP_N = 10;

export interface FinanceAnalyticsQuery {
  /** 起始日期（含），`YYYY-MM-DD` 或 ISO 时间 */
  from?: string;
  /** 结束日期（含当天） */
  to?: string;
}

export interface FinanceBreakdownRow {
  key: string;
  label: string;
  orders: number;
  settledOrders: number;
  refundedOrders: number;
  chargedMicrocredits: number;
  refundedMicrocredits: number;
  netMicrocredits: number;
}

export interface FinanceDayRow {
  date: string;
  orders: number;
  settledOrders: number;
  refundedOrders: number;
  chargedMicrocredits: number;
  refundedMicrocredits: number;
  netMicrocredits: number;
}

export interface FinanceAnalyticsView {
  range: { from: string; to: string; days: number };
  totals: {
    orders: number;
    settledOrders: number;
    refundedOrders: number;
    uncertainOrders: number;
    /** 未结算但已预授权（reserved / running / uncertain）的金额和 */
    outstandingMicrocredits: number;
    chargedMicrocredits: number;
    refundedMicrocredits: number;
    netMicrocredits: number;
    costMicrocredits: number;
    marginMicrocredits: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    /** 结算成功率 = 已结算 / (已结算 + 已退款)；挂账不计入分母 */
    settleRate: number;
  };
  statusCounts: Record<string, number>;
  byDay: FinanceDayRow[];
  byModel: FinanceBreakdownRow[];
  byChannel: FinanceBreakdownRow[];
  byCapability: FinanceBreakdownRow[];
  byScene: FinanceBreakdownRow[];
}

interface AggregateBucket {
  orders: number;
  settledOrders: number;
  refundedOrders: number;
  charged: bigint;
  refunded: bigint;
}

@Injectable()
export class FinanceAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(query: FinanceAnalyticsQuery = {}): Promise<FinanceAnalyticsView> {
    const { from, to, days } = resolveRange(query);
    const rows = await this.prisma.billingOrder.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: {
        id: true,
        status: true,
        model: true,
        capability: true,
        channelId: true,
        scene: true,
        billingMode: true,
        actualAmountMicrocredits: true,
        reservedAmountMicrocredits: true,
        refundedAmountMicrocredits: true,
        costConfigured: true,
        costUnitPriceMicrocredits: true,
        costInputTokenPriceMicrocredits: true,
        costOutputTokenPriceMicrocredits: true,
        costQuantity: true,
        inputTokens: true,
        outputTokens: true,
        cachedTokens: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const statusCounts: Record<string, number> = {};
    const totals = {
      orders: rows.length,
      settledOrders: 0,
      refundedOrders: 0,
      uncertainOrders: 0,
      outstanding: 0n,
      charged: 0n,
      refunded: 0n,
      cost: 0n,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
    };
    const dayMap = new Map<string, AggregateBucket>();
    const modelMap = new Map<string, AggregateBucket>();
    const channelMap = new Map<string, AggregateBucket>();
    const capabilityMap = new Map<string, AggregateBucket>();
    const sceneMap = new Map<string, AggregateBucket>();

    for (const row of rows) {
      statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
      const charged = row.status === 'settled' ? row.actualAmountMicrocredits : 0n;
      const refunded = row.refundedAmountMicrocredits ?? 0n;

      if (row.status === 'settled') totals.settledOrders += 1;
      if (row.status === 'refunded') totals.refundedOrders += 1;
      if (row.status === 'uncertain') totals.uncertainOrders += 1;
      if (row.status === 'reserved' || row.status === 'running' || row.status === 'uncertain') {
        totals.outstanding += row.reservedAmountMicrocredits ?? 0n;
      }
      totals.charged += charged;
      totals.refunded += refunded;
      if (row.status === 'settled' && row.costConfigured) totals.cost += costAmount(row);
      totals.inputTokens += Number(row.inputTokens ?? 0n);
      totals.outputTokens += Number(row.outputTokens ?? 0n);
      totals.cachedTokens += Number(row.cachedTokens ?? 0n);

      accumulate(dayMap, dayKey(row.createdAt), row.status, charged, refunded);
      accumulate(modelMap, row.model || '(未命名模型)', row.status, charged, refunded);
      accumulate(channelMap, row.channelId || '(无渠道)', row.status, charged, refunded);
      accumulate(capabilityMap, row.capability || '(未声明)', row.status, charged, refunded);
      accumulate(sceneMap, row.scene || '(未声明)', row.status, charged, refunded);
    }

    const net = totals.charged - totals.refunded;
    const decided = totals.settledOrders + totals.refundedOrders;
    return {
      range: { from: from.toISOString(), to: to.toISOString(), days },
      totals: {
        orders: totals.orders,
        settledOrders: totals.settledOrders,
        refundedOrders: totals.refundedOrders,
        uncertainOrders: totals.uncertainOrders,
        outstandingMicrocredits: micro(totals.outstanding),
        chargedMicrocredits: micro(totals.charged),
        refundedMicrocredits: micro(totals.refunded),
        netMicrocredits: micro(net),
        costMicrocredits: micro(totals.cost),
        marginMicrocredits: micro(totals.charged - totals.cost),
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cachedTokens: totals.cachedTokens,
        settleRate: decided === 0 ? 0 : round4(totals.settledOrders / decided),
      },
      statusCounts,
      byDay: [...dayMap.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, bucket]) => ({ date, ...toView(bucket) })),
      byModel: rank(modelMap),
      byChannel: rank(channelMap),
      byCapability: rank(capabilityMap),
      byScene: rank(sceneMap),
    };
  }
}

/* ────────────────────────── 纯函数 ────────────────────────── */

/**
 * 区间解析：`to` 按「当天结束」理解（页面选到 10-31 就该包含 10-31 全天）。
 * 非法日期直接 400 —— 财务页静默回退到默认区间会让人以为「这个月没收入」。
 */
function resolveRange(query: FinanceAnalyticsQuery): { from: Date; to: Date; days: number } {
  const now = new Date();
  const endOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const to = parseDate(query.to, endOfToday, true);
  const defaultFrom = new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  const from = parseDate(query.from, defaultFrom, false);
  if (from.getTime() > to.getTime()) throw badRequest('起始日期不能晚于结束日期');
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / DAY_MS));
  if (days > MAX_RANGE_DAYS) throw badRequest(`单次查询区间不能超过 ${MAX_RANGE_DAYS} 天`);
  return { from, to, days };
}

function parseDate(raw: string | undefined, fallback: Date, endOfDay: boolean): Date {
  const text = String(raw ?? '').trim();
  if (text === '') return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) throw badRequest(`日期格式无效：${text}`);
    if (endOfDay) parsed.setUTCDate(parsed.getUTCDate() + 1);
    return parsed;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw badRequest(`日期格式无效：${text}`);
  return parsed;
}

function accumulate(
  target: Map<string, AggregateBucket>,
  key: string,
  status: string,
  charged: bigint,
  refunded: bigint,
): void {
  let bucket = target.get(key);
  if (!bucket) {
    bucket = { orders: 0, settledOrders: 0, refundedOrders: 0, charged: 0n, refunded: 0n };
    target.set(key, bucket);
  }
  bucket.orders += 1;
  if (status === 'settled') bucket.settledOrders += 1;
  if (status === 'refunded') bucket.refundedOrders += 1;
  bucket.charged += charged;
  bucket.refunded += refunded;
}

function rank(map: Map<string, AggregateBucket>): FinanceBreakdownRow[] {
  return [...map.entries()]
    .sort((left, right) => right[1].orders - left[1].orders || left[0].localeCompare(right[0]))
    .slice(0, TOP_N)
    .map(([key, bucket]) => ({ key, label: key, ...toView(bucket) }));
}

function toView(bucket: AggregateBucket): Omit<FinanceBreakdownRow, 'key' | 'label'> {
  return {
    orders: bucket.orders,
    settledOrders: bucket.settledOrders,
    refundedOrders: bucket.refundedOrders,
    chargedMicrocredits: micro(bucket.charged),
    refundedMicrocredits: micro(bucket.refunded),
    netMicrocredits: micro(bucket.charged - bucket.refunded),
  };
}

/** 按天聚合用 UTC 日期键：服务器时区不同不能让同一天的账落在两天 */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 成本快照：与 `BillingAdminService` 同一口径（固定价 × 数量，或 Token 单价 × 用量） */
function costAmount(row: {
  costBillingMode?: string | null;
  costUnitPriceMicrocredits: bigint;
  costQuantity: bigint;
  costInputTokenPriceMicrocredits: bigint;
  costOutputTokenPriceMicrocredits: bigint;
  inputTokens: bigint;
  outputTokens: bigint;
}): bigint {
  const tokenCost = row.costInputTokenPriceMicrocredits * row.inputTokens + row.costOutputTokenPriceMicrocredits * row.outputTokens;
  if (tokenCost > 0n) return tokenCost;
  const quantity = row.costQuantity > 0n ? row.costQuantity : 1n;
  return row.costUnitPriceMicrocredits * quantity;
}

/** BigInt 微积分 → 数值（微积分到 1e15 仍在安全整数范围内） */
function micro(value: bigint): number {
  return Number(value);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
