import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const API_KEY = 'test-key';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const ISO_BMFF_MAGIC = 'ftyp';

let app;
let base;

function auth(token = API_KEY, extra = {}) {
  return {
    ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    ...extra,
  };
}

function url(path) {
  return `${base}${path}`;
}

async function jsonOf(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`响应不是 JSON (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
}

async function pollUntil(check, predicate, { timeoutMs = 4000, intervalMs = 40 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`轮询超时，最后一次结果: ${JSON.stringify(last)}`);
}

before(async () => {
  const config = loadConfig(
    {},
    {
      host: '127.0.0.1',
      port: 0,
      apiKey: API_KEY,
      latencyChatMs: 0,
      latencyImageMs: 0,
      // 留出足够窗口，让「创建后立即取内容应 409」这一断言不会因机器慢而偶发失败
      latencyVideoReadyMs: 400,
      failRate: 0,
      logLevel: 'quiet',
    },
  );
  app = createApp({ config });
  const info = await app.listen();
  base = info.url;
});

after(async () => {
  await app.close();
});

describe('鉴权与探活', () => {
  test('OPTIONS 已知路径：带令牌 204，无令牌 401', async () => {
    const ok = await fetch(url('/v1/images/generations'), { method: 'OPTIONS', headers: auth() });
    assert.equal(ok.status, 204);
    assert.ok(String(ok.headers.get('allow')).includes('POST'));
    assert.equal(ok.headers.get('access-control-allow-origin'), '*');

    const denied = await fetch(url('/v1/images/generations'), { method: 'OPTIONS' });
    assert.equal(denied.status, 401);
    const body = await jsonOf(denied);
    assert.equal(body.error.type, 'authentication_error');
    assert.equal(body.error.code, 'invalid_api_key');

    const wrong = await fetch(url('/v1/chat/completions'), {
      method: 'OPTIONS',
      headers: auth('wrong-key'),
    });
    assert.equal(wrong.status, 401);
  });

  test('OPTIONS 未知路径返回 404（基址/协议填错要能暴露出来）', async () => {
    const res = await fetch(url('/v1/does-not-exist'), { method: 'OPTIONS', headers: auth() });
    assert.equal(res.status, 404);
  });

  test('受保护路径缺少令牌返回 401', async () => {
    const res = await fetch(url('/v1/models'));
    assert.equal(res.status, 401);
  });
});

describe('模型列表', () => {
  test('GET /v1/models 返回 OpenAI 形状且包含三种模态的模型', async () => {
    const res = await fetch(url('/v1/models'), { headers: auth() });
    assert.equal(res.status, 200);
    const body = await jsonOf(res);
    assert.equal(body.object, 'list');
    const ids = body.data.map((m) => m.id);
    for (const expected of ['gpt-4o', 'gpt-image-2', 'MiniMax-Hailuo-2.3']) {
      assert.ok(ids.includes(expected), `缺少模型 ${expected}`);
    }
    for (const model of body.data) {
      assert.equal(model.object, 'model');
      assert.equal(typeof model.created, 'number');
    }
  });

  test('GET /models 兼容无 /v1 前缀的厂商', async () => {
    const res = await fetch(url('/models'), { headers: auth() });
    assert.equal(res.status, 200);
    assert.ok((await jsonOf(res)).data.length > 0);
  });

  test('GET /v1/models/:id 已知 200、未知 404', async () => {
    const known = await fetch(url('/v1/models/gpt-4o'), { headers: auth() });
    assert.equal(known.status, 200);
    assert.equal((await jsonOf(known)).id, 'gpt-4o');

    const unknown = await fetch(url('/v1/models/no-such-model'), { headers: auth() });
    assert.equal(unknown.status, 404);
  });

  test('自定义模型通过 MOCK_MODELS 追加', async () => {
    const extra = createApp({
      config: loadConfig(
        {},
        { port: 0, apiKey: API_KEY, extraModels: 'my-custom-model,another-model', logLevel: 'quiet' },
      ),
    });
    const info = await extra.listen();
    try {
      const res = await fetch(`${info.url}/v1/models`, { headers: auth() });
      const ids = (await jsonOf(res)).data.map((m) => m.id);
      assert.ok(ids.includes('my-custom-model'));
    } finally {
      await extra.close();
    }
  });
});

describe('文生文（/v1/chat/completions）', () => {
  test('非流式返回标准 chat.completion', async () => {
    const res = await fetch(url('/v1/chat/completions'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: '帮我写一个紫砂壶的商品主图提示词' }],
      }),
    });
    assert.equal(res.status, 200);
    const body = await jsonOf(res);
    assert.match(body.id, /^chatcmpl-[0-9a-f]+$/);
    assert.equal(body.object, 'chat.completion');
    assert.equal(body.model, 'gpt-4o');
    const choice = body.choices[0];
    assert.equal(choice.message.role, 'assistant');
    assert.ok(choice.message.content.length > 20);
    assert.equal(choice.finish_reason, 'stop');
    assert.equal(body.usage.total_tokens, body.usage.prompt_tokens + body.usage.completion_tokens);
  });

  test('流式 SSE：delta 拼回来与非流式一致，并以 [DONE] 收尾', async () => {
    const payload = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Write a prompt for a purple mug on marble' }],
    };
    const nonStream = await jsonOf(
      await fetch(url('/v1/chat/completions'), {
        method: 'POST',
        headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      }),
    );

    const res = await fetch(url('/v1/chat/completions'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ...payload, stream: true, stream_options: { include_usage: true } }),
    });
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get('content-type')), /text\/event-stream/);
    const text = await res.text();
    const events = text
      .split('\n\n')
      .map((block) => block.replace(/^data: /, '').trim())
      .filter(Boolean);
    assert.equal(events.at(-1), '[DONE]');

    const chunks = events.filter((e) => e !== '[DONE]').map((e) => JSON.parse(e));
    assert.ok(chunks.every((c) => c.object === 'chat.completion.chunk'));
    const content = chunks
      .map((c) => c.choices?.[0]?.delta?.content ?? '')
      .join('');
    assert.equal(content, nonStream.choices[0].message.content);
    const finish = chunks.find((c) => c.choices?.[0]?.finish_reason);
    assert.equal(finish.choices[0].finish_reason, 'stop');
    assert.ok(chunks.at(-1).usage, 'stream_options.include_usage 时应带 usage');
  });

  test('messages 缺失返回 400', async () => {
    const res = await fetch(url('/v1/chat/completions'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ model: 'gpt-4o' }),
    });
    assert.equal(res.status, 400);
    const body = await jsonOf(res);
    assert.equal(body.error.type, 'invalid_request_error');
    assert.equal(body.error.param, 'messages');
  });

  test('非法 JSON 返回 400', async () => {
    const res = await fetch(url('/v1/chat/completions'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
      body: '{not json',
    });
    assert.equal(res.status, 400);
    assert.match((await jsonOf(res)).error.message, /JSON/);
  });

  test('GET 方法返回 405 并带 Allow', async () => {
    const res = await fetch(url('/v1/chat/completions'), { headers: auth() });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST');
  });
});

describe('文生图', () => {
  test('OpenAI 协议：url 形态可下载为真实 PNG', async () => {
    const res = await fetch(url('/v1/images/generations'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ model: 'gpt-image-2', prompt: 'a purple mug on white marble', size: '256x144', seed: 11 }),
    });
    assert.equal(res.status, 200);
    const body = await jsonOf(res);
    assert.ok(Array.isArray(body.data) && body.data.length === 1);
    const imageUrl = body.data[0].url;
    assert.match(imageUrl, /^http:\/\/127\.0\.0\.1:\d+\/files\/file_[0-9a-f]+\.png$/);
    assert.match(body.data[0].revised_prompt, /purple mug/);

    const file = await fetch(imageUrl, { headers: auth() });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.ok(bytes.subarray(0, 4).equals(PNG_MAGIC));
  });

  test('OpenAI 协议：b64_json 形态解码后是 PNG', async () => {
    const res = await fetch(url('/v1/images/generations'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: 'a red box',
        size: '128x128',
        response_format: 'b64_json',
      }),
    });
    assert.equal(res.status, 200);
    const body = await jsonOf(res);
    const bytes = Buffer.from(body.data[0].b64_json, 'base64');
    assert.ok(bytes.subarray(0, 4).equals(PNG_MAGIC));
  });

  test('OpenAI 图像编辑：multipart 的 image 参考图返回 url', async () => {
    const form = new FormData();
    form.set('model', 'gpt-image-2');
    form.set('prompt', '把参考图改成紫色马克杯');
    form.set('size', '128x128');
    form.append('image', new Blob([PNG_MAGIC], { type: 'image/png' }), 'reference.png');

    const res = await fetch(url('/v1/images/edits'), { method: 'POST', headers: auth(), body: form });
    assert.equal(res.status, 200);
    const body = await jsonOf(res);
    assert.ok(Array.isArray(body.data) && body.data.length === 1);
    assert.match(body.data[0].url, /^http:\/\/127\.0\.0\.1:\d+\/files\/file_[0-9a-f]+\.png$/);
  });

  test('n=2 返回两张不同地址', async () => {
    const res = await fetch(url('/v1/images/generations'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prompt: 'two variations', size: '128x128', n: 2 }),
    });
    const body = await jsonOf(res);
    assert.equal(body.data.length, 2);
    assert.notEqual(body.data[0].url, body.data[1].url);
    assert.equal(body.usage.generated_images, 2);
  });

  test('缺 prompt 返回 400', async () => {
    const res = await fetch(url('/v1/images/generations'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ model: 'gpt-image-2' }),
    });
    assert.equal(res.status, 400);
    assert.equal((await jsonOf(res)).error.param, 'prompt');
  });

  test('MiniMax 图像协议：aspect_ratio + data.image_urls', async () => {
    const res = await fetch(url('/v1/image_generation'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ model: 'image-01', prompt: 'white sneaker', aspect_ratio: '16:9' }),
    });
    assert.equal(res.status, 200);
    const body = await jsonOf(res);
    assert.equal(body.base_resp.status_code, 0);
    assert.equal(body.data.image_urls.length, 1);
    assert.match(body.data.image_urls[0], /\/files\/file_[0-9a-f]+\.png$/);
    const file = await fetch(body.data.image_urls[0]);
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.ok(bytes.subarray(0, 4).equals(PNG_MAGIC));
  });
});

describe('文生视频', () => {
  test('OpenAI 视频：创建 → 未就绪 409 → 完成 → 下载与 Range', async () => {
    const create = await fetch(url('/v1/videos'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ model: 'sora-2', prompt: 'a purple cube rotating', seconds: 1, size: '320x176' }),
    });
    assert.equal(create.status, 200);
    const job = await jsonOf(create);
    assert.match(job.id, /^video_[0-9a-f]+$/);
    assert.equal(job.object, 'video');
    assert.ok(['queued', 'in_progress'].includes(job.status), `创建后不应已完成: ${job.status}`);

    const early = await fetch(url(`/v1/videos/${job.id}/content`), { headers: auth() });
    assert.equal(early.status, 409);
    assert.equal((await jsonOf(early)).error.code, 'video_not_ready');

    const done = await pollUntil(
      async () => jsonOf(await fetch(url(`/v1/videos/${job.id}`), { headers: auth() })),
      (j) => j.status === 'completed',
    );
    assert.equal(done.progress, 100);
    assert.ok(done.mock_width && done.mock_height);

    const content = await fetch(url(`/v1/videos/${job.id}/content`), { headers: auth() });
    assert.equal(content.status, 200);
    assert.equal(content.headers.get('content-type'), 'video/mp4');
    assert.equal(content.headers.get('accept-ranges'), 'bytes');
    const bytes = Buffer.from(await content.arrayBuffer());
    assert.equal(bytes.subarray(4, 8).toString('ascii'), ISO_BMFF_MAGIC);
    assert.ok(bytes.length > 1000);

    const ranged = await fetch(url(`/v1/videos/${job.id}/content`), {
      headers: auth(API_KEY, { Range: 'bytes=0-3' }),
    });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), `bytes 0-3/${bytes.length}`);
    assert.equal(Buffer.from(await ranged.arrayBuffer()).length, 4);

    const list = await jsonOf(await fetch(url('/v1/videos'), { headers: auth() }));
    assert.ok(list.data.some((item) => item.id === job.id));

    const removed = await jsonOf(await fetch(url(`/v1/videos/${job.id}`), { method: 'DELETE', headers: auth() }));
    assert.equal(removed.deleted, true);
    const gone = await fetch(url(`/v1/videos/${job.id}`), { headers: auth() });
    assert.equal(gone.status, 404);
  });

  test('OpenAI 视频：multipart 提交（input_reference 参考图）', async () => {
    const form = new FormData();
    form.set('model', 'sora-2');
    form.set('prompt', 'a purple cube rotating');
    form.set('seconds', '1');
    form.set('size', '320x176');
    form.set('input_reference', new Blob([PNG_MAGIC], { type: 'image/png' }), 'input-reference.png');

    const create = await fetch(url('/v1/videos'), { method: 'POST', headers: auth(), body: form });
    assert.equal(create.status, 200);
    const job = await jsonOf(create);
    assert.match(job.id, /^video_[0-9a-f]+$/);
    assert.equal(job.model, 'sora-2');
    assert.equal(job.seconds, '1');
    assert.equal(job.size, '320x176');
  });

  test('OpenAI 视频：multipart 缺 boundary 返回 400', async () => {
    const res = await fetch(url('/v1/videos'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'multipart/form-data' }),
      body: '--broken\r\n',
    });
    assert.equal(res.status, 400);
    assert.equal((await jsonOf(res)).error.code, 'invalid_multipart');
  });

  test('MiniMax 视频：task_id → 轮询 Success → 取下载地址 → 下载 mp4', async () => {
    const create = await fetch(url('/v1/video_generation'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ model: 'MiniMax-Hailuo-2.3', prompt: 'a red box on a turntable', duration: 1 }),
    });
    assert.equal(create.status, 200);
    const created = await jsonOf(create);
    assert.match(created.task_id, /^task_[0-9a-f]+$/);
    assert.equal(created.base_resp.status_code, 0);

    const done = await pollUntil(
      async () =>
        jsonOf(await fetch(url(`/v1/query/video_generation?task_id=${created.task_id}`), { headers: auth() })),
      (j) => j.status === 'Success',
    );
    assert.ok(done.file_id, '成功响应应带 file_id');
    assert.ok(done.video_width > 0 && done.video_height > 0);

    const file = await jsonOf(
      await fetch(url(`/v1/files/retrieve?file_id=${done.file_id}`), { headers: auth() }),
    );
    assert.equal(file.base_resp.status_code, 0);
    assert.match(file.file.download_url, new RegExp(`/files/${done.file_id}\\.mp4$`));

    const download = await fetch(file.file.download_url, { headers: auth() });
    assert.equal(download.status, 200);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.subarray(4, 8).toString('ascii'), ISO_BMFF_MAGIC);
  });

  test('MiniMax 视频：未知 task_id 返回 base_resp 2013 而非 HTTP 错误', async () => {
    const res = await fetch(url('/v1/query/video_generation?task_id=task_missing'), { headers: auth() });
    assert.equal(res.status, 200);
    assert.equal((await jsonOf(res)).base_resp.status_code, 2013);
  });

  test('MiniMax 视频：缺 prompt 返回 status_code 1002', async () => {
    const res = await fetch(url('/v1/video_generation'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ model: 'MiniMax-Hailuo-2.3' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await jsonOf(res)).base_resp.status_code, 1002);
  });
});

describe('失败注入', () => {
  test('[[fail]] → 500', async () => {
    const res = await fetch(url('/v1/chat/completions'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ messages: [{ role: 'user', content: 'trigger [[fail]] please' }] }),
    });
    assert.equal(res.status, 500);
    assert.equal((await jsonOf(res)).error.code, 'mock_injected_failure');
  });

  test('[[401]] → 401', async () => {
    const res = await fetch(url('/v1/images/generations'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prompt: 'x [[401]]' }),
    });
    assert.equal(res.status, 401);
  });

  test('[[429]] → 429', async () => {
    const res = await fetch(url('/v1/images/generations'), {
      method: 'POST',
      headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prompt: 'x [[429]]' }),
    });
    assert.equal(res.status, 429);
  });
});

describe('杂项', () => {
  test('/health 与 / 自描述', async () => {
    const health = await jsonOf(await fetch(url('/health')));
    assert.equal(health.status, 'ok');
    assert.equal(typeof health.store.files, 'number');

    const index = await jsonOf(await fetch(url('/')));
    assert.equal(index.name, 'mock-model-gateway');
    assert.ok(index.models.length > 0);
    assert.ok(index.endpoints.text);
  });

  test('未知路径 404、缺文件 404', async () => {
    const res = await fetch(url('/v1/nope'), { headers: auth() });
    assert.equal(res.status, 404);

    const file = await fetch(url('/files/file_deadbeef.png'));
    assert.equal(file.status, 404);
  });

  test('HEAD 请求返回头但不带正文', async () => {
    const created = await jsonOf(
      await fetch(url('/v1/images/generations'), {
        method: 'POST',
        headers: auth(API_KEY, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prompt: 'head request', size: '64x64' }),
      }),
    );
    const res = await fetch(created.data[0].url, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal((await res.arrayBuffer()).byteLength, 0);
  });
});
