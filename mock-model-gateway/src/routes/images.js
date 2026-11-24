import { badRequest } from '../errors.js';
import { maybeFail } from '../fail.js';
import { sendJson, sleep } from '../http.js';
import { generateImage } from '../image/generator.js';

/**
 * POST {base}/v1/images/generations —— OpenAI 兼容文生图。
 *
 * 返回 `data[0].url`（默认）或 `data[0].b64_json`，与本项目
 * `openai` 图像协议的取值逻辑一一对应。
 */
export async function handleImageGeneration(ctx) {
  const body = ctx.body ?? {};
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) throw badRequest('prompt 不能为空', 'prompt');
  maybeFail(ctx.cfg, prompt);
  await sleep(ctx.cfg.latencyImageMs);

  const model = typeof body.model === 'string' && body.model ? body.model : 'mock-image';
  const n = clampInt(body.n ?? 1, 1, 4);
  const responseFormat = String(body.response_format ?? 'url').toLowerCase();
  if (!['url', 'b64_json'].includes(responseFormat)) {
    throw badRequest('response_format 只支持 url 或 b64_json', 'response_format');
  }
  const refs = countReferences(body);
  const created = Math.floor(Date.now() / 1000);
  const data = [];

  for (let i = 0; i < n; i += 1) {
    const image = generateImage({
      prompt,
      model,
      size: body.size,
      seed: `${body.seed ?? ''}|${i}`,
      imageCount: refs,
      maxPixels: ctx.cfg.imageMaxPixels,
    });
    if (responseFormat === 'b64_json') {
      data.push({ b64_json: image.buffer.toString('base64'), revised_prompt: image.revisedPrompt });
    } else {
      const { urlPath } = ctx.store.put(image.buffer, {
        mime: image.mime,
        ext: image.ext,
        meta: { kind: 'image', prompt, model, width: image.width, height: image.height },
      });
      data.push({ url: `${ctx.base}${urlPath}`, revised_prompt: image.revisedPrompt });
    }
  }

  sendJson(ctx.req, ctx.res, 200, {
    created,
    data,
    ...(n > 1 ? { usage: { generated_images: n } } : {}),
  });
}

/**
 * POST {base}/v1/image_generation —— MiniMax 图像协议的兼容端点。
 *
 * 本项目还有一条 `minimax` 图像协议（请求用 aspect_ratio，响应在
 * `data.image_urls`）。加上这段，三条通道都能拿这个网关做端到端联调。
 */
export async function handleMinimaxImageGeneration(ctx) {
  const body = ctx.body ?? {};
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) throw badRequest('prompt 不能为空', 'prompt');
  maybeFail(ctx.cfg, prompt);
  await sleep(ctx.cfg.latencyImageMs);

  const model = typeof body.model === 'string' && body.model ? body.model : 'image-01';
  const size = sizeFromAspectRatio(body.aspect_ratio);
  const refs = Array.isArray(body.subject_reference) ? body.subject_reference.length : 0;
  const image = generateImage({
    prompt,
    model,
    size,
    seed: String(body.seed ?? ''),
    imageCount: refs,
    maxPixels: ctx.cfg.imageMaxPixels,
  });
  const { urlPath } = ctx.store.put(image.buffer, {
    mime: image.mime,
    ext: image.ext,
    meta: { kind: 'image', prompt, model, width: image.width, height: image.height },
  });

  sendJson(ctx.req, ctx.res, 200, {
    data: { image_urls: [`${ctx.base}${urlPath}`] },
    metadata: { model, width: image.width, height: image.height, simulated: true },
    base_resp: { status_code: 0, status_msg: 'success' },
  });
}

function sizeFromAspectRatio(raw) {
  const m = /^(\d{1,2})\s*:\s*(\d{1,2})$/.exec(String(raw ?? '1:1').trim());
  if (!m) return '1024x1024';
  const rw = Number(m[1]) || 1;
  const rh = Number(m[2]) || 1;
  const base = 1024;
  if (rw >= rh) return `${base}x${Math.max(64, Math.round((base * rh) / rw))}`;
  return `${Math.max(64, Math.round((base * rw) / rh))}x${base}`;
}

function countReferences(body) {
  let n = 0;
  for (const key of ['image', 'images']) {
    const value = body[key];
    if (Array.isArray(value)) n += value.length;
    else if (typeof value === 'string' && value) n += 1;
  }
  return n;
}

function clampInt(raw, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(Math.round(n), min), max);
}
