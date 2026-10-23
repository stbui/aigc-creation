/**
 * 连通性测试的**缺陷回归防护** (2026-10-20)。
 *
 * ## 背景: 两个静默不实的缺陷
 *
 * ① **探测路径按模态硬编码** —— 改造前 `probePath(modality)` 让 image 恒打
 *    **某一条**路径, 而各图像协议的真实端点各不相同 (据 `PROTOCOL_SPECS`):
 *      openai → /v1/images/generations
 *      volcengine → /images/generations
 *      minimax → /v1/image_generation
 *
 *    于是配了 `openai` 协议时, 探测打的是优云智算/硅基流动**根本不存在**的
 *    路径, 拿到 404, 而探测把 4xx 当作「网络可达」→
 *    **测试显示通过, 但生成必然 404**。
 *
 *    这是本项目最忌讳的那类静默不实: 运营看到绿色对勾, 却每次生成都失败,
 *    且界面上看不出任何原因。
 *
 * ② **只验网络, 不验模型** —— 模型名写错是最高频的配错 (抄旧教程、
 *    填了已下线的模型), 症状同样是「测试通过但生成永远失败」。
 *
 * ## 为什么这个文件用桩服务器
 *
 * 这类缺陷**类型系统完全看不出来**, 且症状都是「以后更难查」而非「立刻报错」。
 * 故必须真跑一遍 HTTP 往返: 桩服务器按协议声明的路径响应, 断言测试
 * 打到了**正确的路径**。
 *
 * ⚠️ 关键: 桩服务器**记录被打到的路径**, 断言「打的是 /v1/images/generations
 * 而不是别的协议的端点」。若只断言「结果为 ok」, 缺陷照样漏过 ——
 * 因为 4xx 也算 ok (那正是缺陷本身)。
 */

import { createServer, type Server } from 'http';
import { AddressInfo } from 'net';
import { PROTOCOL_SPECS, VIDEO_PROTOCOL_SPECS } from '../src/providers/protocols/protocol.spec';
import { setGatewayConfigOverrides, invalidateGatewayConfigCache } from '../src/providers/gateway.config';
import { ModelConfigService } from '../src/admin/model-config.service';

let pass = 0;
const fails: string[] = [];
const ok = (n: string, c: boolean, d?: unknown) => {
  if (c) pass += 1;
  else fails.push(`${n}${d !== undefined ? ` — ${JSON.stringify(d)}` : ''}`);
};

function makeService() {
  const prisma = { modelChannelConfig: { findMany: async () => [] } } as never;
  const router = { invalidate: () => {} } as never;
  return new ModelConfigService(prisma, router);
}

/** 桩服务器: 只对声明过的路径返回 200, 其余 404 */
async function withStub(
  knownPaths: string[],
  fn: (port: number, hits: string[]) => Promise<void>,
): Promise<void> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    hits.push(`${req.method} ${path}`);
    if (knownPaths.includes(path)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":{"code":"not_found"}}');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(port, hits);
  } finally {
    server.close();
  }
}

async function main() {
  const svc = makeService();

  // ── 1. 每个协议的探测路径必须落在它自己的端点上 ────────────────────
  {
    /*
     * 逐协议验: 桩服务器只认该协议的**真实生成端点**。
     * 若探测打错路径 → 命中 404 → 断言红。
     */
    for (const spec of PROTOCOL_SPECS) {
      const realPath = new URL(spec.endpoint('https://x.cn')).pathname;
      await withStub([realPath], async (port, hits) => {
        setGatewayConfigOverrides({
          [`gateway.${spec.modality}.baseUrl`]: `http://127.0.0.1:${port}`,
          [`gateway.${spec.modality}.token`]: 'test-token',
          [`gateway.${spec.modality}.enabled`]: 'true',
          [`gateway.${spec.modality}.provider`]: spec.protocol,
        });
        invalidateGatewayConfigCache();

        const r = await svc.testConnection(spec.modality);
        const probed = hits.find((h) => h.startsWith('OPTIONS'));
        ok(
          `${spec.protocol} 探测打到自己的端点 ${realPath}`,
          probed === `OPTIONS ${realPath}`,
          { probed, expected: `OPTIONS ${realPath}` },
        );
        void r;
      });
    }
    setGatewayConfigOverrides({});
    invalidateGatewayConfigCache();
  }

  // ── 2. 视频协议同理 ────────────────────────────────────────────────
  {
    for (const spec of VIDEO_PROTOCOL_SPECS) {
      const realPath = new URL(spec.submitEndpoint('https://x.cn')).pathname;
      await withStub([realPath], async (port, hits) => {
        setGatewayConfigOverrides({
          'gateway.video.baseUrl': `http://127.0.0.1:${port}`,
          'gateway.video.token': 'test-token',
          'gateway.video.enabled': 'true',
          'gateway.video.provider': spec.protocol,
        });
        invalidateGatewayConfigCache();

        await svc.testConnection('video');
        const probed = hits.find((h) => h.startsWith('OPTIONS'));
        ok(
          `${spec.protocol} 探测打到自己的提交端点 ${realPath}`,
          probed === `OPTIONS ${realPath}`,
          { probed, expected: `OPTIONS ${realPath}` },
        );
      });
    }
    setGatewayConfigOverrides({});
    invalidateGatewayConfigCache();
  }

  // ── 3. 打错路径时, 不能报「通过」 ─────────────────────────────────
  {
    /*
     * 桩服务器**只认火山方舟的路径** `/images/generations`, 而通道配的是
     * openai 协议 (探测会打 `/v1/images/generations`)。此时探测必然打错 → 404。
     * 两个路径确实不同, 才能构成「配错协议」的诱饵。
     *
     * ⚠️ 改造前 4xx 被当作「网络可达」→ ok:true → **显示通过**。
     * 现在必须**不报 ok**, 因为路径不对 = 生成必然失败。
     */
    await withStub(['/images/generations'], async (port) => {
      setGatewayConfigOverrides({
        'gateway.image.baseUrl': `http://127.0.0.1:${port}`,
        'gateway.image.token': 'test-token',
        'gateway.image.enabled': 'true',
        'gateway.image.provider': 'openai',
      });
      invalidateGatewayConfigCache();

      const r = await svc.testConnection('image');
      ok('路径打错时不报「通过」 (避免静默不实)', r.ok === false, {
        ok: r.ok,
        message: r.message,
      });
      ok(
        '错误信息点明实际会走的路径',
        (r.detail ?? '').includes('/v1/images/generations'),
        r.detail,
      );
    });
    setGatewayConfigOverrides({});
    invalidateGatewayConfigCache();
  }

  // ── 4. 模型名写错时必须报失败 (区分「网络可达」与「模型可用」) ────
  {
    const modelsPath = '/v1/models';
    const genPath = '/v1/images/generations';
    const server: Server = createServer((req, res) => {
      const path = (req.url ?? '').split('?')[0];
      res.setHeader('Content-Type', 'application/json');
      if (path === modelsPath) {
        res.writeHead(200);
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-image-2' }, { id: 'qwen-image-3.0' }] }));
        return;
      }
      if (path === genPath) {
        res.writeHead(200);
        res.end('{}');
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    try {
      // 模型名在列表里 → 通过
      setGatewayConfigOverrides({
        'gateway.image.baseUrl': `http://127.0.0.1:${port}`,
        'gateway.image.token': 'test-token',
        'gateway.image.enabled': 'true',
        'gateway.image.provider': 'openai',
        'gateway.image.model': 'qwen-image-3.0',
      });
      invalidateGatewayConfigCache();
      const good = await svc.testConnection('image');
      ok('模型名在可用列表里 → 通过', good.ok === true, { ok: good.ok, message: good.message });
      ok('结果标明已验模型', good.message.includes('模型可用'), good.message);

      // 模型名不在列表里 → 失败 (改造前会显示通过!)
      setGatewayConfigOverrides({
        'gateway.image.baseUrl': `http://127.0.0.1:${port}`,
        'gateway.image.token': 'test-token',
        'gateway.image.enabled': 'true',
        'gateway.image.provider': 'openai',
        'gateway.image.model': 'totally-wrong-model',
      });
      invalidateGatewayConfigCache();
      const bad = await svc.testConnection('image');
      ok('模型名不在列表 → 报失败', bad.ok === false, { ok: bad.ok, message: bad.message });
      ok('错误信息给出可用模型样例', (bad.detail ?? '').includes('qwen-image-3.0'), bad.detail);
    } finally {
      server.close();
      setGatewayConfigOverrides({});
      invalidateGatewayConfigCache();
    }
  }

  // ── 5. 厂商不提供模型列表时, 不能误报 ─────────────────────────────
  {
    /*
     * minimax 生图协议**不声明** modelListEndpoints (未取证到公开端点)。
     * 此时只能验到「网络可达」, 结论应标明「未验模型名」——
     * 既不能报失败 (那会误伤正常配置), 也不能说「模型可用」(那是撒谎)。
     */
    const genPath = '/v1/image_generation';
    await withStub([genPath], async (port) => {
      setGatewayConfigOverrides({
        'gateway.image.baseUrl': `http://127.0.0.1:${port}`,
        'gateway.image.token': 'test-token',
        'gateway.image.enabled': 'true',
        'gateway.image.provider': 'minimax',
        'gateway.image.model': 'image-01',
      });
      invalidateGatewayConfigCache();

      const r = await svc.testConnection('image');
      ok('无模型列表接口时仍报网络可达', r.ok === true, { ok: r.ok, message: r.message });
      ok('结论标明「未验模型名」', r.message.includes('未验模型名'), r.message);
      ok('不谎称「模型可用」', !r.message.includes('模型可用'), r.message);
    });
    setGatewayConfigOverrides({});
    invalidateGatewayConfigCache();
  }

  // ── 6. 各协议都声明了合理的探测端点 (防退化) ───────────────────────
  {
    for (const spec of PROTOCOL_SPECS) {
      const p = new URL(spec.endpoint('https://x.cn')).pathname;
      ok(`${spec.protocol} 的端点非空且以 / 开头`, p.startsWith('/') && p.length > 1, p);
    }
    // 关键不变量: 图像协议的端点**互不相同** ——
    // 若哪天又抄成同一个, 探测就会失去区分能力 (这正是原缺陷的形状)
    const imagePaths = PROTOCOL_SPECS.filter((s) => s.modality === 'image').map((s) =>
      new URL(s.endpoint('https://x.cn')).pathname,
    );
    ok('图像协议的端点互不相同 (探测才有区分力)', new Set(imagePaths).size === imagePaths.length, imagePaths);
  }

  // ── 7. 批量测试: 一次返回所有模态, 失败不影响其它 ─────────────────
  {
    /*
     * 判据: 批量测试要**并发**执行 (总耗时 ≈ 最慢的一个, 而非三者之和),
     * 且某个模态失败时**其它模态的结果仍要返回** ——
     * 「一次看全」的价值正在于此, 一个失败就整体报错等于白做。
     */
    const delays: Record<string, number> = { text: 120, image: 120, video: 120 };
    const server: Server = createServer((req, res) => {
      const path = (req.url ?? '').split('?')[0];
      // 三个模态的探测路径各不相同, 一律延迟相同时间
      setTimeout(() => {
        // 405 = 端点存在但方法不对，避免触发「OPTIONS→GET→POST」三段探测链，
        // 本用例只测批量调用是否并发，不测探测链路本身。
        res.writeHead(path.includes('/v1/models') ? 200 : 405, { 'Content-Type': 'application/json' });
        res.end(path.includes('/v1/models') ? JSON.stringify({ data: [{ id: 'x' }] }) : '{}');
      }, delays.text);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    try {
      /*
       * ⚠️ setGatewayConfigOverrides 是**整体替换**而非合并 ——
       * 故必须一次把所有模态的键都放进同一个对象。
       * (之前在循环里逐次调用, 后一次把前一次的覆盖值冲掉了,
       *  表现为「只有最后一个模态生效」—— 测试自身的 bug, 不是产品 bug。)
       */
      const allOverrides: Record<string, string> = {};
      for (const m of ['text', 'image', 'video']) {
        allOverrides[`gateway.${m}.baseUrl`] = `http://127.0.0.1:${port}`;
        allOverrides[`gateway.${m}.token`] = 'test-token';
        allOverrides[`gateway.${m}.enabled`] = 'true';
      }
      setGatewayConfigOverrides(allOverrides);
      invalidateGatewayConfigCache();

      const t0 = Date.now();
      const r = await svc.testAllConnections();
      const elapsed = Date.now() - t0;

      ok('批量测试返回全部模态', Object.keys(r.results).length === 3, Object.keys(r.results));
      ok('批量测试的 total 为 3', r.total === 3, r.total);
      ok('okCount 不超过 total', r.okCount <= r.total, { okCount: r.okCount, total: r.total });
      // 三个各 120ms 串行 ≈ 360ms, 并发 ≈ 120ms。留宽裕余量给 CI 抖动。
      ok('批量测试是并发的 (总耗时应远小于串行之和)', elapsed < 300, { elapsed, 串行预期: '≥360ms' });
      ok('批量测试返回耗时', r.elapsedMs > 0, r.elapsedMs);
    } finally {
      server.close();
      setGatewayConfigOverrides({});
      invalidateGatewayConfigCache();
    }
  }

  // ── 6. 草稿测试: override 生效、令牌语义、来源标记 ────────────────
  {
    const seen: Array<{ path: string; auth?: string }> = [];
    const server: Server = createServer((req, res) => {
      seen.push({
        path: (req.url ?? '').split('?')[0],
        auth: req.headers.authorization as string | undefined,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 全局配置指向一个不可达地址, 证明 override 的 baseUrl 确实生效
      setGatewayConfigOverrides({
        'gateway.image.baseUrl': 'http://127.0.0.1:1',
        'gateway.image.token': 'saved-token',
        'gateway.image.enabled': 'true',
        'gateway.image.provider': 'openai',
      });
      invalidateGatewayConfigCache();

      const r1 = await svc.testConnection('image', {
        protocol: 'openai',
        baseUrl,
        token: 'draft-token',
        enabled: true,
      });
      ok('草稿测试使用 override 的地址', seen.some((s) => s.path === '/v1/images/generations'), seen);
      ok('草稿测试标记为 draft', r1.target === 'draft', r1);
      ok('草稿测试带 testedAt', Boolean(r1.testedAt), r1);
      ok('草稿令牌进入 Authorization', seen[0]?.auth === 'Bearer draft-token', seen[0]);

      seen.length = 0;
      const r2 = await svc.testConnection('image', {
        protocol: 'openai',
        baseUrl,
        // token 不传 → 用已保存令牌
        enabled: true,
      });
      ok('未传 token 时使用已保存令牌', seen[0]?.auth === 'Bearer saved-token', seen[0]);
      ok('使用已保存令牌仍标记 draft', r2.target === 'draft', r2);

      seen.length = 0;
      await svc.testConnection('image', {
        protocol: 'openai',
        baseUrl,
        token: '',
        enabled: true,
      });
      ok('token 传空串时不带 Authorization', seen[0]?.auth === undefined, seen[0]);

      // 不传 override: 全局配置本身要指向桩服务, 才能验证「读的是全局」
      setGatewayConfigOverrides({
        'gateway.image.baseUrl': baseUrl,
        'gateway.image.token': 'saved-token',
        'gateway.image.enabled': 'true',
        'gateway.image.provider': 'openai',
      });
      invalidateGatewayConfigCache();
      seen.length = 0;
      const r4 = await svc.testConnection('image');
      ok('不传 override 时标记 saved', r4.target === 'saved', r4);
      ok('不传 override 时仍读全局配置', seen[0]?.auth === 'Bearer saved-token', seen[0]);
    } finally {
      server.close();
      setGatewayConfigOverrides({});
      invalidateGatewayConfigCache();
    }
  }

  // ── 7. POST-only 生成端点不能被误判为「不存在」 ──────────────────
  {
    /*
     * 实测 api.modelverse.cn:
     *   OPTIONS /v1/images/generations → 404
     *   GET     /v1/images/generations → 404
     *   POST    /v1/images/generations → 401/400  ← 端点存在
     * 生成接口通常只注册 POST。若只凭 OPTIONS/GET 的 404 就报「端点不存在」，
     * 会把可用配置误判成坏的。故增加空 body POST 兜底探测。
     */
    const seen: string[] = [];
    const server: Server = createServer((req, res) => {
      seen.push(`${req.method} ${(req.url ?? '').split('?')[0]}`);
      const path = (req.url ?? '').split('?')[0];
      if (path === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"data":[{"id":"gpt-image-2"}]}');
        return;
      }
      if (path === '/v1/images/generations') {
        if (req.method === 'POST') {
          // 空 body 缺少 prompt —— 端点存在，但请求不合法
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":{"message":"prompt is required"}}');
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end('{"error":{"message":"not found"}}');
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    try {
      const r = await svc.testConnection('image', {
        protocol: 'openai',
        baseUrl: `http://127.0.0.1:${port}`,
        token: 'sk-probe',
        model: 'gpt-image-2',
        enabled: true,
      });
      ok('OPTIONS/GET 404 但 POST 存在 → 判定端点存在', r.ok === true, r);
      ok('结果不再谎报「端点不存在」', !String(r.message).includes('端点不存在'), r.message);
      ok('确实补发了 POST 探测', seen.includes('POST /v1/images/generations'), seen);
    } finally {
      server.close();
    }
  }

  // ── 8. 三种方法都 404 才能判定端点不存在 ─────────────────────────
  {
    const server: Server = createServer((req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":{"message":"not found"}}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const r = await svc.testConnection('image', {
        protocol: 'openai',
        baseUrl: `http://127.0.0.1:${port}`,
        token: 'sk-probe',
        model: '',
        enabled: true,
      });
      ok('三种方法都 404 → 判定端点不存在', r.ok === false && String(r.message).includes('端点不存在'), r);
    } finally {
      server.close();
    }
  }

  console.log(`\n通过 ${pass} 项`);
  if (fails.length) {
    console.error(`\n失败 ${fails.length} 项:`);
    for (const f of fails) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log('连通性测试断言通过（探测路径由协议层派生 · 模型名可校验 · 草稿 override · POST-only 端点 · 不谎报可用）');
}

void main();