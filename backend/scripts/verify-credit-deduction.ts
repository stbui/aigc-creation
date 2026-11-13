/**
 * 生成扣费链路端到端验证 (2026-10-20)。
 *
 * 沙箱内后台进程无法存活 (nohup / 子 shell / 受管后台任务都试过,
 * `node dist/main.js` 启动即静默退出), 故本脚本**在同一个进程内**:
 *   NestFactory.create(AppModule) → app.listen() → fetch 打自己的端口 → 关闭
 * 拿到的是真实 HTTP 往返 (走完整的 Express/Nest 链路 + 全局拦截器/过滤器),
 * 不是绕过网络层的函数直调 —— 扣费与建任务的顺序、状态机的条件更新
 * 只有在真实链路上才成立。
 *
 * 覆盖 commerce-design.md C5 的三条不可让步的约定（新模型层口径）:
 *   1. 建任务后立即**预留**积分并落账单, 余额不足不产生任务
 *   2. 上游明确未接单(4xx) → 失败并按预留明细原路退还;
 *      上游 5xx 属「结果不明」(42206), 冻结等人工核对, **不自动退款**
 *   3. 前置校验失败不扣费
 * 另验证 C 端商品端点、能力消耗价下发、购买→沙箱支付→发积分。
 */
process.env.PORT = process.env.PORT || '3011';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
// 本机模型桩是 127.0.0.1：出站层默认拒绝私网，必须在 ConfigModule 装载前放行。
// 已存在的非空环境变量不会被 env 文件覆盖，故这里显式赋值即可。
process.env.MODEL_ALLOW_PRIVATE_UPSTREAMS = 'true';

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../src/app.module');
const { ValidationPipe } = require('@nestjs/common');
const { ResponseInterceptor } = require('../src/common/response.interceptor');
const http = require('http');

const BASE = `http://127.0.0.1:${process.env.PORT}/api/v1`;

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, ...json };
}

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  /*
   * ⚠ 前缀 / 拦截器 / ValidationPipe 都在 main.ts 里装配, 直接 create(AppModule)
   * 会漏掉它们 —— 表现为「404 Cannot POST /api/v1/auth/login」。
   * 这里补齐, 保证测到的是与真实启动完全一致的链路。
   */
  app.setGlobalPrefix('api/v1');
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(Number(process.env.PORT), '127.0.0.1');
  console.log(`[验证] 后端已在 ${BASE} 启动\n`);

  const prisma = app.get(require('../src/prisma/prisma.service').PrismaService);
  // 本脚本覆盖沙箱支付；支付总开关默认关闭，先像运营一样显式打开
  await prisma.systemSetting.upsert({
    where: { key: 'payment.enabled' },
    create: { key: 'payment.enabled', value: 'true' },
    update: { value: 'true' },
  });
  app.get(require('../src/common/settings.service').SettingsService).invalidate();
  const health = app.get(require('../src/model/routing/route-health.service').RouteHealthService);
  const billing = app.get(require('../src/model/billing/billing.service').BillingService);
  const bcrypt = require('bcryptjs');

  /*
   * 模型-only 改造后，正常任务必须命中真实模型线路才会 succeeded。
   * 这里起一个本机 OpenAI 兼容桩：成功时回 base64 PNG，失败时回 500。
   * 它只验证协议与扣费状态机，不代表任何真实模型质量。
   */
  const smokePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  let modelMode = 'success';
  const modelServer = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (modelMode === 'reject') {
        // 4xx = 上游**明确没有接下任务**：这条路必然走「切线 / 失败退款」
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'invalid_api_key', message: 'mock upstream rejected' } }));
        return;
      }
      if (modelMode === 'failure') {
        // 5xx = 请求可能已被上游受理：结果不明，不切线也不自动退款
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'mock upstream failure' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: smokePng.toString('base64') }] }));
    });
  });
  await new Promise((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
  const modelPort = modelServer.address().port;

  const email = `credit-${Date.now()}@test.com`;
  const user = await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash('test123456', 10), name: '扣费测试' },
  });
  const T = (await call('POST', '/auth/login', null, { email, password: 'test123456' })).data.accessToken;

  // ── C 端商品端点 (公开免登录) ──────────────────────────────────────
  console.log('【C 端商品端点】');
  const pub = await call('GET', '/products', null);
  check('GET /products 免登录可访问', pub.status === 200, `HTTP ${pub.status}`);
  check('返回商品数组', Array.isArray(pub.data) && pub.data.length > 0, `${pub.data?.length ?? 0} 个`);
  const list = pub.data ?? [];
  const first = list[0];
  // ⚠ 刻意**避开 0 元试用包**: 用免费商品验支付会漏掉金额相关断言
  // (paidCents 为 0 时「实付 = 原价」这类回落分支永远测不到)。
  const paid = list.find((p) => p.priceCents > 0) ?? first;
  console.log(`         (首个 SKU 是 ${first.name} ¥${first.priceCents / 100}, 支付断言改用 ${paid.name} ¥${paid.priceCents / 100})`);
  check('价格用整数分', Number.isInteger(first?.priceCents), `${first?.priceCents} 分`);
  check('含 credits 字段', Number.isInteger(first?.credits), `${first?.credits} 积分`);
  check('不泄漏 grantType 内部字段', first && first.grantType === undefined);
  const detail = await call('GET', `/products/${first.sku}`, null);
  check('按 sku 查详情', detail.status === 200, `HTTP ${detail.status}`);
  check('不存在的 sku 返回 404', (await call('GET', '/products/NOPE', null)).status === 404);

  // ── 能力消耗价下发 ────────────────────────────────────────────────
  console.log('\n【能力消耗价下发】');
  const caps = await call('GET', '/capabilities', null);
  check('GET /capabilities 可访问', caps.status === 200, `HTTP ${caps.status}`);
  const items = caps.data?.items ?? [];
  check('全部能力带整数 creditCost', items.length > 0 && items.every((c) => Number.isInteger(c.creditCost)),
    `${items.length} 项`);
  const expand = items.find((c) => c.id === 'expand');
  const fusion = items.find((c) => c.id === 'multi_fusion');
  check('无负数消耗价', items.every((c) => (c.creditCost ?? 0) >= 0));
  check('多图融合价 > 单图能力', (fusion?.creditCost ?? 0) > (expand?.creditCost ?? 0),
    `fusion=${fusion?.creditCost} vs expand=${expand?.creditCost}`);

  // ── 项目与素材 ────────────────────────────────────────────────────
  console.log('\n【准备项目与素材】');
  const projectId = (await call('POST', '/projects', T, { name: '扣费冒烟' })).data?.id;
  check('项目已创建', !!projectId, projectId);

  const png = smokePng;
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'credit-smoke.png');
  fd.append('projectId', projectId);
  const upJson = await (await fetch(`${BASE}/assets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${T}` },
    body: fd,
  })).json();
  const assetId = upJson.data?.id;
  check('素材已上传', !!assetId, assetId ?? JSON.stringify(upJson).slice(0, 100));

  /*
   * 夹具：渠道 → 渠道模型 → 能力绑定 + 能力售价。
   *
   * 协议填**插件声明的 provider id**（`openai-image`）而不是插件 id
   * （`openai-images`）—— 注册表按 provider 注册，填插件 id 会在派发时
   * 报「协议尚未注册执行器」。该协议同步返回 `data[0].b64_json`，与模型桩
   * 的响应形状一致；走的是生产同一条 `ProtocolExecutor` → 出站安全链路。
   */
  const IMAGE_CONFIG = {
    version: 1,
    image: {
      references: { promptMaxChars: 4000, maxImages: 4, maxImageBytes: 0, maskSupported: false },
      size: { parameter: 'size', values: ['1:1', '16:9'], default: '1:1', allowCustom: false },
      resolution: { supported: true, values: ['1k', '2k'], default: '1k' },
      quality: { supported: false, values: [], default: 'auto' },
      transparentBackground: { supported: false, default: false },
      responseFormat: { supported: true, default: 'url' },
      outputFormat: { supported: false },
      maxOutputs: 1,
    },
  };
  const MICRO = 1_000_000n;
  const cost = expand?.creditCost ?? 0;

  const channel = await prisma.modelChannel.create({
    data: {
      userId: '',
      scope: 'system',
      enabled: true,
      name: `扣费验证渠道-${Date.now()}`,
      baseUrl: `http://127.0.0.1:${modelPort}`,
      apiKey: 'smoke-token',
      sortOrder: -100,
    },
  });
  const channelModel = await prisma.channelModel.create({
    data: {
      channelId: channel.id,
      modelKey: 'smoke-image-model',
      activeKey: 'smoke-image-model',
      providerModelKey: 'smoke-image-model',
      displayName: '扣费验证模型桩',
      capability: 'image',
      protocol: 'openai-image',
      billingMode: 'fixed_request',
      capabilityConfigJson: JSON.stringify(IMAGE_CONFIG),
      enabled: true,
      priceConfigured: false,
    },
  });
  // 能力级夹具：绑定 + 能力售价（前台模型层已删除）
  await prisma.capabilityPricing.upsert({
    where: { capabilityId: 'expand' },
    create: {
      capabilityId: 'expand',
      billingMode: 'fixed_request',
      unitPriceMicrocredits: BigInt(cost) * MICRO,
    },
    update: {
      billingMode: 'fixed_request',
      unitPriceMicrocredits: BigInt(cost) * MICRO,
    },
  });
  await prisma.capabilityModelBinding.deleteMany({ where: { capabilityId: 'expand' } });
  await prisma.capabilityModelBinding.create({
    data: { capabilityId: 'expand', channelModelId: channelModel.id, priority: 0, weight: 100, enabled: true },
  });
  const modelKey = 'smoke-image-model';
  // 本进程直接写库，目录快照不会自己失效
  app.get(require('../src/model/catalog/capability-catalog.service').CapabilityCatalogService).invalidateLocal();

  // ── 余额不足 ──────────────────────────────────────────────────────
  console.log('\n【余额不足 → 402 且不建任务】');
  check('新用户余额为 0', (await call('GET', '/credits/balance', T)).data?.balance === 0);
  const before = await prisma.generationTask.count({ where: { ownerId: user.id } });
  const poor = await call('POST', '/generate', T, {
    projectId, capability: 'expand', modelKey, inputAssetIds: [assetId], params: { ratio: '1:1' },
  });
  check('余额不足返回 402', poor.status === 402, `HTTP ${poor.status} ${poor.message ?? ''}`);
  const after = await prisma.generationTask.count({ where: { ownerId: user.id } });
  check('未产生任何任务 (没白送算力)', before === after, `${before} → ${after}`);
  check('余额未被扣成负数', (await call('GET', '/credits/balance', T)).data?.balance === 0);

  // ── 前置校验失败不扣费 ────────────────────────────────────────────
  console.log('\n【前置校验失败 → 不扣费】');
  const bad = await call('POST', '/generate', T, {
    projectId: 'no-such-project', capability: 'expand', inputAssetIds: [assetId], params: {},
  });
  check('项目不存在被拒', bad.status >= 400, `HTTP ${bad.status}`);
  check('校验失败余额不变', (await call('GET', '/credits/balance', T)).data?.balance === 0);

  // ── 发放后正常扣费 ────────────────────────────────────────────────
  console.log('\n【正常扣费】');
  const grant = 200;
  // 金额在库里是微积分（1 积分 = 1e6）；批次与账户同建，否则余额接口读不到
  const grantAmount = BigInt(grant) * 1_000_000n;
  const grantLot = await prisma.creditLot.create({
    data: { userId: user.id, source: 'grant', totalMicrocredits: grantAmount, remainingMicrocredits: grantAmount, expireAt: null },
  });
  await prisma.creditAccount.upsert({
    where: { userId: user.id },
    create: { userId: user.id, availableMicrocredits: grantAmount },
    update: { availableMicrocredits: { increment: grantAmount }, version: { increment: 1 } },
  });
  await prisma.creditLedgerEntry.create({
    data: {
      userId: user.id,
      type: 'grant',
      amountMicrocredits: grantAmount,
      availableDeltaMicrocredits: grantAmount,
      availableAfterMicrocredits: grantAmount,
      reservedAfterMicrocredits: 0n,
      lotId: grantLot.id,
      note: '冒烟发放',
    },
  });

  const ok = await call('POST', '/generate', T, {
    projectId, capability: 'expand', modelKey, inputAssetIds: [assetId], params: { ratio: '1:1' },
  });
  check('余额充足时创建成功', ok.status === 200 || ok.status === 201, `HTTP ${ok.status} ${ok.message ?? ''}`);
  check('响应带扣费快照', ok.data?.creditCost === cost, `返回 ${ok.data?.creditCost} / 期望 ${cost}`);
  const taskId = ok.data?.taskId;
  const balAfterDeduct = (await call('GET', '/credits/balance', T)).data?.balance;
  check('余额已按消耗价扣减', balAfterDeduct === grant - cost, `${balAfterDeduct} (期望 ${grant - cost})`);
  const taskRow = await prisma.generationTask.findUnique({ where: { id: taskId } });
  check('任务落库记了扣费快照', taskRow?.creditCost === cost, `creditCost=${taskRow?.creditCost}`);

  let normalTask = null;
  const normalDeadline = Date.now() + 15000;
  while (Date.now() < normalDeadline) {
    normalTask = (await call('GET', `/tasks/${taskId}`, T)).data;
    if (normalTask && (normalTask.status === 'succeeded' || normalTask.status === 'failed')) break;
    await sleep(300);
  }
  check('模型桩返回后任务成功', normalTask?.status === 'succeeded', normalTask?.status);
  check('新任务带模型分组快照', Boolean(normalTask?.modelKey), normalTask?.modelKey);

  // ── 幂等创建：重放与并发都只能扣一次 ──────────────────────────────
  console.log('\n【幂等创建 → 只扣一次、只建一个任务】');
  const idemKey = `credit-idem-${Date.now()}`;
  const tasksBeforeIdem = await prisma.generationTask.count({ where: { ownerId: user.id } });
  const ordersBeforeIdem = await prisma.billingOrder.count({ where: { userId: user.id } });
  const balanceBeforeIdem = (await call('GET', '/credits/balance', T)).data?.balance;
  const idemPayload = {
    projectId,
    capability: 'expand',
    modelKey,
    inputAssetIds: [assetId],
    params: { ratio: 'original', occupy: 80, position: 'center' },
    idempotencyKey: idemKey,
  };

  const [idemA, idemB] = await Promise.all([
    call('POST', '/generate', T, idemPayload),
    call('POST', '/generate', T, idemPayload),
  ]);
  check(
    '并发重放均成功',
    [idemA, idemB].every((r) => r.status === 200 || r.status === 201),
    `${idemA.status}/${idemB.status} ${idemA.message ?? ''} ${idemB.message ?? ''}`,
  );
  check('并发重放返回同一任务', idemA.data?.taskId === idemB.data?.taskId, `${idemA.data?.taskId} / ${idemB.data?.taskId}`);
  check(
    '竞态落败方标记幂等命中',
    idemA.data?.idempotentHit === false && idemB.data?.idempotentHit === true ||
      idemA.data?.idempotentHit === true && idemB.data?.idempotentHit === false,
    `${idemA.data?.idempotentHit}/${idemB.data?.idempotentHit}`,
  );
  check(
    '并发生成任务只增加一条',
    (await prisma.generationTask.count({ where: { ownerId: user.id } })) === tasksBeforeIdem + 1,
    `${(await prisma.generationTask.count({ where: { ownerId: user.id } }))} / ${tasksBeforeIdem + 1}`,
  );
  const ordersAfterIdem = await prisma.billingOrder.count({ where: { userId: user.id } });
  check(
    '并发只产生一张账单',
    ordersAfterIdem === ordersBeforeIdem + 1,
    `${ordersAfterIdem} / ${ordersBeforeIdem + 1}`,
  );
  check(
    '并发重放只扣一次积分',
    (await call('GET', '/credits/balance', T)).data?.balance === balanceBeforeIdem - cost,
    `${(await call('GET', '/credits/balance', T)).data?.balance} / ${balanceBeforeIdem - cost}`,
  );

  /*
   * 两路并发请求虽然已返回，任务执行仍是异步的。必须等幂等任务到达终态
   * 后再切换失败桩，否则它会在「失败退款」用例期间执行并额外退款，
   * 把余额断言污染成 195 → 190 这类假失败。
   */
  let idemTask = null;
  const idemDeadline = Date.now() + 15000;
  while (Date.now() < idemDeadline) {
    idemTask = (await call('GET', `/tasks/${idemA.data?.taskId}`, T)).data;
    if (idemTask && (idemTask.status === 'succeeded' || idemTask.status === 'failed')) break;
    await sleep(300);
  }
  check('幂等任务在切换模型桩前已完成', idemTask?.status === 'succeeded', idemTask?.status);

  // ── 上游明确拒绝 → 失败并全额退还 ────────────────────────────────
  console.log('\n【上游明确拒绝 → 任务失败并全额退还】');
  /*
   * 4xx 表示上游**没有接下这次任务**，请求不可能已计费，因此可以切线；
   * 本夹具只有一条线路，切线即「没有可用线路」，任务以 42204 失败并退款。
   *
   * 不能再用 5xx 验退款：新模型层把 5xx 归为「结果不明」（42206），
   * 刻意不切线也不退款 —— 那正是下一段要单独验的行为。
   */
  modelMode = 'reject';

  const cost2 = expand?.creditCost ?? 0;
  const balBeforeFail = (await call('GET', '/credits/balance', T)).data?.balance;

  const ok2 = await call('POST', '/generate', T, {
    projectId, capability: 'expand', modelKey, inputAssetIds: [assetId], params: { ratio: '1:1' },
  });
  check('余额充足时仍可建任务', ok2.status === 200 || ok2.status === 201, `HTTP ${ok2.status}`);
  const taskId2 = ok2.data?.taskId;
  /*
   * 不能用「余额是否少了 cost2」判断是否扣过费：任务一入库就进 worker，桩返回
   * 4xx 会瞬间失败并原额退款，等 POST 返回再读余额时扣与退往往都已发生。
   *
   * 新模型层的持久证据是账单：建任务后立即预留并落 `BillingOrder`。故断言
   * 「该任务有账单」+「账单金额 = 能力消耗价」+「任务快照 creditCost」，三段
   * 交叉证明先冻结后结算，与结算终态分开验。
   */
  const failOrder = await prisma.billingOrder.findFirst({
    where: { taskId: taskId2 },
    orderBy: { createdAt: 'desc' },
  });
  const costSnapshot = (await prisma.generationTask.findUnique({ where: { id: taskId2 } }))?.creditCost;
  check('失败任务同样先冻结积分',
    !!failOrder && failOrder.amountMicrocredits === BigInt(cost2) * MICRO && costSnapshot === cost2,
    `账单 ${failOrder?.amountMicrocredits ?? '无'} (期望 ${BigInt(cost2) * MICRO})，任务快照 ${costSnapshot} (期望 ${cost2})`);

  let t2 = null;
  const deadline2 = Date.now() + 25000;
  while (Date.now() < deadline2) {
    const r2 = await call('GET', `/tasks/${taskId2}`, T);
    t2 = r2.data;
    if (t2 && (t2.status === 'succeeded' || t2.status === 'failed')) break;
    await sleep(600);
  }
  check('上游拒绝后任务转为 failed', t2?.status === 'failed', `状态 ${t2?.status}`);
  check('线路全部不可用错误码为 42204', t2?.errorCode === '42204', t2?.errorCode);

  const rejectedAttempt = await prisma.routeAttempt.findFirst({
    where: { taskId: taskId2 },
    orderBy: { attemptNumber: 'desc' },
  });
  check('4xx 记为「明确未接单」，切线安全',
    rejectedAttempt?.dispatchState === 'rejected_no_job' && rejectedAttempt?.failureCode === 'upstream_401',
    `${rejectedAttempt?.dispatchState} / ${rejectedAttempt?.failureCode}`);

  if (t2?.status === 'failed') {
    // 退还发生在失败分支, 可能稍晚于任务状态落库, 稍等再查余额
    let balAfterRefund = balBeforeFail - cost2;
    for (let i = 0; i < 10; i++) {
      balAfterRefund = (await call('GET', '/credits/balance', T)).data?.balance;
      if (balAfterRefund === balBeforeFail) break;
      await sleep(400);
    }
    check('失败后余额已退还', balAfterRefund === balBeforeFail,
      `${balAfterRefund} (期望 ${balBeforeFail})`);

    const settled = await prisma.billingOrder.findUnique({ where: { id: failOrder.id } });
    check('失败账单转 refunded 且全额退回',
      settled?.status === 'refunded' && settled?.refundedAmountMicrocredits === settled?.amountMicrocredits,
      `${settled?.status} / ${settled?.refundedAmountMicrocredits} / ${settled?.amountMicrocredits}`);

    // 退款不是新发积分：必须按预留明细回填原批次，新建批次会让到期时间失真
    const reservationItems = await prisma.creditReservationItem.findMany({
      where: { billingOrderId: failOrder.id },
    });
    check('退款按预留明细原路回填批次', reservationItems.length > 0, `${reservationItems.length} 条`);

    const ledger = await prisma.creditLedgerEntry.findFirst({
      where: { userId: user.id, type: 'refund' },
    });
    check('退还流水已落库', !!ledger, ledger?.note ?? '未找到');
    check('退还流水金额为正 (退回而非再扣)', (ledger?.amountMicrocredits ?? 0n) > 0n, `${ledger?.amountMicrocredits}`);
  }

  /*
   * 4xx 会按 failureCode 给渠道打冷却（401 → 渠道 10 分钟）。这是运行时的正确
   * 行为，但会挡住后面的用例 —— 显式清空，让每段从「健康线路」开始。
   */
  health.clear();

  // ── 上游 5xx → 结果不明，不切线也不自动退款 ─────────────────────
  console.log('\n【上游 5xx → 42206 结果不明，冻结等人工核对】');
  modelMode = 'failure';

  const balBeforeUncertain = (await call('GET', '/credits/balance', T)).data?.balance;
  const uncertainCreate = await call('POST', '/generate', T, {
    projectId, capability: 'expand', modelKey, inputAssetIds: [assetId], params: { ratio: '1:1' },
  });
  check('5xx 用例同样可以先建任务', uncertainCreate.status === 200 || uncertainCreate.status === 201,
    `HTTP ${uncertainCreate.status}`);
  const uncertainTaskId = uncertainCreate.data?.taskId;

  let t3 = null;
  const deadline3 = Date.now() + 25000;
  while (Date.now() < deadline3) {
    t3 = (await call('GET', `/tasks/${uncertainTaskId}`, T)).data;
    if (t3 && (t3.status === 'succeeded' || t3.status === 'failed')) break;
    await sleep(600);
  }
  check('5xx 后任务转为 failed', t3?.status === 'failed', `状态 ${t3?.status}`);
  check('错误码为 42206（结果不明）', t3?.errorCode === '42206', t3?.errorCode);

  const uncertainOrder = await prisma.billingOrder.findFirst({
    where: { taskId: uncertainTaskId },
    orderBy: { createdAt: 'desc' },
  });
  check('账单保持 uncertain，积分仍在冻结',
    uncertainOrder?.status === 'uncertain' && (uncertainOrder?.refundedAmountMicrocredits ?? 0n) === 0n,
    `${uncertainOrder?.status} / 已退 ${uncertainOrder?.refundedAmountMicrocredits}`);
  check('未自动退款（余额未回到失败前）',
    (await call('GET', '/credits/balance', T)).data?.balance === balBeforeUncertain - cost2,
    `${(await call('GET', '/credits/balance', T)).data?.balance} / ${balBeforeUncertain - cost2}`);

  /*
   * 人工核对的出口：运营在后台选「退款」后余额必须原额回来。
   * 这里直接调服务（与后台接口同一条路径），不绕过账本。
   */
  await billing.refund(uncertainOrder.id, '验收：结果不明经人工核对后退款');
  let balAfterManual = balBeforeUncertain - cost2;
  for (let i = 0; i < 10; i++) {
    balAfterManual = (await call('GET', '/credits/balance', T)).data?.balance;
    if (balAfterManual === balBeforeUncertain) break;
    await sleep(300);
  }
  check('人工退款后余额原额恢复', balAfterManual === balBeforeUncertain,
    `${balAfterManual} (期望 ${balBeforeUncertain})`);

  // ── 没有模型通道 → 42204 且退款，不产出伪结果 ─────────────────
  console.log('\n【无模型通道 → 42204 且退款】');
  /*
   * 只停渠道、**不**失效目录：快照里仍保留这条线路，准入通过、执行期装配失败，
   * 正是要验的「线路在派发前失效」路径。
   */
  // 先回源一份新快照：停用渠道后 30s 内不会重载，准入才能看到这条线路
  await app.get(require('../src/model/catalog/capability-catalog.service').CapabilityCatalogService).snapshotNow();
  await prisma.modelChannel.update({ where: { id: channel.id }, data: { enabled: false } });
  const balBeforeNoChannel = (await call('GET', '/credits/balance', T)).data?.balance;
  const noChannel = await call('POST', '/generate', T, {
    projectId, capability: 'expand', modelKey, inputAssetIds: [assetId], params: { ratio: '1:1' },
  });
  check('直调仍可建任务 (由执行期判失败)', noChannel.status === 200 || noChannel.status === 201, `HTTP ${noChannel.status}`);
  let noChannelTask = null;
  const noChannelDeadline = Date.now() + 15000;
  while (Date.now() < noChannelDeadline) {
    noChannelTask = (await call('GET', `/tasks/${noChannel.data?.taskId}`, T)).data;
    if (noChannelTask && (noChannelTask.status === 'succeeded' || noChannelTask.status === 'failed')) break;
    await sleep(300);
  }
  check('无通道任务失败', noChannelTask?.status === 'failed', noChannelTask?.status);
  check('无通道错误码为 42204', noChannelTask?.errorCode === '42204', noChannelTask?.errorCode);
  check('无通道任务没有产出素材', !noChannelTask?.outputAsset, noChannelTask?.outputAsset);
  let balAfterNoChannel = balBeforeNoChannel;
  for (let i = 0; i < 10; i++) {
    balAfterNoChannel = (await call('GET', '/credits/balance', T)).data?.balance;
    if (balAfterNoChannel === balBeforeNoChannel) break;
    await sleep(300);
  }
  check('无通道失败后积分已退还', balAfterNoChannel === balBeforeNoChannel,
    `${balBeforeNoChannel} → ${balAfterNoChannel}`);

  // ── 下单 → 沙箱支付 → 发积分 ──────────────────────────────────────
  console.log('\n【下单 → 沙箱支付 → 发积分】');
  const balPreBuy = (await call('GET', '/credits/balance', T)).data?.balance;
  // 上一步退还后余额已回到 balBeforeFail; 购买段以**当前实测值**为基准,
  // 不写死 grant — 写死会让前面任何一步的偏差在此处误报成购买的问题
  const key = `smoke-${Date.now()}`;
  const o1 = await call('POST', '/orders', T, { productId: paid.id, quantity: 1, idempotencyKey: key });
  check('下单成功', o1.status === 200 || o1.status === 201, o1.data?.orderNo ?? o1.message);
  check('订单初始 pending', o1.data?.status === 'pending', o1.data?.status);
  check('订单含商品快照', !!o1.data?.items?.[0]?.name, o1.data?.items?.[0]?.name);
  /*
   * 实付金额的口径: 有活动/券时**必然小于**原价, 且折扣必须能被算术验证。
   *
   * ⚠ 这里曾写成「实付 = 原价」而失败 —— 实付 693 / 原价 990, 差的 297 分
   * 来自 seed-marketing 造的「入门积分包限时价 9.9 → 6.93」。
   * 那不是缺陷而是活动结算在生效, 反倒是「原价 fallback」之外的分支被覆盖到了。
   * 故改为断言**折扣自洽**: 有折扣时 totalCents - discountCents === paidCents。
   */
  const hasDiscount = (o1.data?.discountCents ?? 0) > 0;
  check('金额为整数分', Number.isInteger(o1.data?.paidCents), `${o1.data?.paidCents}`);
  check(
    '实付自洽 (原价 - 优惠 = 实付)',
    o1.data?.totalCents - o1.data?.discountCents === o1.data?.paidCents,
    `${o1.data?.totalCents} - ${o1.data?.discountCents} = ${o1.data?.paidCents}`,
  );
  check('实付 ≤ 原价', o1.data?.paidCents <= o1.data?.totalCents,
    `实付 ${o1.data?.paidCents} / 原价 ${o1.data?.totalCents}`);
  check('有优惠时带活动标识', !hasDiscount || !!o1.data?.campaignId,
    hasDiscount ? `campaignId=${o1.data?.campaignId}` : '无优惠');

  /*
   * 改价不影响历史订单 (commerce-design §5.2 硬规则)。
   * 把 SKU 价格改掉后重查订单, 金额与快照都必须还是下单时那一份 ——
   * 这是「金额快照」存在的唯一理由, 不测就等于没实现。
   */
  const priceBefore = paid.priceCents;
  await prisma.product.update({ where: { id: paid.id }, data: { priceCents: priceBefore + 10000 } });
  const reread = await call('GET', `/orders/${o1.data?.id}`, T);
  check('改价后历史订单金额不变', reread.data?.totalCents === o1.data?.totalCents,
    `${o1.data?.totalCents} → ${reread.data?.totalCents}`);
  check('改价后历史订单实付不变', reread.data?.paidCents === o1.data?.paidCents,
    `${o1.data?.paidCents} → ${reread.data?.paidCents}`);
  check('改价后订单快照仍是原商品名', reread.data?.items?.[0]?.name === o1.data?.items?.[0]?.name,
    reread.data?.items?.[0]?.name);
  await prisma.product.update({ where: { id: paid.id }, data: { priceCents: priceBefore } });

  const o2 = await call('POST', '/orders', T, { productId: paid.id, quantity: 1, idempotencyKey: key });
  check('同 key 重复下单返回同一订单', o2.data?.id === o1.data?.id, `${o2.data?.id} vs ${o1.data?.id}`);
  check('幂等命中被标记', o2.data?.idempotentHit === true);

  const orderId = o1.data?.id;
  const pay = await call('POST', `/orders/${orderId}/pay`, T, { scenario: 'success' });
  check('沙箱支付成功', pay.status === 200 || pay.status === 201, pay.data?.message);
  check('订单转 paid', pay.data?.order?.status === 'paid', pay.data?.order?.status);
  check('已发积分 = SKU 积分数', pay.data?.order?.grantedCredits === paid.credits,
    `${pay.data?.order?.grantedCredits} / ${paid.credits}`);

  const balAfterPay = (await call('GET', '/credits/balance', T)).data?.balance;
  check('余额 = 扣费后 + 购买所得', balAfterPay === balPreBuy + paid.credits,
    `${balPreBuy} + ${paid.credits} = ${balPreBuy + paid.credits}, 实得 ${balAfterPay}`);

  const repay = await call('POST', `/orders/${orderId}/pay`, T, { scenario: 'success' });
  check('重复支付幂等', repay.data?.idempotentHit === true, repay.data?.message);
  check('重复支付不重复发积分',
    (await call('GET', '/credits/balance', T)).data?.balance === balAfterPay);

  // 失败场景: 订单保持 pending 可重试
  console.log('\n【沙箱失败场景 → 订单保持可重试】');
  const k2 = `smoke-f-${Date.now()}`;
  const o3 = await call('POST', '/orders', T, { productId: paid.id, quantity: 1, idempotencyKey: k2 });
  const failPay = await call('POST', `/orders/${o3.data?.id}/pay`, T, { scenario: 'failed' });
  const after3 = await call('GET', `/orders/${o3.data?.id}`, T);
  check('失败后订单仍 pending (可重试)', after3.data?.status === 'pending', after3.data?.status);
  check('失败已留痕', (after3.data?.payments?.length ?? 0) >= 1, `${after3.data?.payments?.length} 条`);
  check('失败未发积分',
    (await call('GET', '/credits/balance', T)).data?.balance === balAfterPay);

  // ── 余额口径 ──────────────────────────────────────────────────────
  console.log('\n【余额口径】');
  const lots = await prisma.creditLot.findMany({ where: { userId: user.id } });
  // 批次是微积分口径，接口余额是积分口径：只在断言处换算
  const sum = Number(lots.reduce((s, l) => s + l.remainingMicrocredits, 0n) / 1_000_000n);
  check('接口余额 = Σ批次剩余', (await call('GET', '/credits/balance', T)).data?.balance === sum,
    `接口 ${(await call('GET', '/credits/balance', T)).data?.balance} / 批次汇总 ${sum}`);

  // ── 清理 ──────────────────────────────────────────────────────────
  const taskIds = (await prisma.generationTask.findMany({ where: { ownerId: user.id }, select: { id: true } }))
    .map((t) => t.id);
  const orderIds = (await prisma.billingOrder.findMany({ where: { userId: user.id }, select: { id: true } }))
    .map((o) => o.id);
  await prisma.generationTask.deleteMany({ where: { ownerId: user.id } });
  await prisma.asset.deleteMany({ where: { ownerId: user.id } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.payment.deleteMany({ where: { userId: user.id } });
  await prisma.orderItem.deleteMany({ where: { order: { userId: user.id } } });
  await prisma.order.deleteMany({ where: { userId: user.id } });
  await require('./credit-fixture').clearCredits(prisma, user.id);
  /*
   * 新模型层的运行时台账（RouteAttempt / BillingOrder / CreditReservationItem /
   * ApiCallLog）都是字符串关联、没有外键级联，不显式删就会永远留在测试库里。
   */
  await prisma.routeAttempt.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.creditReservationItem.deleteMany({ where: { billingOrderId: { in: orderIds } } });
  await prisma.billingOrder.deleteMany({ where: { userId: user.id } });
  await prisma.apiCallLog.deleteMany({ where: { userId: user.id } });
  // 模型夹具：能力绑定 → 渠道模型 → 渠道 → 能力售价
  await prisma.capabilityModelBinding.deleteMany({ where: { channelModelId: channelModel.id } });
  await prisma.capabilityPricing.deleteMany({ where: { capabilityId: 'expand' } });
  await prisma.channelModel.deleteMany({ where: { id: channelModel.id } });
  await prisma.modelChannel.deleteMany({ where: { id: channel.id } });
  // 登录写登录日志、退款失败给站内消息 —— 两者都直接引用 User,
  // 漏删任意一张都会让最后一步 delete 撞上外键, 看起来像「脚本异常」而非清理不全
  await prisma.loginLog.deleteMany({ where: { userId: user.id } });
  await prisma.notification.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });

  console.log(`\n${'='.repeat(54)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log('='.repeat(54));

  await app.close();
  await new Promise((resolve) => modelServer.close(resolve));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('[验证] 异常:', e);
  process.exit(1);
});
