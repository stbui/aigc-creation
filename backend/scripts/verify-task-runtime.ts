/**
 * 任务运行时验收（P4-b）：准入 → 派发 → 切线 → 轮询 → 收尾。
 *
 * 验收口径（`docs/channel-model-design.md` §10 P4）：
 *   端到端跑通「成功 / 上游拒绝切线 / 超时不切换 / 失败退款」四条路径。
 *
 * 为什么用真实 HTTP mock 上游而不是桩掉执行器：
 *   本阶段的全部风险都在「哪一步算没发出去」——协议模板、出站安全、失败码归一、
 *   dispatchState 判定，任何一层被桩掉，切线策略就变成了自证。这里起一个本机
 *   HTTP 服务，按请求体里的 `model` 字段决定行为（成功 / 401 / 429），
 *   走的是和生产完全相同的 `ProtocolExecutor` → `outboundRequest` 链路。
 *
 * 为什么不起 HTTP 应用层：
 *   建任务、鉴权、项目、素材上传的接线已由 `verify-free-create-e2e` 覆盖；
 *   这里直接调 `TaskAdmissionService.admit()`（与 `GenerateService.createTask`
 *   同一个入口），把断言集中在任务状态机与账单状态机上。
 *
 * 四个场景各自使用独立的渠道 / 渠道模型 / 前台模型：
 *   线路健康冷却、目录快照都是进程内状态，复用同一渠道会让「上一个场景的 401」
 *   把下一个场景的线路一起冷却，测试之间互相污染。
 *
 * Token 补扣 / 退差不在本脚本：那是账单层的算术，已由 `npm run verify:billing`
 * （结算差额退回、超预授权补扣、授权上限截断）逐条覆盖；本脚本只证明
 * 「固定价账单随线路切换被正确替换，并在终态结算 / 退款」。
 *
 * 运行：cd backend && npm run verify:task-runtime
 *      （默认开发档；测测试库请显式 `NODE_ENV=test`）
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
// 本机 mock 上游是 127.0.0.1：出站层默认拒绝私网，必须在 ConfigModule 装载前放行。
// 已存在的非空环境变量不会被 env 文件覆盖，故这里显式赋值即可。
process.env.MODEL_ALLOW_PRIVATE_UPSTREAMS = 'true';

const http = require('node:http');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../src/app.module');
const { PrismaService } = require('../src/prisma/prisma.service');
const { TaskAdmissionService } = require('../src/model/tasks/task-admission.service');
const { TaskWorkerService } = require('../src/model/tasks/task-worker.service');
const { RouteCatalogService } = require('../src/model/catalog/route-catalog.service');
const { RouterService } = require('../src/model/routing/router.service');
const { RouteHealthService } = require('../src/model/routing/route-health.service');
const { BillingService } = require('../src/model/billing/billing.service');
const { UserGroupService } = require('../src/model/user-groups/user-group.service');
const { StorageService } = require('../src/storage/storage.service');
const { capabilitySpecFromModelCapabilityConfig } = require('../src/model/intent/capability-spec');
const { restrictIntentToSpec } = require('../src/model/intent/model-intent');
const { getCapability, sanitizeParams } = require('../src/capabilities/capability.registry');
const { Jimp } = require('jimp');
const bcrypt = require('bcryptjs');
const { grantCredits, clearCredits } = require('./credit-fixture');

/** 1 积分 = 1e6 微积分 */
const MICRO = 1_000_000n;
/** 任务终态轮询上限：本机 mock 是同步返回，正常 1 秒内落库；给 30 秒兜住落盘与标识 */
const WAIT_MS = 30_000;

let pass = 0;
const fails: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}${detail !== undefined ? ` — ${fmt(detail)}` : ''}`);
    return;
  }
  fails.push(`${name}${detail !== undefined ? ` — ${fmt(detail)}` : ''}`);
  console.log(`  FAIL  ${name}${detail !== undefined ? ` — ${fmt(detail)}` : ''}`);
}
const fmt = (value: unknown) => String(typeof value === 'object' ? JSON.stringify(value) : value).slice(0, 300);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 渠道模型能力配置：尺寸走比例枚举、画质走独立分辨率档。
 *
 * 与 `free_create` 的意图形状对齐：`ratio` → 意图 `size`（'1:1'），
 * `size`（画质）→ 意图 `imageResolution`（'1k'）。两处都必须在合同里声明，
 * 否则匹配阶段会以「不支持参数」拒绝——那是测试夹具的问题，不是运行时的。
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

/**
 * 本机 mock 上游：按请求体的 `model` 决定行为。
 *
 * 只实现 `agnes-image` 插件用到的两个端点：创建与结果文件下载。
 * `POST /v1/images/generations` 的响应形状与该插件清单一致（`data[].url`）。
 */
async function startMockUpstream() {
  const png = await new Jimp({ width: 240, height: 240, color: 0x3366ccff }).getBuffer('image/png');
  /** model → 已收到的创建请求数；断言「不该发的请求一次都没发」靠它 */
  const hits = new Map<string, number>();
  const server = http.createServer((req: any, res: any) => {
    if (req.method === 'GET' && req.url === '/files/ok.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
      res.end(png);
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        let model = '';
        try {
          model = String(JSON.parse(Buffer.concat(chunks).toString('utf8'))?.model ?? '');
        } catch {
          model = '';
        }
        hits.set(model, (hits.get(model) ?? 0) + 1);
        if (model.includes('reject401')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
          return;
        }
        if (model.includes('reject429')) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'rate limit exceeded' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ url: `${origin}/files/ok.png` }] }));
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `unknown path ${req.url}` } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    hitsOf: (model: string) => hits.get(model) ?? 0,
    totalHits: () => [...hits.values()].reduce((sum, n) => sum + n, 0),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function main() {
  const mock = await startMockUpstream();
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  // 必须显式 init：`NestFactory.create` 不触发 onModuleInit，插件清单与协议注册表
  // 都靠生命周期钩子装载；不 init 的话 protocol 全是未注册，派发一律
  // `channel_unavailable`，看起来像渠道问题、实际是装配没跑。
  await app.init();
  const prisma = app.get(PrismaService);
  const admission = app.get(TaskAdmissionService);
  const worker = app.get(TaskWorkerService);
  const catalog = app.get(RouteCatalogService);
  const router = app.get(RouterService);
  const groups = app.get(UserGroupService);
  const billing = app.get(BillingService);
  const health = app.get(RouteHealthService);
  // 上一次运行（或其它脚本）留下的冷却不应影响本次判定
  health.clear();

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const created = {
    userIds: [] as string[],
    projectIds: [] as string[],
    channelIds: [] as string[],
    channelModelIds: [] as string[],
    logicalModelIds: [] as string[],
  };

  /** 建渠道：系统渠道，凭证明文即可（SecretCipher 对无前缀值按明文读） */
  async function makeChannel(name: string) {
    const channel = await prisma.modelChannel.create({
      data: {
        name: `${name}-${stamp}`,
        baseUrl: mock.origin,
        apiKey: 'sk-verify-task-runtime',
        scope: 'system',
        enabled: true,
        concurrencyLimit: 0,
      },
    });
    created.channelIds.push(channel.id);
    return channel;
  }

  /** 建渠道模型：协议固定 `agnes-image`（插件清单里的同步生图协议） */
  async function makeChannelModel(channelId: string, modelKey: string, withPrice?: number) {
    const model = await prisma.channelModel.create({
      data: {
        channelId,
        modelKey,
        activeKey: modelKey.toLowerCase(),
        providerModelKey: modelKey,
        displayName: modelKey,
        capability: 'image',
        protocol: 'agnes-image',
        billingMode: 'fixed_request',
        capabilityConfigJson: JSON.stringify(IMAGE_CONFIG),
        enabled: true,
        priceConfigured: withPrice !== undefined,
      },
    });
    created.channelModelIds.push(model.id);
    if (withPrice !== undefined) {
      await prisma.channelModelPriceTier.create({
        data: {
          channelModelId: model.id,
          activeKey: '{}',
          selectorKey: '{}',
          selectorJson: '{}',
          providerModelKey: modelKey,
          billingMode: 'fixed_request',
          unitPriceMicrocredits: BigInt(withPrice) * MICRO,
          priceConfigured: true,
          enabled: true,
        },
      });
    }
    return model;
  }

  /**
   * 建前台模型：一次发布 = 一个 revision + 若干线路。
   *
   * @param pricePolicy `unified` 用标量价；`channel` 跟随线路价格档
   */
  async function makeLogicalModel(input: {
    code: string;
    pricePolicy?: 'unified' | 'channel';
    priceCredits?: number;
    routes: Array<{ channelModelId: string; priority: number }>;
  }) {
    const spec = capabilitySpecFromModelCapabilityConfig(IMAGE_CONFIG, 'image');
    const model = await prisma.logicalModel.create({
      data: {
        code: input.code,
        activeKey: input.code.toLowerCase(),
        name: `验收模型 ${input.code}`,
        // 准入按「前台模型 capability == 请求能力 id」校验，这里必须是 C 端能力 id
        // 而不是模态；模态在 revision 的能力合同里（`capability: 'image'`）。
        capability: 'free_create',
        enabled: true,
        pricePolicy: input.pricePolicy ?? 'unified',
        billingMode: 'fixed_request',
        unitPriceMicrocredits: BigInt(input.priceCredits ?? 0) * MICRO,
      },
    });
    created.logicalModelIds.push(model.id);
    const revision = await prisma.logicalModelRevision.create({
      data: {
        logicalModelId: model.id,
        version: 1,
        capabilitySpecJson: JSON.stringify(spec),
        defaultOptionsJson: '{}',
      },
    });
    for (const route of input.routes) {
      await prisma.logicalModelRoute.create({
        data: {
          logicalModelRevisionId: revision.id,
          channelModelId: route.channelModelId,
          priority: route.priority,
          weight: 100,
          enabled: true,
        },
      });
    }
    const published = await prisma.logicalModel.update({
      where: { id: model.id },
      data: { activeRevisionId: revision.id, revisionSequence: 1 },
    });
    // 本进程直接写库，目录快照不会自己失效
    catalog.invalidateLocal();
    return published;
  }

  /** 提交一次任务（走真实准入：能力裁剪 → 选路 → 计价 → 预留） */
  async function admitTask(ownerId: string, projectId: string, logicalModelId: string, label: string) {
    return admission.admit({
      ownerId,
      dto: {
        projectId,
        capability: 'free_create',
        logicalModelId,
        inputAssetIds: [],
        params: { prompt: `验收 ${label}：一张干净的产品主图`, ratio: '1:1', size: '1k' },
      },
    });
  }

  /** 等到任务离开 queued / running */
  async function waitTerminal(taskId: string) {
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      const task = await prisma.generationTask.findUnique({ where: { id: taskId } });
      if (task && task.status !== 'queued' && task.status !== 'running') return task;
      await sleep(100);
    }
    return prisma.generationTask.findUnique({ where: { id: taskId } });
  }

  async function walletOf(userId: string) {
    const account = await prisma.creditAccount.findUnique({ where: { userId } });
    return {
      available: account?.availableMicrocredits ?? 0n,
      reserved: account?.reservedMicrocredits ?? 0n,
    };
  }

  try {
    /* ── 夹具：账号 + 项目 ─────────────────────────────── */
    const user = await prisma.user.create({
      data: {
        email: `verify-task-runtime-${stamp}@test.local`,
        passwordHash: await bcrypt.hash('test123456', 10),
        name: '任务运行时验收',
      },
    });
    created.userIds.push(user.id);
    const project = await prisma.project.create({ data: { ownerId: user.id, name: '任务运行时验收' } });
    created.projectIds.push(project.id);
    // 每个场景独立计费，方便逐条核对余额；一次发放 100 积分
    await grantCredits(prisma, { userId: user.id, credits: 100, reason: '任务运行时验收' });
    const initialWallet = await walletOf(user.id);
    check('夹具：发放 100 积分', initialWallet.available === 100n * MICRO, initialWallet.available.toString());

    /* ══ 场景 A：同步成功 ══════════════════════════════
     * 一次派发即出图 → 下载 → AIGC 标识 → 落盘 → 账单结算。
     * 断言的核心是「上游真的被调了一次」「扣的是目录价而不是能力默认价」。 */
    console.log('\n[A] 成功：派发 → 产物落盘 → 账单结算');
    {
      const channel = await makeChannel('rt-ok');
      const channelModel = await makeChannelModel(channel.id, `mock-ok-a-${stamp}`);
      const model = await makeLogicalModel({ code: `rt-ok-${stamp}`, priceCredits: 7, routes: [{ channelModelId: channelModel.id, priority: 0 }] });

      const admitted = await admitTask(user.id, project.id, model.id, 'A');
      check('A 准入返回 queued', admitted.status === 'queued', admitted.status);
      check('A 任务快照价 = 目录价 7 积分（非能力默认 10）', admitted.creditCost === 7, admitted.creditCost);

      worker.kick();
      const task = await waitTerminal(admitted.taskId);
      check('A 任务终态 succeeded', task?.status === 'succeeded', task?.status);
      check('A 上游被调用 1 次', mock.hitsOf(`mock-ok-a-${stamp}`) === 1, mock.hitsOf(`mock-ok-a-${stamp}`));

      const asset = task?.outputAssetId ? await prisma.asset.findUnique({ where: { id: task.outputAssetId } }) : null;
      check('A 产物素材已落库', Boolean(asset), task?.outputAssetId ?? '');
      check('A 产物格式按字节嗅探为 image/png', asset?.format === 'image/png', asset?.format);
      check('A 产物记录了 AIGC 标识时间', Boolean(asset?.aigcLabeledAt), asset?.aigcLabeledAt);

      const order = await prisma.billingOrder.findUnique({ where: { id: task?.billingOrderId ?? '' } });
      check('A 账单 settled', order?.status === 'settled', order?.status);
      check('A 按预留额结算，无差额', order?.actualAmountMicrocredits === 7n * MICRO && order?.refundedAmountMicrocredits === 0n, {
        actual: order?.actualAmountMicrocredits?.toString(),
        refunded: order?.refundedAmountMicrocredits?.toString(),
      });

      const attempt = await prisma.routeAttempt.findFirst({ where: { taskId: admitted.taskId } });
      check('A 尝试状态 succeeded / accepted', attempt?.status === 'succeeded' && attempt?.dispatchState === 'accepted', {
        status: attempt?.status,
        dispatchState: attempt?.dispatchState,
      });

      const wallet = await walletOf(user.id);
      check('A 可用余额扣掉 7 积分、冻结归零', wallet.available === initialWallet.available - 7n * MICRO && wallet.reserved === 0n, {
        available: wallet.available.toString(),
        reserved: wallet.reserved.toString(),
      });
    }

    /* ══ 场景 B：上游 401 → 切线 → 换账单 ═══════════════
     * 401 属于「上游明确没接」，允许切线；新线路价格档与旧线路不同，
     * 旧账单必须退回、新账单按新价预留——这是「按 A 的价走 B 的线路」的唯一防线。 */
    console.log('\n[B] 上游 401：切线、替换账单、新线路成功');
    const afterA = await walletOf(user.id);
    {
      const reject = await makeChannel('rt-reject');
      const rejectModel = await makeChannelModel(reject.id, `mock-reject401-${stamp}`, 9);
      const okChannel = await makeChannel('rt-fallback');
      const okModel = await makeChannelModel(okChannel.id, `mock-ok-b-${stamp}`, 4);
      const model = await makeLogicalModel({
        code: `rt-switch-${stamp}`,
        pricePolicy: 'channel',
        routes: [
          { channelModelId: rejectModel.id, priority: 1 },
          { channelModelId: okModel.id, priority: 0 },
        ],
      });

      const admitted = await admitTask(user.id, project.id, model.id, 'B');
      check('B 首轮命中高价线路（9 积分）', admitted.creditCost === 9, admitted.creditCost);

      worker.kick();
      const task = await waitTerminal(admitted.taskId);
      check('B 任务终态 succeeded', task?.status === 'succeeded', task?.status);
      check('B 两条线路各被调用 1 次', mock.hitsOf(`mock-reject401-${stamp}`) === 1 && mock.hitsOf(`mock-ok-b-${stamp}`) === 1, {
        reject: mock.hitsOf(`mock-reject401-${stamp}`),
        ok: mock.hitsOf(`mock-ok-b-${stamp}`),
      });

      const attempts = await prisma.routeAttempt.findMany({
        where: { taskId: admitted.taskId },
        orderBy: { attemptNumber: 'asc' },
      });
      check('B 尝试共 2 次', attempts.length === 2, attempts.length);
      check(
        'B 首次尝试记录 401 且标记「上游没接」',
        attempts[0]?.status === 'failed' && attempts[0]?.dispatchState === 'rejected_no_job' && attempts[0]?.failureCode === 'upstream_401',
        { status: attempts[0]?.status, dispatchState: attempts[0]?.dispatchState, failureCode: attempts[0]?.failureCode },
      );
      check('B 第二次尝试 succeeded', attempts[1]?.status === 'succeeded', attempts[1]?.status);

      const orders = await prisma.billingOrder.findMany({ where: { taskId: admitted.taskId }, orderBy: { createdAt: 'asc' } });
      check('B 账单被替换（共 2 单）', orders.length === 2, orders.length);
      check('B 旧账单按原额退回', orders[0]?.status === 'refunded' && orders[0]?.amountMicrocredits === 9n * MICRO, {
        status: orders[0]?.status,
        amount: orders[0]?.amountMicrocredits?.toString(),
      });
      check('B 新账单按新线路价（4 积分）结算', orders[1]?.status === 'settled' && orders[1]?.amountMicrocredits === 4n * MICRO, {
        status: orders[1]?.status,
        amount: orders[1]?.amountMicrocredits?.toString(),
      });
      check('B 任务当前账单指向新单', task?.billingOrderId === orders[1]?.id, task?.billingOrderId);
      check('B 任务展示价同步为新单金额', task?.creditCost === 4, task?.creditCost);

      const wallet = await walletOf(user.id);
      check('B 最终只扣 4 积分、无冻结残留', wallet.available === afterA.available - 4n * MICRO && wallet.reserved === 0n, {
        available: wallet.available.toString(),
        reserved: wallet.reserved.toString(),
      });
    }

    /* ══ 场景 C：轮询超时 → 不切线 ═════════════════════
     * 上游已受理（accepted）后，超过 modality 的轮询时限只能转「结果不明」：
     * 上游可能已经产出并计费，换线路重发会让平台白付一次调用。
     * 这里不真等 15 分钟：把任务构造成「已受理 + createdAt 已过时限」的运行中状态，
     * 由 worker 自己的轮询分支判定。 */
    console.log('\n[C] 轮询超时：转结果不明，不切线、不退款');
    const afterB = await walletOf(user.id);
    {
      const channel = await makeChannel('rt-timeout');
      const channelModel = await makeChannelModel(channel.id, `mock-ok-c1-${stamp}`, 5);
      const backupChannel = await makeChannel('rt-timeout-backup');
      const backupModel = await makeChannelModel(backupChannel.id, `mock-ok-c2-${stamp}`, 5);
      const model = await makeLogicalModel({
        code: `rt-timeout-${stamp}`,
        pricePolicy: 'channel',
        routes: [
          { channelModelId: channelModel.id, priority: 1 },
          { channelModelId: backupModel.id, priority: 0 },
        ],
      });
      // 用与准入完全相同的意图与计价口径建一张「已受理、等轮询」的任务：
      // 参数必须过一遍能力和参数的清洗与裁剪，否则测的就成了「手搓意图能否选路」
      const def = getCapability('free_create');
      const params = sanitizeParams('free_create', { prompt: '验收 C', ratio: '1:1', size: '1k' });
      const cached = await router.findModel(model.id);
      const access = await groups.accessForUser(user.id);
      const intent = restrictIntentToSpec(cached.productSpec, def.model.intent(params, { image: 0, video: 0 }));
      const routed = await router.resolve(access, model.id, intent);
      const draft = billing.buildDraft(access, routed);

      const task = await prisma.generationTask.create({
        data: {
          projectId: project.id,
          ownerId: user.id,
          capability: 'free_create',
          status: 'running',
          stage: 'poll',
          // 回拨 16 分钟：图像模态的轮询时限是 15 分钟
          createdAt: new Date(Date.now() - 16 * 60_000),
          inputAssetIds: '[]',
          params: JSON.stringify(params),
          provider: 'gateway',
          creditCost: Number(draft.amountMicrocredits / MICRO),
          logicalModelId: model.id,
          logicalModelRevisionId: routed.revisionId,
          routeId: routed.route.id,
          channelModelId: routed.channelModel.id,
          routeRun: 1,
          leaseOwner: '',
          nextPollAt: new Date(Date.now() - 1000),
          providerRequestId: 'mock-job-timeout',
        },
      });
      const reserved = await billing.reserveTaskBilling({
        userId: user.id,
        taskId: task.id,
        idempotencyKey: `task:${task.id}`,
        draft,
      });
      await prisma.generationTask.update({
        where: { id: task.id },
        data: { billingOrderId: reserved.order.id, authorizedChargeMicrocredits: reserved.reserved },
      });
      await prisma.routeAttempt.create({
        data: {
          taskId: task.id,
          routeRun: 1,
          attemptNumber: 1,
          logicalModelId: model.id,
          logicalModelRevisionId: routed.revisionId,
          routeId: routed.route.id,
          channelModelId: routed.channelModel.id,
          channelId: routed.channelModel.channelId,
          // 上游已受理：此后任何失败都不允许切线
          status: 'dispatching',
          dispatchState: 'accepted',
          providerRequestId: 'mock-job-timeout',
        },
      });
      const hitsBefore = mock.totalHits();
      worker.kick();
      const done = await waitTerminal(task.id);
      check('C 任务终态 failed', done?.status === 'failed', done?.status);
      check('C 错误码 42206（结果不明）', done?.errorCode === '42206', done?.errorCode);
      check('C 未切换线路（上游调用数不变）', mock.totalHits() === hitsBefore, `${hitsBefore} → ${mock.totalHits()}`);
      check('C 备份线路一次都没被调用', mock.hitsOf(`mock-ok-c2-${stamp}`) === 0, mock.hitsOf(`mock-ok-c2-${stamp}`));
      check('C 尝试仍只有 1 条', (await prisma.routeAttempt.count({ where: { taskId: task.id } })) === 1);

      const order = await prisma.billingOrder.findUnique({ where: { id: reserved.order.id } });
      check('C 账单转 uncertain（保留冻结，等人工核对）', order?.status === 'uncertain', order?.status);
      const wallet = await walletOf(user.id);
      check('C 冻结仍为报价额、未退款', wallet.reserved === draft.amountMicrocredits && wallet.available === afterB.available - draft.amountMicrocredits, {
        available: wallet.available.toString(),
        reserved: wallet.reserved.toString(),
      });
    }

    /* ══ 场景 D：唯一线路 429 → 无路可切 → 失败退款 ════
     * 429 属于「上游没接」，切线是安全的；但本轮只有这一条线路，
     * 于是按「没有可用线路」42204 失败并原额退款。 */
    console.log('\n[D] 失败退款：全部线路拒绝 → 42204 + 账单退回');
    const afterC = await walletOf(user.id);
    {
      const channel = await makeChannel('rt-refund');
      const channelModel = await makeChannelModel(channel.id, `mock-reject429-${stamp}`);
      const model = await makeLogicalModel({ code: `rt-refund-${stamp}`, priceCredits: 6, routes: [{ channelModelId: channelModel.id, priority: 0 }] });

      const admitted = await admitTask(user.id, project.id, model.id, 'D');
      worker.kick();
      const task = await waitTerminal(admitted.taskId);
      check('D 任务终态 failed', task?.status === 'failed', task?.status);
      check('D 错误码 42204（无可用线路）', task?.errorCode === '42204', task?.errorCode);
      check('D 上游只被调用 1 次（未重复派发）', mock.hitsOf(`mock-reject429-${stamp}`) === 1, mock.hitsOf(`mock-reject429-${stamp}`));

      const attempt = await prisma.routeAttempt.findFirst({ where: { taskId: admitted.taskId } });
      check('D 尝试记录 429 且不可重发', attempt?.dispatchState === 'rejected_no_job' && attempt?.failureCode === 'upstream_429', {
        dispatchState: attempt?.dispatchState,
        failureCode: attempt?.failureCode,
      });
      check('D 没有新建尝试', (await prisma.routeAttempt.count({ where: { taskId: admitted.taskId } })) === 1);

      const order = await prisma.billingOrder.findUnique({ where: { id: task?.billingOrderId ?? '' } });
      check('D 账单 refunded 且全额', order?.status === 'refunded' && order?.refundedAmountMicrocredits === 6n * MICRO, {
        status: order?.status,
        refunded: order?.refundedAmountMicrocredits?.toString(),
      });

      const wallet = await walletOf(user.id);
      // 冻结额里仍有场景 C 的待核对账单，这里只要求「本场景没多扣、没卡住钱」
      check('D 余额与本场景开始时一致（C 的冻结保持原样）', wallet.available === afterC.available && wallet.reserved === afterC.reserved, {
        available: wallet.available.toString(),
        reserved: wallet.reserved.toString(),
      });
    }

    /* ── 不变量：可用余额 == Σ 批次剩余 ──────────────────
     * 预授权在预留时就从批次里扣走（`reserve` 内 FEFO 扣批次），因此
     * 批次剩余与「可用余额」始终一致，冻结额是两者的差之外的独立口径。
     * 这条不变量一旦破了，说明有账单没走钱包层、直接改了账户金额。 */
    {
      const account = await prisma.creditAccount.findUnique({ where: { userId: user.id } });
      const lots = await prisma.creditLot.findMany({ where: { userId: user.id } });
      const remaining = lots.reduce((sum: bigint, lot: any) => sum + lot.remainingMicrocredits, 0n);
      check(
        '不变量：可用余额 == 批次剩余合计',
        (account?.availableMicrocredits ?? 0n) === remaining,
        `${(account?.availableMicrocredits ?? 0n).toString()} vs ${remaining.toString()}`,
      );
    }
  } finally {
    await cleanup();
    await app.close();
    await mock.close();
  }

  console.log(`\n任务运行时验收：通过 ${pass} 项，失败 ${fails.length} 项`);
  if (fails.length > 0) {
    for (const failure of fails) console.log(`  ✗ ${failure}`);
    process.exitCode = 1;
  }

  /** 清理本轮现场：按外键依赖顺序删，避免污染后续脚本 */
  async function cleanup() {
    try {
      const tasks = await prisma.generationTask.findMany({ where: { ownerId: { in: created.userIds } }, select: { id: true } });
      const taskIds = tasks.map((task: any) => task.id);
      await prisma.apiCallLog.deleteMany({ where: { taskId: { in: taskIds } } });
      await prisma.routeAttempt.deleteMany({ where: { taskId: { in: taskIds } } });
      await prisma.generationTask.deleteMany({ where: { ownerId: { in: created.userIds } } });
      // 产物文件先按 storageKey 删掉再删行：只删行会在 uploads/generated 下
      // 留下一批无人引用的孤儿文件，反复跑验收目录会越来越大
      const assets = await prisma.asset.findMany({
        where: { ownerId: { in: created.userIds } },
        select: { storageBackend: true, storageKey: true },
      });
      for (const asset of assets) {
        if (!asset.storageKey) continue;
        const provider = app.get(StorageService).get((asset.storageBackend as any) ?? 'local');
        await provider?.delete(asset.storageKey).catch(() => undefined);
      }
      await prisma.asset.deleteMany({ where: { ownerId: { in: created.userIds } } });
      await prisma.project.deleteMany({ where: { ownerId: { in: created.userIds } } });
      for (const userId of created.userIds) await clearCredits(prisma, userId).catch(() => undefined);
      await prisma.notification.deleteMany({ where: { userId: { in: created.userIds } } }).catch(() => undefined);
      await prisma.channelModelPriceTier.deleteMany({ where: { channelModelId: { in: created.channelModelIds } } });
      await prisma.channelModel.deleteMany({ where: { id: { in: created.channelModelIds } } });
      await prisma.modelChannel.deleteMany({ where: { id: { in: created.channelIds } } });
      const revisions = await prisma.logicalModelRevision.findMany({
        where: { logicalModelId: { in: created.logicalModelIds } },
        select: { id: true },
      });
      await prisma.logicalModelRoute.deleteMany({ where: { logicalModelRevisionId: { in: revisions.map((r: any) => r.id) } } });
      await prisma.logicalModelRevision.deleteMany({ where: { id: { in: revisions.map((r: any) => r.id) } } });
      await prisma.logicalModel.deleteMany({ where: { id: { in: created.logicalModelIds } } });
      await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
      catalog.invalidateLocal();
    } catch (error) {
      console.log(`  （清理未完成：${(error as Error).message}）`);
    }
  }
}

main().catch((error) => {
  console.error('[FATAL]', error?.stack ?? error);
  process.exitCode = 1;
  // app 若已 listen 或 worker 定时器仍在，不显式退出会挂住进程
  setTimeout(() => process.exit(1), 200);
});
