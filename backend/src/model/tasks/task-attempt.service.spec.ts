import { describe, expect, it, vi } from 'vitest';

import { TaskAttemptService } from './task-attempt.service';

describe('TaskAttemptService.begin', () => {
  it('failed + submission_unknown 必须转人工核对，不能按终态换线', async () => {
    const service = new TaskAttemptService({} as never);
    const outcome = await service.begin({
      id: 'attempt-1',
      status: 'failed',
      dispatchState: 'submission_unknown',
    } as never);

    expect(outcome.action).toBe('uncertain');
  });

  it('failed + rejected_no_job 才允许按明确拒绝换线', async () => {
    const service = new TaskAttemptService({} as never);
    const outcome = await service.begin({
      id: 'attempt-1',
      status: 'failed',
      dispatchState: 'rejected_no_job',
    } as never);

    expect(outcome.action).toBe('done');
  });
});

describe('TaskAttemptService.markAccepted', () => {
  it('只有派发中的 attempt 才能通过 CAS 进入已受理', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new TaskAttemptService({
      routeAttempt: { updateMany, findUnique: vi.fn() },
    } as never);

    await expect(service.markAccepted('attempt-1', ' upstream-job-1 ')).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', status: 'dispatching', dispatchState: 'submission_unknown' },
      data: { dispatchState: 'accepted', providerRequestId: 'upstream-job-1' },
    });
  });

  it('CAS 未命中且状态不一致时返回 false，调用方必须停止重试', async () => {
    const service = new TaskAttemptService({
      routeAttempt: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({ status: 'selected', dispatchState: 'not_sent' }),
      },
    } as never);

    await expect(service.markAccepted('attempt-1', 'upstream-job-1')).resolves.toBe(false);
  });

  it('并发写入已落为 accepted 时按幂等成功处理', async () => {
    const service = new TaskAttemptService({
      routeAttempt: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({ status: 'dispatching', dispatchState: 'accepted' }),
      },
    } as never);

    await expect(service.markAccepted('attempt-1', 'upstream-job-1')).resolves.toBe(true);
  });
});
