import { modelIdsOf } from '../config.js';
import { notFound } from '../errors.js';
import { sendBuffer, sendJson } from '../http.js';

/** GET /files/:id.ext —— 产出文件（图片 / 视频）。支持单段 Range。 */
export function handleFile(ctx, name) {
  const id = decodeURIComponent(name).replace(/\.[a-z0-9]+$/i, '');
  const file = ctx.store.get(id);
  if (!file) throw notFound('文件不存在、已过期或被容量淘汰');
  sendBuffer(ctx.req, ctx.res, 200, file.buffer, file.mime, {
    'Content-Disposition': `inline; filename="${id}.${file.ext}"`,
    'Cache-Control': 'public, max-age=3600',
  });
}

/** GET / —— 自描述信息，方便浏览器打开确认「服务活着、端点在哪」。 */
export function handleIndex(ctx) {
  const models = modelIdsOf(ctx.cfg);
  sendJson(ctx.req, ctx.res, 200, {
    name: 'mock-model-gateway',
    description: 'OpenAI 标准协议 + MiniMax 视频兼容的仿真模型网关（仅用于联调）',
    endpoints: {
      models: ['GET /v1/models', 'GET /models', 'GET /v1/models/:id'],
      text: 'POST /v1/chat/completions',
      imageOpenAI: ['POST /v1/images/generations', 'POST /v1/images/edits'],
      imageMinimax: 'POST /v1/image_generation',
      videoOpenAI: ['POST /v1/videos', 'GET /v1/videos/:id', 'GET /v1/videos/:id/content'],
      videoMinimax: [
        'POST /v1/video_generation',
        'GET /v1/query/video_generation?task_id=',
        'GET /v1/files/retrieve?file_id=',
      ],
      assets: 'GET /files/:id.ext',
      health: 'GET /health',
    },
    auth: ctx.cfg.apiKey ? 'Bearer <MOCK_API_KEY>' : '未启用（任意令牌均可）',
    models,
    runtime: {
      latencyChatMs: ctx.cfg.latencyChatMs,
      latencyImageMs: ctx.cfg.latencyImageMs,
      latencyVideoReadyMs: ctx.cfg.latencyVideoReadyMs,
      failRate: ctx.cfg.failRate,
      store: ctx.store.stats(),
      uptimeSeconds: Math.round(process.uptime()),
    },
  });
}

export function handleHealth(ctx) {
  sendJson(ctx.req, ctx.res, 200, {
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    store: ctx.store.stats(),
  });
}
