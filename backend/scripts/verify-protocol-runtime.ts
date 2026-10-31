/**
 * 协议运行时验收（P2）。
 *
 * 覆盖三件事，缺一不可：
 *   1. **声明式协议可执行**：把随代码入库的全部插件 provider 过一遍
 *      `buildCreate`，证明清单求值（表达式 DSL / 路径 / 鉴权 / 图片参数投影）
 *      在真实清单上跑得通，而不是只通过结构校验；
 *   2. **响应归一化正确**：用合成响应断言「成功 / 异步 / 失败」三条路径，
 *      这些分支写错会把上游错误当成空产出；
 *   3. **端到端可验收**：起一个本地假上游，走**真实后台接口**
 *      `POST /admin/channels/:id/models/test`，对 image 与 video 各跑一次，
 *      并校验 `ApiCallLog` 落库（`billable=false`、`source='admin'`）。
 *
 * 假上游只在本机回环地址监听；因此脚本显式打开
 * `MODEL_ALLOW_PRIVATE_UPSTREAMS`，生产默认仍是关闭。
 *
 * 运行：NODE_ENV=development npm run verify:protocol-runtime
 */
process.env.PORT = process.env.PORT || '3014';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
// 假上游在 127.0.0.1：只在这个验收进程里放开私有网段，不改任何配置文件
process.env.MODEL_ALLOW_PRIVATE_UPSTREAMS = '1';

const http = require('node:http');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('../src/app.module');
const { ResponseInterceptor } = require('../src/common/response.interceptor');
const { ProtocolRegistry } = require('../src/model/protocol/registry');
const { PluginManifestStore } = require('../src/model/plugins/plugin-manifest.store');
const { PrismaService } = require('../src/prisma/prisma.service');

let pass = 0;
const fails: string[] = [];
const ok = (name: string, condition: boolean, detail?: unknown) => {
  if (condition) {
    pass += 1;
    return;
  }
  fails.push(`${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
};

const IMAGE_KEY = 'sk-verify-image';
const VIDEO_KEY = 'sk-verify-video';

/** 1×1 透明 PNG，假上游的图片响应体 */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** 假上游：记录收到的请求，按路径回放 image / video 两条协议的最小成功响应 */
function startFakeUpstream() {
  const received: Array<{ method: string; path: string; headers: any; body: string }> = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      received.push({ method: req.method, path: req.url, headers: req.headers, body: raw });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.end(
          JSON.stringify({
            data: [{ id: 'minimax-video-2' }, { id: 'gpt-image-1', display_name: 'GPT Image 1' }],
          }),
        );
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/images/generations') {
        res.end(JSON.stringify({ data: [{ url: `${baseAddress}/media/result.png` }] }));
        return;
      }
      if (req.method === 'POST' && req.url === '/v2/video_generation') {
        res.end(JSON.stringify({ task_id: 'fake-video-task', base_resp: { status_code: 0, status_msg: 'success' } }));
        return;
      }
      if (req.method === 'GET' && req.url === '/v2/query/video_generation/fake-video-task') {
        res.end(
          JSON.stringify({
            task: { status: 'Success', content: { url: `${baseAddress}/media/result.mp4` } },
            base_resp: { status_code: 0, status_msg: 'success' },
          }),
        );
        return;
      }
      if (req.method === 'GET' && req.url === '/media/result.png') {
        res.setHeader('Content-Type', 'image/png');
        res.end(PNG_BYTES);
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { code: 'not_found', message: `假上游没有实现 ${req.method} ${req.url}` } }));
    });
  });
  return new Promise<{ server: typeof server; port: number; received: typeof received }>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as any).port, received }));
  });
}

let baseAddress = '';

async function main() {
  const fake = await startFakeUpstream();
  baseAddress = `http://127.0.0.1:${fake.port}`;

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('api/v1');
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as any).port;
  const apiBase = `http://127.0.0.1:${port}/api/v1`;

  const call = async (method: string, path: string, token: string | null, body?: unknown) => {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 300) };
    }
    return { status: response.status, code: json.code, data: json.data, message: json.message ?? json.raw };
  };

  const registry = app.get(ProtocolRegistry);
  const prisma = app.get(PrismaService);
  const stamp = Date.now().toString(36);
  let channelId = '';

  try {
    /* ── 1. 全量协议构造请求冒烟 ─────────────────────────── */
    const metadata = registry.list();
    ok('已注册插件协议数量 ≥ 100', metadata.length >= 100, metadata.length);
    const missing = ['openai-image', 'minimax-video'].filter((id) => !registry.resolve(id));
    ok('关键协议已注册', missing.length === 0, missing);

    // 冒烟用通用模型名；清单里存在的「仅接受某模型」校验按预期跳过，不计为失败
    const plugins = app.get(PluginManifestStore);
    const declaredValidations = new Map<string, string[]>(
      plugins.providers().map((item: any) => [
        item.provider.id,
        (item.provider.validations ?? []).map((rule: any) => String(rule.message ?? '')),
      ]),
    );

    const buildFails: string[] = [];
    const skippedByValidation: string[] = [];
    for (const item of metadata) {
      const adapter = registry.resolve(item.id)!;
      const request = smokeRequest(item.capabilities[0] || 'image', `sk-${item.id}`);
      try {
        const spec = await adapter.buildCreate({ baseUrl: 'https://example.invalid', request });
        const problems: string[] = [];
        if (!spec || typeof spec.method !== 'string' || spec.method === '') problems.push('缺少 method');
        if (!spec || typeof spec.path !== 'string' || !spec.path.startsWith('/')) problems.push(`路径必须是相对路径：${spec?.path}`);
        if (spec?.path?.includes('undefined')) problems.push(`路径含 undefined：${spec.path}`);
        if (problems.length > 0) buildFails.push(`${item.id}: ${problems.join('；')}`);
      } catch (error) {
        const message = String((error as Error).message ?? '');
        const declared = declaredValidations.get(item.id) ?? [];
        if (declared.includes(message)) skippedByValidation.push(item.id);
        else buildFails.push(`${item.id}: ${message}`);
      }
    }
    ok('全部已注册协议都能构造出请求', buildFails.length === 0, buildFails.slice(0, 8));
    console.log(`  · 构造请求冒烟：${metadata.length} 个协议，其中 ${skippedByValidation.length} 个因通用测试模型名未过清单校验而跳过`);

    /* ── 2. 响应归一化 ─────────────────────────────────── */
    const imageAdapter = registry.resolve('openai-image')!;
    const imageRequest = smokeRequest('image', 'gpt-image-1');
    const imageResult = await imageAdapter.parseCreate(
      Buffer.from(JSON.stringify({ data: [{ url: 'https://example.invalid/1.png' }] })),
      imageRequest,
    );
    ok('图片响应判为成功', imageResult.status === 'succeeded', imageResult.status);
    ok('图片响应解析出 1 张图', imageResult.result?.images?.length === 1, imageResult.result?.images?.length);

    const imageError = await imageAdapter.parseCreate(
      Buffer.from(JSON.stringify({ error: { code: 'content_policy', message: 'prompt rejected' } })),
      imageRequest,
    );
    ok('图片错误响应判为失败', imageError.status === 'failed', imageError.status);
    ok('图片错误原因被带出', String(imageError.message ?? '').includes('prompt rejected'), imageError.message);

    const videoAdapter = registry.resolve('minimax-video')!;
    const videoRequest = smokeRequest('video', 'MiniMax-Hailuo-2.3');
    const videoCreated = await videoAdapter.parseCreate(Buffer.from(JSON.stringify({ task_id: 't-1' })), videoRequest);
    ok('视频创建响应判为待处理', videoCreated.status === 'pending', videoCreated.status);
    ok('视频任务 id 被解析', videoCreated.taskId === 't-1', videoCreated.taskId);
    const videoPolled = await videoAdapter.parsePoll!(
      { baseUrl: 'https://example.invalid', model: videoRequest.model, request: videoRequest, taskId: 't-1' },
      Buffer.from(
        JSON.stringify({
          task: { status: 'Success', content: { url: 'https://example.invalid/v.mp4' } },
          base_resp: { status_code: 0 },
        }),
      ),
    );
    ok('视频轮询成功判为成功', videoPolled.status === 'succeeded', videoPolled.status);
    ok('视频结果地址被解析', videoPolled.result?.videos?.length === 1, videoPolled.result?.videos?.length);

    /* ── 3. 真实接口端到端：image ────────────────────────── */
    const login = await call('POST', '/auth/login', null, { email: 'admin@admin.com', password: '123456789' });
    ok('管理员登录', login.code === 0 && Boolean(login.data?.accessToken), login);
    const token: string = login.data?.accessToken;
    if (!token) throw new Error('无法取得管理员令牌，端到端用例终止');

    const created = await call('POST', '/admin/channels', token, {
      name: `验收-协议运行时-${stamp}`,
      baseUrl: baseAddress,
      apiKey: IMAGE_KEY,
      reason: '协议运行时验收',
    });
    ok('创建验收渠道', created.code === 0 && Boolean(created.data?.id), created);
    channelId = created.data?.id ?? '';
    if (!channelId) throw new Error('渠道创建失败，端到端用例终止');

    const imageTest = await call('POST', `/admin/channels/${channelId}/models/test`, token, {
      protocol: 'openai-image',
      capability: 'image',
      providerModelKey: 'gpt-image-1',
      reason: '协议运行时验收',
    });
    ok('图片测试接口返回成功', imageTest.code === 0 && imageTest.data?.status === 'succeeded', imageTest);
    ok('图片测试解析出产出', imageTest.data?.mediaCount === 1, imageTest.data?.mediaCount);
    const imageCall = fake.received.find((item) => item.path === '/v1/images/generations');
    ok('图片请求打到假上游', Boolean(imageCall), fake.received.map((item) => item.path));
    ok('图片请求携带 Bearer 鉴权', String(imageCall?.headers?.authorization ?? '') === `Bearer ${IMAGE_KEY}`, imageCall?.headers?.authorization);
    const imageBody = imageCall ? JSON.parse(imageCall.body) : {};
    ok('图片请求体带模型与提示词', imageBody.model === 'gpt-image-1' && typeof imageBody.prompt === 'string', imageBody);

    /* ── 4. 真实接口端到端：video（异步两段式） ───────────── */
    const videoTest = await call('POST', `/admin/channels/${channelId}/models/test`, token, {
      protocol: 'minimax-video',
      capability: 'video',
      providerModelKey: 'MiniMax-Hailuo-2.3',
      timeoutMs: 20000,
      reason: '协议运行时验收',
    });
    ok('视频测试接口返回成功', videoTest.code === 0 && videoTest.data?.status === 'succeeded', videoTest);
    ok('视频测试执行了轮询', (videoTest.data?.pollCount ?? 0) >= 1, videoTest.data?.pollCount);
    ok('视频测试解析出产出', videoTest.data?.mediaCount === 1, videoTest.data?.mediaCount);
    ok(
      '视频轮询打到假上游',
      fake.received.some((item) => item.path === '/v2/query/video_generation/fake-video-task'),
      fake.received.map((item) => item.path),
    );

    /* ── 5. ApiCallLog 落库 ────────────────────────────── */
    const logs = await prisma.apiCallLog.findMany({ where: { channelId }, orderBy: { createdAt: 'asc' } });
    ok('两次测试各写一条调用记录', logs.length >= 2, logs.length);
    for (const expected of ['image', 'video']) {
      const log = logs.find((row: any) => row.capability === expected);
      ok(`${expected} 调用记录存在`, Boolean(log), logs.map((row: any) => row.capability));
      if (!log) continue;
      ok(`${expected} 记录标记不可计费`, log.billable === false, log.billable);
      ok(`${expected} 记录来源为后台`, log.source === 'admin' && log.operation === 'admin_model_test', {
        source: log.source,
        operation: log.operation,
      });
      ok(`${expected} 记录状态为 success`, log.status === 'success', log.status);
      ok(`${expected} 记录保留上游响应`, String(log.responseBody ?? '').length > 0, log.responseBody);
      ok(`${expected} 记录标记真实模型名`, String(log.model ?? '').length > 0, log.model);
    }
    // 调用记录只应保存请求 / 响应正文，不得把 Authorization 或密钥写进去
    const leaksCredential = logs.some((row: any) =>
      [row.requestBody, row.responseBody, row.error, row.upstreamUrl, row.path].some((value: any) =>
        String(value ?? '').includes(IMAGE_KEY),
      ),
    );
    ok('调用记录不回显明文凭证', !leaksCredential, '存在明文凭证');

    /* ── 6. 未知协议在发请求前被拒绝，不发空请求 ─────────── */
    const missingProtocol = await call('POST', `/admin/channels/${channelId}/models/test`, token, {
      protocol: 'not-a-protocol',
      capability: 'image',
      providerModelKey: 'gpt-image-1',
      reason: '协议运行时验收',
    });
    ok('未知协议在发请求前被拒绝', missingProtocol.code !== 0, missingProtocol);

    /* ── 7. 上游目录拉取与导入 ───────────────────────────── */
    const fetched = await call('POST', `/admin/channels/${channelId}/models/fetch`, token, { reason: '协议运行时验收' });
    ok('拉取上游模型目录', fetched.code === 0 && fetched.data?.models?.length === 2, fetched);
    ok(
      '目录按 id 排序',
      JSON.stringify((fetched.data?.models ?? []).map((item: any) => item.id)) === JSON.stringify(['gpt-image-1', 'minimax-video-2']),
      (fetched.data?.models ?? []).map((item: any) => item.id),
    );
    ok(
      '目录透出上游展示名',
      (fetched.data?.models ?? []).find((item: any) => item.id === 'gpt-image-1')?.displayName === 'GPT Image 1',
      fetched.data?.models,
    );
    ok(
      '目录请求携带 Bearer 鉴权',
      String(fake.received.find((item) => item.path === '/v1/models')?.headers?.authorization ?? '') === `Bearer ${IMAGE_KEY}`,
      fake.received.map((item) => item.path),
    );

    const rejectedImport = await call('POST', `/admin/channels/${channelId}/models/import`, token, {
      models: ['no-such-model'],
      reason: '协议运行时验收',
    });
    ok('导入不在目录中的模型被拒绝', rejectedImport.code !== 0, rejectedImport);

    const imported = await call('POST', `/admin/channels/${channelId}/models/import`, token, {
      models: ['gpt-image-1'],
      reason: '协议运行时验收',
    });
    ok('导入上游模型', imported.code === 0 && imported.data?.added === 1, imported);
    const importedRow = await prisma.channelModel.findFirst({ where: { channelId, providerModelKey: 'gpt-image-1' } });
    ok('导入模型默认停用', importedRow?.enabled === false, importedRow?.enabled);
    ok('导入模型默认未定价', importedRow?.priceConfigured === false, importedRow?.priceConfigured);
    ok('导入模型能力待管理员声明', String(importedRow?.capability ?? '') === '', importedRow?.capability);

    const reimported = await call('POST', `/admin/channels/${channelId}/models/import`, token, {
      models: ['gpt-image-1'],
      reason: '协议运行时验收',
    });
    ok('重复导入不新增', reimported.code === 0 && reimported.data?.added === 0, reimported);

    const auditActions = await prisma.adminAuditLog.findMany({ where: { targetId: channelId }, select: { action: true } });
    for (const action of ['channel_model.test', 'channel_model.fetch', 'channel_model.import']) {
      ok(`审计记录 ${action}`, auditActions.some((row: any) => row.action === action), auditActions.map((row: any) => row.action));
    }
  } finally {
    if (channelId) {
      try {
        // 验收渠道没有业务引用；直接删库，避免依赖接口的删除前置校验
        await prisma.channelModel.deleteMany({ where: { channelId } });
        await prisma.modelChannel.deleteMany({ where: { id: channelId } });
      } catch (error) {
        console.warn('清理验收渠道失败：', (error as Error).message);
      }
    }
    await app.close();
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
  }

  console.log(`\n协议运行期验收：通过 ${pass} 项，失败 ${fails.length} 项`);
  if (fails.length > 0) {
    for (const failure of fails) console.log(`  ✗ ${failure}`);
    process.exitCode = 1;
  }
}

/** 每种能力的最小请求：只给必填项，缺省由协议自己补 */
function smokeRequest(capability: string, model: string) {
  const request: any = { capability, model, prompt: 'Model test.' };
  if (capability === 'image') request.imageCount = 1;
  if (capability === 'video') {
    request.duration = 6;
    request.aspectRatio = '16:9';
    request.resolution = '720P';
  }
  request.extra = { audioFormat: 'mp3', audioVoice: 'alloy', audioSpeed: '1' };
  return request;
}

main().catch((error) => {
  console.error('协议运行时验收异常：', error);
  process.exitCode = 1;
});
