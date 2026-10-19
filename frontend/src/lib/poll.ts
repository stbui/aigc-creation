import { generateApi, toAbsoluteUrl } from './api';
import { POLL_INTERVAL_MS, POLL_MAX_TRIES } from './constants';
import type { Task, TaskStatus } from '../types/api';

/**
 * 任务轮询。
 *
 * 此前 7 个页面各自复制同一段 "for/setTimeout + tries 上限 + 网络抖动重试" 循环,
 * 实现细节 (间隔/上限/抖动语义) 分散且易漂移。这里收口为唯一实现。
 *
 * 中止语义: 传入 signal 后, 中止时返回一个**永不 resolve** 的 promise ——
 * 与原先 "卸载时 clearTimeout, 回调不再执行" 的行为一致, 组件卸载后不会触发
 * setState 或残留的 message 提示。
 */

export interface PolledResult {
  status: TaskStatus;
  url?: string;
  width?: number;
  height?: number;
  errorCode?: string | null;
}

export type PollOutcome = { ok: true; task: Task } | { ok: false; errorCode: string };

export interface PollOptions {
  intervalMs?: number;
  maxTries?: number;
  signal?: AbortSignal | null;
  /** 每次拿到最新任务时回调 (用于展示进度) */
  onTick?: (task: Task) => void;
}

/** 中止后使用的挂起 promise (不产生任何后续副作用) */
const PENDING = new Promise<PollOutcome>(() => {});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** 轮询任务直到 succeeded/failed 或超过 maxTries (超时)。 */
export async function waitForTask(taskId: string, options: PollOptions = {}): Promise<PollOutcome> {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const maxTries = options.maxTries ?? POLL_MAX_TRIES;
  const { signal, onTick } = options;

  for (let tries = 0; tries < maxTries; tries++) {
    if (signal?.aborted) return PENDING;
    try {
      const task = await generateApi.getTask(taskId);
      onTick?.(task);
      if (task.status === 'succeeded' || task.status === 'failed') return { ok: true, task };
    } catch {
      /* 网络抖动: 不中断, 下一轮重试 */
    }
    if (signal?.aborted) return PENDING;
    await sleep(intervalMs);
  }
  return { ok: false, errorCode: 'POLL_TIMEOUT' };
}

/** 轮询并映射为结果卡片所需的扁平结构 (url/尺寸/错误码)。 */
export async function pollToResult(taskId: string, options: PollOptions = {}): Promise<PolledResult> {
  const outcome = await waitForTask(taskId, options);
  if (!outcome.ok) return { status: 'failed', errorCode: outcome.errorCode };
  const { task } = outcome;
  return {
    status: task.status,
    url: task.outputAsset ? toAbsoluteUrl(task.outputAsset.sourceUrl) : undefined,
    width: task.outputAsset?.width ?? undefined,
    height: task.outputAsset?.height ?? undefined,
    errorCode: task.errorCode ?? null,
  };
}
