import { generateApi, assetSrc } from './api';
import { POLL_INTERVAL_MS, POLL_MAX_TRIES, POLL_VIDEO_MAX_TRIES } from './constants';
import type { Modality, Task, TaskStatus } from '../types/api';

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
  /**
   * 产出的真实来源: gateway=真实模型通道 / local=本地算法回落。
   *
   * 必须透出给结果卡 —— 页面要按**这一单实际走了哪条通道**显示徽标,
   * 而不是按能力清单的静态 mode 猜。同一能力在网关可用时是模型产出、
   * 网关故障时是本地回落, 两者都必须如实呈现, 否则等于用假效果冒充模型能力。
   */
  provider?: string | null;
  /**
   * 产出模态 (2026-10-20 视频通道落地) —— 'image' | 'video'。
   *
   * 必须透出到结果卡: 视频**不能**用 `<img>` 渲染 (浏览器会当图片解码,
   * 表现为"生成成功但预览空白")。缺省按 image 处理, 不能反过来 ——
   * 反过来会让存量图像产出全变白屏。
   */
  modality?: Modality;
  /** 视频时长 (毫秒); 仅视频产出有值 */
  durationMs?: number | null;
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
  let maxTries = options.maxTries ?? POLL_MAX_TRIES;
  const { signal, onTick } = options;

  for (let tries = 0; tries < maxTries; tries++) {
    if (signal?.aborted) return PENDING;
    try {
      const task = await generateApi.getTask(taskId);
      onTick?.(task);
      /*
       * 视频与图像的产出时间不是一个量级：视频 1–2 分钟起。按图像上限
       * 截断会让视频任务在前端确定性超时（后台仍在跑、已扣费）。
       * 拿到任务模态后再放宽上限，图像任务不受影响。
       */
      if (task.modality === 'video') {
        maxTries = options.maxTries ?? POLL_VIDEO_MAX_TRIES;
      }
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
    url: task.outputAsset ? assetSrc(task.outputAsset) : undefined,
    width: task.outputAsset?.width ?? undefined,
    height: task.outputAsset?.height ?? undefined,
    errorCode: task.errorCode ?? null,
    provider: task.provider ?? null,
    modality: task.outputAsset?.modality,
    durationMs: task.outputAsset?.durationMs ?? undefined,
  };
}
