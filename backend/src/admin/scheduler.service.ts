import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BackupService } from './backup.service';
import { AdminSettingsService } from './settings.service';
import { MarketingService } from '../marketing/marketing.service';
import { OrderService } from '../orders/order.service';
import { CreditService } from '../credits/credit.service';
import { MembershipService } from '../membership/membership.service';

/** 调度检查间隔: 10 分钟 */
const TICK_MS = 10 * 60 * 1000;

/** 允许的备份频次 */
const ALLOWED_FREQUENCIES = [1, 7, 30] as const;

const SETTING_BACKUP_FREQUENCY = 'backup.frequencyDays';
const SETTING_BACKUP_KEEP = 'backup.keepCount';
const SETTING_AUDIT_RETENTION = 'retention.auditLogDays';

/**
 * 备份与清理调度器。
 *
 * ⚠ **本地 MVP 不做真实定时器**, 改为「启动时 + 每 10 分钟轮询检查」:
 *   1. 本项目部署形态是本地单机 (backend + SQLite 文件), 没有常驻进程保证;
 *   2. node-cron 定时器在进程休眠/重启后会错过当次执行, 补跑逻辑反而更复杂;
 *   3. 轮询式实现的行为可预测, 且便于测试时手动触发。
 *
 * 判定"今天是否已备份": 比对当天已有 succeeded 记录, 已有则跳过 ——
 * 重复启动不会产生重复备份。
 */
/** 任务中文名, 后台展示用 */
const TASK_LABELS: Record<string, string> = {
  'order-expire': '订单超时关闭',
  'credit-expire': '积分到期回收',
  membership: '会员到期与月度积分',
  backup: '数据备份',
  cleanup: '数据保留期清理',
  'campaign-expire': '活动到期收尾',
};

interface TaskState {
  name: string;
  lastRunAt: Date | null;
  lastDurationMs: number | null;
  lastSuccess: boolean | null;
  lastError: string | null;
  /** 连续失败次数。> 0 说明任务已挂, 需要人介入 */
  consecutiveFailures: number;
  totalRuns: number;
}

/**
 * ⚠ 必须带 @Injectable(): Nest 依赖 `design:paramtypes` 反射元数据来解析构造函数参数。
 * 类上漏掉这个装饰器时 TS **不会报错**(isolatedModules 下装饰器元信息丢失也不提示),
 * 但运行时所有注入都会是 undefined —— 表现为 `Cannot read properties of undefined`。
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /**
   * 任务执行状态。
   *
   * ⚠ **放内存而非 DB**: 这类运行时指标每秒都在变, 落库会把
   * 「最近的调度状态」和「需要长期留存的任务审计」混为一谈。
   * 需要长期留痕的任务自身会写表(如 CleanupLog)。
   */
  private readonly taskStates = new Map<string, TaskState>();

  constructor(
    private readonly backup: BackupService,
    private readonly settings: AdminSettingsService,
    private readonly marketing: MarketingService,
    private readonly orders: OrderService,
    private readonly credit: CreditService,
    private readonly membership: MembershipService,
  ) {}

  onModuleInit(): void {
    // 延迟首轮: 等所有模块完成初始化, 避免与数据库首次连接竞争
    setTimeout(() => {
      void this.tick().catch((e) => this.logger.warn(`首轮调度检查失败: ${e.message}`));
    }, 5_000);

    this.timer = setInterval(() => {
      void this.tick().catch((e) => this.logger.warn(`调度检查失败: ${e.message}`));
    }, TICK_MS);

    // 不阻止进程退出
    this.timer.unref?.();

    this.logger.log(
      `调度器已启动 (每 ${TICK_MS / 60000} 分钟检查一次;频次/保留份数见系统设置)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 单轮检查。
   *
   * ⚠ **每个任务独立 try/catch**: 早期版本用一个大 try 包住全部任务,
   * 结果「备份抛错 → 订单超时关闭被跳过」。调度器里一个任务失败
   * 不该连累其它任务 —— 订单不关闭会直接影响用户看到的可用金额。
   */
  async tick(): Promise<void> {
    // 重入保护: 备份是 IO 密集操作, 慢环境下上一轮未结束会被重复触发
    if (this.running) return;
    this.running = true;
    try {
      await this.runTask('order-expire', () => this.maybeCancelExpiredOrders());
      await this.runTask('credit-expire', () => this.maybeExpireCredits());
      await this.runTask('backup', () => this.maybeBackup());
      await this.runTask('cleanup', () => this.maybeCleanup());
      await this.runTask('campaign-expire', () => this.maybeExpireCampaigns());
      await this.runTask('membership', () => this.maybeRunMembership());
    } finally {
      this.running = false;
    }
  }

  /**
   * 执行单个任务并记录结果。
   *
   * 记录四件事: 最近执行时间、耗时、是否成功、连续失败次数。
   * 连续失败要能看到 —— 一个静默失败三周的定时任务比不设更危险,
   * 因为所有人都会以为它在跑。
   */
  private async runTask(name: string, fn: () => Promise<void>): Promise<void> {
    const rec = this.taskStates.get(name) ?? {
      name,
      lastRunAt: null,
      lastDurationMs: null,
      lastSuccess: null,
      lastError: null,
      consecutiveFailures: 0,
      totalRuns: 0,
    };

    const startedAt = Date.now();
    try {
      await fn();
      rec.lastRunAt = new Date();
      rec.lastDurationMs = Date.now() - startedAt;
      rec.lastSuccess = true;
      rec.lastError = null;
      rec.consecutiveFailures = 0;
    } catch (e) {
      const message = (e as Error).message;
      rec.lastRunAt = new Date();
      rec.lastDurationMs = Date.now() - startedAt;
      rec.lastSuccess = false;
      rec.lastError = message.slice(0, 300);
      rec.consecutiveFailures += 1;
      // 连续失败要打 ERROR 而非 WARN —— 需要有人真的看到
      this.logger.error(`任务 ${name} 第 ${rec.consecutiveFailures} 次连续失败: ${message}`);
    } finally {
      rec.totalRuns += 1;
      this.taskStates.set(name, rec);
    }
  }

  /** 各任务最近执行状态, 供后台 B-90 可观测 */
  taskStatus() {
    return [...this.taskStates.values()].map((t) => ({
      name: t.name,
      label: TASK_LABELS[t.name] ?? t.name,
      lastRunAt: t.lastRunAt,
      lastDurationMs: t.lastDurationMs,
      lastSuccess: t.lastSuccess,
      lastError: t.lastError,
      consecutiveFailures: t.consecutiveFailures,
      totalRuns: t.totalRuns,
    }));
  }

  /**
   * 手动触发指定任务 (运维验证用)。
   *
   * ⚠ **忽略"是否到期"的判定**: 手动触发就是想立刻执行,
   * 让运维能验证"这个任务到底能不能跑通"。
   */
  async runNow(name: string): Promise<{ name: string; skipped?: boolean; reason?: string }> {
    if (this.running) {
      return { name, skipped: true, reason: '上一轮调度尚未结束, 请稍后重试' };
    }
    this.running = true;
    try {
      switch (name) {
        case 'order-expire':
          await this.runTask(name, () => this.doCancelExpiredOrders());
          break;
        case 'credit-expire':
          await this.runTask(name, () => this.doExpireCredits());
          break;
        case 'membership':
          // runSchedulerTasks 返回统计对象, 但 runTask 的契约是「任务自身不返回值」,
          // 统计结果已由 MembershipService 落日志, 这里显式丢弃以保持契约一致
          await this.runTask(name, async () => {
            await this.membership.runSchedulerTasks();
          });
          break;
        default:
          throw new Error(`不支持的任务: ${name}`);
      }
    } finally {
      this.running = false;
    }
    return { name };
  }

  // ── B-90 任务一: 订单超时关闭 ─────────────────────────────────────

  /**
   * 关闭超时未支付订单。
   *
   * 节流: 每 5 分钟最多一次。订单过期判定本身很轻(一条 where 查询),
   * 但没必要每 10 分钟都跑 —— 订单超时是 30 分钟粒度, 5 分钟足够及时。
   */
  private async maybeCancelExpiredOrders(): Promise<void> {
    if (!this.shouldRun('order-expire', 5 * 60 * 1000)) return;
    await this.doCancelExpiredOrders();
  }

  private async doCancelExpiredOrders(): Promise<void> {
    const closed = await this.orders.cancelExpired();
    if (closed > 0) {
      this.logger.log(`订单超时关闭: ${closed} 笔`);
    }
  }

  // ── B-90 任务二: 积分批次过期回收 ─────────────────────────────────

  /**
   * 回收已到期的积分批次。
   *
   * 节流: 每 10 分钟一次。积分过期按天计算, 10 分钟粒度足够,
   * 且回收涉及多次写, 不必过于频繁。
   */
  private async maybeExpireCredits(): Promise<void> {
    if (!this.shouldRun('credit-expire', 10 * 60 * 1000)) return;
    await this.doExpireCredits();
  }

  private async doExpireCredits(): Promise<void> {
    const res = await this.credit.expireLots();
    if (res.expiredLots > 0) {
      this.logger.log(`积分到期回收: ${res.expiredLots} 批次 / ${res.expiredCredits} 积分`);
    }
  }

  // ── 会员调度: 到期处理 + 月度积分发放 ─────────────────────────────

  /**
   * 会员到期与月度积分发放。
   *
   * 节流: 每 30 分钟。积分按月发, 到期按天判 —— 30 分钟粒度足够,
   * 会员数放大后这个频率也不会成为瓶颈。
   */
  private async maybeRunMembership(): Promise<void> {
    if (!this.shouldRun('membership', 30 * 60 * 1000)) return;
    await this.membership.runSchedulerTasks();
  }

  /** 节流判定: 距上次执行是否已超过最小间隔 */
  private shouldRun(name: string, minIntervalMs: number): boolean {
    const rec = this.taskStates.get(name);
    if (!rec?.lastRunAt) return true;
    return Date.now() - rec.lastRunAt.getTime() >= minIntervalMs;
  }

  /**
   * 限时活动到期收尾 (M11)。
   *
   * 只改状态, 不还原价格 —— 限时价从不写 Product.priceCents (见 schema 注释),
   * 所以"到期恢复基准价"天然成立。这也是当初不落Product 表的理由:
   * 落表则此处必须补还原逻辑, 且漏一条就是永久错误价。
   */
  private async maybeExpireCampaigns(): Promise<void> {
    await this.marketing.expireCampaigns();
  }

  /** 到期则执行备份 */
  private async maybeBackup(): Promise<void> {
    const frequencyDays = await this.readNumber(SETTING_BACKUP_FREQUENCY, 1);
    if (!ALLOWED_FREQUENCIES.includes(frequencyDays as 1)) {
      this.logger.warn(`备份频次配置非法(${frequencyDays}), 跳过`);
      return;
    }

    const lastSuccess = await this.lastSuccessAt();
    if (lastSuccess && Date.now() - lastSuccess.getTime() < frequencyDays * 24 * 3600 * 1000) {
      return;
    }

    this.logger.log(`到达备份周期 (${frequencyDays} 天), 开始执行`);
    await this.backup.run('scheduled');
  }

  /** 到期则清理运行痕迹 */
  private async maybeCleanup(): Promise<void> {
    const keepDays = await this.readNumber(SETTING_AUDIT_RETENTION, 180);
    if (keepDays < 30) return; // 少于 30 天不自动清理, 避免误配导致数据快速流失

    const recent = await this.hasRecentCleanup('AdminAuditLog', keepDays);
    if (recent) return;

    await this.backup.cleanupExpired('AdminAuditLog', keepDays, 'scheduled');
  }

  /** 读数值型设置, 失败回落默认值 */
  private async readNumber(key: string, fallback: number): Promise<number> {
    try {
      const v = await this.settings.get<string | number>(key);
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    } catch {
      // 设置项未在 SETTING_DEFS 登记时 get() 会抛 404, 说明该配置尚未定义
      return fallback;
    }
  }

  private async lastSuccessAt(): Promise<Date | null> {
    const records = await this.backup.list();
    const ok = records
      .filter((r) => r.status === 'succeeded')
      .map((r) => new Date(r.createdAt))
      .sort((a, b) => b.getTime() - a.getTime());
    return ok[0] ?? null;
  }

  /** 避免同一天重复清理 */
  private async hasRecentCleanup(target: string, retentionDays: number): Promise<boolean> {
    const logs = await this.backup.cleanupLogs(20);
    const since = Date.now() - retentionDays * 24 * 3600 * 1000;
    return logs.some(
      (l) =>
        l.target === target &&
        l.success &&
        new Date(l.createdAt).getTime() > since - 24 * 3600 * 1000,
    );
  }
}