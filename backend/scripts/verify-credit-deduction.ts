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
 * 覆盖 commerce-design.md C5 的三条不可让步的约定:
 *   1. 扣费在建任务之前, 余额不足不产生任务
 *   2. 生成失败必退还, 且退到**永久批次**
 *   3. 前置校验失败不扣费
 * 另验证 C 端商品端点、能力消耗价下发、购买→沙箱支付→发积分。
 */
process.env.PORT = process.env.PORT || '3011';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { ValidationPipe } = require('@nestjs/common');
const { ResponseInterceptor } = require('../dist/common/response.interceptor');

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

  const prisma = app.get(require('../dist/prisma/prisma.service').PrismaService);
  const bcrypt = require('bcryptjs');

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

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
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

  // ── 余额不足 ──────────────────────────────────────────────────────
  console.log('\n【余额不足 → 402 且不建任务】');
  check('新用户余额为 0', (await call('GET', '/credits/balance', T)).data?.balance === 0);
  const before = await prisma.generationTask.count({ where: { ownerId: user.id } });
  const poor = await call('POST', '/generate', T, {
    projectId, capability: 'expand', inputAssetIds: [assetId], params: { ratio: '1:1' },
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
  await prisma.creditLot.create({
    data: { userId: user.id, source: 'grant', totalCredits: grant, remainingCredits: grant, expireAt: null },
  });
  await prisma.creditLedger.create({
    data: { userId: user.id, type: 'grant', amount: grant, balanceAfter: grant, reason: '冒烟发放' },
  });

  const cost = expand?.creditCost ?? 0;
  const ok = await call('POST', '/generate', T, {
    projectId, capability: 'expand', inputAssetIds: [assetId], params: { ratio: '1:1' },
  });
  check('余额充足时创建成功', ok.status === 200 || ok.status === 201, `HTTP ${ok.status} ${ok.message ?? ''}`);
  check('响应带扣费快照', ok.data?.creditCost === cost, `返回 ${ok.data?.creditCost} / 期望 ${cost}`);
  const taskId = ok.data?.taskId;
  const balAfterDeduct = (await call('GET', '/credits/balance', T)).data?.balance;
  check('余额已按消耗价扣减', balAfterDeduct === grant - cost, `${balAfterDeduct} (期望 ${grant - cost})`);
  const taskRow = await prisma.generationTask.findUnique({ where: { id: taskId } });
  check('任务落库记了扣费快照', taskRow?.creditCost === cost, `creditCost=${taskRow?.creditCost}`);

  // ── 失败必退还 ────────────────────────────────────────────────────
  console.log('\n【生成失败 → 自动退还到永久批次】');
  /*
   * 难点: 删素材不足以触发失败 —— 网关不可用时 MockImageProvider 会用本地 Jimp
   * 兜底, 任务照样 succeeded, 那样根本走不到退还分支。
   *
   * 解法: 把素材记录指向一个**磁盘上不存在的文件**, readAssetBytes 的
   * provider.exists() 返回 false, 兜底 readFile 抛 ENOENT → processTask catch。
   * 这比 mock 掉 provider 更接近真实故障 (磁盘文件被清理/迁移丢失),
   * 且扣费与退还都发生在真实 HTTP 链路里。
   *
   * 必须**先破坏素材再建任务**: 任务 enqueue 后立即 setImmediate 执行,
   * 事后改库可能赶不上读取时机。
   */
  await prisma.asset.update({
    where: { id: assetId },
    data: { storageKey: 'vanished/does-not-exist.png', storageBackend: 'local' },
  });

  const cost2 = expand?.creditCost ?? 0;
  const balBeforeFail = (await call('GET', '/credits/balance', T)).data?.balance;

  const ok2 = await call('POST', '/generate', T, {
    projectId, capability: 'expand', inputAssetIds: [assetId], params: { ratio: '1:1' },
  });
  check('余额充足时仍可建任务', ok2.status === 200 || ok2.status === 201, `HTTP ${ok2.status}`);
  const taskId2 = ok2.data?.taskId;
  const balAfterFailDeduct = (await call('GET', '/credits/balance', T)).data?.balance;
  check('失败任务同样先扣费', balAfterFailDeduct === balBeforeFail - cost2,
    `${balBeforeFail} → ${balAfterFailDeduct} (期望 ${balBeforeFail - cost2})`);

  let t2 = null;
  const deadline2 = Date.now() + 25000;
  while (Date.now() < deadline2) {
    const r2 = await call('GET', `/tasks/${taskId2}`, T);
    t2 = r2.data;
    if (t2 && (t2.status === 'succeeded' || t2.status === 'failed')) break;
    await sleep(600);
  }
  check('破坏素材后任务转为 failed', t2?.status === 'failed', `状态 ${t2?.status}`);

  if (t2?.status === 'failed') {
    // 退还发生在 catch 分支, 可能稍晚于任务状态落库, 稍等再查余额
    let balAfterRefund = balAfterFailDeduct;
    for (let i = 0; i < 10; i++) {
      balAfterRefund = (await call('GET', '/credits/balance', T)).data?.balance;
      if (balAfterRefund === balBeforeFail) break;
      await sleep(400);
    }
    check('失败后余额已退还', balAfterRefund === balBeforeFail,
      `${balAfterFailDeduct} → ${balAfterRefund} (期望 ${balBeforeFail})`);

    const lastLot = await prisma.creditLot.findFirst({
      where: { userId: user.id }, orderBy: { createdAt: 'desc' },
    });
    // 退还必须落在**永久批次**: 原批次带过期日的话, 退到那里等于让用户白付
    check('退还批次为永久 (expireAt 为空)', lastLot?.expireAt === null, `expireAt=${lastLot?.expireAt}`);

    const ledger = await prisma.creditLedger.findFirst({
      where: { userId: user.id, reason: { contains: '自动退还' } },
    });
    check('退还流水已落库', !!ledger, ledger?.reason ?? '未找到');
    check('退还流水金额为正 (退回而非再扣)', (ledger?.amount ?? 0) > 0, `${ledger?.amount}`);
  }

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
  const sum = lots.reduce((s, l) => s + l.remainingCredits, 0);
  check('接口余额 = Σ批次剩余', (await call('GET', '/credits/balance', T)).data?.balance === sum,
    `接口 ${(await call('GET', '/credits/balance', T)).data?.balance} / 批次汇总 ${sum}`);

  // ── 清理 ──────────────────────────────────────────────────────────
  await prisma.generationTask.deleteMany({ where: { ownerId: user.id } });
  await prisma.asset.deleteMany({ where: { ownerId: user.id } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.payment.deleteMany({ where: { userId: user.id } });
  await prisma.orderItem.deleteMany({ where: { order: { userId: user.id } } });
  await prisma.order.deleteMany({ where: { userId: user.id } });
  await prisma.creditLedger.deleteMany({ where: { userId: user.id } });
  await prisma.creditLot.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });

  console.log(`\n${'='.repeat(54)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log('='.repeat(54));

  await app.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('[验证] 异常:', e);
  process.exit(1);
});