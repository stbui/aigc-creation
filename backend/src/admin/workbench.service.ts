import { Injectable } from '@nestjs/common';
import type { AdminUser } from './admin.decorator';
import { AdminRoleService } from './admin-role.service';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS } from './permissions';
import {
  PaymentReconciliationService,
  RECONCILIATION_OPEN_RESULTS,
} from '../payments/payment-reconciliation.service';
import {
  ALERT_CACHE_TTL_MS,
  BACKUP_STALE_HOURS,
  FAILED_CRITICAL_THRESHOLD,
  RECONCILIATION_CRITICAL_COUNT,
  REFUND_CRITICAL_HOURS,
  REFUND_STUCK_MINUTES,
  RUNNING_ALERT_THRESHOLD,
  TICKET_CRITICAL_HOURS,
  UNCERTAIN_BILLING_CRITICAL_COUNT,
  UNCERTAIN_BILLING_CRITICAL_HOURS,
  WORKBENCH_ITEMS_PER_GROUP,
} from './alert-thresholds';

export type WorkbenchRoleView = 'admin' | 'operator' | 'finance';
export type WorkbenchGroupKey =
  | 'ticket'
  | 'task'
  | 'refund'
  | 'reconciliation'
  | 'invoice'
  | 'billing'
  | 'backup';
export type WorkbenchSeverity = 'critical' | 'warning' | 'info';

export interface WorkbenchItem {
  id: string;
  title: string;
  subtitle: string;
  meta: Array<{ label: string; value: string; tone?: 'danger' | 'warn' | 'muted' }>;
  target: { path: string; intent?: string };
}

export interface WorkbenchGroup {
  key: WorkbenchGroupKey;
  label: string;
  severity: WorkbenchSeverity;
  /** 全量待处理数，不是 items.length */
  count: number;
  /** 涉及金额（分）；没有金额语义的组省略 */
  amountCents?: number;
  oldestAt?: string;
  /** 完整列表入口 */
  link: string;
  items: WorkbenchItem[];
}

export interface AdminWorkbench {
  generatedAt: string;
  roleView: WorkbenchRoleView;
  groups: WorkbenchGroup[];
}

/**
 * 角色工作台。
 *
 * ## 与告警中心的分工
 *
 * 告警中心回答「有什么坏了」，工作台回答「先做哪一件」。两者读同一批业务状态，
 * 阈值来自 `alert-thresholds.ts`，避免铃铛与首屏各算一套后数字打架。
 *
 * ## 只读
 *
 * 本服务不执行任何写操作。所有实体行只给带 `intent` 的目标页路径；真正的
 * 退款、结算、回复仍由对应页面调用原接口，权限、原因、二次确认与审计不变。
 *
 * ## 角色视图
 *
 * 分组先按当前角色权限过滤，再按 `roleView` 的职责范围裁剪。`admin` 可用
 * `view` 参数预览运营/财务首屏，但视图不放大查询范围 —— 权限过滤始终先执行。
 */
@Injectable()
export class AdminWorkbenchService {
  private readonly cache = new Map<string, { at: number; data: AdminWorkbench }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: AdminRoleService,
    private readonly reconciliations: PaymentReconciliationService,
  ) {}

  async get(actor: Pick<AdminUser, 'id' | 'role'>, requestedView?: string): Promise<AdminWorkbench> {
    const roleView = this.resolveView(actor.role, requestedView);
    // 财务工单组按「指派给我」过滤，缓存必须带 actorId，否则同角色不同账号会串数据
    const cacheKey = `${actor.role}:${actor.id}:${roleView}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < ALERT_CACHE_TTL_MS) return cached.data;

    const permissions = await this.roles.getPermissions(actor.role);
    const can = (permission: string) => permissions.includes(permission);
    const allowed = new Set<WorkbenchGroupKey>(VIEW_GROUPS[roleView]);

    const jobs: Array<Promise<WorkbenchGroup | null>> = [];
    if (allowed.has('ticket') && can(PERMISSIONS.ticketRead)) {
      jobs.push(this.ticketGroup(actor.id, roleView));
    }
    if (allowed.has('task') && can(PERMISSIONS.taskRead)) jobs.push(this.taskGroup());
    if (allowed.has('refund') && can(PERMISSIONS.orderRead)) jobs.push(this.refundGroup());
    if (allowed.has('reconciliation') && can(PERMISSIONS.paymentRead)) {
      jobs.push(this.reconciliationGroup());
    }
    if (allowed.has('invoice') && can(PERMISSIONS.invoiceWrite)) jobs.push(this.invoiceGroup());
    if (allowed.has('billing') && can(PERMISSIONS.billingOrderRead)) {
      jobs.push(this.billingGroup());
    }
    if (allowed.has('backup') && can(PERMISSIONS.backupRead)) jobs.push(this.backupGroup());

    const groups = (await Promise.all(jobs))
      .filter((group): group is WorkbenchGroup => group !== null)
      .sort(
        (a, b) =>
          severityRank(a.severity) - severityRank(b.severity) ||
          (b.count ?? 0) - (a.count ?? 0),
      );

    const data: AdminWorkbench = {
      generatedAt: new Date().toISOString(),
      roleView,
      groups,
    };
    this.cache.set(cacheKey, { at: Date.now(), data });
    return data;
  }

  private resolveView(role: string, requested?: string): WorkbenchRoleView {
    if (role === 'admin' && (requested === 'operator' || requested === 'finance')) {
      return requested;
    }
    if (role === 'finance') return 'finance';
    if (role === 'operator') return 'operator';
    return 'admin';
  }

  private async ticketGroup(
    actorId: string,
    roleView: WorkbenchRoleView,
  ): Promise<WorkbenchGroup | null> {
    /*
     * 财务看「指派给我」而不是全站待回复：财务不负责首响，只需要处理
     * 运营转交过来的退款/发票类工单。运营与管理员才看未回复队列。
     */
    const financeOwned = roleView === 'finance';
    const where = financeOwned
      ? { status: 'processing', assigneeId: actorId }
      : { status: 'open' };
    const [count, oldest, rows] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findFirst({
        where,
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.ticket.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: WORKBENCH_ITEMS_PER_GROUP,
        select: {
          id: true,
          ticketNo: true,
          subject: true,
          priority: true,
          createdAt: true,
        },
      }),
    ]);
    if (count === 0) return null;

    const hours = ageHours(oldest?.createdAt);
    return {
      key: 'ticket',
      label: financeOwned ? '指派给我的工单' : '待回复工单',
      severity: hours >= TICKET_CRITICAL_HOURS ? 'critical' : 'warning',
      count,
      oldestAt: oldest?.createdAt.toISOString(),
      link: financeOwned
        ? `/admin/tickets?status=processing&assigneeId=${encodeURIComponent(actorId)}`
        : '/admin/tickets?status=open',
      items: rows.map((row) => ({
        id: row.id,
        title: `${row.ticketNo} · ${row.subject}`,
        subtitle: `等待 ${formatHours(ageHours(row.createdAt))}`,
        meta: [{ label: '优先级', value: priorityLabel(row.priority), tone: row.priority === 'high' ? 'danger' : 'muted' }],
        target: { path: `/admin/tickets?id=${encodeURIComponent(row.id)}&intent=handle&from=workbench` },
      })),
    };
  }

  private async taskGroup(): Promise<WorkbenchGroup | null> {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const where = { status: 'failed', createdAt: { gte: since } };
    const [count, running, rows] = await Promise.all([
      this.prisma.generationTask.count({ where }),
      this.prisma.generationTask.count({ where: { status: 'running' } }),
      this.prisma.generationTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: WORKBENCH_ITEMS_PER_GROUP,
        select: {
          id: true,
          capability: true,
          errorCode: true,
          createdAt: true,
          owner: { select: { email: true } },
        },
      }),
    ]);
    if (count === 0 && running <= RUNNING_ALERT_THRESHOLD) return null;

    const critical = count >= FAILED_CRITICAL_THRESHOLD;
    return {
      key: 'task',
      label: count > 0 ? '近 24 小时失败任务' : '执行中任务积压',
      severity: critical ? 'critical' : 'warning',
      count: count + (running > RUNNING_ALERT_THRESHOLD ? 1 : 0),
      link: count > 0 ? '/admin/tasks?status=failed' : '/admin/tasks?status=running',
      items: rows.map((row) => ({
        id: row.id,
        title: `${row.capability} · ${shortId(row.id)}`,
        subtitle: `${row.owner.email} · ${row.errorCode ?? '无错误码'}`,
        meta: [
          { label: '错误码', value: row.errorCode ?? '—', tone: row.errorCode ? 'danger' : 'muted' },
          { label: '提交', value: formatHours(ageHours(row.createdAt)) },
        ],
        target: { path: `/admin/tasks?id=${encodeURIComponent(row.id)}&intent=retry&from=workbench` },
      })),
    };
  }

  private async refundGroup(): Promise<WorkbenchGroup | null> {
    const cutoff = new Date(Date.now() - REFUND_STUCK_MINUTES * 60_000);
    const where = { status: 'processing', createdAt: { lt: cutoff } };
    const [count, oldest, sum, rows] = await Promise.all([
      this.prisma.refund.count({ where }),
      this.prisma.refund.findFirst({
        where,
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.refund.aggregate({ where, _sum: { amountCents: true } }),
      this.prisma.refund.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: WORKBENCH_ITEMS_PER_GROUP,
        select: {
          id: true,
          orderId: true,
          amountCents: true,
          createdAt: true,
          order: { select: { orderNo: true } },
        },
      }),
    ]);
    if (count === 0) return null;

    const hours = ageHours(oldest?.createdAt);
    return {
      key: 'refund',
      label: '退款卡在渠道处理中',
      severity: hours >= REFUND_CRITICAL_HOURS ? 'critical' : 'warning',
      count,
      amountCents: sum._sum.amountCents ?? 0,
      oldestAt: oldest?.createdAt.toISOString(),
      link: '/admin/orders?refundState=processing',
      items: rows.map((row) => ({
        id: row.id,
        title: `${row.order.orderNo} · ¥${yuan(row.amountCents)}`,
        subtitle: `渠道已受理，等待 ${formatHours(ageHours(row.createdAt))}`,
        meta: [{ label: '账龄', value: formatHours(ageHours(row.createdAt)), tone: 'warn' }],
        target: {
          path: `/admin/orders?id=${encodeURIComponent(row.orderId)}&intent=confirmRefund&from=workbench`,
        },
      })),
    };
  }

  /**
   * 对账差异。
   *
   * 与告警中心同一口径：只看每个「渠道 + 账单日」最新一次已完成的对账，
   * 否则重跑过的旧异常行会让待办数只涨不落。
   *
   * 行内跳转账单页的**对账批次详情**（`?runId=`），不是单条明细 ——
   * 页面只支持按批次打开，`?item=` 会被静默忽略，点进去等于什么都没发生。
   */
  private async reconciliationGroup(): Promise<WorkbenchGroup | null> {
    const runIds = await this.reconciliations.openRunIds();
    if (runIds.length === 0) return null;
    const where = {
      runId: { in: runIds },
      result: { in: [...RECONCILIATION_OPEN_RESULTS] },
    };
    const [count, sum, rows] = await Promise.all([
      this.prisma.paymentReconciliationItem.count({ where }),
      this.prisma.paymentReconciliationItem.aggregate({
        where,
        _sum: { amountCents: true },
      }),
      this.prisma.paymentReconciliationItem.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: WORKBENCH_ITEMS_PER_GROUP,
        select: {
          id: true,
          runId: true,
          merchantOrderNo: true,
          result: true,
          amountCents: true,
          createdAt: true,
        },
      }),
    ]);
    if (count === 0) return null;

    return {
      key: 'reconciliation',
      label: '对账差异待处置',
      severity: count >= RECONCILIATION_CRITICAL_COUNT ? 'critical' : 'warning',
      count,
      amountCents: sum._sum.amountCents ?? 0,
      oldestAt: rows[0]?.createdAt.toISOString(),
      link: '/admin/payments?tab=reconciliation',
      items: rows.map((row) => ({
        id: row.id,
        title: `${row.merchantOrderNo} · ¥${yuan(row.amountCents)}`,
        subtitle: row.result,
        meta: [{ label: '差异', value: row.result, tone: 'warn' }],
        target: {
          path: `/admin/payments?tab=reconciliation&runId=${encodeURIComponent(row.runId)}&from=workbench`,
        },
      })),
    };
  }

  private async invoiceGroup(): Promise<WorkbenchGroup | null> {
    const pendingWhere = { status: 'pending' };
    const [count, sum, blockedRows, rows] = await Promise.all([
      this.prisma.invoice.count({ where: pendingWhere }),
      this.prisma.invoice.aggregate({ where: pendingWhere, _sum: { amountCents: true } }),
      this.prisma.$queryRaw<Array<{ count: number | bigint }>>`
        SELECT COUNT(*) AS count
        FROM "Invoice" AS i
        JOIN "Order" AS o ON o.id = i.orderId
        WHERE i.status = 'pending'
          AND (
            o.status NOT IN ('paid', 'partial_refunded')
            OR i.amountCents > (o.paidCents - o.refundedCents)
            OR EXISTS (
              SELECT 1 FROM "Refund" AS r
              WHERE r.orderId = o.id AND r.status = 'processing'
            )
          )
      `,
      this.prisma.invoice.findMany({
        where: pendingWhere,
        orderBy: { createdAt: 'asc' },
        take: WORKBENCH_ITEMS_PER_GROUP,
        select: {
          id: true,
          invoiceNo: true,
          amountCents: true,
          createdAt: true,
          order: { select: { orderNo: true } },
        },
      }),
    ]);
    if (count === 0) return null;

    const blocked = Number(blockedRows[0]?.count ?? 0);
    return {
      key: 'invoice',
      label: blocked > 0 ? '待开具发票（含退款阻断）' : '待开具发票',
      severity: 'warning',
      count,
      amountCents: sum._sum.amountCents ?? 0,
      oldestAt: rows[0]?.createdAt.toISOString(),
      link: '/admin/invoices',
      items: rows.map((row) => ({
        id: row.id,
        title: `${row.invoiceNo} · ¥${yuan(row.amountCents)}`,
        subtitle: `订单 ${row.order.orderNo} · 等待 ${formatHours(ageHours(row.createdAt))}`,
        meta: [{ label: '提交', value: formatHours(ageHours(row.createdAt)) }],
        target: {
          // 发票页没有详情深链；带 `status=pending` 落到待开具队列，
          // 行内动作仍由页面上的开具/驳回确认弹窗执行。
          path: `/admin/invoices?status=pending&from=workbench`,
        },
      })),
    };
  }

  private async billingGroup(): Promise<WorkbenchGroup | null> {
    const where = { status: 'uncertain' };
    const [count, rows] = await Promise.all([
      this.prisma.billingOrder.count({ where }),
      this.prisma.billingOrder.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: WORKBENCH_ITEMS_PER_GROUP,
        select: {
          id: true,
          taskId: true,
          capability: true,
          model: true,
          reservedAmountMicrocredits: true,
          actualAmountMicrocredits: true,
          createdAt: true,
        },
      }),
    ]);
    if (count === 0) return null;

    // 与告警中心同一口径：笔数或挂账时长任一越线即升 critical
    const hours = ageHours(rows[0]?.createdAt);
    return {
      key: 'billing',
      label: '生成账单结果不明',
      severity:
        count >= UNCERTAIN_BILLING_CRITICAL_COUNT || hours >= UNCERTAIN_BILLING_CRITICAL_HOURS
          ? 'critical'
          : 'warning',
      count,
      oldestAt: rows[0]?.createdAt.toISOString(),
      link: '/admin/billing-orders?status=uncertain',
      items: rows.map((row) => ({
        id: row.id,
        title: `${row.capability || row.model || '生成任务'} · ${row.taskId ? shortId(row.taskId) : shortId(row.id)}`,
        subtitle: `待人工结算或退款 · 等待 ${formatHours(ageHours(row.createdAt))}`,
        meta: [
          {
            label: '金额',
            value: `${microToCredits(
              row.actualAmountMicrocredits > 0n
                ? row.actualAmountMicrocredits
                : row.reservedAmountMicrocredits,
            )} 积分`,
          },
        ],
        target: {
          path: `/admin/billing-orders?id=${encodeURIComponent(row.id)}&intent=settle&from=workbench`,
        },
      })),
    };
  }

  private async backupGroup(): Promise<WorkbenchGroup | null> {
    const [latest, unverified] = await Promise.all([
      this.prisma.backupRecord.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { status: true, createdAt: true, errorMessage: true },
      }),
      this.prisma.backupRecord.count({ where: { status: 'succeeded', verified: false } }),
    ]);

    if (!latest) {
      return {
        key: 'backup',
        label: '尚未配置备份',
        severity: 'warning',
        count: 1,
        link: '/admin/backups',
        items: [],
      };
    }

    const hours = ageHours(latest.createdAt);
    if (latest.status === 'failed') {
      return {
        key: 'backup',
        label: '最近一次备份失败',
        severity: 'critical',
        count: 1,
        oldestAt: latest.createdAt.toISOString(),
        link: '/admin/backups',
        items: [],
      };
    }
    if (hours >= BACKUP_STALE_HOURS) {
      return {
        key: 'backup',
        label: '备份已超过 48 小时',
        severity: 'warning',
        count: 1,
        oldestAt: latest.createdAt.toISOString(),
        link: '/admin/backups',
        items: [],
      };
    }
    if (unverified > 0) {
      return {
        key: 'backup',
        label: '有备份尚未通过恢复验证',
        severity: 'info',
        count: unverified,
        link: '/admin/backups',
        items: [],
      };
    }
    return null;
  }
}

/** 各角色首屏包含的组。权限过滤仍在前一步执行，这里只裁剪职责范围。 */
const VIEW_GROUPS: Record<WorkbenchRoleView, WorkbenchGroupKey[]> = {
  admin: ['ticket', 'task', 'refund', 'reconciliation', 'invoice', 'billing', 'backup'],
  operator: ['ticket', 'task'],
  finance: ['ticket', 'refund', 'reconciliation', 'invoice', 'billing', 'backup'],
};

const SEVERITY_RANK: Record<WorkbenchSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function severityRank(severity: WorkbenchSeverity): number {
  return SEVERITY_RANK[severity];
}

function ageHours(at: Date | string | null | undefined): number {
  if (!at) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 3_600_000));
}

function formatHours(hours: number): string {
  if (hours < 1) return '不足 1 小时';
  if (hours < 48) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

function priorityLabel(priority: string): string {
  return priority === 'high' ? '高' : priority === 'low' ? '低' : '中';
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function yuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

function microToCredits(micro: bigint): string {
  const value = Number(micro) / 1_000_000;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
