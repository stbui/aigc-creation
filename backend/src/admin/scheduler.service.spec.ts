import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SchedulerService } from './scheduler.service';

/**
 * 调度器的三条约定，都用 `taskStatus()` 的可见状态来断言。
 *
 * 调度器是后台唯一「没人盯着也在跑」的部分，它的失败必须是可发现的：
 *   1. 任务体返回 false（未到执行时间）不计入执行、不刷新 lastRunAt —— 否则
 *      10 分钟一次的轮询会把 24 小时级任务永远推到下一轮；
 *   2. 同一个任务里的多个补偿动作各自独立，一个失败不掩盖另一个；
 *   3. 失败必须累积 consecutiveFailures，让后台告警看得到「它一直在挂」。
 */

function setup() {
  const deps = {
    backup: { run: vi.fn().mockResolvedValue({}), list: vi.fn().mockResolvedValue([]) },
    settings: { get: vi.fn().mockResolvedValue(1) },
    marketing: {
      expireCampaigns: vi.fn().mockResolvedValue(undefined),
      retryPendingRegisterRewards: vi.fn().mockResolvedValue(0),
    },
    orders: { retryPendingMembershipActivation: vi.fn().mockResolvedValue(0) },
    credit: {
      expireLots: vi.fn().mockResolvedValue({ expired: 0, scanned: 0 }),
      // 形状必须与 auditConsistency 的真实返回一致：doAuditCredits 会读
      // result.mismatched.length —— 返回 {} 会变成「任务抛错」而不是「任务成功」，
      // 而失败同样会刷新 lastRunAt，节流用例就会因此假绿。
      auditConsistency: vi
        .fn()
        .mockResolvedValue({ checked: 0, mismatched: [], orphanLots: [], orphanLotCount: 0 }),
    },
    membership: { runSchedulerTasks: vi.fn().mockResolvedValue({}) },
    generate: { recoverOrphanTasks: vi.fn().mockResolvedValue(0) },
    payments: { closeExpired: vi.fn().mockResolvedValue(0) },
    retention: {
      runScheduled: vi.fn().mockResolvedValue({ skipped: true, results: [] } as never),
    },
  };
  const service = new SchedulerService(
    deps.backup as never,
    deps.settings as never,
    deps.marketing as never,
    deps.orders as never,
    deps.credit as never,
    deps.membership as never,
    deps.generate as never,
    deps.payments as never,
    deps.retention as never,
  );
  return { service, deps };
}

describe('SchedulerService 任务状态登记', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未到执行时间的任务登记在列但不刷新 lastRunAt、不计入执行次数', async () => {
    const { service, deps } = setup();

    // 第一轮：credit-audit 无历史记录 → shouldRun 放行；第二轮起被 24h 节流挡住
    await service.tick();
    const first = service.taskStatus().find((task) => task.name === 'credit-audit');
    expect(first?.totalRuns).toBe(1);
    // 必须是「成功」的一轮：失败也会刷新 lastRunAt，那样就测不出跳过语义
    expect(first?.lastSuccess).toBe(true);
    expect(first?.lastRunAt).not.toBeNull();
    const firstRunAt = first?.lastRunAt;

    await service.tick();
    const second = service.taskStatus().find((task) => task.name === 'credit-audit');
    // 跳过不推进 lastRunAt，也不增加 totalRuns —— 否则 24h 节流永远等不到
    expect(second?.lastRunAt).toBe(firstRunAt);
    expect(second?.totalRuns).toBe(1);
    // 任务仍在列表里，运营能看到它「本轮未到执行时间」
    expect(second).toBeDefined();
    expect(deps.credit.auditConsistency).toHaveBeenCalledTimes(1);
  });

  it('队列对账失败时不连累会员补发与邀请奖励重试，但仍登记为失败', async () => {
    const { service, deps } = setup();
    deps.generate.recoverOrphanTasks.mockRejectedValue(
      new Error('队列作业列表不可读，本轮跳过补投: connect ECONNREFUSED 127.0.0.1:6379'),
    );

    /*
     * 手动触发：task-recover 的三项补偿同在一条任务里。若串起来写，队列一挂
     * 就让只依赖数据库的两项补发一起被跳过；runSettled 逐项兜错后汇总抛出，
     * 由 runTask 登记成失败（runNow 本身不抛 —— 后台要的是「看得到失败」）。
     */
    await service.runNow('task-recover');

    expect(deps.orders.retryPendingMembershipActivation).toHaveBeenCalledTimes(1);
    expect(deps.marketing.retryPendingRegisterRewards).toHaveBeenCalledTimes(1);

    const task = service.taskStatus().find((item) => item.name === 'task-recover');
    expect(task?.consecutiveFailures).toBe(1);
    expect(task?.lastSuccess).toBe(false);
    expect(task?.lastError).toMatch(/ECONNREFUSED/);
  });

  it('队列恢复后连续失败计数归零，避免告警长期挂着旧故障', async () => {
    const { service, deps } = setup();
    deps.generate.recoverOrphanTasks.mockRejectedValueOnce(new Error('redis down'));

    await service.runNow('task-recover');
    expect(
      service.taskStatus().find((task) => task.name === 'task-recover')?.consecutiveFailures,
    ).toBe(1);

    await service.runNow('task-recover');
    const recovered = service.taskStatus().find((task) => task.name === 'task-recover');
    expect(recovered?.consecutiveFailures).toBe(0);
    expect(recovered?.lastSuccess).toBe(true);
  });

  it('清理目标部分失败汇总成一次任务失败（单个目标失败不静默）', async () => {
    const { service, deps } = setup();
    deps.retention.runScheduled.mockResolvedValue({
      skipped: false,
      results: [
        { table: 'ApiCallLog', deleted: 0, error: 'database is locked' },
        { table: 'CleanupLog', deleted: 3 },
      ],
    });

    await service.tick();

    const cleanup = service.taskStatus().find((task) => task.name === 'cleanup');
    expect(cleanup?.consecutiveFailures).toBe(1);
    expect(cleanup?.lastError).toMatch(/ApiCallLog\(database is locked\)/);
    // 清理失败不得影响同一轮里的其它任务
    expect(service.taskStatus().find((task) => task.name === 'order-expire')?.lastSuccess).toBe(
      true,
    );
  });

  it('清理整轮跳过时不计入执行，也不刷新 lastRunAt', async () => {
    const { service, deps } = setup();
    deps.retention.runScheduled.mockResolvedValue({ skipped: true, results: [] });

    await service.tick();

    const cleanup = service.taskStatus().find((task) => task.name === 'cleanup');
    expect(cleanup?.totalRuns).toBe(0);
    expect(cleanup?.lastRunAt).toBeNull();
  });

  it('上一轮未结束时不重复触发（重入保护）', async () => {
    const { service, deps } = setup();
    // 挂在第一个任务（order-expire）上，让 tick 停在轮内
    let release: (() => void) | undefined;
    deps.payments.closeExpired.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(0);
        }),
    );

    const running = service.tick();
    await Promise.resolve();
    const concurrent = service.tick();

    release?.();
    await Promise.all([running, concurrent]);

    // 第二轮被 running 标志挡住：整轮只跑了第一个任务，没有第二次的 closeExpired
    expect(deps.payments.closeExpired).toHaveBeenCalledTimes(1);
    expect(deps.credit.expireLots).toHaveBeenCalledTimes(1);
  });
});
