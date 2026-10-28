import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { getCapability } from '../capabilities/capability.registry';
import { ALL_PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS } from './permissions';
import { SignedUrlService } from '../common/signed-url.service';

/**
 * 平台概览聚合 (admin-prd.md B-07~B-12)。
 *
 * 两块口径:
 *   · 创作侧 —— 用户 / 项目 / 素材 / 任务 (全量状态分布 + 窗口趋势)
 *   · 交易侧 —— 订单 / GMV / 退款 / 会员 / 积分 (commerce 块)
 *
 * 交易指标**全部来自真实流水**: GMV 取 `Order.paidCents` 之和 (实付而非原价,
 * 否则用券订单会让营收虚高), 退款取 `Refund.amountCents`, 积分取流水表。
 * 不设"估算""预估"字段 —— 后台看到的数字必须能与财务对得上。
 */
@Injectable()
export class AdminOverviewService {
  /**
   * 概览缓存（30 秒）。
   *
   * 概览要扫窗口内的任务与订单明细，SQLite 单文件下 90 天窗口并不便宜。
   * 后台同一时刻可能有多个管理员在看同一档，且页面本身只在切换窗口时请求；
   * 30 秒足以挡住重复点击「刷新」，又不会让运营看到明显过期的数字。
   * 响应里带 `generatedAt`，前端明确展示数据截至时间。
   */
  private readonly cache = new Map<number, { at: number; data: any }>();
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly signedUrl: SignedUrlService,
  ) {}

  async overview(days: number) {
    const cached = this.cache.get(days);
    if (cached && Date.now() - cached.at < AdminOverviewService.CACHE_TTL_MS) {
      return cached.data;
    }
    const data = await this.buildOverview(days);
    this.cache.set(days, { at: Date.now(), data });
    return data;
  }

  /**
   * 概览数据。
   *
   * days 控制两个窗口: 趋势与"新增"。任务状态分布不受窗口影响 (全量)。
   */
  private async buildOverview(days: number) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    /** 上一窗口的起点。用于环比，而不是拿「近 7 天」和「累计」比 */
    const prevSince = new Date(since.getTime() - days * 24 * 3600 * 1000);

    const paidStatuses = ['paid', 'partial_refunded', 'refunded'];
    const now = new Date();

    const [
      userTotal,
      userNew,
      projectTotal,
      taskGroups,
      assetGroups,
      recentTasks,
      weekTasks,
      orderGroups,
      gmvAll,
      gmvWindow,
      pendingAgg,
      refundAll,
      refundWindow,
      paymentGroups,
      paidInWindow,
      activeMembers,
      newMembers,
      creditGranted,
      creditConsumed,
      prevUserNew,
      prevTasks,
      prevOrders,
      prevRefunds,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.project.count(),
      this.prisma.generationTask.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.asset.groupBy({ by: ['kind'], _count: { _all: true } }),
      this.prisma.generationTask.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          capability: true,
          status: true,
          provider: true,
          errorCode: true,
          createdAt: true,
          updatedAt: true,
          outputAsset: { select: { id: true, sourceUrl: true } },
        },
      }),
      this.prisma.generationTask.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, status: true, errorCode: true },
      }),

      // ── 交易侧 ──
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      // GMV = 实付金额之和。**不含未支付订单** —— 把 pending 也算进去
      // 会让营收随"用户点了下单但没付"而虚涨
      this.prisma.order.aggregate({
        where: { status: { in: paidStatuses } },
        _sum: { paidCents: true },
        _count: { _all: true },
      }),
      this.prisma.order.aggregate({
        where: { status: { in: paidStatuses }, paidAt: { gte: since } },
        _sum: { paidCents: true },
      }),
      this.prisma.order.aggregate({
        where: { status: 'pending' },
        _sum: { paidCents: true },
      }),
      this.prisma.refund.aggregate({ _sum: { amountCents: true } }),
      this.prisma.refund.aggregate({
        where: { createdAt: { gte: since } },
        _sum: { amountCents: true },
      }),
      this.prisma.payment.groupBy({ by: ['status'], _count: { _all: true } }),
      // 收入趋势按日聚合 —— 窗口内的已支付订单量可控, 在 Node 侧聚合即可
      this.prisma.order.findMany({
        where: { status: { in: paidStatuses }, paidAt: { gte: since } },
        select: { paidAt: true, paidCents: true, channel: true },
      }),
      this.prisma.membership.count({
        where: { status: { in: ['active', 'grace'] }, expiresAt: { gt: now } },
      }),
      this.prisma.membership.count({ where: { createdAt: { gte: since } } }),
      // 只统计"发出去"的三种流水 (均为正数)。refund_reclaim/expire 不是发放,
      // 混进来会让「本期发放」这个指标失去意义
      this.prisma.creditLedger.aggregate({
        where: {
          createdAt: { gte: since },
          type: { in: ['purchase', 'grant', 'admin_adjust'] },
        },
        _sum: { amount: true },
      }),
      // consume 流水的 amount 是负数, 取绝对值即累计消耗
      this.prisma.creditLedger.aggregate({
        where: { createdAt: { gte: since }, type: 'consume' },
        _sum: { amount: true },
      }),

      // ── 上一窗口（环比）──
      // 与当前窗口等长且紧邻。用「累计」做分母会让任何窗口都显得在增长。
      this.prisma.user.count({ where: { createdAt: { gte: prevSince, lt: since } } }),
      this.prisma.generationTask.findMany({
        where: { createdAt: { gte: prevSince, lt: since } },
        select: { status: true },
      }),
      this.prisma.order.aggregate({
        where: { status: { in: paidStatuses }, paidAt: { gte: prevSince, lt: since } },
        _sum: { paidCents: true },
        _count: { _all: true },
      }),
      this.prisma.refund.aggregate({
        where: { createdAt: { gte: prevSince, lt: since } },
        _sum: { amountCents: true },
      }),
    ]);

    const tasks: Record<string, number> = {
      total: 0,
      succeeded: 0,
      failed: 0,
      running: 0,
      pending: 0,
    };
    for (const g of taskGroups) {
      const n = g._count._all;
      tasks.total += n;
      if (tasks[g.status] !== undefined) tasks[g.status] += n;
    }
    const finished = tasks.succeeded + tasks.failed;
    const successRate = finished === 0 ? null : Math.round((tasks.succeeded / finished) * 1000) / 10;

    const assets: Record<string, number> = { total: 0, original: 0, generated: 0 };
    for (const g of assetGroups) {
      const n = g._count._all;
      assets.total += n;
      if (assets[g.kind] !== undefined) assets[g.kind] += n;
    }

    const orderCounts: Record<string, number> = {
      total: 0,
      pending: 0,
      paid: 0,
      cancelled: 0,
      refunded: 0,
      partialRefunded: 0,
    };
    for (const g of orderGroups) {
      const n = g._count._all;
      orderCounts.total += n;
      if (g.status === 'partial_refunded') orderCounts.partialRefunded = n;
      else if (orderCounts[g.status] !== undefined) orderCounts[g.status] = n;
    }

    let payOk = 0;
    let payFail = 0;
    for (const g of paymentGroups) {
      if (g.status === 'succeeded') payOk = g._count._all;
      if (g.status === 'failed') payFail = g._count._all;
    }
    const paymentSuccessRate =
      payOk + payFail === 0 ? null : Math.round((payOk / (payOk + payFail)) * 1000) / 10;

    // ── 当前窗口与上一窗口 ──
    // 顶部的「任务总数 / 成功率」是累计口径，容易被误读成「最近表现」。
    // 这里单独给窗口口径，并配上一窗口用于环比。
    const win = { tasks: 0, succeeded: 0, failed: 0 };
    const reasonMap = new Map<string, number>();
    for (const r of weekTasks) {
      win.tasks += 1;
      if (r.status === 'succeeded') win.succeeded += 1;
      if (r.status === 'failed') {
        win.failed += 1;
        const code = r.errorCode || 'unknown';
        reasonMap.set(code, (reasonMap.get(code) ?? 0) + 1);
      }
    }
    const winFinished = win.succeeded + win.failed;
    const winSuccessRate =
      winFinished === 0 ? null : Math.round((win.succeeded / winFinished) * 1000) / 10;

    const prevWin = { tasks: 0, succeeded: 0, failed: 0 };
    for (const r of prevTasks) {
      prevWin.tasks += 1;
      if (r.status === 'succeeded') prevWin.succeeded += 1;
      if (r.status === 'failed') prevWin.failed += 1;
    }
    const prevFinished = prevWin.succeeded + prevWin.failed;
    const prevSuccessRate =
      prevFinished === 0 ? null : Math.round((prevWin.succeeded / prevFinished) * 1000) / 10;

    const channelMap = new Map<string, { channel: string; gmvCents: number; orders: number }>();
    for (const o of paidInWindow) {
      const channel = o.channel || 'unknown';
      const cur = channelMap.get(channel) ?? { channel, gmvCents: 0, orders: 0 };
      cur.gmvCents += o.paidCents;
      cur.orders += 1;
      channelMap.set(channel, cur);
    }
    const channelMix = Array.from(channelMap.values()).sort((a, b) => b.gmvCents - a.gmvCents);

    return {
      /** 数据生成时间（30 秒缓存，前端据此显示「截至」） */
      generatedAt: new Date().toISOString(),
      cacheTtlSeconds: Math.round(AdminOverviewService.CACHE_TTL_MS / 1000),
      days,
      totals: {
        users: userTotal,
        newUsers: userNew,
        projects: projectTotal,
        tasks: tasks.total,
        succeeded: tasks.succeeded,
        failed: tasks.failed,
        running: tasks.running,
        pending: tasks.pending,
        successRate,
        assets: assets.total,
        originals: assets.original,
        generated: assets.generated,
      },
      trend: this.buildTrend(weekTasks, days),
      /** 窗口口径（与 trend 同源），用于「最近表现」而不是累计数字 */
      window: {
        tasks: win.tasks,
        succeeded: win.succeeded,
        failed: win.failed,
        successRate: winSuccessRate,
        failureReasons: Array.from(reasonMap.entries())
          .map(([errorCode, count]) => ({ errorCode, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 6),
        revenue: {
          gmvCents: gmvWindow._sum.paidCents ?? 0,
          paidOrders: paidInWindow.length,
          refundedCents: refundWindow._sum.amountCents ?? 0,
          usersNew: userNew,
        },
      },
      /** 上一窗口的同口径数字。分母为 0 时前端显示「—」而不是 100% */
      comparison: {
        tasks: prevWin.tasks,
        succeeded: prevWin.succeeded,
        failed: prevWin.failed,
        successRate: prevSuccessRate,
        usersNew: prevUserNew,
        gmvCents: prevOrders._sum.paidCents ?? 0,
        paidOrders: prevOrders._count._all,
        refundedCents: prevRefunds._sum.amountCents ?? 0,
      },
      /*
       * 交易概览。
       *
       * 金额一律整数分, 前端自行除以 100 —— 后端不做展示层格式化,
       * 避免"接口返回元、页面再乘 100"这类口径漂移。
       */
      commerce: {
        orders: orderCounts,
        /** 累计 GMV (实付之和, 不含未支付订单) */
        gmvCents: gmvAll._sum.paidCents ?? 0,
        /** 窗口内 GMV */
        gmvWindowCents: gmvWindow._sum.paidCents ?? 0,
        /** 待付订单金额: 用来判断"卡在支付"的规模 */
        pendingCents: pendingAgg._sum.paidCents ?? 0,
        /** 窗口内退款 */
        refundedWindowCents: refundWindow._sum.amountCents ?? 0,
        refundedCents: refundAll._sum.amountCents ?? 0,
        /** 支付成功率 (%)。无支付流水时为 null 而非 0 —— 0% 会误导成"全挂了" */
        paymentSuccessRate,
        members: { active: activeMembers, newInWindow: newMembers },
        credits: {
          grantedInWindow: creditGranted._sum.amount ?? 0,
          consumedInWindow: Math.abs(creditConsumed._sum.amount ?? 0),
        },
        /** 窗口内收入按支付渠道拆分，用于看营收结构而不只是总额 */
        channelMix,
        revenueTrend: this.buildRevenueTrend(paidInWindow, days),
      },
      recentTasks: recentTasks.map((t) => {
        const def = getCapability(t.capability);
        return {
          id: t.id,
          capability: t.capability,
          capabilityName: def?.name ?? t.capability,
          mode: def?.mode ?? 'unknown',
          status: t.status,
          provider: t.provider,
          errorCode: t.errorCode,
          createdAt: t.createdAt,
          durationMs: t.updatedAt.getTime() - t.createdAt.getTime(),
          thumbnailUrl: this.signedUrl.displayUrl(t.outputAsset?.sourceUrl),
        };
      }),
    };
  }

  /**
   * 趋势序列: 按日聚合并补齐无数据日。
   *
   * 不用数据库日期分组: SQLite driver adapter 对日期函数支持有限,
   * 改为取时间戳在 Node 侧聚合。7~30 天量级完全可接受。
   */
  private buildTrend(
    rows: Array<{ createdAt: Date; status: string }>,
    days: number,
  ): Array<{ date: string; total: number; succeeded: number; failed: number }> {
    const key = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const map = new Map<string, { total: number; succeeded: number; failed: number }>();
    for (let i = days - 1; i >= 0; i -= 1) {
      map.set(key(new Date(Date.now() - i * 24 * 3600 * 1000)), {
        total: 0,
        succeeded: 0,
        failed: 0,
      });
    }
    for (const r of rows) {
      const k = key(r.createdAt);
      const cur = map.get(k);
      if (!cur) continue;
      cur.total += 1;
      if (r.status === 'succeeded') cur.succeeded += 1;
      if (r.status === 'failed') cur.failed += 1;
    }
    return Array.from(map.entries()).map(([date, v]) => ({ date, ...v }));
  }

  /**
   * 收入趋势: 按**支付时间**而不是下单时间聚合。
   *
   * 下单时间只说明"谁点了提交", 支付时间才是钱真正到账的时刻;
   * 两者混用会让某天的营收在"前天下的单今天付款"时对不上账。
   */
  private buildRevenueTrend(
    rows: Array<{ paidAt: Date | null; paidCents: number }>,
    days: number,
  ): Array<{ date: string; gmvCents: number; orders: number }> {
    const key = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const map = new Map<string, { gmvCents: number; orders: number }>();
    for (let i = days - 1; i >= 0; i -= 1) {
      map.set(key(new Date(Date.now() - i * 24 * 3600 * 1000)), { gmvCents: 0, orders: 0 });
    }
    for (const r of rows) {
      if (!r.paidAt) continue;
      const cur = map.get(key(r.paidAt));
      if (!cur) continue;
      cur.gmvCents += r.paidCents;
      cur.orders += 1;
    }
    return Array.from(map.entries()).map(([date, v]) => ({ date, ...v }));
  }
}