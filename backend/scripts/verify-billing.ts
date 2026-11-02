/**
 * 计费账本验收（P4）：预留 / 结算 / 退款 / 补扣 / 授权上限 / 人工核对。
 *
 * 直接在进程内取 `BillingService` 与 `CreditWalletService`（不起 HTTP 服务）：
 * P4 的责任边界是「账单状态机 + 资金变动」，协议分发与任务调度属于 P4-b，
 * 用真实上游去验只会把失败原因混进网络噪声。
 *
 * 守住的承诺：
 *   1. 预留：可用 → 冻结，FEFO 扣批次，写 `reserve` 流水；同一幂等键重复提交不重复冻结
 *   2. 结算：按实际用量消费，差额退回**原批次**，写 `consume`（+ 差额 `refund`）流水
 *   3. Token 补扣：实际超出预授权时从可用余额补扣；有授权上限时按上限截断
 *   4. 失败退款：未结算账单全额退回，重复调用幂等；已结算账单拒绝自动退款
 *   5. 结果不明：`uncertain` 保留冻结积分，人工核对后才落终态
 *   6. 不变量：任何一步之后 `CreditAccount.available == Σ CreditLot.remaining`
 *
 * 用法（默认开发档；测测试库请显式指定 NODE_ENV）：
 *   cd backend && npm run build && npx ts-node -T scripts/verify-billing.ts
 *   NODE_ENV=test npx ts-node -T scripts/verify-billing.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { BillingService } = require('../dist/model/billing/billing.service');
const { CreditWalletService } = require('../dist/model/billing/credit-wallet.service');
const { BillingAdminService } = require('../dist/model/billing/billing-admin.service');
const bcrypt = require('bcryptjs');

/** 1 积分 = 1e6 微积分 */
const MICRO = 1_000_000n;
/** Token 单价口径：`price / 1e6` 微积分每个 token，故 1e12 = 1 积分 / token */
const ONE_CREDIT_PER_TOKEN = 1_000_000_000_000n;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

/** 建单所需的完整价格快照；测试里全部显式给定，不经过产品目录 */
function draft(overrides: Record<string, any> = {}) {
  return {
    model: 'verify-model',
    capability: 'expand',
    scene: 'verify',
    billingMode: 'fixed_request',
    channelId: 'ch-verify',
    channelModelId: 'cm-verify',
    priceTierId: 'pt-verify',
    priceTierVersion: 1,
    priceSelectorJson: '{}',
    priceVersion: 1,
    unitPriceMicrocredits: 5n * MICRO,
    multiplierBasisPoints: 10_000n,
    userGroup: 'default',
    priceCurrency: 'credits',
    currencyRateMicrocredits: MICRO,
    quantity: 1n,
    amountMicrocredits: 5n * MICRO,
    inputTokenPriceMicrocredits: 0n,
    outputTokenPriceMicrocredits: 0n,
    cachedTokenPriceMicrocredits: 0n,
    inputTokens: 0n,
    outputTokens: 0n,
    cachedTokens: 0n,
    videoFormulaTokens: 0n,
    ...overrides,
  };
}

async function errorCode(fn: () => Promise<unknown>): Promise<{ code?: number; message?: string; thrown: boolean }> {
  try {
    await fn();
    return { thrown: false };
  } catch (e: any) {
    return { thrown: true, code: e?.code, message: e?.message };
  }
}

(async () => {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const billing = app.get(BillingService);
  const wallet = app.get(CreditWalletService);

  const stamp = Date.now();
  const email = `verify-billing-${stamp}@test.local`;
  const user = await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash('test123456', 10), name: '计费验收' },
  });
  const userId = user.id;
  const taskIds: string[] = [];

  /** 账户 / 批次快照，用于每一步后校验不变量 */
  async function snapshot() {
    const account = await prisma.creditAccount.findUnique({ where: { userId } });
    const lots = await prisma.creditLot.findMany({ where: { userId } });
    return {
      available: account?.availableMicrocredits ?? 0n,
      reserved: account?.reservedMicrocredits ?? 0n,
      lots: lots.reduce((sum, lot) => sum + lot.remainingMicrocredits, 0n),
    };
  }
  async function balanceIs(sum: bigint, reserved: bigint, label: string) {
    const snap = await snapshot();
    check(
      `${label}: 余额口径一致`,
      snap.available === sum && snap.reserved === reserved && snap.lots === sum,
      `available=${snap.available} reserved=${snap.reserved} Σ批次=${snap.lots}`,
    );
  }
  async function grant(credits: number) {
    await prisma.$transaction(async (tx: any) =>
      wallet.grant(tx, {
        userId,
        amountMicrocredits: BigInt(credits) * MICRO,
        source: 'grant',
        type: 'grant',
        meta: { note: '计费验收发放' },
      }),
    );
  }
  function taskId(label: string) {
    const id = `verify-bill-${stamp}-${label}`;
    taskIds.push(id);
    return id;
  }
  async function reserve(label: string, overrides: Record<string, any>, extra: Record<string, any> = {}) {
    return billing.reserveTaskBilling({
      userId,
      taskId: taskId(label),
      idempotencyKey: `verify-${stamp}-${label}`,
      draft: draft(overrides) as any,
      ...extra,
    });
  }

  console.log('\n【准备】');
  await grant(100);
  const start = await snapshot();
  check('发放 100 积分到账', start.available === 100n * MICRO, `available=${start.available}`);
  check('发放同时建了批次', start.lots === start.available && start.reserved === 0n);
  const grantEntry = await prisma.creditLedgerEntry.findFirst({
    where: { userId, type: 'grant' },
    orderBy: { createdAt: 'desc' },
  });
  check('发放流水关联到批次', Boolean(grantEntry?.lotId), grantEntry?.lotId ?? '未找到');

  // ── 预留 ────────────────────────────────────────────────────────────
  console.log('\n【预留】');
  const r1 = await reserve('reserve', {});
  check('账单进入 reserved', r1.order.status === 'reserved', r1.order.status);
  check('预留金额写入账单', r1.order.reservedAmountMicrocredits === 5n * MICRO, `${r1.order.reservedAmountMicrocredits}`);
  await balanceIs(95n * MICRO, 5n * MICRO, '预留后');
  const reserveEntry = await prisma.creditLedgerEntry.findFirst({
    where: { userId, type: 'reserve', billingOrderId: r1.order.id },
  });
  check('写了 reserve 流水', Boolean(reserveEntry), reserveEntry?.id ?? '未找到');
  check(
    'reserve 流水：可用 -5 / 冻结 +5',
    reserveEntry?.availableDeltaMicrocredits === -5n * MICRO &&
      reserveEntry?.reservedDeltaMicrocredits === 5n * MICRO,
    `${reserveEntry?.availableDeltaMicrocredits} / ${reserveEntry?.reservedDeltaMicrocredits}`,
  );
  const items = await prisma.creditReservationItem.findMany({ where: { billingOrderId: r1.order.id } });
  check('预留明细按批次记录', items.length >= 1 && items.every((item: any) => item.microcredits > 0n), `${items.length} 条`);

  console.log('\n【幂等：同一幂等键重复提交】');
  const again = await billing.reserveTaskBilling({
    userId,
    taskId: r1.order.taskId,
    idempotencyKey: `verify-${stamp}-reserve`,
    draft: draft() as any,
  });
  check('重复提交命中幂等', again.idempotentHit === true, `idempotentHit=${again.idempotentHit}`);
  check('返回同一张账单', again.order.id === r1.order.id, `${again.order.id} / ${r1.order.id}`);
  await balanceIs(95n * MICRO, 5n * MICRO, '重复提交后');

  // ── 结算：全额消费 ──────────────────────────────────────────────────
  console.log('\n【结算：固定价全额消费】');
  const settled1 = await billing.settle(r1.order.id, {});
  check('账单进入 settled', settled1.status === 'settled', settled1.status);
  check('实际消耗 = 预留', settled1.actualAmountMicrocredits === 5n * MICRO, `${settled1.actualAmountMicrocredits}`);
  check('无差额退回', settled1.refundedAmountMicrocredits === 0n, `${settled1.refundedAmountMicrocredits}`);
  await balanceIs(95n * MICRO, 0n, '结算后');
  const consumeOfR1 = await prisma.creditLedgerEntry.count({
    where: { userId, type: 'consume', billingOrderId: r1.order.id },
  });
  check('只写一条 consume 流水', consumeOfR1 === 1, `${consumeOfR1} 条`);
  const settleAgain = await billing.settle(r1.order.id, {});
  check('重复结算幂等', settleAgain.status === 'settled' && settleAgain.actualAmountMicrocredits === 5n * MICRO);
  check(
    '重复结算不再写流水',
    (await prisma.creditLedgerEntry.count({
      where: { userId, type: 'consume', billingOrderId: r1.order.id },
    })) === 1,
  );

  // ── Token 结算：差额退回 ────────────────────────────────────────────
  console.log('\n【Token 结算：预授权多扣 → 差额退回】');
  const tokenOrder = await reserve('token-refund', {
    billingMode: 'token',
    capability: 'text',
    amountMicrocredits: 10n * MICRO,
    outputTokenPriceMicrocredits: ONE_CREDIT_PER_TOKEN,
  });
  await balanceIs(85n * MICRO, 10n * MICRO, 'Token 预留后');
  await prisma.apiCallLog.create({
    data: {
      userId,
      taskId: tokenOrder.order.taskId,
      billingOrderId: tokenOrder.order.id,
      startedAt: new Date(),
      status: 'success',
      usageAvailable: true,
      billable: true,
      inputTokens: 0n,
      outputTokens: 3n,
      cachedTokens: 0n,
    },
  });
  const tokenSettled = await billing.settle(tokenOrder.order.id, {});
  check('按 3 个输出 token 结算（3 积分）', tokenSettled.actualAmountMicrocredits === 3n * MICRO, `${tokenSettled.actualAmountMicrocredits}`);
  check('差额 7 积分退回', tokenSettled.refundedAmountMicrocredits === 7n * MICRO, `${tokenSettled.refundedAmountMicrocredits}`);
  check('用量来源标记为 provider', tokenSettled.usageSource === 'provider' && tokenSettled.usageAvailable === true, `${tokenSettled.usageSource}`);
  await balanceIs(92n * MICRO, 0n, 'Token 结算后');
  const refundEntry = await prisma.creditLedgerEntry.findFirst({
    where: { userId, type: 'refund', billingOrderId: tokenOrder.order.id },
  });
  check('差额退回写 refund 流水', refundEntry?.amountMicrocredits === 7n * MICRO, `${refundEntry?.amountMicrocredits}`);

  // ── Token 结算：补扣 ────────────────────────────────────────────────
  console.log('\n【Token 结算：实际超预授权 → 补扣差额】');
  const supplementOrder = await reserve('token-supplement', {
    billingMode: 'token',
    capability: 'text',
    amountMicrocredits: 2n * MICRO,
    outputTokenPriceMicrocredits: ONE_CREDIT_PER_TOKEN,
  });
  await prisma.apiCallLog.create({
    data: {
      userId,
      taskId: supplementOrder.order.taskId,
      billingOrderId: supplementOrder.order.id,
      startedAt: new Date(),
      status: 'success',
      usageAvailable: true,
      billable: true,
      outputTokens: 5n,
    },
  });
  const supplemented = await billing.settle(supplementOrder.order.id, {});
  check('按 5 积分结算（超出预授权 3）', supplemented.actualAmountMicrocredits === 5n * MICRO, `${supplemented.actualAmountMicrocredits}`);
  check('无退回金额', supplemented.refundedAmountMicrocredits === 0n);
  await balanceIs(87n * MICRO, 0n, '补扣后');
  const supplementEntry = await prisma.creditLedgerEntry.findFirst({
    where: { userId, type: 'consume', billingOrderId: supplementOrder.order.id },
  });
  check(
    'consume 流水：可用 -3 / 冻结 -2',
    supplementEntry?.availableDeltaMicrocredits === -3n * MICRO &&
      supplementEntry?.reservedDeltaMicrocredits === -2n * MICRO,
    `${supplementEntry?.availableDeltaMicrocredits} / ${supplementEntry?.reservedDeltaMicrocredits}`,
  );
  check('补扣留痕', String(supplementEntry?.note ?? '').includes('补扣'), supplementEntry?.note ?? '');

  // ── Token 结算：授权上限截断 ────────────────────────────────────────
  console.log('\n【Token 结算：命中授权上限 → 按上限结算】');
  // 预授权必须在授权上限内（超了直接拒绝），截断只发生在事后按实际用量结算时
  const limitedOrder = await reserve(
    'token-limit',
    { billingMode: 'token', capability: 'text', amountMicrocredits: 3n * MICRO, outputTokenPriceMicrocredits: ONE_CREDIT_PER_TOKEN },
    { chargeLimitMicrocredits: 4n * MICRO },
  );
  await prisma.apiCallLog.create({
    data: {
      userId,
      taskId: limitedOrder.order.taskId,
      billingOrderId: limitedOrder.order.id,
      startedAt: new Date(),
      status: 'success',
      usageAvailable: true,
      billable: true,
      outputTokens: 20n,
    },
  });
  const limitedSettled = await billing.settle(limitedOrder.order.id, {});
  check('实际用量 20 被截断到上限 4', limitedSettled.actualAmountMicrocredits === 4n * MICRO, `${limitedSettled.actualAmountMicrocredits}`);
  check('截断不产生退回（实际高于预授权）', limitedSettled.refundedAmountMicrocredits === 0n, `${limitedSettled.refundedAmountMicrocredits}`);
  await balanceIs(83n * MICRO, 0n, '上限结算后');
  const limitEntry = await prisma.creditLedgerEntry.findFirst({
    where: { userId, type: 'consume', billingOrderId: limitedOrder.order.id },
  });
  check('上限结算留痕', String(limitEntry?.note ?? '').includes('上限'), limitEntry?.note ?? '');

  console.log('\n【超出授权上限的预授权被拒】');
  const overLimit = await errorCode(() => reserve('token-over-limit', { amountMicrocredits: 8n * MICRO }, { chargeLimitMicrocredits: 4n * MICRO }));
  check('拒绝超上限请求', overLimit.thrown === true, overLimit.message);
  check(
    '不留下半截账单',
    (await prisma.billingOrder.count({ where: { userId, idempotencyKey: `verify-${stamp}-token-over-limit` } })) === 0,
  );
  await balanceIs(83n * MICRO, 0n, '拒绝后');

  // ── Token 结算：上游无 usage ────────────────────────────────────────
  console.log('\n【Token 结算：上游没有用量 → 拒绝结算并保留冻结】');
  const noUsage = await reserve('token-no-usage', {
    billingMode: 'token',
    capability: 'text',
    amountMicrocredits: 2n * MICRO,
    outputTokenPriceMicrocredits: ONE_CREDIT_PER_TOKEN,
  });
  const noUsageResult = await errorCode(() => billing.settle(noUsage.order.id, {}));
  check('无 usage 结算失败', noUsageResult.code === 40909, `${noUsageResult.code} ${noUsageResult.message}`);
  const noUsageOrder = await billing.get(noUsage.order.id);
  check('账单仍未结算', noUsageOrder.status === 'reserved', noUsageOrder.status);
  await balanceIs(81n * MICRO, 2n * MICRO, '无 usage 后');
  await billing.refund(noUsage.order.id, '无用量，退回预授权');
  await balanceIs(83n * MICRO, 0n, '退回预授权后');

  // ── 按秒计费 ────────────────────────────────────────────────────────
  console.log('\n【按秒计费：按实际时长重算】');
  const secondOrder = await reserve('per-second', {
    billingMode: 'per_second',
    capability: 'audio',
    unitPriceMicrocredits: 2n * MICRO,
    quantity: 3n,
    amountMicrocredits: 6n * MICRO,
  });
  const noDuration = await errorCode(() => billing.settle(secondOrder.order.id, {}));
  check('缺少实际时长拒绝结算', noDuration.code === 40909, `${noDuration.code} ${noDuration.message}`);
  const secondSettled = await billing.settle(secondOrder.order.id, { audioDurationMs: 4500 });
  check('时长向上取整为 5 秒', secondSettled.quantity === 5n, `${secondSettled.quantity}`);
  check('按 5 秒结算 = 10 积分', secondSettled.actualAmountMicrocredits === 10n * MICRO, `${secondSettled.actualAmountMicrocredits}`);
  await balanceIs(73n * MICRO, 0n, '按秒结算后');

  // ── 失败退款 ────────────────────────────────────────────────────────
  console.log('\n【失败退款】');
  const refundOrder = await reserve('refund', {});
  await balanceIs(68n * MICRO, 5n * MICRO, '退款前');
  const refunded = await billing.refund(refundOrder.order.id, '上游返回 500');
  check('账单进入 refunded', refunded.status === 'refunded', refunded.status);
  check('错误原因留痕', refunded.errorText.includes('500'), refunded.errorText);
  await balanceIs(73n * MICRO, 0n, '退款后');
  await billing.refund(refundOrder.order.id, '重复调用');
  check(
    '重复退款幂等',
    (await prisma.creditLedgerEntry.count({ where: { userId, type: 'refund', billingOrderId: refundOrder.order.id } })) === 1,
  );
  await balanceIs(73n * MICRO, 0n, '重复退款后');

  console.log('\n【已结算账单不允许自动退款】');
  const settledRefund = await errorCode(() => billing.refund(r1.order.id, '已结算'));
  check('拒绝自动退款', settledRefund.code === 40909, `${settledRefund.code} ${settledRefund.message}`);

  // ── 结果不明 ────────────────────────────────────────────────────────
  console.log('\n【结果不明：保留冻结，人工核对】');
  const uncertainOrder = await reserve('uncertain', {});
  await billing.markRunning(uncertainOrder.order.id);
  check('进入 running', (await billing.get(uncertainOrder.order.id)).status === 'running');
  await billing.markUncertain(uncertainOrder.order.id, '上游超时，结果未知');
  const uncertainRow = await billing.get(uncertainOrder.order.id);
  check('账单转 uncertain', uncertainRow.status === 'uncertain', uncertainRow.status);
  await balanceIs(68n * MICRO, 5n * MICRO, 'uncertain 后（积分仍冻结）');
  const emptyNote = await errorCode(() => billing.resolve(uncertainOrder.order.id, 'refund', userId, '  '));
  check('人工核对必须填依据', emptyNote.code === 40001, `${emptyNote.code} ${emptyNote.message}`);
  const resolved = await billing.resolve(uncertainOrder.order.id, 'refund', userId, '上游确认未执行');
  check('核对后退款', resolved.status === 'refunded', resolved.status);
  check('留下核对人', resolved.resolvedBy === userId, resolved.resolvedBy ?? '');
  await balanceIs(73n * MICRO, 0n, '核对退款后');

  // ── 余额不足 ────────────────────────────────────────────────────────
  console.log('\n【余额不足】');
  const poorUser = await prisma.user.create({
    data: { email: `verify-billing-poor-${stamp}@test.local`, passwordHash: await bcrypt.hash('test123456', 10), name: '余额不足' },
  });
  await prisma.$transaction(async (tx: any) =>
    wallet.grant(tx, { userId: poorUser.id, amountMicrocredits: MICRO, source: 'grant', type: 'grant' }),
  );
  const poor = await errorCode(() =>
    billing.reserveTaskBilling({
      userId: poorUser.id,
      taskId: `verify-bill-poor-${stamp}`,
      idempotencyKey: `verify-${stamp}-poor`,
      draft: draft() as any,
    }),
  );
  check('余额不足拒绝预留', poor.code === 40002, `${poor.code} ${poor.message}`);
  check(
    '失败不留下账单',
    (await prisma.billingOrder.count({ where: { userId: poorUser.id } })) === 0,
  );
  const poorAccount = await prisma.creditAccount.findUnique({ where: { userId: poorUser.id } });
  check(
    '余额与冻结都未变',
    poorAccount?.availableMicrocredits === MICRO && poorAccount?.reservedMicrocredits === 0n,
    `${poorAccount?.availableMicrocredits} / ${poorAccount?.reservedMicrocredits}`,
  );

  // ── 是否转人工 ──────────────────────────────────────────────────────
  console.log('\n【失败是否需要人工核对】');
  const reviewOrder = await reserve('review', {});
  check('超时错误要求人工', await billing.failureRequiresReview(reviewOrder.order.id, reviewOrder.order.taskId, new Error('upstream timeout')));
  check('普通 400 不要求人工', !(await billing.failureRequiresReview(reviewOrder.order.id, reviewOrder.order.taskId, new Error('bad request'))));
  await prisma.apiCallLog.create({
    data: {
      userId,
      taskId: reviewOrder.order.taskId,
      billingOrderId: reviewOrder.order.id,
      startedAt: new Date(),
      status: 'success',
      billable: true,
      usageAvailable: false,
      outputTokens: 1n,
    },
  });
  check('已有成功调用则要求人工', await billing.failureRequiresReview(reviewOrder.order.id, reviewOrder.order.taskId, new Error('bad request')));

  // ── 待核对队列与批量核对 ────────────────────────────────────────────
  console.log('\n【待核对队列（review）与批量核对】');
  {
    const admin = app.get(BillingAdminService);
    // 一条 uncertain：进队列
    const uncertainOrder = await reserve('review-queue', {});
    await billing.markUncertain(uncertainOrder.order.id, '验收：结果不明');
    // 一条 reserved 但任务已失败：进队列
    const failedTaskOrder = await reserve('review-failed-task', {});
    const reviewProject = await prisma.project.create({
      data: { ownerId: userId, name: '待核对验收项目' },
    });
    await prisma.generationTask.create({
      data: {
        id: failedTaskOrder.order.taskId,
        projectId: reviewProject.id,
        ownerId: userId,
        capability: 'expand',
        status: 'failed',
        inputAssetIds: '[]',
        params: '{}',
        provider: 'gateway',
        creditCost: 5,
      },
    });
    // 一条正常 reserved、任务未失败：不进队列
    const normalOrder = await reserve('review-normal', {});

    const queue = await admin.listOrders({ status: 'review', pageSize: 100 });
    const queuedIds = queue.items.map((item: any) => item.id);
    check('待核对队列含 uncertain 单', queuedIds.includes(uncertainOrder.order.id), queuedIds.length);
    check('待核对队列含「任务失败但仍预留」单', queuedIds.includes(failedTaskOrder.order.id));
    check('待核对队列不含正常预留单', !queuedIds.includes(normalOrder.order.id));

    // 批量核对：逐条独立处置，单条失败不影响其余
    const batch = await admin.batchResolveOrders(
      [uncertainOrder.order.id, failedTaskOrder.order.id, 'not-exist-id'],
      'refund',
      '验收脚本批量核对',
      'verify-admin',
    );
    check('批量核对逐条返回结果', batch.total === 3 && batch.results.length === 3, batch.total);
    check('批量核对成功 2 条', batch.resolved === 2, batch.resolved);
    check('批量核对失败 1 条并带原因', batch.failed === 1 && Boolean(batch.results[2]?.error), batch.results[2]?.error);
    const afterBatch = await prisma.billingOrder.findUnique({ where: { id: uncertainOrder.order.id } });
    check('批量核对后账单已退款', afterBatch?.status === 'refunded', afterBatch?.status);
    const afterBatch2 = await prisma.billingOrder.findUnique({ where: { id: failedTaskOrder.order.id } });
    check('批量核对后第二笔也退款', afterBatch2?.status === 'refunded', afterBatch2?.status);
    check(
      '批量核对留下核对人与依据',
      afterBatch?.resolvedBy === 'verify-admin' && afterBatch?.resolutionNote === '验收脚本批量核对',
      { by: afterBatch?.resolvedBy, note: afterBatch?.resolutionNote },
    );
    const batchError = await errorCode(() => admin.batchResolveOrders([], 'refund', 'x', 'verify-admin'));
    check('批量核对拒绝空列表', batchError.code === 40001, `${batchError.code} ${batchError.message}`);
    const batchError2 = await errorCode(() =>
      admin.batchResolveOrders([uncertainOrder.order.id], 'refund', '', 'verify-admin'),
    );
    check('批量核对缺原因被拒', batchError2.code === 40001, `${batchError2.code} ${batchError2.message}`);

    await prisma.generationTask.deleteMany({ where: { id: failedTaskOrder.order.taskId } });
    await prisma.project.deleteMany({ where: { id: reviewProject.id } });
  }

  // ── 清理 ────────────────────────────────────────────────────────────
  const userIds = [userId, poorUser.id];
  await prisma.apiCallLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.creditReservationItem.deleteMany({
    where: { billingOrderId: { in: (await prisma.billingOrder.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((o: any) => o.id) } },
  });
  await prisma.billingOrder.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.creditLedgerEntry.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.creditLot.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.creditAccount.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  await app.close();
  console.log(`\n${'='.repeat(54)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log('='.repeat(54));
  process.exit(fail > 0 ? 1 : 0);
})().catch(async (e: any) => {
  console.error('[FATAL]', e?.message ?? e);
  process.exit(1);
});
