import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../types/api';

/**
 * 任务轮询：终态返回、网络抖动重试、超时、视频上限放宽、中止语义。
 *
 * 这里用假定时器，不真的等 1 秒。被 mock 的常量刻意取小值，让「次数」
 * 本身成为断言，而不是断言某个实现细节。
 */

vi.mock('../api', () => ({
  generateApi: { getTask: vi.fn() },
  assetSrc: vi.fn(
    (asset?: { sourceUrl?: string | null; signedUrl?: string | null } | null) =>
      asset?.signedUrl ?? asset?.sourceUrl ?? '',
  ),
}));

vi.mock('../constants', () => ({
  POLL_INTERVAL_MS: 1000,
  POLL_MAX_TRIES: 2,
  POLL_MULTI_FUSION_MAX_TRIES: 6,
  POLL_VIDEO_MAX_TRIES: 4,
}));

import { assetSrc, generateApi } from '../api';
import { pollToResult, waitForTask } from '../poll';

const getTask = vi.mocked(generateApi.getTask);

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    status: 'running',
    modality: 'image',
    capability: 'creative_image',
    ...overrides,
  } as unknown as Task;
}

beforeEach(() => {
  vi.useFakeTimers();
  getTask.mockReset();
  vi.mocked(assetSrc).mockImplementation(
    (asset?: { sourceUrl?: string | null; signedUrl?: string | null } | null) =>
      asset?.signedUrl ?? asset?.sourceUrl ?? '',
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForTask', () => {
  it('首个响应就是终态时立即返回，不进入等待', async () => {
    getTask.mockResolvedValue(makeTask({ status: 'succeeded' }));

    const outcome = await waitForTask('task-1');

    expect(outcome).toMatchObject({ ok: true, task: { status: 'succeeded' } });
    expect(getTask).toHaveBeenCalledTimes(1);
  });

  it('running 时按间隔轮询，直到 succeeded', async () => {
    getTask
      .mockResolvedValueOnce(makeTask({ status: 'running' }))
      .mockResolvedValueOnce(makeTask({ status: 'succeeded' }));

    const pending = waitForTask('task-1', { intervalMs: 1000, maxTries: 5 });
    await vi.advanceTimersByTimeAsync(1000);
    const outcome = await pending;

    expect(outcome.ok).toBe(true);
    expect(getTask).toHaveBeenCalledTimes(2);
  });

  it('单次网络异常不中断，下一轮继续轮询', async () => {
    getTask
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(makeTask({ status: 'succeeded' }));

    const pending = waitForTask('task-1', { intervalMs: 1000, maxTries: 5 });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(getTask).toHaveBeenCalledTimes(2);
  });

  it('超过图像上限返回 POLL_TIMEOUT', async () => {
    getTask.mockResolvedValue(makeTask({ status: 'running' }));

    const pending = waitForTask('task-1');
    await vi.advanceTimersByTimeAsync(2000);

    await expect(pending).resolves.toEqual({ ok: false, errorCode: 'POLL_TIMEOUT' });
    expect(getTask).toHaveBeenCalledTimes(2);
  });

  it('视频任务的轮询上限自动放宽到 POLL_VIDEO_MAX_TRIES', async () => {
    getTask.mockResolvedValue(makeTask({ status: 'running', modality: 'video' }));

    const pending = waitForTask('task-1');
    await vi.advanceTimersByTimeAsync(4000);

    await expect(pending).resolves.toEqual({ ok: false, errorCode: 'POLL_TIMEOUT' });
    expect(getTask).toHaveBeenCalledTimes(4);
  });

  it('多图融合任务的轮询上限自动放宽，避免多变体误报超时', async () => {
    getTask.mockResolvedValue(makeTask({ status: 'running', capability: 'multi_fusion' }));

    const pending = waitForTask('task-1');
    await vi.advanceTimersByTimeAsync(6000);

    await expect(pending).resolves.toEqual({ ok: false, errorCode: 'POLL_TIMEOUT' });
    expect(getTask).toHaveBeenCalledTimes(6);
  });

  it('每轮都通过 onTick 回传最新任务', async () => {
    const onTick = vi.fn();
    getTask
      .mockResolvedValueOnce(makeTask({ status: 'running' }))
      .mockResolvedValueOnce(makeTask({ status: 'failed', errorCode: '42204' }));

    const pending = waitForTask('task-1', { intervalMs: 1000, maxTries: 5, onTick });
    await vi.advanceTimersByTimeAsync(1000);
    await pending;

    expect(onTick).toHaveBeenCalledTimes(2);
    expect(onTick.mock.calls[1][0]).toMatchObject({ status: 'failed', errorCode: '42204' });
  });

  it('signal 已中止时不发请求，返回永不落定的 promise', async () => {
    const controller = new AbortController();
    controller.abort();
    let settled = false;

    const pending = waitForTask('task-1', { signal: controller.signal });
    pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toBe(false);
    expect(getTask).not.toHaveBeenCalled();
  });

  it('轮询中途中止后不再发下一轮请求', async () => {
    getTask.mockResolvedValue(makeTask({ status: 'running' }));
    const controller = new AbortController();
    let settled = false;

    const pending = waitForTask('task-1', { intervalMs: 1000, maxTries: 5, signal: controller.signal });
    pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5000);

    expect(settled).toBe(false);
    expect(getTask).toHaveBeenCalledTimes(1);
  });
});

describe('pollToResult', () => {
  it('把任务映射成结果卡需要的扁平结构', async () => {
    getTask.mockResolvedValue(
      makeTask({
        status: 'succeeded',
        provider: 'gateway',
        outputAsset: {
          id: 'asset-1',
          sourceUrl: '/uploads/a.png',
          signedUrl: '/uploads/a.png?sign=1',
          format: 'png',
          width: 1024,
          height: 768,
          modality: 'image',
          durationMs: null,
        } as unknown as Task['outputAsset'],
      }),
    );

    await expect(pollToResult('task-1')).resolves.toEqual({
      status: 'succeeded',
      url: '/uploads/a.png?sign=1',
      width: 1024,
      height: 768,
      errorCode: null,
      provider: 'gateway',
      modality: 'image',
      durationMs: undefined,
      outputs: [
        {
          url: '/uploads/a.png?sign=1',
          width: 1024,
          height: 768,
          format: 'png',
          modality: 'image',
          durationMs: undefined,
        },
      ],
    });
  });

  it('多图融合任务按顺序映射全部真实产出', async () => {
    const outputAssets = [
      {
        id: 'asset-1',
        sourceUrl: '/uploads/a.png',
        signedUrl: '/uploads/a.png?sign=1',
        format: 'png',
        width: 1024,
        height: 768,
        modality: 'image',
        durationMs: null,
      },
      {
        id: 'asset-2',
        sourceUrl: '/uploads/b.png',
        signedUrl: '/uploads/b.png?sign=2',
        format: 'png',
        width: 1024,
        height: 768,
        modality: 'image',
        durationMs: null,
      },
    ] as unknown as Task['outputAssets'];
    getTask.mockResolvedValue(
      makeTask({
        status: 'succeeded',
        provider: 'gateway',
        outputAsset: outputAssets?.[0] ?? null,
        outputAssets,
      }),
    );

    const result = await pollToResult('task-1');

    expect(result.outputs?.map((output) => output.url)).toEqual([
      '/uploads/a.png?sign=1',
      '/uploads/b.png?sign=2',
    ]);
    expect(result.url).toBe('/uploads/a.png?sign=1');
  });

  it('轮询超时映射为 failed + POLL_TIMEOUT', async () => {
    getTask.mockResolvedValue(makeTask({ status: 'running' }));

    const pending = pollToResult('task-1');
    await vi.advanceTimersByTimeAsync(2000);

    await expect(pending).resolves.toEqual({ status: 'failed', errorCode: 'POLL_TIMEOUT' });
  });
});
