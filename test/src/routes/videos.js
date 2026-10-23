import { randomBytes } from 'node:crypto';
import { ApiError, badRequest, notFound } from '../errors.js';
import { maybeFail } from '../fail.js';
import { sendBuffer, sendJson, sleep } from '../http.js';
import { generateVideo } from '../video/generator.js';

/**
 * 视频生成的两套协议：
 *
 * 1. **OpenAI 标准** `POST /v1/videos` → 任务对象；`GET /v1/videos/:id`
 *    查状态；`GET /v1/videos/:id/content` 取 mp4 字节。
 * 2. **MiniMax 兼容** `POST /v1/video_generation` → task_id；
 *    `GET /v1/query/video_generation?task_id=` 轮询；
 *    `GET /v1/files/retrieve?file_id=` 换下载地址。
 *
 * 为什么要同时有第二套：本项目当前**只实现了 minimax-video 视频协议**，
 * 后台「模型配置 → 视频通道」只有选它才能通过「协议未接入」校验。
 * OpenAI 那套供将来的协议实现与其它 OpenAI 客户端使用。
 *
 * 视频在创建任务时就**真实生成完毕**（编码放进内存），状态推进只是
 * 按 readyAt 做时间模拟 —— 这样轮询逻辑（本项目 2 秒一次）能被真实
 * 走到，而不必让创建请求阻塞几十秒。
 */

export async function handleOpenAiVideoCreate(ctx) {
  const body = ctx.body ?? {};
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) throw badRequest('prompt 不能为空', 'prompt');
  maybeFail(ctx.cfg, prompt);
  await sleep(Math.min(ctx.cfg.latencyVideoReadyMs / 4, 400));

  const model = typeof body.model === 'string' && body.model ? body.model : 'mock-video';
  const seconds = clampNumber(Number(body.seconds) || 2, 1, ctx.cfg.videoMaxSeconds);
  const requestedSize = typeof body.size === 'string' ? body.size : '1280x720';
  const video = generateVideo({
    prompt,
    model,
    size: requestedSize,
    seconds,
    seed: String(body.seed ?? ''),
    maxSeconds: ctx.cfg.videoMaxSeconds,
  });
  const { id: fileId } = ctx.store.put(video.buffer, {
    mime: video.mime,
    ext: video.ext,
    meta: { kind: 'video', prompt, model, width: video.width, height: video.height },
  });

  const now = Date.now();
  const job = {
    id: `video_${randomBytes(10).toString('hex')}`,
    createdAt: now,
    readyAt: now + ctx.cfg.latencyVideoReadyMs,
    model,
    prompt,
    seconds,
    requestedSize,
    fileId,
    width: video.width,
    height: video.height,
  };
  ctx.state.openaiVideos.set(job.id, job);
  sendJson(ctx.req, ctx.res, 200, serializeOpenAiJob(job, now));
}

export function handleOpenAiVideoGet(ctx, id) {
  const job = ctx.state.openaiVideos.get(id);
  if (!job) throw notFound(`视频任务 "${id}" 不存在`);
  sendJson(ctx.req, ctx.res, 200, serializeOpenAiJob(job, Date.now()));
}

export function handleOpenAiVideoList(ctx) {
  const jobs = [...ctx.state.openaiVideos.values()].sort((a, b) => b.createdAt - a.createdAt);
  const now = Date.now();
  sendJson(ctx.req, ctx.res, 200, {
    object: 'list',
    data: jobs.map((job) => serializeOpenAiJob(job, now)),
    has_more: false,
  });
}

export function handleOpenAiVideoContent(ctx, id) {
  const job = ctx.state.openaiVideos.get(id);
  if (!job) throw notFound(`视频任务 "${id}" 不存在`);
  const now = Date.now();
  if (now < job.readyAt) {
    throw new ApiError(409, `视频仍在生成中（${serializeOpenAiJob(job, now).status}）`, {
      code: 'video_not_ready',
    });
  }
  const file = ctx.store.get(job.fileId);
  if (!file) throw notFound('视频文件已过期或被淘汰，请重新生成');
  sendBuffer(ctx.req, ctx.res, 200, file.buffer, file.mime, {
    'Content-Disposition': `inline; filename="${job.id}.mp4"`,
    'Cache-Control': 'public, max-age=3600',
  });
}

export function handleOpenAiVideoDelete(ctx, id) {
  const job = ctx.state.openaiVideos.get(id);
  if (!job) throw notFound(`视频任务 "${id}" 不存在`);
  ctx.state.openaiVideos.delete(id);
  ctx.store.remove(job.fileId);
  sendJson(ctx.req, ctx.res, 200, { id, object: 'video.deleted', deleted: true });
}

function serializeOpenAiJob(job, now) {
  const total = Math.max(1, job.readyAt - job.createdAt);
  const elapsed = Math.max(0, now - job.createdAt);
  let status;
  let progress;
  if (elapsed >= total) {
    status = 'completed';
    progress = 100;
  } else if (elapsed >= total * 0.3) {
    status = 'in_progress';
    progress = Math.min(99, Math.round((elapsed / total) * 95));
  } else {
    status = 'queued';
    progress = 0;
  }
  return {
    id: job.id,
    object: 'video',
    created_at: Math.floor(job.createdAt / 1000),
    status,
    progress,
    model: job.model,
    seconds: String(job.seconds),
    size: job.requestedSize,
    ...(status === 'completed'
      ? {
          completed_at: Math.floor(job.readyAt / 1000),
          // 非 OpenAI 标准字段：明确告知仿真产物的真实分辨率
          mock_width: job.width,
          mock_height: job.height,
        }
      : {}),
  };
}

// ─────────────────────────── MiniMax 兼容协议 ───────────────────────────

export async function handleMinimaxVideoCreate(ctx) {
  const body = ctx.body ?? {};
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    sendJson(ctx.req, ctx.res, 200, {
      task_id: '',
      base_resp: { status_code: 1002, status_msg: 'prompt is required' },
    });
    return;
  }
  maybeFail(ctx.cfg, prompt);
  await sleep(Math.min(ctx.cfg.latencyVideoReadyMs / 4, 400));

  const model = typeof body.model === 'string' && body.model ? body.model : 'MiniMax-Hailuo-2.3';
  const seconds = clampNumber(Number(body.duration) || 2, 1, ctx.cfg.videoMaxSeconds);
  const resolution = typeof body.resolution === 'string' ? body.resolution : '';
  const video = generateVideo({
    prompt,
    model,
    resolution,
    seconds,
    seed: String(body.seed ?? ''),
    maxSeconds: ctx.cfg.videoMaxSeconds,
    hasFirstFrame: Boolean(body.first_frame_image),
  });
  const { id: fileId } = ctx.store.put(video.buffer, {
    mime: video.mime,
    ext: video.ext,
    meta: { kind: 'video', prompt, model, width: video.width, height: video.height },
  });

  const taskId = `task_${randomBytes(10).toString('hex')}`;
  const now = Date.now();
  ctx.state.minimaxTasks.set(taskId, {
    id: taskId,
    createdAt: now,
    readyAt: now + ctx.cfg.latencyVideoReadyMs,
    fileId,
    model,
    width: video.width,
    height: video.height,
  });
  sendJson(ctx.req, ctx.res, 200, {
    task_id: taskId,
    base_resp: { status_code: 0, status_msg: 'success' },
  });
}

export function handleMinimaxVideoQuery(ctx) {
  const taskId = ctx.query.get('task_id') ?? ctx.query.get('taskId') ?? '';
  const task = ctx.state.minimaxTasks.get(taskId);
  if (!task) {
    sendJson(ctx.req, ctx.res, 200, {
      task_id: taskId,
      base_resp: { status_code: 2013, status_msg: 'task not found' },
    });
    return;
  }
  const now = Date.now();
  const total = Math.max(1, task.readyAt - task.createdAt);
  const elapsed = Math.max(0, now - task.createdAt);
  let status;
  if (elapsed >= total) status = 'Success';
  else if (elapsed >= total * 0.3) status = 'Processing';
  else status = 'Queueing';

  sendJson(ctx.req, ctx.res, 200, {
    task_id: taskId,
    status,
    ...(status === 'Success'
      ? {
          file_id: task.fileId,
          video_width: task.width,
          video_height: task.height,
        }
      : { file_id: '' }),
    base_resp: { status_code: 0, status_msg: 'success' },
  });
}

export function handleMinimaxFileRetrieve(ctx) {
  const fileId = ctx.query.get('file_id') ?? ctx.query.get('fileId') ?? '';
  const file = ctx.store.get(fileId);
  if (!file) {
    sendJson(ctx.req, ctx.res, 200, {
      file: null,
      base_resp: { status_code: 2013, status_msg: 'file not found' },
    });
    return;
  }
  sendJson(ctx.req, ctx.res, 200, {
    file: {
      file_id: fileId,
      bytes: file.size,
      created_at: Math.floor(file.createdAt / 1000),
      filename: `${fileId}.${file.ext}`,
      download_url: `${ctx.base}/files/${fileId}.${file.ext}`,
      purpose: 'video_generation',
    },
    base_resp: { status_code: 0, status_msg: 'success' },
  });
}

function clampNumber(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}
