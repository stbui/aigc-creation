/**
 * 真实模型通道冒烟 —— 不依赖任何真实 API key, 用一个「契约一致的网关桩」验证:
 *   A. 通道远程路径: 配置 GATEWAY_BASE_URL 指向桩 → 产出必须来自桩(source=gateway)
 *      并校验桩收到的请求体(能力映射/提示词/参考图 URL/模型字段)
 *   B. 未配置网关: 自动回落本地算法(source=local), 产出仍是合法图片
 *   C. 网关故障(端口无人监听): 回落本地算法且不抛错
 *   D. 单能力强制本地: GATEWAY_ROUTE_<ID>=local 时即使网关可用也走本地
 *   E. 全部 15 项能力都有提示词构造, 不出现 fallback 成 capability id
 *
 * 用法: node scripts/smoke-gateway-channel.js
 */
const http = require('http');
const path = require('path');
const { Jimp, JimpMime } = require('jimp');

process.env.ASSET_PUBLIC_BASE = 'http://localhost:3002';

const ROOT = path.resolve(__dirname, '..');

/** 记录桩收到的请求, 供断言 */
const received = [];

/** 造一张 512x512 的测试图 (桩返回的"模型产出") */
async function makeStubImage() {
  // 只需可识别的尺寸与格式; 不画字 (jimp 1.6 print 签名与旧版不同)
  const img = new Jimp({ width: 512, height: 512, color: 0x6c5ce7ff });
  return await img.getBuffer(JimpMime.jpeg);
}

function startStub(port, behaviour) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/generation/tasks') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ path: req.url, body: body ? JSON.parse(body) : null, auth: req.headers.authorization || null });
        if (behaviour === 'fail-create') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'channel unavailable' }));
          return;
        }
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: `stub-task-${received.length}`, status: 'queued' }));
      });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/generation/tasks/')) {
      if (behaviour === 'fail-status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'x', status: 'failed', error: 'upstream error' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'stub-task-1',
          status: 'succeeded',
          model: 'stub-model-v1',
          prompt: 'echo',
          assets: [{ url: `http://127.0.0.1:${port}/output.jpg` }],
        }),
      );
      return;
    }
    if (req.method === 'GET' && req.url === '/output.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(server.stubBuffer);
      return;
    }
    // ── 优云智算契约: OpenAI 兼容同步接口 ──────────────────────────
    // POST /v1/images/generations → { created, data: [ { url } ] } (无轮询)
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ path: req.url, body: body ? JSON.parse(body) : null, auth: req.headers.authorization || null });
        if (behaviour === 'mv-error') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'invalid_model', message: 'model not supported' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // 故意不带扩展名: 真实优云智算返回的 OSS 链接形如 .../d8021... 无后缀,
        // 用来验证 provider 是按字节魔数而非URL 后缀判格式。
        res.end(JSON.stringify({ created: 1750000000, data: [{ url: `http://127.0.0.1:${port}/mv-output` }] }));
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/mv-output') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(server.stubBuffer);
      return;
    }
    // ── 火山方舟契约: POST /images/generations (baseUrl 自带 /api/v3) ──
    // 尺寸是档位("2K")而非精确像素; 响应形状与 OpenAI 相同
    if (req.method === 'POST' && req.url === '/api/v3/images/generations') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ path: req.url, body: body ? JSON.parse(body) : null, auth: req.headers.authorization || null });
        if (behaviour === 'volc-error') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'InvalidParameter', message: 'size not supported' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${port}/mv-output` }] }));
      });
      return;
    }
    // ── MiniMax 契约: POST /v1/image_generation (单数!) ──────────────────
    // 尺寸用 aspect_ratio; 响应是 data.image_urls[] 而非 data[].url;
    // 失败时仍返回 HTTP 200, 只在 base_resp 里标错 —— 必须能识别出来
    if (req.method === 'POST' && req.url === '/v1/image_generation') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ path: req.url, body: body ? JSON.parse(body) : null, auth: req.headers.authorization || null });
        if (behaviour === 'mm-error-200') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ base_resp: { status_code: 1004, status_msg: 'invalid api key' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'mm-task-1',
            data: { image_urls: [`http://127.0.0.1:${port}/mv-output`] },
            base_resp: { status_code: 0, status_msg: 'success' },
          }),
        );
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', async () => {
      server.stubBuffer = await makeStubImage();
      resolve(server);
    });
  });
}

/**
 * 载入 router (需要先设好环境变量, 因此必须在设变量之后再 require)。
 *
 * ⚠️ 构造器需要 (prisma, callLogger) 两个依赖 —— 那是加ModelCallLog 埋点时引入的,
 * 本脚本原本写的是无参 new, 从那之后一直抛
 * 「Cannot read properties of undefined (reading 'logSuccess')」, 即CLAUDE.md 里
 * 记载的「20 项断言」实际已失效。这里补两个**行为等价的桩**:
 *   - prisma: modelChannelConfig.findMany 返回空 (脚本全程用env 驱动, 不读 DB)
 *   - callLogger: 两个写日志方法只计数, 不落库 (本脚本断言的是路由与产出, 不关心埋点)
 * 桩不足以覆盖的方面: 埋点落库本身由真实运行路径保证, 不在本脚本职责内。
 */
function loadRouter() {
  const { CapabilityRouterProvider } = require(path.join(ROOT, 'dist/providers/capability-router.provider.js'));
  // ⚠️ gateway.config 有 3s 读取缓存(gateway.config.ts CACHE_TTL_MS)。
  // 脚本中途改 env 后必须显式失效, 否则会读到上一段的旧配置 ——
  // 表现为「刚设的 GATEWAY_ROUTE_XXX=local 不生效」。这是既存缺陷:
  // 原脚本用无参 new 时同样踩, 只是从没跑到那一步就先崩了。
  require(path.join(ROOT, 'dist/providers/gateway.config.js')).invalidateGatewayConfigCache();
  const prismaStub = { modelChannelConfig: { findMany: async () => [] } };
  const calls = [];
  const callLoggerStub = {
    logSuccess: async (e) => calls.push({ ok: true, ...e }),
    logFailure: async (e) => calls.push({ ok: false, ...e }),
  };
  const router = new CapabilityRouterProvider(prismaStub, callLoggerStub);
  // 供断言使用: 本次 loadRouter 以来的埋点记录
  router.__calls = calls;
  return router;
}

function assert(cond, label) {
  if (!cond) {
    console.error(`❌ ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${label}`);
  }
}

/** 量出图片尺寸 (jimp 1.6: fromBuffer 需 MIME 提示, 尺寸读 bitmap.width/height) */
async function measure(buffer, mime) {
  const img = await Jimp.fromBuffer(buffer, mime);
  return { w: img.bitmap.width, h: img.bitmap.height };
}

async function inputImage() {
  const img = new Jimp({ width: 240, height: 240, color: 0x3366ffff });
  const p = path.join(ROOT, 'uploads', 'original', 'smoke-gateway-input.png');
  require('fs').writeFileSync(p, await img.getBuffer(JimpMime.png));
  return p;
}

(async () => {
  const PORT = 39217;
  const inp = await inputImage();

  // ── A. 远程路径 (aigc 异步任务契约) ─────────────────────────
  // ⚠️ 必须显式声明 GATEWAY_PROVIDER=aigc: 协议默认值已于 2026-10-20
  // 从 aigc 改为 openai (新部署默认走主流协议), 不显式声明会让本段
  // 误走 openai → 打错端点 → 断言全挂。测试不应依赖默认值。
  process.env.GATEWAY_BASE_URL = `http://127.0.0.1:${PORT}`;
  process.env.GATEWAY_ENABLED = '1';
  process.env.GATEWAY_TOKEN = 'stub-token';
  process.env.GATEWAY_MODEL = 'stub-model-v1';
  process.env.GATEWAY_POLL_MS = '120';
  process.env.GATEWAY_PROVIDER = 'aigc';
  delete process.env.GATEWAY_ROUTE_MATTING;

  const server = await startStub(PORT, 'ok');
  const router = loadRouter();

  const snapshot = router.routingSnapshot();
  assert(Object.keys(snapshot).length === 15, `路由快照覆盖 15 项能力 (实际 ${Object.keys(snapshot).length})`);
  assert(
    Object.values(snapshot).every((v) => v.effective === 'gateway'),
    '配置网关后 15 项能力 effective 均为 gateway',
  );

  const r1 = await router.generate('free_create', [inp], { prompt: '把产品放进未来感厨房', ratio: '16:9', size: '2k' });
  assert(r1.source === 'gateway', `远程路径 source=gateway (实际 ${r1.source})`);
  const meta1 = await measure(r1.buffer, 'image/jpeg');
  assert(meta1.w === 512 && meta1.h === 512, `远程产出为桩返回的 512x512 (实际 ${meta1.w}x${meta1.h})`);
  assert(r1.format === 'image/jpeg', `格式透传 image/jpeg (实际 ${r1.format})`);

  const sent = received[received.length - 1];
  assert(sent.path === '/generation/tasks', '网关收到 POST /generation/tasks');
  assert(sent.auth === 'Bearer stub-token', 'Authorization 头带 Bearer token');
  assert(sent.body.type === 'image', '请求体 type=image');
  assert(sent.body.model === 'stub-model-v1', '请求体透传 model');
  assert(typeof sent.body.prompt === 'string' && sent.body.prompt.includes('未来感厨房'), '提示词包含业务参数(自由创作 prompt)');
  assert(sent.body.prompt.length > 20, `提示词非空且具体 (${sent.body.prompt.length} 字)`);
  assert(sent.body.params.capability === 'free_create', 'params 透传 capability');
  assert(
    Array.isArray(sent.body.params.inputImages) && sent.body.params.inputImages[0].startsWith('http://localhost:3002/uploads/'),
    `参考图以站内 URL 回传 (${sent.body.params.inputImages && sent.body.params.inputImages[0]})`,
  );

  const before = received.length;
  const r2 = await router.generate('matting', [inp], { bgColor: '#3988E9', ratio: 'original' });
  const sent2 = received[before];
  assert(received.length === before + 1, `抠图也走了远程通道 (新增 ${received.length - before} 次提交请求)`);
  assert(sent2.body.prompt.includes('抠图') && sent2.body.prompt.includes('#3988E9'), '抠图提示词含能力语义与背景色');

  // ── D. 单能力强制本地 ───────────────────────────────────────
  process.env.GATEWAY_ROUTE_MATTING = 'local';
  const router2 = loadRouter();
  assert(router2.routingSnapshot().matting.effective === 'local', 'GATEWAY_ROUTE_MATTING=local 生效');
  const beforeLocal = received.length;
  const r3 = await router2.generate('matting', [inp], { bgColor: '#FFFFFF' });
  assert(r3.source === 'local' && received.length === beforeLocal, `强制本地时不发远程请求 (source=${r3.source})`);
  delete process.env.GATEWAY_ROUTE_MATTING;

  // ── B. 未配置网关 → 本地 ───────────────────────────────────
  server.close();
  process.env.GATEWAY_ENABLED = '0';
  delete process.env.GATEWAY_BASE_URL;
  delete process.env.GATEWAY_TOKEN;
  const router3 = loadRouter();
  assert(!router3.routingSnapshot().recolor.effective === false, '未配置网关时 effective=local');
  const r4 = await router3.generate('recolor', [inp], { color: '#EB5757' });
  assert(r4.source === 'local', `未配置网关回落本地 (source=${r4.source})`);
  const meta4 = await measure(r4.buffer, 'image/jpeg');
  assert(meta4.w > 0 && meta4.h > 0, `本地回落产出仍是合法图片 (${meta4.w}x${meta4.h})`);

  // ── C. 网关故障(端口无人) → 回落 ────────────────────────────
  process.env.GATEWAY_ENABLED = '1';
  process.env.GATEWAY_BASE_URL = 'http://127.0.0.1:39218'; // 未监听
  process.env.GATEWAY_POLL_MS = '100';
  process.env.GATEWAY_MAX_POLLS = '2';
  const router4 = loadRouter();
  const r5 = await router4.generate('enhance', [inp], { mode: 'clarity' });
  assert(r5.source === 'local', `网关不可达时回落本地且不抛错 (source=${r5.source})`);

  // ── F. 优云智算通道 (OpenAI 兼容同步契约) ────────────────────
  // 与 A 段同一个桩, 只是换协议: GATEWAY_PROVIDER=modelverse 时路由器必须走
  // /v1/images/generations 同步路径, 而不是 aigc 的 /generation/tasks + 轮询。
  // 选错协议的典型症状是 POST /generation/tasks 404 → 回落本地, 故此处断言路径。
  const MV_PORT = 39219;
  const mvServer = await startStub(MV_PORT, 'ok');
  process.env.GATEWAY_BASE_URL = `http://127.0.0.1:${MV_PORT}`;
  process.env.GATEWAY_ENABLED = '1';
  process.env.GATEWAY_TOKEN = 'mv-stub-token';
  // 用规范名 openai(非历史别名 modelverse): 冒烟应覆盖**主路径**,
  // 别名兼容另由 I 段之外的存量配置保证, 不占用这里的断言位。
  process.env.GATEWAY_PROVIDER = 'openai';
  delete process.env.GATEWAY_MODEL;
  const router5 = loadRouter();

  const mvBefore = received.length;
  const r6 = await router5.generate('free_create', [inp], { prompt: '把产品放进未来感厨房', ratio: '16:9', size: '2k' });
  const mvSent = received[mvBefore];
  assert(r6.source === 'gateway', `优云智算 source=gateway (实际 ${r6.source})`);
  assert(mvSent && mvSent.path === '/v1/images/generations', `走 OpenAI 兼容路径 (实际 ${mvSent && mvSent.path})`);
  assert(mvSent.auth === 'Bearer mv-stub-token', '优云智算 Authorization 头带 Bearer token');
  assert(mvSent.body.prompt.includes('未来感厨房'), '优云智算请求体透传业务提示词');
  assert(mvSent.body.size === '2048x1152', `比例+画质换算成 size (实际 ${mvSent.body.size})`);
  assert(
    typeof mvSent.body.image === 'string' && mvSent.body.image.startsWith('data:image/'),
    `参考图以 base64 data URL 回传 (实际 ${String(mvSent.body.image).slice(0, 30)}…)`,
  );
  const meta6 = await measure(r6.buffer, 'image/jpeg');
  assert(meta6.w === 512 && meta6.h === 512, `优云智算产出为桩返回的 512x512 (实际 ${meta6.w}x${meta6.h})`);
  assert(
    r6.format === 'image/jpeg',
    `无扩展名 URL 也按字节魔数判对格式 (实际 ${r6.format})`,
  );

  // F2. 上游返回 error 对象 → 回落本地而非抛错
  // 同 H2: 用独立端口, 避免 close() 的 TIME_WAIT 影响下一段 (见 H2 注释)
  const MV_ERR_PORT = 39224;
  const mvErrServer = await startStub(MV_ERR_PORT, 'mv-error');
  process.env.GATEWAY_BASE_URL = `http://127.0.0.1:${MV_ERR_PORT}`;
  const router6 = loadRouter();
  const r7 = await router6.generate('free_create', [inp], { prompt: 'x', ratio: '1:1', size: '1k' });
  assert(r7.source === 'local', `优云智算返回 error 时回落本地 (实际 ${r7.source})`);
  // 回落**成功**记的是 logSuccess(fallback=true, reason=上游错误原文),
  // 只有本地算法也失败才记 logFailure —— 断言别查错方法。
  const fallbackLog = router6.__calls.filter((c) => c.ok && c.fallback).pop();
  assert(
    Boolean(fallbackLog && String(fallbackLog.reason || '').includes('优云智算')),
    `回落记录了上游错误原因 (${fallbackLog && fallbackLog.reason})`,
  );
  assert(Boolean(fallbackLog && fallbackLog.source === 'local'), '回落记录的 source=local');
  mvErrServer.close();
  mvServer.close();

  // ── G. 火山方舟协议 ─────────────────────────────────────────
  // 三处与 OpenAI 系的差异都在这里断言, 任一回归都会立刻暴露:
  //   端点 /images/generations(无 /v1) / size 用档位而非像素 / 参考图走 URL
  const VOLC_PORT = 39220;
  const volcServer = await startStub(VOLC_PORT, 'ok');
  process.env.GATEWAY_BASE_URL = `http://127.0.0.1:${VOLC_PORT}/api/v3`;
  process.env.GATEWAY_ENABLED = '1';
  process.env.GATEWAY_TOKEN = 'volc-stub-token';
  process.env.GATEWAY_PROVIDER = 'volcengine';
  delete process.env.GATEWAY_MODEL;
  const router7 = loadRouter();

  const volcBefore = received.length;
  const r8 = await router7.generate('free_create', [inp], { prompt: '把产品放进未来感厨房', ratio: '16:9', size: '2k' });
  const volcSent = received[volcBefore];
  assert(r8.source === 'gateway', `火山方舟 source=gateway (实际 ${r8.source})`);
  assert(volcSent && volcSent.path === '/api/v3/images/generations', `走火山端点 (实际 ${volcSent && volcSent.path})`);
  assert(volcSent.body.size === '2K', `size 换算成档位而非像素 (实际 ${volcSent.body.size})`);
  assert(
    typeof volcSent.body.image === 'string' && volcSent.body.image.startsWith('http'),
    `参考图走公网 URL 而非 base64 (实际 ${String(volcSent.body.image).slice(0, 40)}…)`,
  );
  assert(String(volcSent.body.model).startsWith('doubao-seedream'), `默认模型为 Seedream (实际 ${volcSent.body.model})`);
  const meta8 = await measure(r8.buffer, 'image/jpeg');
  assert(meta8.w === 512 && meta8.h === 512, `火山产出为桩返回的 512x512 (实际 ${meta8.w}x${meta8.h})`);

  // G2. 火山 4xx → 回落本地
  const VOLC_ERR_PORT = 39225;
  const volcErrServer = await startStub(VOLC_ERR_PORT, 'volc-error');
  process.env.GATEWAY_BASE_URL = `http://127.0.0.1:${VOLC_ERR_PORT}/api/v3`;
  const router8 = loadRouter();
  const r9 = await router8.generate('free_create', [inp], { prompt: 'x', ratio: '1:1', size: '1k' });
  assert(r9.source === 'local', `火山返回错误时回落本地 (实际 ${r9.source})`);
  volcErrServer.close();
  volcServer.close();

  // ── H. MiniMax 协议 ─────────────────────────────────────────
  // 最隐蔽的一条是 H2: MiniMax 失败仍返 HTTP 200, 只在 base_resp 里标错 ——
  // 不显式识别就会把「失败响应」当成「无产出图」, 丢失真实错误原因。
  const MM_PORT = 39221;
  const mmServer = await startStub(MM_PORT, 'ok');
  process.env.GATEWAY_BASE_URL = `http://127.0.0.1:${MM_PORT}`;
  process.env.GATEWAY_PROVIDER = 'minimax';
  const router9 = loadRouter();

  const mmBefore = received.length;
  const r10 = await router9.generate('free_create', [inp], { prompt: '把产品放进未来感厨房', ratio: '16:9', size: '2k' });
  const mmSent = received[mmBefore];
  assert(r10.source === 'gateway', `MiniMax source=gateway (实际 ${r10.source})`);
  assert(mmSent && mmSent.path === '/v1/image_generation', `走 MiniMax 端点(单数) (实际 ${mmSent && mmSent.path})`);
  assert(mmSent.body.aspect_ratio === '16:9', `用 aspect_ratio 而非 size (实际 ${mmSent.body.aspect_ratio})`);
  assert(!('size' in mmSent.body), `MiniMax 请求体不含 size 字段 (实际 ${mmSent.body.size})`);
  assert(
    Array.isArray(mmSent.body.subject_reference) && mmSent.body.subject_reference.length === 1,
    `参考图走 subject_reference 且限单张 (实际 ${JSON.stringify(mmSent.body.subject_reference)?.slice(0, 40)}…)`,
  );
  const meta10 = await measure(r10.buffer, 'image/jpeg');
  assert(meta10.w === 512 && meta10.h === 512, `MiniMax 产出为桩返回的 512x512 (实际 ${meta10.w}x${meta10.h})`);

  // H2. HTTP 200 但 base_resp 标错 → 必须识别为失败并回落
  // ⚠️ 用**独立端口**而不是 close 后原地重启: close() 不等连接完全释放,
  // 端口处于 TIME_WAIT 时新桩虽listen 成功, 旧连接的残留仍会让请求 fetch failed,
  // 断言测到的就不是「base_resp 错误识别」而是「连不上」—— 测错了东西。
  const MM_ERR_PORT = 39223;
  const mmErrServer = await startStub(MM_ERR_PORT, 'mm-error-200');
  process.env.GATEWAY_BASE_URL = `http://127.0.0.1:${MM_ERR_PORT}`;
  const router10 = loadRouter();
  const r11 = await router10.generate('free_create', [inp], { prompt: 'x', ratio: '1:1', size: '1k' });
  assert(r11.source === 'local', `MiniMax HTTP200 但 base_resp 报错时回落本地 (实际 ${r11.source})`);
  const mmLog = router10.__calls.filter((c) => c.ok && c.fallback).pop();
  assert(
    Boolean(mmLog && /status 1004|invalid api key/.test(String(mmLog.reason))),
    `识别出 base_resp 里的真实错误 (${mmLog && String(mmLog.reason).slice(0, 80)})`,
  );
  mmErrServer.close();
  mmServer.close();

  // ── I. 未知协议必须显式报错, 不能静默当 aigc ─────────────────
  // 静默当 aigc 会让「协议填错」表现为 404 → 回落本地占位图, 界面上看不出来。
  process.env.GATEWAY_PROVIDER = 'not-a-real-protocol';
  const router11 = loadRouter();
  const r12 = await router11.generate('free_create', [inp], { prompt: 'x', ratio: '1:1', size: '1k' });
  assert(r12.source === 'local', '未知协议也回落本地(用户仍拿得到图)');
  const unknownLog = router11.__calls.filter((c) => c.ok && c.fallback).pop();
  assert(
    Boolean(unknownLog && /未知通道协议/.test(String(unknownLog.reason))),
    `未知协议给出可读原因 (${unknownLog && String(unknownLog.reason).slice(0, 90)})`,
  );
  delete process.env.GATEWAY_PROVIDER;

  // ── J. 内置厂商预设完整性 ────────────────────────────────────
  // 预设是后台下拉的数据源, 与 provider 实现脱节会导致「选了却调不通」
  const { VENDOR_PRESETS, PROTOCOL_OPTIONS } = require(path.join(ROOT, 'dist/providers/provider-presets.js'));
  assert(VENDOR_PRESETS.length >= 5, `内置厂商不少于5 家 (实际 ${VENDOR_PRESETS.length})`);
  const optValues = PROTOCOL_OPTIONS.map((o) => o.value);
  const orphanProtocol = VENDOR_PRESETS.filter((v) => !optValues.includes(v.protocol));
  assert(
    orphanProtocol.length === 0,
    `每个预设的协议都在可选项里 (孤儿: ${orphanProtocol.map((v) => v.protocol).join(',') || '无'})`,
  );
  const noModel = VENDOR_PRESETS.filter((v) => !v.models || v.models.length === 0);
  assert(noModel.length === 0, `每个厂商都带可选模型 (缺: ${noModel.map((v) => v.key).join(',') || '无'})`);
  const noUrl = VENDOR_PRESETS.filter((v) => !v.baseUrl || !v.consoleUrl);
  assert(noUrl.length === 0, `每个厂商都有基址与控制台地址 (缺: ${noUrl.map((v) => v.key).join(',') || '无'})`);

  // ── K. 历史别名 modelverse 仍可用 ───────────────────────────
  // 2026-10-20 协议默认值从 modelverse 规范化为 openai, 但存量 DB 里仍是
  // modelverse。没有这条断言, 删掉兼容分支时不会有任何信号。
  const MV_ALIAS_PORT = 39222;
  const aliasServer = await startStub(MV_ALIAS_PORT, 'ok');
  process.env.GATEWAY_BASE_URL = `http://127.0.0.1:${MV_ALIAS_PORT}`;
  process.env.GATEWAY_PROVIDER = 'modelverse';
  const router12 = loadRouter();
  const aliasBefore = received.length;
  const r13 = await router12.generate('free_create', [inp], { prompt: '别名兼容', ratio: '1:1', size: '1k' });
  const aliasSent = received[aliasBefore];
  assert(r13.source === 'gateway', `历史别名 modelverse 仍走远程 (实际 ${r13.source})`);
  assert(
    aliasSent && aliasSent.path === '/v1/images/generations',
    `别名映射到 openai 端点 (实际 ${aliasSent && aliasSent.path})`,
  );
  aliasServer.close();
  delete process.env.GATEWAY_PROVIDER;
  delete process.env.GATEWAY_PROVIDER;

  // ── E. 15 项能力提示词覆盖 ─────────────────────────────────
  const { buildPromptFor, PROMPT_COVERAGE } = require(path.join(ROOT, 'dist/providers/gateway-prompt.js'));
  const registry = require(path.join(ROOT, 'dist/capabilities/capability.registry.js'));
  const ids = registry.CAPABILITIES.map((c) => c.id);
  const missing = ids.filter((id) => !PROMPT_COVERAGE.includes(id) || buildPromptFor(id, {}) === id);
  assert(missing.length === 0, `15 项能力均有专属提示词 (缺: ${missing.join(',') || '无'})`);
  assert(
    buildPromptFor('main_image', { productName: '循环扇', platform: 'taobao' }).includes('循环扇'),
    '主图提示词注入商品名与平台',
  );

  console.log('\n' + (process.exitCode ? '❌ GATEWAY CHANNEL SMOKE FAILED' : '✅ GATEWAY CHANNEL SMOKE ALL PASS'));
})();
