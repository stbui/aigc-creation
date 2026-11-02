import { generateApi, assetSrc } from './api';
import {
  POLL_INTERVAL_MS,
  POLL_MAX_TRIES,
  POLL_MULTI_FUSION_MAX_TRIES,
  POLL_VIDEO_MAX_TRIES,
} from './constants';
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
  /** 产出素材 id —— 结果卡“用作参考图”需要它，不能用任务 id 代替 */
  assetId?: string;
  /** 产出真实格式（png/jpeg/webp），下载扩展名据此决定 */
  format?: string;
  width?: number;
  height?: number;
  errorCode?: string | null;
  /**
   * 产出的真实来源: gateway=真实模型通道；local 仅用于历史任务。
   *
   * 必须透出给结果卡 —— 页面要按**这一单实际走了哪条通道**显示徽标,
   * 而不是按能力清单的静态 mode 猜。新任务只会是 gateway；
   * 历史 local 记录仍须如实呈现，不能伪装成模型产出。
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
  /**
   * 同一任务的全部真实产出。多图融合一次可生成 1-4 张变体；
   * 缺省时调用方按单个 url 处理，兼容旧后端。
   */
  outputs?: PolledOutput[];
}

export interface PolledOutput {
  url: string;
  /** 产出素材 id（后端 outputAssets/ outputAsset 上的 asset.id） */
  assetId?: string;
  width?: number;
  height?: number;
  format?: string;
  modality?: Modality;
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
      } else if (task.capability === 'multi_fusion') {
        // 多变体在同一次任务内并发调用模型，耗时上限高于普通单图能力。
        maxTries = options.maxTries ?? POLL_MULTI_FUSION_MAX_TRIES;
      }
      /*
       * cancelled 也是终态：后端在管理员终止 / 恢复超时时会置 cancelled，
       * 继续轮询只会拖到超时，然后给用户一个假的“生成超时”。
       */
      if (
        task.status === 'succeeded' ||
        task.status === 'failed' ||
        task.status === 'cancelled'
      ) {
        return { ok: true, task };
      }
    } catch (e) {
      /*
       * 会话失效 / 明确拒绝不应被当成网络抖动吞掉，否则用户要等完整超时。
       * 这里不 instanceof ApiError：poll 的单测会 mock ./api，引入类会让
       * 所有既有 mock 需要额外导出；按 status 鸭子类型判断即可。
       */
      const status =
        typeof e === 'object' && e !== null && 'status' in e
          ? Number((e as { status: unknown }).status)
          : 0;
      if (status === 401 || status === 403) throw e;
      /* 其余网络抖动: 不中断, 下一轮重试 */
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
  // 统一把 cancelled 映射为 failed + 明确错误码，所有消费方都能走失败分支
  if (task.status === 'cancelled') {
    return {
      status: 'failed',
      errorCode: task.errorCode ?? 'CANCELLED',
      provider: task.provider ?? null,
    };
  }
  const taskOutputs = task.outputAssets?.length ? task.outputAssets : task.outputAsset ? [task.outputAsset] : [];
  const outputs = taskOutputs.flatMap((output): PolledOutput[] => {
    const url = assetSrc(output);
    if (!url) return [];
    return [
      {
        url,
        // 旧 mock / 旧后端可能没有 id/format；只在真实存在时补字段，
        // 避免把 undefined 也塞进结果对象影响既有调用方与快照
        ...(output.id ? { assetId: output.id } : {}),
        width: output.width ?? undefined,
        height: output.height ?? undefined,
        ...(output.format ? { format: output.format } : {}),
        modality: output.modality,
        durationMs: output.durationMs ?? undefined,
      },
    ];
  });
  const primary = outputs[0];
  return {
    status: task.status,
    url: primary?.url,
    ...(primary?.assetId ? { assetId: primary.assetId } : {}),
    ...(primary?.format ? { format: primary.format } : {}),
    width: primary?.width,
    height: primary?.height,
    errorCode: task.errorCode ?? null,
    provider: task.provider ?? null,
    modality: primary?.modality,
    durationMs: primary?.durationMs,
    outputs,
  };
}
