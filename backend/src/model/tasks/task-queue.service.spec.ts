import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskQueueService } from './task-queue.service';

/**
 * 队列生产者只测一件事：Redis 不可达时**必须返回，不能挂住调用方**。
 *
 * BullMQ 强制 `maxRetriesPerRequest: null`，ioredis 的 `enableOfflineQueue` 又默认
 * 开启，于是命令在断连期间既不 resolve 也不 reject。调用链上
 * `SchedulerService.tick()` 有 `running` 重入保护，一次永久挂起就会让订单超时关闭、
 * 积分回收、备份、清理整轮永久停摆，而且因为没抛错，后台连「连续失败」都看不到。
 */

/** 模拟 ioredis 离线队列：命令永不 settle */
function hangingQueue() {
  return {
    add: vi.fn(() => new Promise(() => undefined)),
    getRanges: vi.fn(() => new Promise(() => undefined)),
  };
}

describe('TaskQueueService 队列命令截止', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('入队命令挂起时在截止后报错，而不是永久等待', async () => {
    const queue = hangingQueue();
    const service = new TaskQueueService(queue as never);

    const settled = vi.fn();
    const promise = service.enqueue('task-1').catch((error: Error) => settled(error.message));

    await vi.advanceTimersByTimeAsync(4_999);
    // 截止之前仍应保持等待：正常 Redis 往返远小于这个值，不能提前误判
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await promise;

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled.mock.calls[0][0]).toMatch(/任务入队.*未返回/);
  });

  it('读取作业列表挂起时返回 null 并记录原因，不阻塞对账', async () => {
    const queue = hangingQueue();
    const service = new TaskQueueService(queue as never);

    const promise = service.scheduledTaskIds();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(promise).resolves.toBeNull();
    expect(service.lastReadFailure).toMatch(/超过 5000ms 未返回/);
  });

  it('队列可达时正常返回作业 ID 并清空失败记录', async () => {
    const queue = {
      add: vi.fn().mockResolvedValue({}),
      getRanges: vi.fn().mockResolvedValue(['task-1', 'task-2']),
    };
    const service = new TaskQueueService(queue as never);
    service.lastReadFailure = 'stale';

    await expect(service.scheduledTaskIds()).resolves.toEqual(new Set(['task-1', 'task-2']));
    expect(service.lastReadFailure).toBeNull();
  });

  it('命令立即报错时仍按 null 上报（与超时同一条出口）', async () => {
    const queue = {
      add: vi.fn().mockResolvedValue({}),
      getRanges: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379')),
    };
    const service = new TaskQueueService(queue as never);

    await expect(service.scheduledTaskIds()).resolves.toBeNull();
    expect(service.lastReadFailure).toMatch(/ECONNREFUSED/);
  });

  it('入队成功不受截止影响（作业仍带幂等 jobId 投递）', async () => {
    const queue = { add: vi.fn().mockResolvedValue({}), getRanges: vi.fn() };
    const service = new TaskQueueService(queue as never);

    await expect(service.enqueue('task-9', 1_500)).resolves.toBeUndefined();
    expect(queue.add).toHaveBeenCalledWith(
      'execute',
      { taskId: 'task-9' },
      expect.objectContaining({ jobId: 'task-9', delay: 1_500 }),
    );
  });
});
