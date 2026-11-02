/**
 * 后台账单与调用记录（`/api/v1/admin/billing-orders`、`/admin/api-logs`）。
 *
 * 两个只读查询 + 一个人工核对动作：
 *   · `GET  /admin/billing-orders`              生成账单列表（状态、用量、成本、金额）
 *   · `POST /admin/billing-orders/:id/resolve`  人工核对（settle | refund）
 *   · `GET  /admin/api-logs`                    上游调用记录（`ApiCallLog` 维度）
 *
 * 核对动作本身不做任何金额计算，一律委托 `BillingService.resolve` —— 那里才是
 * 「结算按用量、退款全额、终态不可改写」的唯一实现。这里只负责补上操作人、原因
 * 与审计，并把 BigInt 金额转成可序列化的数值。
 */

import { Injectable } from '@nestjs/common';
import type { BillingOrder, Prisma } from '@prisma/client';
import { AppError } from '../../common/app.exception';
import { CSV_EXPORT_MAX_ROWS, toCsv } from '../../common/csv';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from './billing.service';
import { billingCreditCost } from './cost-amount';

/** 列表页单页上限：超过这个量级应当用筛选收窄，而不是翻页 */
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

export interface BillingOrderQuery {
  status?: string;
  userId?: string;
  taskId?: string;
  model?: string;
  channelId?: string;
  billingMode?: string;
  group?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface ApiLogQuery {
  status?: string;
  requestKind?: string;
  channelId?: string;
  taskId?: string;
  userId?: string;
  model?: string;
  billable?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 列表里的单条账单：金额一律转成数值（JSON 不能序列化 BigInt） */
export interface BillingOrderView {
  id: string;
  userId: string;
  userEmail: string;
  taskId: string;
  model: string;
  capability: string;
  scene: string;
  billingMode: string;
  status: string;
  channelId: string;
  channelName: string;
  channelModelId: string;
  channelModelName: string;
  priceTierId: string;
  userGroup: string;
  priceCurrency: string;
  unitPriceMicrocredits: number;
  multiplierBasisPoints: number;
  quantity: number;
  amountMicrocredits: number;
  reservedAmountMicrocredits: number;
  actualAmountMicrocredits: number;
  refundedAmountMicrocredits: number;
  costConfigured: boolean;
  /** 成本金额（微积分）。null = 成本未配置或账单未结算（页面显示「未配置」） */
  costAmountMicrocredits: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  usageSource: string;
  usageAvailable: boolean;
  chargeLimitSet: boolean;
  chargeLimitMicrocredits: number;
  providerRequestId: string;
  errorText: string;
  resolutionNote: string;
  resolvedBy: string;
  /**
   * 退款归类。`route_switch` = 线路切换的内部重预留（钱没离开平台，
   * **不计入「已退」**）；其余为真实退款。
   */
  refundReason: string;
  startedAt: string | null;
  settledAt: string | null;
  refundedAt: string | null;
  createdAt: string;
}

export interface BillingOrderListResult extends PageResult<BillingOrderView> {
  /** 各状态条数（不受分页影响，受筛选影响） */
  statusCounts: Record<string, number>;
}

@Injectable()
export class BillingAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  /* ───────────────────────── 生成账单 ───────────────────────── */

  async listOrders(query: BillingOrderQuery): Promise<BillingOrderListResult> {
    const { page, pageSize, skip, take } = paging(query);
    const where = await orderWhere(this.prisma, query);
    const [rows, total, counts] = await Promise.all([
      this.prisma.billingOrder.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.billingOrder.count({ where }),
      this.prisma.billingOrder.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);
    const [channelNames, channelModelNames, userEmails] = await Promise.all([
      nameLookup(
        rows.map((row) => row.channelId),
        (ids) =>
          this.prisma.modelChannel.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
      ),
      nameLookup(
        rows.map((row) => row.channelModelId),
        (ids) =>
          this.prisma.channelModel.findMany({
            where: { id: { in: ids } },
            select: { id: true, displayName: true, modelKey: true },
          }).then((items) =>
            items.map((item) => ({ id: item.id, name: item.displayName || item.modelKey })),
          ),
      ),
      nameLookup(
        rows.map((row) => row.userId),
        (ids) => this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }),
      ),
    ]);
    const statusCounts: Record<string, number> = {};
    for (const item of counts) statusCounts[item.status] = item._count._all;
    return {
      items: rows.map((row) => toOrderView(row, channelNames, channelModelNames, userEmails)),
      total,
      page,
      pageSize,
      statusCounts,
    };
  }

  async getOrder(id: string): Promise<BillingOrderView> {
    const row = await this.prisma.billingOrder.findUnique({ where: { id: String(id ?? '').trim() } });
    if (!row) throw new AppError(40400, '账单不存在', 404);
    const [channelNames, channelModelNames, userEmails] = await Promise.all([
      nameLookup([row.channelId], (ids) =>
        this.prisma.modelChannel.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
      ),
      nameLookup([row.channelModelId], (ids) =>
        this.prisma.channelModel
          .findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, modelKey: true } })
          .then((items) => items.map((item) => ({ id: item.id, name: item.displayName || item.modelKey }))),
      ),
      nameLookup([row.userId], (ids) =>
        this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }),
      ),
    ]);
    return toOrderView(row, channelNames, channelModelNames, userEmails);
  }

  /**
   * 人工核对：`settle` 按现有用量结算，`refund` 全额退回。
   *
   * 权限（`billing_order.resolve`）与原因必填由控制器 / 前端保证；金额与状态机
   * 完全交给 `BillingService.resolve`，这里不重复实现任何资金逻辑。
   */
  async resolveOrder(id: string, action: string, reason: string, actorUserId: string): Promise<BillingOrderView> {
    const normalized = String(action ?? '').trim().toLowerCase();
    if (normalized !== 'settle' && normalized !== 'refund') {
      throw new AppError(40001, '请选择结算或退款', 400);
    }
    const note = String(reason ?? '').trim();
    if (note === '') throw new AppError(40001, '请填写核对依据', 400);
    await this.billing.resolve(id, normalized, actorUserId, note);
    return this.getOrder(id);
  }

  /**
   * 批量核对：逐条独立处置，返回每条结果。
   *
   * 单条失败不阻断其余 —— 批量场景常见「其中一两条状态已经变了」，
   * 整批重试会让人反复核对同一堆单。失败条目带原因，便于定位是哪一条不满足条件。
   */
  async batchResolveOrders(
    ids: string[],
    action: string,
    reason: string,
    actorUserId: string,
  ): Promise<{ total: number; resolved: number; failed: number; results: Array<{ id: string; ok: boolean; error?: string }> }> {
    const unique = [...new Set(ids.map((item) => String(item ?? '').trim()).filter((item) => item !== ''))];
    if (unique.length === 0) throw new AppError(40001, '请选择要核对的账单', 400);
    if (unique.length > MAX_BATCH_RESOLVE) {
      throw new AppError(40001, `单次最多核对 ${MAX_BATCH_RESOLVE} 条账单`, 400);
    }
    // 动作与依据在**请求级**校验：缺依据是整批的用法错误，不是逐条的失败。
    // 若放到循环里，用户会看到「3 条全部失败」，看不出是自己的入参漏了。
    const normalized = String(action ?? '').trim().toLowerCase();
    if (normalized !== 'settle' && normalized !== 'refund') {
      throw new AppError(40001, '请选择结算或退款', 400);
    }
    const note = String(reason ?? '').trim();
    if (note === '') throw new AppError(40001, '请填写核对依据', 400);

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of unique) {
      try {
        await this.resolveOrder(id, normalized, note, actorUserId);
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, error: (error as Error).message });
      }
    }
    const resolved = results.filter((item) => item.ok).length;
    return { total: results.length, resolved, failed: results.length - resolved, results };
  }

  /* ───────────────────────── 调用记录 ───────────────────────── */

  async listApiLogs(query: ApiLogQuery): Promise<PageResult<ApiLogView> & { summary: ApiLogSummary }> {
    const { page, pageSize, skip, take } = paging(query);
    const where = apiLogWhere(query);
    const [rows, total, summary] = await Promise.all([
      this.prisma.apiCallLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.apiCallLog.count({ where }),
      this.apiLogSummary(where),
    ]);
    /*
     * 关联投影：一次查询把「谁调的 / 任务什么状态 / 账单什么状态」铺平。
     *
     * 参考实现在实体上用 `gorm:"-"` 挂一组只读投影字段，本仓改为在读模型里
     * JOIN —— 同样是不落库的展示字段。缺了它们，值班的人在日志页只能看到一个
     * userId，要点进任务页、账单页各查一次才能拼出全貌。
     */
    const related = await this.apiLogRelations(rows);
    return {
      items: rows.map((row) => ({ ...toApiLogView(row), ...related.get(row.id) })),
      total,
      page,
      pageSize,
      summary,
    };
  }

  /**
   * 调用记录的关联投影（用户昵称 / 任务状态 / 账单状态与金额）。
   *
   * 只查当前页涉及的 id，不做全表扫描。
   */
  private async apiLogRelations(
    rows: Array<{ id: string; userId: string; taskId: string; billingOrderId: string }>,
  ): Promise<Map<string, ApiLogRelation>> {
    const out = new Map<string, ApiLogRelation>();
    if (rows.length === 0) return out;
    const uniq = (values: string[]) => [...new Set(values.map((v) => String(v ?? '').trim()).filter((v) => v !== ''))];

    const userIds = uniq(rows.map((r) => r.userId));
    const taskIds = uniq(rows.map((r) => r.taskId));
    const orderIds = uniq(rows.map((r) => r.billingOrderId));

    const [users, tasks, orders] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        : Promise.resolve([]),
      taskIds.length
        ? this.prisma.generationTask.findMany({
            where: { id: { in: taskIds } },
            select: { id: true, status: true, capability: true },
          })
        : Promise.resolve([]),
      orderIds.length
        ? this.prisma.billingOrder.findMany({
            where: { id: { in: orderIds } },
            select: {
              id: true,
              status: true,
              reservedAmountMicrocredits: true,
              actualAmountMicrocredits: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const userById = new Map(users.map((u) => [u.id, u]));
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const orderById = new Map(orders.map((o) => [o.id, o]));

    for (const row of rows) {
      const user = userById.get(row.userId);
      const task = taskById.get(row.taskId);
      const order = orderById.get(row.billingOrderId);
      out.set(row.id, {
        userDisplayName: user?.name ?? '',
        userAccount: user?.email ?? '',
        taskStatus: task?.status ?? '',
        billingStatus: order?.status ?? '',
        billingReservedMicrocredits: order ? Number(order.reservedAmountMicrocredits) : null,
        billingSettledMicrocredits: order ? Number(order.actualAmountMicrocredits) : null,
      });
    }
    return out;
  }

  /**
   * 导出调用记录（CSV）。
   *
   * 与列表共用 `apiLogWhere`：筛什么就导出什么，避免出现「列表 32 行、导出
   * 400 行」的口径漂移。上限与其它后台导出一致，不提供「导全库」——调用记录
   * 是增长最快的表，全量导出会把 SQLite 拖到无法响应。
   *
   * 请求 / 响应体刻意不进导出：体积大且含用户内容，核对状态与错误码用不上。
   */
  async exportApiLogsCsv(query: ApiLogQuery): Promise<string> {
    const rows = await this.prisma.apiCallLog.findMany({
      where: apiLogWhere(query),
      orderBy: { createdAt: 'desc' },
      take: CSV_EXPORT_MAX_ROWS,
    });
    return toCsv(
      [
        { label: '时间', value: (r) => r.createdAt },
        { label: '来源', value: (r) => r.source },
        { label: '能力', value: (r) => r.capability },
        { label: '操作', value: (r) => r.operation },
        { label: '请求类型', value: (r) => r.requestKind },
        { label: '渠道', value: (r) => r.channelName || r.channelId },
        { label: '模型', value: (r) => r.model },
        { label: '状态', value: (r) => r.status },
        { label: 'HTTP', value: (r) => r.statusCode },
        { label: '耗时(ms)', value: (r) => r.durationMs },
        { label: '任务', value: (r) => r.taskId },
        { label: '账单', value: (r) => r.billingOrderId },
        { label: '用户', value: (r) => r.userId },
        { label: '错误码', value: (r) => r.errorCode },
        { label: '错误', value: (r) => r.error },
      ],
      rows,
    );
  }

  /** 概览：成功 / 失败条数与平均耗时。成本字段未配置时不能求和，故不提供成本合计 */
  private async apiLogSummary(where: Prisma.ApiCallLogWhereInput): Promise<ApiLogSummary> {
    const [success, failed, aggregate] = await Promise.all([
      this.prisma.apiCallLog.count({ where: { ...where, status: 'success' } }),
      this.prisma.apiCallLog.count({ where: { ...where, status: { in: ['failed', 'canceled'] } } }),
      this.prisma.apiCallLog.aggregate({ where, _avg: { durationMs: true }, _count: { _all: true } }),
    ]);
    return {
      total: aggregate._count._all,
      success,
      failed,
      other: Math.max(0, aggregate._count._all - success - failed),
      avgDurationMs: Math.round(aggregate._avg.durationMs ?? 0),
    };
  }
}

/** 调用记录视图：请求 / 响应体不在列表里下发（体积大且含用户内容，详情另开） */
export interface ApiLogView {
  id: string;
  userId: string;
  traceId: string;
  requestId: string;
  channelId: string;
  channelName: string;
  taskId: string;
  billingOrderId: string;
  source: string;
  capability: string;
  operation: string;
  requestKind: string;
  billable: boolean;
  apiFormat: string;
  method: string;
  path: string;
  model: string;
  status: string;
  statusCode: number;
  durationMs: number;
  pollCount: number;
  providerStatus: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  usageAvailable: boolean;
  mediaCount: number;
  videoSeconds: number;
  providerRequestId: string;
  errorCode: string;
  error: string;
  createdAt: string;
  /** 关联投影（用户 / 任务 / 账单），见 ApiLogRelation */
  userDisplayName?: string;
  userAccount?: string;
  taskStatus?: string;
  billingStatus?: string;
  billingReservedMicrocredits?: number | null;
  billingSettledMicrocredits?: number | null;
}

/** 调用记录的关联投影（只读展示字段，不落库） */
export interface ApiLogRelation {
  /** 用户昵称 */
  userDisplayName: string;
  /** 用户账号（邮箱） */
  userAccount: string;
  /** 任务状态（'succeeded' / 'failed' / 'running' …）；无任务为空 */
  taskStatus: string;
  /** 账单状态；无账单为空 */
  billingStatus: string;
  /** 账单预授权金额（微积分）；无账单为 null */
  billingReservedMicrocredits: number | null;
  /** 账单实收金额（微积分）；无账单为 null */
  billingSettledMicrocredits: number | null;
}

export interface ApiLogSummary {
  total: number;
  success: number;
  failed: number;
  other: number;
  avgDurationMs: number;
}

/* ────────────────────────── 纯函数 ────────────────────────── */

function paging(query: { page?: number; pageSize?: number }): {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
} {
  const page = Math.max(1, Math.trunc(Number(query.page) || 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(query.pageSize) || DEFAULT_PAGE_SIZE)));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function splitCsv(value: string | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** 时间筛选：`from` / `to` 都是闭区间，非法时间直接忽略而不是报错 */
function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  const range: Prisma.DateTimeFilter = {};
  const start = Date.parse(String(from ?? ''));
  const end = Date.parse(String(to ?? ''));
  if (Number.isFinite(start)) range.gte = new Date(start);
  if (Number.isFinite(end)) range.lte = new Date(end);
  return range.gte || range.lte ? range : undefined;
}

/**
 * 「待核对」队列的口径（与参考实现 `AdminBillingOrders(status='review')` 一致）：
 *   · `uncertain` —— 上游可能已受理，费用状态不明；
 *   · `running` 且超过 40 分钟 —— 执行者疑似已死；
 *   · `reserved` 但任务已失败/取消 —— 预授权没人退。
 */
const REVIEW_RUNNING_STALE_MINUTES = 40;
const MAX_BATCH_RESOLVE = 100;

async function orderWhere(
  prisma: PrismaService,
  query: BillingOrderQuery,
): Promise<Prisma.BillingOrderWhereInput> {
  const where: Prisma.BillingOrderWhereInput = {};
  const statuses = splitCsv(query.status);
  if (statuses.includes('review')) {
    const concrete = statuses.filter((item) => item !== 'review');
    const staleBefore = new Date(Date.now() - REVIEW_RUNNING_STALE_MINUTES * 60_000);
    // 任务已失败/取消、但账单仍挂着预授权：用子查询而非 relation 过滤
    // （BillingOrder 与 GenerationTask 之间没有声明 relation）
    const failedTasks = await prisma.generationTask.findMany({
      where: { status: { in: ['failed', 'cancelled'] } },
      select: { id: true },
    });
    const reviewClause: Prisma.BillingOrderWhereInput = {
      OR: [
        { status: 'uncertain' },
        { status: 'running', updatedAt: { lt: staleBefore } },
        { status: 'reserved', taskId: { in: failedTasks.map((task) => task.id) } },
      ],
    };
    where.OR = [
      reviewClause,
      ...(concrete.length > 0 ? [{ status: { in: concrete } }] : []),
    ];
    if (concrete.length === 0) delete where.status;
  } else if (statuses.length > 0) {
    where.status = { in: statuses };
  }
  if (query.userId?.trim()) where.userId = query.userId.trim();
  if (query.taskId?.trim()) where.taskId = query.taskId.trim();
  if (query.model?.trim()) where.model = query.model.trim();
  if (query.channelId?.trim()) where.channelId = query.channelId.trim();
  if (query.billingMode?.trim()) where.billingMode = query.billingMode.trim();
  if (query.group?.trim()) where.userGroup = query.group.trim();
  const range = dateRange(query.from, query.to);
  if (range) where.createdAt = range;
  return where;
}

function apiLogWhere(query: ApiLogQuery): Prisma.ApiCallLogWhereInput {
  const where: Prisma.ApiCallLogWhereInput = {};
  const statuses = splitCsv(query.status);
  if (statuses.length > 0) where.status = { in: statuses };
  if (query.requestKind?.trim()) where.requestKind = query.requestKind.trim();
  if (query.channelId?.trim()) where.channelId = query.channelId.trim();
  if (query.taskId?.trim()) where.taskId = query.taskId.trim();
  if (query.userId?.trim()) where.userId = query.userId.trim();
  if (query.model?.trim()) where.model = query.model.trim();
  if (query.billable === '1' || query.billable === 'true') where.billable = true;
  if (query.billable === '0' || query.billable === 'false') where.billable = false;
  const range = dateRange(query.from, query.to);
  if (range) where.createdAt = range;
  return where;
}

/** 批量取名：空 id 直接跳过查询（`in: []` 在 SQLite 上会退化成全表扫描的风险没必要冒） */
async function nameLookup(
  ids: string[],
  load: (ids: string[]) => Promise<Array<{ id: string; name?: string; email?: string }>>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.map((id) => String(id ?? '').trim()).filter((id) => id !== ''))];
  if (unique.length === 0) return new Map();
  const rows = await load(unique);
  return new Map(rows.map((row) => [row.id, String(row.name ?? row.email ?? '')]));
}

function num(value: bigint): number {
  return Number(value);
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/**
 * 成本金额：统一走 `billingCreditCost`（成本按「单价 × 数量」或 Token 单价 × 用量）。
 * 成本未配置 / 账单未结算时返回 null，由页面显示「未配置」——
 * 不在列表里用售价代替成本，那会让毛利看起来永远是 100%。
 */
function costAmount(row: BillingOrder): number | null {
  const cost = billingCreditCost(row);
  return cost === null ? null : num(cost);
}

function toOrderView(
  row: BillingOrder,
  channelNames: Map<string, string>,
  channelModelNames: Map<string, string>,
  userEmails: Map<string, string>,
): BillingOrderView {
  return {
    id: row.id,
    userId: row.userId,
    userEmail: userEmails.get(row.userId) ?? '',
    taskId: row.taskId,
    model: row.model,
    capability: row.capability,
    scene: row.scene,
    billingMode: row.billingMode,
    status: row.status,
    channelId: row.channelId,
    channelName: channelNames.get(row.channelId) ?? '',
    channelModelId: row.channelModelId,
    channelModelName: channelModelNames.get(row.channelModelId) ?? '',
    priceTierId: row.priceTierId,
    userGroup: row.userGroup,
    priceCurrency: row.priceCurrency,
    unitPriceMicrocredits: num(row.unitPriceMicrocredits),
    multiplierBasisPoints: num(row.multiplierBasisPoints),
    quantity: num(row.quantity),
    amountMicrocredits: num(row.amountMicrocredits),
    reservedAmountMicrocredits: num(row.reservedAmountMicrocredits),
    actualAmountMicrocredits: num(row.actualAmountMicrocredits),
    refundedAmountMicrocredits: num(row.refundedAmountMicrocredits),
    costConfigured: row.costConfigured,
    costAmountMicrocredits: costAmount(row),
    inputTokens: num(row.inputTokens),
    outputTokens: num(row.outputTokens),
    cachedTokens: num(row.cachedTokens),
    usageSource: row.usageSource,
    usageAvailable: row.usageAvailable,
    chargeLimitSet: row.chargeLimitSet,
    chargeLimitMicrocredits: num(row.chargeLimitMicrocredits),
    providerRequestId: row.providerRequestId,
    errorText: row.errorText,
    resolutionNote: row.resolutionNote,
    resolvedBy: row.resolvedBy,
    refundReason: row.refundReason,
    startedAt: iso(row.startedAt),
    settledAt: iso(row.settledAt),
    refundedAt: iso(row.refundedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

function toApiLogView(row: {
  id: string;
  userId: string;
  traceId: string;
  requestId: string;
  channelId: string;
  channelName: string;
  taskId: string;
  billingOrderId: string;
  source: string;
  capability: string;
  operation: string;
  requestKind: string;
  billable: boolean;
  apiFormat: string;
  method: string;
  path: string;
  model: string;
  status: string;
  statusCode: number;
  durationMs: number;
  pollCount: number;
  providerStatus: string;
  inputTokens: bigint;
  outputTokens: bigint;
  cachedTokens: bigint;
  usageAvailable: boolean;
  mediaCount: number;
  videoSeconds: number;
  providerRequestId: string;
  errorCode: string;
  error: string;
  createdAt: Date;
}): ApiLogView {
  return {
    id: row.id,
    userId: row.userId,
    traceId: row.traceId,
    requestId: row.requestId,
    channelId: row.channelId,
    channelName: row.channelName,
    taskId: row.taskId,
    billingOrderId: row.billingOrderId,
    source: row.source,
    capability: row.capability,
    operation: row.operation,
    requestKind: row.requestKind,
    billable: row.billable,
    apiFormat: row.apiFormat,
    method: row.method,
    path: row.path,
    model: row.model,
    status: row.status,
    statusCode: row.statusCode,
    durationMs: row.durationMs,
    pollCount: row.pollCount,
    providerStatus: row.providerStatus,
    inputTokens: num(row.inputTokens),
    outputTokens: num(row.outputTokens),
    cachedTokens: num(row.cachedTokens),
    usageAvailable: row.usageAvailable,
    mediaCount: row.mediaCount,
    videoSeconds: row.videoSeconds,
    providerRequestId: row.providerRequestId,
    errorCode: row.errorCode,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}
