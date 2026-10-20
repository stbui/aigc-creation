/**
 * 视频通道断言 (2026-10-20)。
 *
 * ## 为什么必须专门写
 *
 * 视频是本项目**第一个真正跑通的非图像模态**, 涉及四段式异步契约
 * (提交 → 轮询 → 取文件 → 下载) 与两处存储层改动 (Asset.durationMs /
 * ModelCallLog.modality)。这些**类型系统完全看不出来**:
 *
 *   - 协议层把 status 判成 'success' 但实际是 'Success' → 永远轮询到超时
 *   - 少取 file_id 那一跳 → 拿不到下载地址
 *   - 视频走 Jimp.read → 任务永远失败
 *   - 扩展名仍存 .jpg → 浏览器按图片解码视频, 播放失败
 *
 * 故用桩服务 (stub) 跑真实的 HTTP 往返, 逐段验证。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { MinimaxVideoProvider } from '../src/providers/minimax-video.provider';
import { videoProtocolSpec } from '../src/providers/protocols/protocol.spec';
import { sniffVideoFormat } from '../src/providers/video-format';
import { VENDOR_CATALOG } from '../src/providers/vendors/vendor.catalog';
import { CAPABILITIES } from '../src/capabilities/capability.registry';
import { collectCatalogIssues } from '../src/providers/vendors/vendor.integrity';

let pass = 0;
const fails: string[] = [];
const ok = (n: string, c: boolean, d?: unknown) => {
  if (c) pass += 1;
  else fails.push(`${n}${d !== undefined ? ` — ${JSON.stringify(d)}` : ''}`);
};
const eq = (n: string, a: unknown, e: unknown) => ok(n, Object.is(a, e), a);

// ── 1. 协议层: 端点与状态归一 ─────────────────────────────────────
{
  const spec = videoProtocolSpec('minimax-video');
  ok('minimax-video 协议已声明', !!spec);
  if (spec) {
    eq('提交端点', spec.submitEndpoint('https://api.minimax.io'), 'https://api.minimax.io/v1/video_generation');
    eq(
      '轮询端点 (query 参数形式)',
      spec.pollEndpoint('https://api.minimax.io', 'TASK123'),
      'https://api.minimax.io/v1/query/video_generation?task_id=TASK123',
    );
    eq(
      '取文件端点',
      spec.fileEndpoint!('https://api.minimax.io', 'F1'),
      'https://api.minimax.io/v1/files/retrieve?file_id=F1',
    );
    // ⚠️ MiniMax v1 状态**首字母大写** —— 归一必须大小写无关
    eq('状态 Success → success', spec.classifyStatus('Success'), 'success');
    eq('状态 Fail → failed', spec.classifyStatus('Fail'), 'failed');
    eq('状态 Processing → pending', spec.classifyStatus('Processing'), 'pending');
    eq('状态 Queueing → pending', spec.classifyStatus('Queueing'), 'pending');
    eq('状态 Preparing → pending', spec.classifyStatus('Preparing'), 'pending');
    // 兼容 v2 风格
    eq('状态 succeeded → success', spec.classifyStatus('succeeded'), 'success');
    eq('状态 failed → failed', spec.classifyStatus('failed'), 'failed');
    eq('无状态 → pending', spec.classifyStatus(undefined), 'pending');

    // 错误提取: MiniMax 失败也返回 HTTP 200, 错误在 base_resp
    eq(
      'base_resp 错误被提取',
      spec.extractError({ base_resp: { status_code: 1004, status_msg: 'bad token' } }),
      'status 1004: bad token',
    );
    eq('无错误返回 null', spec.extractError({ status: 'Success' }), null);
  }
}

// ── 2. 厂商目录: minimax 有视频通道 ──────────────────────────────
{
  const mm = VENDOR_CATALOG.find((v) => v.key === 'minimax');
  ok('minimax 在目录中', !!mm);
  const vch = mm?.channels.find((c) => c.modality === 'video');
  ok('minimax 有视频通道', !!vch);
  eq('视频通道协议', vch?.protocol, 'minimax-video');
  ok('视频通道有模型清单', (vch?.models.length ?? 0) > 0);
  // 图与视频共用基址与令牌 —— 厂商聚合的核心收益
  const ich = mm?.channels.find((c) => c.modality === 'image');
  eq('图与视频同基址', vch && ich ? vch.baseUrl ?? mm!.baseUrl : '', ich?.baseUrl ?? mm?.baseUrl);
  eq('厂商目录完整性', collectCatalogIssues().length, 0);
}

// ── 3. 能力层: 视频能力无 localImpl ─────────────────────────────
{
  const v = CAPABILITIES.find((c) => c.modality === 'video');
  ok('有视频能力', !!v);
  eq('视频能力 id', v?.id, 'image_to_video');
  eq('视频能力无本地兜底', v?.localImpl, undefined);
  ok('视频能力有积分价', typeof v?.creditCost === 'number');
}

// ── 4. 格式魔数: 视频不能按 URL 后缀猜 ───────────────────────────
{
  // 最小 mp4 头: 偏移 4 处是 'ftyp'
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(20)]);
  eq('mp4 魔数判定', sniffVideoFormat(mp4), 'video/mp4');
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(20)]);
  eq('webm 魔数判定', sniffVideoFormat(webm), 'video/webm');
  const avi = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI '), Buffer.alloc(20)]);
  eq('avi 魔数判定', sniffVideoFormat(avi), 'video/x-msvideo');
}

// ── 5. 端到端: 桩服务跑真实的四段式 ───────────────────────────────
//
// 用本地 HTTP 桩模拟 MiniMax, 验证 provider 真的按四段走完 ——
// 这是唯一能证明「少取一跳就拿不到字节」这类缺陷被挡住的方式。
async function e2e(): Promise<void> {
  const calls: string[] = [];
  let pollCount = 0;
  // 一段最小的 mp4 字节 (含 ftyp box)
  const videoBytes = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypisom'),
    Buffer.from('mock-video-payload'),
  ]);

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';
    calls.push(`${req.method} ${url}`);
    const send = (obj: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'POST' && url.endsWith('/v1/video_generation')) {
      send({ task_id: 'TASK-1', base_resp: { status_code: 0, status_msg: 'success' } });
      return;
    }
    if (req.method === 'GET' && url.includes('/v1/query/video_generation')) {
      pollCount += 1;
      // 前两次还在处理中, 第三次成功 —— 验证轮询真的会等
      if (pollCount < 3) {
        send({ task_id: 'TASK-1', status: 'Processing', base_resp: { status_code: 0, status_msg: 'success' } });
      } else {
        send({
          task_id: 'TASK-1',
          status: 'Success',
          file_id: 'FILE-1',
          video_width: 1920,
          video_height: 1080,
          base_resp: { status_code: 0, status_msg: 'success' },
        });
      }
      return;
    }
    if (req.method === 'GET' && url.includes('/v1/files/retrieve')) {
      send({
        file: { download_url: `http://127.0.0.1:${port}/download/video.mp4?sig=abc` },
        base_resp: { status_code: 0, status_msg: 'success' },
      });
      return;
    }
    if (req.method === 'GET' && url.startsWith('/download/')) {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(videoBytes);
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // 配置注入: gateway.config 走 3s 缓存 + env/DB 覆盖
  const { setGatewayConfigOverrides, invalidateGatewayConfigCache } = await import(
    '../src/providers/gateway.config'
  );
  setGatewayConfigOverrides({
    'gateway.video.baseUrl': baseUrl,
    'gateway.video.token': 'test-token',
    'gateway.video.enabled': 'true',
    'gateway.video.provider': 'minimax-video',
    'gateway.video.model': 'MiniMax-Hailuo-2.3',
    'gateway.video.pollMs': '10',
    'gateway.video.maxPolls': '10',
    'gateway.video.timeoutMs': '15000',
  });
  invalidateGatewayConfigCache();

  try {
    const provider = new MinimaxVideoProvider();
    const r = await provider.generate('image_to_video', ['/tmp/nonexistent.png'], {
      prompt: '人物转头微笑',
      duration: '6',
      resolution: '1080P',
    });
    ok('e2e: 产出有字节', r.buffer.length > 0, r.buffer.length);
    eq('e2e: 判别式为 video', r.kind, 'video');
    eq('e2e: 格式判定为 mp4', r.format, 'video/mp4');
    eq('e2e: 来源为 gateway', r.source, 'gateway');
    eq('e2e: 任务 id 回传', r.taskId, 'TASK-1');
    eq('e2e: 时长换算为毫秒', r.durationMs, 6000);

    // 四段都走到了
    ok('e2e: 调用了提交端点', calls.some((c) => c.includes('/v1/video_generation')));
    ok('e2e: 调用了轮询端点', calls.some((c) => c.includes('/v1/query/video_generation')));
    ok('e2e: 调用了取文件端点', calls.some((c) => c.includes('/v1/files/retrieve')));
    ok('e2e: 调用了下载端点', calls.some((c) => c.startsWith('GET /download/')));
    ok('e2e: 轮询了多次才成功', pollCount >= 3, pollCount);
  } catch (e) {
    fails.push(`e2e 视频生成失败 — ${(e as Error).message}`);
  } finally {
    server.close();
  }
}

async function main() {
  await e2e();
  console.log(`\n通过 ${pass} 项`);
  if (fails.length) {
    console.error(`\n失败 ${fails.length} 项:`);
    for (const f of fails) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log('视频通道断言全部通过（四段式契约跑通、状态归一、格式魔数、厂商与能力注册）');
}

void main();
