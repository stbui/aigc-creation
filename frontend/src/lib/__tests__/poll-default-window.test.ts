import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../types/api';

vi.mock('../api', () => ({
  generateApi: { getTask: vi.fn() },
  assetSrc: vi.fn(),
}));

import { generateApi } from '../api';
import { waitForTask } from '../poll';

const getTask = vi.mocked(generateApi.getTask);

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    status: 'running',
    modality: 'image',
    capability: 'free_create',
    ...overrides,
  } as unknown as Task;
}

describe('默认任务轮询窗口', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getTask.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('普通图片任务运行超过 72 秒时继续等待，并以最终成功状态收尾', async () => {
    let calls = 0;
    getTask.mockImplementation(async () => {
      calls += 1;
      // 最近一次真实任务耗时约 4 分钟；旧的 60 × 1.2s 窗口会在约 72s 误报超时。
      return calls <= 200 ? makeTask() : makeTask({ status: 'succeeded' });
    });

    const pending = waitForTask('task-1');
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);

    await expect(pending).resolves.toMatchObject({
      ok: true,
      task: { status: 'succeeded' },
    });
  });
});
