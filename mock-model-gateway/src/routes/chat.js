import { randomBytes } from 'node:crypto';
import { badRequest } from '../errors.js';
import { maybeFail } from '../fail.js';
import { sleep, sendJson } from '../http.js';
import { chunkForStreaming, generateText } from '../text/generator.js';

/**
 * POST {base}/v1/chat/completions —— OpenAI 兼容对话补全。
 *
 * 非流式与流式都支持。本项目后端固定发 `stream: false`，流式是给
 * 其它 OpenAI 客户端（以及手工 curl）联调用的。
 */
export async function handleChat(ctx) {
  const body = ctx.body ?? {};
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw badRequest('messages 必须是非空数组', 'messages');
  }
  maybeFail(ctx.cfg, collectText(messages));
  await sleep(ctx.cfg.latencyChatMs);

  const model = typeof body.model === 'string' && body.model ? body.model : 'mock-text';
  const result = generateText({
    model,
    messages,
    maxTokens: numberOrUndefined(body.max_tokens ?? body.maxTokens),
    temperature: numberOrUndefined(body.temperature),
  });
  const id = `chatcmpl-${randomBytes(12).toString('hex')}`;
  const created = Math.floor(Date.now() / 1000);

  if (body.stream === true) {
    await streamCompletion(ctx, { id, created, model, result });
    return;
  }

  sendJson(ctx.req, ctx.res, 200, {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: result.content },
        logprobs: null,
        finish_reason: result.finishReason,
      },
    ],
    usage: result.usage,
    system_fingerprint: 'fp_mock_gateway',
  });
}

/** SSE 流式响应，逐个 delta 推正文，最后以 [DONE] 收尾。 */
async function streamCompletion(ctx, { id, created, model, result }) {
  const { req, res } = ctx;
  res.writeHead(200, {
    ...ctx.cors,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  const write = (payload) => {
    if (closed) return false;
    res.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`);
    return true;
  };

  write({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    system_fingerprint: 'fp_mock_gateway',
  });

  for (const chunk of chunkForStreaming(result.content, 10)) {
    if (closed) return;
    write({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
      system_fingerprint: 'fp_mock_gateway',
    });
    await sleep(8);
  }

  write({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: result.finishReason }],
    ...(ctx.body?.stream_options?.include_usage ? { usage: result.usage } : {}),
    system_fingerprint: 'fp_mock_gateway',
  });
  write('[DONE]');
  if (!closed) res.end();
  req.resume();
}

function collectText(messages) {
  return messages
    .map((m) => {
      const c = m?.content;
      if (typeof c === 'string') return c;
      if (Array.isArray(c)) {
        return c.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join(' ');
      }
      return '';
    })
    .join('\n');
}

function numberOrUndefined(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
