#!/usr/bin/env node
/**
 * 仿真模型网关冒烟脚本。
 *
 *   node scripts/smoke.js                       # 打已启动的 http://127.0.0.1:3900
 *   MOCK_BASE=http://127.0.0.1:3901 node scripts/smoke.js
 *   MOCK_API_KEY=xxx node scripts/smoke.js      # 网关启用了令牌时
 *   node scripts/smoke.js --spawn               # 自己起一个临时实例（随机端口）
 *
 * 覆盖：模型列表 / 文生文（含流式）/ 文生图（url + 下载）/ 两套视频协议
 *       （OpenAI 任务制 + MiniMax 四段式）/ 失败注入 / 鉴权。
 * 全部通过 exit 0，任一失败 exit 1。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = new Set(process.argv.slice(2));
const spawnOwn = argv.has('--spawn');
const API_KEY = process.env.MOCK_API_KEY ?? '';
let base = (process.env.MOCK_BASE ?? 'http://127.0.0.1:3900').replace(/\/+$/, '');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

let passed = 0;
const failures = [];

function ok(name, extra = '') {
  passed += 1;
  console.log(`[ok]   ${name}${extra ? ` — ${extra}` : ''}`);
}

function fail(name, reason) {
  failures.push({ name, reason });
  console.log(`[FAIL] ${name} — ${reason}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    ok(name, typeof detail === 'string' ? detail : '');
  } catch (e) {
    fail(name, e?.message ?? String(e));
  }
}

function headers(extra = {}) {
  return {
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    ...extra,
  };
}

async function request(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: headers(init.headers),
  });
  return res;
}

async function json(path, init) {
  const res = await request(path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

function postJson(path, body) {
  return json(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function poll(fn, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} 轮询超时，最后状态: ${JSON.stringify(last)}`);
}

async function fetchMagic(url) {
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`下载 ${url} → HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, res };
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  let owned = null;
  if (spawnOwn) {
    const { createApp } = await import('../src/app.js');
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig(
      {},
      { port: 0, latencyChatMs: 0, latencyImageMs: 0, latencyVideoReadyMs: 300, logLevel: 'quiet' },
    );
    owned = createApp({ config });
    const info = await owned.listen();
    base = info.url;
    console.log(`自己启动临时实例: ${base}\n`);
  }

  console.log(`目标网关: ${base}\n`);

  try {
    await check('健康检查', async () => {
      const body = await json('/health');
      assert(body.status === 'ok', `status=${body.status}`);
      return `文件 ${body.store.files} 个`;
    });

    await check('模型列表', async () => {
      const body = await json('/v1/models');
      const ids = body.data.map((m) => m.id);
      for (const id of ['gpt-4o', 'gpt-image-2', 'MiniMax-Hailuo-2.3']) {
        assert(ids.includes(id), `缺少模型 ${id}`);
      }
      return `${ids.length} 个`;
    });

    await check('文生文', async () => {
      const body = await postJson('/v1/chat/completions', {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: '帮我写一条紫砂壶的商品主图提示词' }],
      });
      assert(body.choices?.[0]?.message?.content?.length > 20, '返回内容为空');
      return `${body.usage.total_tokens} tokens`;
    });

    await check('文生文（流式）', async () => {
      const res = await request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'write a short prompt' }],
          stream: true,
        }),
      });
      assert(res.ok, `HTTP ${res.status}`);
      const text = await res.text();
      const events = text.split('\n\n').map((b) => b.replace(/^data: /, '').trim()).filter(Boolean);
      assert(events.at(-1) === '[DONE]', '未以 [DONE] 收尾');
      return `${events.length - 1} 个 chunk`;
    });

    await check('文生图（OpenAI，url 形态）', async () => {
      const body = await postJson('/v1/images/generations', {
        model: 'gpt-image-2',
        prompt: 'a purple product hero on white marble',
        size: '512x288',
      });
      const url = body.data?.[0]?.url;
      assert(url, '没有返回 url');
      const { bytes } = await fetchMagic(url);
      assert(bytes.subarray(0, 4).equals(PNG_MAGIC), '下载内容不是 PNG');
      return `${bytes.length} bytes`;
    });

    await check('文生图（MiniMax，aspect_ratio）', async () => {
      const body = await postJson('/v1/image_generation', {
        model: 'image-01',
        prompt: 'a white sneaker on a pedestal',
        aspect_ratio: '16:9',
      });
      const url = body.data?.image_urls?.[0];
      assert(url, '没有返回 image_urls');
      const { bytes } = await fetchMagic(url);
      assert(bytes.subarray(0, 4).equals(PNG_MAGIC), '下载内容不是 PNG');
      return `${bytes.length} bytes`;
    });

    await check('文生视频（OpenAI 任务制）', async () => {
      const created = await postJson('/v1/videos', {
        model: 'sora-2',
        prompt: 'a purple cube rotating slowly',
        seconds: 1,
      });
      assert(created.id, '创建未返回 id');
      const done = await poll(
        () => json(`/v1/videos/${created.id}`),
        (job) => job.status === 'completed',
        '视频任务',
      );
      assert(done.progress === 100, `progress=${done.progress}`);
      const res = await request(`/v1/videos/${created.id}/content`);
      assert(res.ok, `取视频 HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert(bytes.subarray(4, 8).toString('ascii') === 'ftyp', '不是 MP4');
      return `${bytes.length} bytes · ${done.mock_width}x${done.mock_height}`;
    });

    await check('文生视频（MiniMax 四段式）', async () => {
      const created = await postJson('/v1/video_generation', {
        model: 'MiniMax-Hailuo-2.3',
        prompt: 'a red gift box on a turntable',
        duration: 1,
        resolution: '720P',
      });
      assert(created.task_id, '创建未返回 task_id');
      const done = await poll(
        () => json(`/v1/query/video_generation?task_id=${created.task_id}`),
        (task) => task.status === 'Success',
        '视频任务',
      );
      const file = await json(`/v1/files/retrieve?file_id=${done.file_id}`);
      assert(file.file?.download_url, '没有 download_url');
      const { bytes } = await fetchMagic(file.file.download_url);
      assert(bytes.subarray(4, 8).toString('ascii') === 'ftyp', '不是 MP4');
      return `${bytes.length} bytes · ${done.video_width}x${done.video_height}`;
    });

    await check('失败注入 [[fail]] → 500', async () => {
      const res = await request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'x [[fail]]' }] }),
      });
      assert(res.status === 500, `HTTP ${res.status}`);
      const body = await res.json();
      assert(body.error?.code === 'mock_injected_failure', '错误码不符');
      return 'HTTP 500';
    });

    if (API_KEY) {
      await check('鉴权：错误令牌 → 401', async () => {
        const res = await fetch(`${base}/v1/models`, { headers: { Authorization: 'Bearer wrong' } });
        assert(res.status === 401, `HTTP ${res.status}`);
        return 'HTTP 401';
      });
    }

    if (process.env.MOCK_VERIFY_VIDEO === '1') {
      await check('视频可被 ffmpeg 解码', async () => {
        const created = await postJson('/v1/videos', { prompt: 'decode check', seconds: 1 });
        const done = await poll(() => json(`/v1/videos/${created.id}`), (j) => j.status === 'completed', '视频任务');
        const { bytes } = await fetchMagic(`${base}/v1/videos/${created.id}/content`);
        void done;
        const dir = mkdtempSync(join(tmpdir(), 'mock-gw-'));
        const file = join(dir, 'smoke.mp4');
        try {
          writeFileSync(file, bytes);
          const result = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], {
            encoding: 'utf8',
            timeout: 30_000,
          });
          if (result.error?.code === 'ENOENT') return '跳过（未安装 ffmpeg）';
          assert(result.status === 0, result.stderr || `exit ${result.status}`);
          assert(!String(result.stderr).trim(), result.stderr);
          return 'ffmpeg 解码通过';
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    }
  } finally {
    if (owned) await owned.close();
  }

  console.log('');
  if (failures.length) {
    console.log(`结果: ${passed} 通过 / ${failures.length} 失败`);
    for (const f of failures) console.log(`  - ${f.name}: ${f.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`结果: ${passed} 项全部通过`);
}

main().catch((e) => {
  console.error('冒烟脚本异常:', e);
  process.exitCode = 1;
});
