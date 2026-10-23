/**
 * 支付 / 对账 / 发票链路冒烟 (2026-10-21, B3)。
 *
 * 这三块共享同一条资金链路, 任何一处回归都会表现为「钱收了, 账不对」,
 * 所以放在同一个脚本里按真实顺序跑: 下单 → 预下单 → 渠道回调 → 对账 → 开票。
 *
 * 钉死的契约:
 *
 *   1. 预下单返回可识别的 mode (沙箱 / 跳转 / 二维码); 沙箱通道不产生外呼
 *   2. 回调走**公开路由**, 靠报文里的订单号入账; 重复回调幂等 (只发一次积分)
 *   3. 金额不符 → 订单**不置 paid**, 回执失败 (让渠道重试), 并落对账差异
 *   4. 订单不存在 → 回执失败 + missing_local 差异 (渠道收了钱本地没单)
 *   5. 对账导入识别 matched / amount_mismatch / missing_local / missing_channel /
 *      duplicate 五类; 处置只改状态与备注, 不改钱; 重复处置 409
 *   6. 发票一单一票、企业抬头必须有税号、未支付订单不能开票
 *   7. 开具后产出可打印 HTML; 已开具的票不能再开具或驳回
 *   8. 退款**先打回渠道再改本地账**: 渠道失败/未配置时订单状态与积分不变;
 *      渠道处理中 (processing) 不动本地账; 有在途退款时拒绝再次发起 (40908)
 *
 * ## 环境
 *
 *   API_BASE    后端地址 (默认 http://127.0.0.1:4100)
 *   NODE_ENV    决定连哪个库 (与 scripts/db-url.js 同一套档位)
 *
 * 例: NODE_ENV=test API_BASE=http://127.0.0.1:4200 node scripts/smoke-payments.js
 *
 * 后台动作 (开票审核 / 对账) 需要一个**本脚本新建的**管理员夹具账号:
 * 直接写库建 user(role=admin) + 确保 AdminRole 记录存在。不复用 seed:admin
 * 的一次性密码 (它只打印一次且不落盘)。
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
const { loadEnvOnce, resolveDbUrl } = require('./db-url');

loadEnvOnce();

const BASE = (process.env.API_BASE || 'http://127.0.0.1:4100').replace(/\/$/, '') + '/api/v1';
const prisma = new PrismaClient({
  adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
});

/** 本次运行的唯一后缀 —— 交易号/邮箱都必须可重跑且互不干扰 */
const RUN = `${Date.now()}`;

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
  return { httpStatus: res.status, ...json };
}

/** multipart 上传: 不能手写 Content-Type (boundary 由 fetch 生成) */
async function upload(path, token, file, fields) {
  const fd = new FormData();
  fd.append('file', new Blob([file.content], { type: 'text/csv' }), file.name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { httpStatus: res.status, ...json };
}

/** 取原始响应 (CSV / HTML 不套信封) */
async function raw(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  return { httpStatus: res.status, contentType: res.headers.get('content-type') ?? '', text };
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

/** 本地日期 YYYY-MM-DD —— 必须与后端按本地时区切分账单日一致 */
function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

(async () => {
  // ── 夹具: 普通用户 + 管理员 ──────────────────────────────────────
  const userA = await call('POST', '/auth/register', null, {
    email: `smoke-pay-a-${RUN}@test.local`,
    password: 'test123456',
    name: '支付冒烟 A',
  });
  if (userA.code !== 0) throw new Error(`注册 A 失败: ${userA.message}`);
  const TA = userA.data.accessToken;

  const hash = await bcrypt.hash('test123456', 10);
  const adminUser = await prisma.user.create({
    data: { email: `smoke-pay-admin-${RUN}@test.local`, passwordHash: hash, name: '支付冒烟管理员', role: 'admin' },
  });
  /*
   * 权限点由 AdminRole 表提供: 缺记录等于零权限。
   * update 分支也要写 permissions —— 测试库里的角色记录可能是在
   * `finance.reconcile` 等新权限点加入之前种的, 只 create 不 update
   * 会让脚本以「无操作权限」失败, 且原因与被测功能无关。
   */
  const { ROLE_PERMISSIONS } = require('../dist/admin/permissions');
  const adminPerms = JSON.stringify(ROLE_PERMISSIONS.admin);
  await prisma.adminRole.upsert({
    where: { code: 'admin' },
    update: { permissions: adminPerms },
    create: { code: 'admin', name: '管理员', permissions: adminPerms },
  });
  const adminLogin = await call('POST', '/auth/login', null, {
    email: adminUser.email,
    password: 'test123456',
  });
  const TADMIN = adminLogin.data?.accessToken;
  if (!TADMIN) throw new Error(`管理员登录失败: ${adminLogin.message}`);

  // 取一个可购买的积分包 —— 不写死 SKU, 种子改了脚本不该跟着坏
  const product = await prisma.product.findFirst({
    where: { status: 'active', credits: { gt: 0 }, priceCents: { gt: 0 } },
    orderBy: { priceCents: 'asc' },
  });
  if (!product) throw new Error('库里没有可购买的积分包, 先跑 npm run seed:commerce');

  const idem = (tag) => `smoke-pay-${RUN}-${tag}`;

  /** 建单 + 返回订单 */
  async function newOrder(tag) {
    const r = await call('POST', '/orders', TA, {
      productId: product.id,
      quantity: 1,
      idempotencyKey: idem(tag),
    });
    if (r.code !== 0) throw new Error(`下单失败 (${tag}): ${r.message}`);
    return r.data;
  }

  // ── 1. 预下单 ────────────────────────────────────────────────────
  console.log('\n【预下单】');
  const order1 = await newOrder('intent');
  const intent = await call('POST', `/payments/${order1.id}/intent`, TA);
  check('预下单成功', intent.code === 0, intent.message);
  const sandboxChannel = intent.data?.channel === 'sandbox';
  check(
    '返回可识别的支付方式',
    ['sandbox', 'redirect', 'qrcode'].includes(intent.data?.mode),
    `channel=${intent.data?.channel} mode=${intent.data?.mode}`,
  );
  if (sandboxChannel) {
    check('沙箱通道不返回跳转地址/二维码', !intent.data.payUrl && !intent.data.codeUrl);
  } else {
    console.log('  NOTE  当前实例配置了真实通道, 沙箱专用断言跳过');
  }
  const dupIntent = await call('POST', `/payments/${order1.id}/intent`, null);
  check('预下单需登录 (401)', dupIntent.httpStatus === 401, dupIntent.message);

  // ── 1.5 支付渠道状态 (只读) ──────────────────────────────────────
  // 放在沙箱分支之前: 无论当前生效哪条通道都要能看状态 ——
  // 真实通道配错时恰恰更需要这一屏。
  console.log('\n【支付渠道状态】');
  const channelsAdmin = await call('GET', '/admin/payment-channels', TADMIN);
  check(
    '管理员可读支付渠道状态',
    channelsAdmin.code === 0 && Array.isArray(channelsAdmin.data?.channels),
    channelsAdmin.message,
  );
  check('通道清单覆盖 sandbox/alipay/wechat', (channelsAdmin.data?.channels ?? []).length === 3);
  check(
    '当前通道在已登记通道内',
    ['sandbox', 'alipay', 'wechat'].includes(channelsAdmin.data?.active),
    channelsAdmin.data?.active,
  );
  check(
    '缺失项只给变量名, 不回传凭据值',
    !/BEGIN [A-Z ]*PRIVATE KEY|apiV3Key"\s*:\s*"[^"]+|WECHAT_PRIVATE_KEY\s*=/.test(
      JSON.stringify(channelsAdmin.data ?? {}),
    ),
  );
  const sandboxRow = (channelsAdmin.data?.channels ?? []).find((c) => c.channel === 'sandbox');
  check('沙箱通道没有渠道回调地址', sandboxRow?.notifyUrl === null);
  check(
    '真实通道给出回调地址',
    (channelsAdmin.data?.channels ?? [])
      .filter((c) => c.channel !== 'sandbox')
      .every((c) => typeof c.notifyUrl === 'string' && c.notifyUrl.includes('/payments/callback/')),
  );
  const channelsDenied = await call('GET', '/admin/payment-channels', TA);
  check(
    '普通用户不能读支付渠道状态 (403)',
    channelsDenied.httpStatus === 403 || channelsDenied.code === 40301,
    channelsDenied.message,
  );

  if (!sandboxChannel) {
    console.log('\n当前环境不是沙箱通道, 回调/对账段落无法离线执行, 已跳过');
    console.log(`\n合计: ${pass} 通过 / ${fail} 失败\n`);
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  }

  // ── 2. 沙箱回调: 正常入账 + 幂等 ─────────────────────────────────
  console.log('\n【渠道回调】');
  const trade1 = `SMOKE-MATCH-${RUN}`;
  const cb1 = await call('POST', '/payments/callback/sandbox', null, {
    orderNo: order1.orderNo,
    tradeNo: trade1,
    amountCents: order1.paidCents,
  });
  check('回调入账被接受', cb1.httpStatus === 200 && cb1.success === true, JSON.stringify(cb1).slice(0, 120));

  const st1 = await call('GET', `/payments/${order1.id}/status`, TA);
  check('订单已置为已支付', st1.data?.status === 'paid', st1.data?.status);
  check('支付流水可追溯到渠道交易号', st1.data?.payments?.[0]?.payTransactionId === trade1);

  // 下单响应里的 grantedCredits 是建单时的值 (0), 入账后要看订单详情
  const order1Paid = await call('GET', `/orders/${order1.id}`, TA);
  const bal1 = await call('GET', '/credits/balance', TA);
  check(
    '积分按订单发放',
    order1Paid.data?.grantedCredits === product.credits && bal1.data?.balance === product.credits,
    `余额 ${bal1.data?.balance} / 订单发放 ${order1Paid.data?.grantedCredits} / 商品 ${product.credits}`,
  );

  const rawRow = await prisma.payment.findFirst({ where: { orderId: order1.id } });
  check('回调原始报文已留档', !!rawRow?.rawPayload && rawRow.rawPayload.includes(trade1));

  const cb1Again = await call('POST', '/payments/callback/sandbox', null, {
    orderNo: order1.orderNo,
    tradeNo: trade1,
    amountCents: order1.paidCents,
  });
  check('重复回调回执成功 (渠道停止重试)', cb1Again.httpStatus === 200);
  const bal1b = await call('GET', '/credits/balance', TA);
  check('重复回调不重复发积分', bal1b.data?.balance === bal1.data?.balance, `${bal1b.data?.balance}`);

  // ── 3. 金额不符 / 订单不存在 ─────────────────────────────────────
  console.log('\n【回调异常】');
  const order2 = await newOrder('mismatch');
  const trade2 = `SMOKE-MISMATCH-${RUN}`;
  const cbBad = await call('POST', '/payments/callback/sandbox', null, {
    orderNo: order2.orderNo,
    tradeNo: trade2,
    amountCents: order2.paidCents + 100,
  });
  check('金额不符回执失败 (渠道会重试)', cbBad.httpStatus === 400 && cbBad.success === false);
  const st2 = await call('GET', `/payments/${order2.id}/status`, TA);
  check('金额不符时订单不置为已支付', st2.data?.status === 'pending', st2.data?.status);

  const cbGhost = await call('POST', '/payments/callback/sandbox', null, {
    orderNo: `GHOST-${RUN}`,
    tradeNo: `SMOKE-GHOST-${RUN}`,
    amountCents: 100,
  });
  check('未知订单回执失败', cbGhost.httpStatus === 400, cbGhost.message);

  const cbMissing = await call('POST', '/payments/callback/sandbox', null, {
    orderNo: order1.orderNo,
    amountCents: 100,
  });
  check('缺交易号被拒', cbMissing.httpStatus === 400);

  // 回调产生的差异应落在同一批 (callback) 批次里
  const cbDiffs = await prisma.reconciliationItem.findMany({
    where: { tradeNo: { in: [trade2, `SMOKE-GHOST-${RUN}`] } },
  });
  check('金额不符落 amount_mismatch 差异', cbDiffs.some((d) => d.diffType === 'amount_mismatch'));
  check('未知订单落 missing_local 差异', cbDiffs.some((d) => d.diffType === 'missing_local'));

  // ── 4. 对账导入 ──────────────────────────────────────────────────
  console.log('\n【对账导入】');
  const order3 = await newOrder('matched');
  const trade3 = `SMOKE-RECON-${RUN}`;
  await call('POST', '/payments/callback/sandbox', null, {
    orderNo: order3.orderNo,
    tradeNo: trade3,
    amountCents: order3.paidCents,
  });

  // 本地有、账单里没有 → missing_channel
  const order4 = await newOrder('local-only');
  await call('POST', `/orders/${order4.id}/pay`, TA, { scenario: 'success' });

  /*
   * 金额不符必须建立在**本地确有这笔成功支付**之上:
   * 本地没有记录的行会被判成 missing_local, 与金额无关。
   * 所以再造一笔正常入账的支付, 然后在账单里把金额写少 1 元。
   */
  const order6 = await newOrder('amount-mismatch-local');
  const trade6 = `SMOKE-AMT-${RUN}`;
  await call('POST', '/payments/callback/sandbox', null, {
    orderNo: order6.orderNo,
    tradeNo: trade6,
    amountCents: order6.paidCents,
  });

  const billDate = localDate();
  const dupTrade = `SMOKE-DUP-${RUN}`;
  const csv = [
    'tradeNo,amountCents,orderNo',
    `${trade3},${order3.paidCents},${order3.orderNo}`,
    // 本地这笔的真实金额是 order6.paidCents; 账单写成少 1 元 → amount_mismatch
    `${trade6},${order6.paidCents - 100},${order6.orderNo}`,
    // 渠道有、本地无 → missing_local
    `SMOKE-CHANNEL-ONLY-${RUN},500,`,
    `${dupTrade},800,`,
    `${dupTrade},800,`,
  ].join('\n');

  const imported = await upload('/admin/reconciliation/import', TADMIN, {
    name: 'smoke-bill.csv',
    content: csv,
  }, { channel: 'sandbox', billDate });
  check('导入成功', imported.code === 0, imported.message);
  const items = imported.data?.items ?? [];
  const byType = (t) => items.filter((i) => i.diffType === t);
  check('识别出一致行', byType('matched').some((i) => i.tradeNo === trade3));
  check('识别金额不符', byType('amount_mismatch').some((i) => i.tradeNo === trade6));
  check('识别本地缺单', byType('missing_local').some((i) => i.tradeNo === `SMOKE-CHANNEL-ONLY-${RUN}`));
  check('识别重复交易', byType('duplicate').some((i) => i.tradeNo === dupTrade));
  check('识别渠道缺单', byType('missing_channel').length >= 1);
  check(
    '批次差异计数与明细一致',
    imported.data?.batch?.diffCount === items.filter((i) => i.diffType !== 'matched').length,
    `${imported.data?.batch?.diffCount}`,
  );
  check('一致行已自动结案', byType('matched').every((i) => i.status === 'resolved'));

  const batchId = imported.data?.batch?.id;
  const matchedItem = byType('matched')[0];
  const resolveMatched = await call('POST', `/admin/reconciliation/items/${matchedItem.id}/resolve`, TADMIN, {
    status: 'resolved',
    note: '不该成功',
  });
  check('一致行不可处置 (400)', resolveMatched.code === 40001, resolveMatched.message);

  const mismatchItem = byType('amount_mismatch')[0];
  const noNote = await call('POST', `/admin/reconciliation/items/${mismatchItem.id}/resolve`, TADMIN, {
    status: 'resolved',
    note: '   ',
  });
  check('处置必须填说明', noNote.code === 40001, noNote.message);

  const resolved = await call('POST', `/admin/reconciliation/items/${mismatchItem.id}/resolve`, TADMIN, {
    status: 'resolved',
    note: '已在订单模块补单, 冒烟脚本',
  });
  check('处置成功', resolved.code === 0 && resolved.data?.status === 'resolved', resolved.message);
  const resolvedAgain = await call('POST', `/admin/reconciliation/items/${mismatchItem.id}/resolve`, TADMIN, {
    status: 'ignored',
    note: '重复处置',
  });
  check('重复处置被拒 (409)', resolvedAgain.httpStatus === 409, resolvedAgain.message);

  const exportCsv = await raw(`/admin/reconciliation/batches/${batchId}/export`, TADMIN);
  check('差异清单可导出 CSV', exportCsv.httpStatus === 200 && exportCsv.contentType.includes('text/csv'));
  check('导出内容含交易号', exportCsv.text.includes(trade3));

  const forbidden = await call('GET', '/admin/reconciliation/batches', TA);
  check('普通用户不能访问对账 (403)', forbidden.httpStatus === 403 || forbidden.code === 40301, forbidden.message);

  // ── 5. 退款: 先打回渠道, 再改本地账 ──────────────────────────────
  /*
   * 退款在 2026-10-22 从「改库」变成「真的调渠道」。这里钉死的是**顺序与失败语义**:
   * 渠道没确认成功之前, 订单状态与积分一分都不能动 —— 反过来写会造出
   * 「库里显示已退款、用户却没收到钱」的资损路径, 而且事后无从区分。
   */
  console.log('\n【退款】');

  /** 建单 + 沙箱回调入账, 返回订单 */
  async function paidOrder(tag, tradeTag) {
    const o = await newOrder(tag);
    const cb = await call('POST', '/payments/callback/sandbox', null, {
      orderNo: o.orderNo,
      tradeNo: `SMOKE-${tradeTag}-${RUN}`,
      amountCents: o.paidCents,
    });
    if (cb.httpStatus !== 200 || cb.success !== true) throw new Error(`入账失败 (${tag})`);
    return o;
  }

  // 5.1 全额退款 (沙箱通道)
  const orderR1 = await paidOrder('refund-full', 'REFUND-FULL');
  const balBefore = await call('GET', '/credits/balance', TA);
  const refunded = await call('POST', `/admin/orders/${orderR1.id}/refund`, TADMIN, {
    amountCents: orderR1.paidCents,
    reason: '冒烟脚本全额退款',
  });
  check('沙箱全额退款成功', refunded.code === 0 && refunded.data?.state === 'succeeded', refunded.message);
  check(
    '退款结果为终态并标记全额',
    refunded.data?.pending === false && refunded.data?.fullyRefunded === true,
    `pending=${refunded.data?.pending} fully=${refunded.data?.fullyRefunded}`,
  );

  const refundRow = await prisma.refund.findFirst({ where: { orderId: orderR1.id } });
  check('退款单落库为 succeeded', refundRow?.status === 'succeeded', refundRow?.status);
  check('退款单金额与申请一致', refundRow?.amountCents === orderR1.paidCents, `${refundRow?.amountCents}`);
  /*
   * 沙箱没有真实渠道交易, 因此 providerRefundId 必须为空。
   * 这里**故意不造假单号** —— 出现值说明代码在编造渠道回执。
   */
  check('沙箱不伪造渠道退款单号', !refundRow?.providerRefundId, refundRow?.providerRefundId);

  const oR1 = await call('GET', `/orders/${orderR1.id}`, TA);
  check('订单置为已退款', oR1.data?.status === 'refunded', oR1.data?.status);
  const balAfter = await call('GET', '/credits/balance', TA);
  check(
    '退款回收该订单发放的积分',
    balBefore.data?.balance - balAfter.data?.balance === product.credits,
    `${balBefore.data?.balance} → ${balAfter.data?.balance} (应减少 ${product.credits})`,
  );
  const reclaimLedger = await prisma.creditLedger.findFirst({
    where: { orderId: orderR1.id, type: 'refund_reclaim' },
  });
  check('积分回收留有 refund_reclaim 流水', reclaimLedger?.amount === -product.credits, `${reclaimLedger?.amount}`);

  // 5.2 部分退款: 分两次退完, 第二次不重复扣积分
  const orderR2 = await paidOrder('refund-partial', 'REFUND-PART');
  const half = Math.floor(orderR2.paidCents / 2);
  const part1 = await call('POST', `/admin/orders/${orderR2.id}/refund`, TADMIN, {
    amountCents: half,
    reason: '冒烟脚本部分退款',
  });
  check('部分退款成功', part1.code === 0 && part1.data?.state === 'succeeded', part1.message);
  check('部分退款后不是全额', part1.data?.fullyRefunded === false, `refunded=${part1.data?.refundedCents}`);
  const oR2a = await call('GET', `/orders/${orderR2.id}`, TA);
  check('部分退款把订单置为 partial_refunded', oR2a.data?.status === 'partial_refunded', oR2a.data?.status);

  const part2 = await call('POST', `/admin/orders/${orderR2.id}/refund`, TADMIN, {
    amountCents: orderR2.paidCents - half,
    reason: '冒烟脚本退完剩余金额',
  });
  check('追加退款结清', part2.code === 0 && part2.data?.fullyRefunded === true, part2.message);
  check('二次退款不重复回收积分', part2.data?.creditsReclaimed === 0, `reclaimed=${part2.data?.creditsReclaimed}`);
  const oR2b = await call('GET', `/orders/${orderR2.id}`, TA);
  check('退完置为 refunded', oR2b.data?.status === 'refunded', oR2b.data?.status);

  // 5.3 渠道未配置: 503 + 不留半截退款单 + 订单与积分不变
  const orderR3 = await paidOrder('refund-unconfigured', 'REFUND-UNCFG');
  const alipayRow = (channelsAdmin.data?.channels ?? []).find((c) => c.channel === 'alipay');
  if (alipayRow && alipayRow.configured === false) {
    const pay3 = await prisma.payment.findFirst({ where: { orderId: orderR3.id, status: 'succeeded' } });
    // 把本地流水改成一个**未配置**的渠道, 模拟「退款通道调不通」
    await prisma.payment.update({ where: { id: pay3.id }, data: { channel: 'alipay' } });
    const balBeforeFail = await call('GET', '/credits/balance', TA);
    const uncfg = await call('POST', `/admin/orders/${orderR3.id}/refund`, TADMIN, {
      amountCents: orderR3.paidCents,
      reason: '冒烟脚本: 渠道未配置',
    });
    check(
      '渠道未配置时退款返回 503',
      uncfg.httpStatus === 503 && uncfg.code === 50301,
      `${uncfg.httpStatus} ${uncfg.message}`,
    );
    check('通道解析失败不留下半截退款单', (await prisma.refund.count({ where: { orderId: orderR3.id } })) === 0);
    const oR3 = await call('GET', `/orders/${orderR3.id}`, TA);
    check('渠道失败时订单状态不变', oR3.data?.status === 'paid', oR3.data?.status);
    const balAfterFail = await call('GET', '/credits/balance', TA);
    check('渠道失败时不回收积分', balAfterFail.data?.balance === balBeforeFail.data?.balance);
  } else {
    console.log('  NOTE  当前实例 alipay 已配置, 跳过「渠道未配置」断言');
  }

  // 5.4 在途退款: 不允许叠加新退款 (40908)
  const orderR4 = await paidOrder('refund-inflight', 'REFUND-INFLIGHT');
  const pay4 = await prisma.payment.findFirst({ where: { orderId: orderR4.id, status: 'succeeded' } });
  const inFlightRow = await prisma.refund.create({
    data: {
      orderId: orderR4.id,
      paymentId: pay4.id,
      userId: userA.data.user.id,
      amountCents: 100,
      creditsReclaimed: 0,
      creditsUnreclaimable: 0,
      reason: '冒烟脚本: 模拟渠道异步处理中',
      operatorId: adminUser.id,
      status: 'processing',
      detail: '{}',
    },
  });
  const blocked = await call('POST', `/admin/orders/${orderR4.id}/refund`, TADMIN, {
    amountCents: orderR4.paidCents,
    reason: '冒烟脚本: 在途时应被拒',
  });
  check(
    '有在途退款时拒绝新退款 (409/40908)',
    blocked.httpStatus === 409 && blocked.code === 40908,
    `${blocked.httpStatus} ${blocked.message}`,
  );
  const oR4 = await call('GET', `/orders/${orderR4.id}`, TA);
  check('被拒时订单仍为 paid', oR4.data?.status === 'paid', oR4.data?.status);
  await prisma.refund.delete({ where: { id: inFlightRow.id } });

  // 5.5 手工核销订单 (channel=manual): 不调渠道, 但本地账必须改
  const orderR5 = await paidOrder('refund-manual', 'REFUND-MANUAL');
  const pay5 = await prisma.payment.findFirst({ where: { orderId: orderR5.id, status: 'succeeded' } });
  await prisma.payment.update({ where: { id: pay5.id }, data: { channel: 'manual' } });
  const manual = await call('POST', `/admin/orders/${orderR5.id}/refund`, TADMIN, {
    amountCents: orderR5.paidCents,
    reason: '冒烟脚本: 手工核销订单退款',
  });
  check('手工核销订单可退款', manual.code === 0 && manual.data?.state === 'succeeded', manual.message);
  const manualRow = await prisma.refund.findFirst({ where: { orderId: orderR5.id } });
  check('手工核销不产生渠道退款单号', !manualRow?.providerRefundId, manualRow?.providerRefundId);
  const oR5 = await call('GET', `/orders/${orderR5.id}`, TA);
  check('手工核销退款后订单置为 refunded', oR5.data?.status === 'refunded', oR5.data?.status);

  // 5.6 越权: 普通用户不能发起退款
  const orderR6 = await paidOrder('refund-denied', 'REFUND-DENIED');
  const denied = await call('POST', `/admin/orders/${orderR6.id}/refund`, TA, {
    amountCents: orderR6.paidCents,
    reason: '普通用户尝试退款',
  });
  check(
    '普通用户不能发起退款 (403)',
    denied.httpStatus === 403 || denied.code === 40301,
    `${denied.httpStatus} ${denied.message}`,
  );

  // ── 6. 发票 ──────────────────────────────────────────────────────
  console.log('\n【发票】');
  const inv1 = await call('POST', '/invoices', TA, {
    orderId: order1.id,
    kind: 'company',
    title: `冒烟科技有限公司 ${RUN}`,
    taxNo: '91310000MA1FL0000X',
    email: `smoke-pay-a-${RUN}@test.local`,
  });
  check('已支付订单可申请开票', inv1.code === 0 && inv1.data?.status === 'pending', inv1.message);
  check('开票金额取实付快照', inv1.data?.amountCents === order1.paidCents, `${inv1.data?.amountCents}`);

  const inv1Dup = await call('POST', '/invoices', TA, {
    orderId: order1.id,
    kind: 'personal',
    title: '重复申请',
  });
  check('一单一票 (重复申请 409)', inv1Dup.httpStatus === 409, inv1Dup.message);

  const noTax = await call('POST', '/invoices', TA, {
    orderId: order3.id,
    kind: 'company',
    title: '缺税号公司',
  });
  check('企业抬头必须有税号', noTax.code === 40001, noTax.message);

  const notPaid = await call('POST', '/invoices', TA, {
    orderId: order2.id,
    kind: 'personal',
    title: '未支付订单',
  });
  check('未支付订单不能开票', notPaid.httpStatus === 409, notPaid.message);

  const earlyFile = await raw(`/invoices/${inv1.data.id}/file`, TA);
  check('未开具时无发票文件 (409)', earlyFile.httpStatus === 409, earlyFile.text.slice(0, 60));

  const list = await call('GET', '/invoices', TA);
  check('C 端能查到自己的发票', (list.data?.items ?? []).some((i) => i.id === inv1.data.id));

  const adminList = await call('GET', '/admin/invoices?status=pending', TADMIN);
  check('后台能按状态筛到待开具', (adminList.data?.items ?? []).some((i) => i.id === inv1.data.id));

  const issueNoReason = await call('POST', `/admin/invoices/${inv1.data.id}/issue`, TADMIN, { reason: '' });
  check('开具必须填原因', issueNoReason.code === 40001, issueNoReason.message);

  const issued = await call('POST', `/admin/invoices/${inv1.data.id}/issue`, TADMIN, {
    reason: '冒烟脚本开具',
  });
  check('开具成功', issued.code === 0 && issued.data?.status === 'issued', issued.message);
  check('开具后带票号与文件地址', !!issued.data?.invoiceNo && issued.data?.hasStoredFile === true);

  const file = await raw(`/invoices/${inv1.data.id}/file`, TA);
  check('可打印 HTML 可取', file.httpStatus === 200 && file.contentType.includes('text/html'));
  check('HTML 含票号与抬头', file.text.includes(issued.data.invoiceNo) && file.text.includes(`冒烟科技有限公司 ${RUN}`));

  const issueAgain = await call('POST', `/admin/invoices/${inv1.data.id}/issue`, TADMIN, { reason: '重复开具' });
  check('已开具的票不能再开具 (409)', issueAgain.httpStatus === 409, issueAgain.message);
  const rejectIssued = await call('POST', `/admin/invoices/${inv1.data.id}/reject`, TADMIN, { reason: '重复驳回' });
  check('已开具的票不能驳回 (409)', rejectIssued.httpStatus === 409, rejectIssued.message);

  // 驳回路径: 另一张待开具的票
  const order5 = await newOrder('reject');
  await call('POST', '/payments/callback/sandbox', null, {
    orderNo: order5.orderNo,
    tradeNo: `SMOKE-REJECT-${RUN}`,
    amountCents: order5.paidCents,
  });
  const inv2 = await call('POST', '/invoices', TA, {
    orderId: order5.id,
    kind: 'personal',
    title: `冒烟个人 ${RUN}`,
  });
  const rejected = await call('POST', `/admin/invoices/${inv2.data.id}/reject`, TADMIN, {
    reason: '抬头信息不完整, 请补充后重新申请',
  });
  check('驳回成功', rejected.code === 0 && rejected.data?.status === 'rejected', rejected.message);
  const detail2 = await call('GET', `/invoices/${inv2.data.id}`, TA);
  check('驳回原因回传用户侧', detail2.data?.rejectReason?.includes('抬头信息不完整'), detail2.data?.rejectReason);

  const invRow = await prisma.invoice.findUnique({ where: { id: inv1.data.id } });
  check('发票与申请人绑定', invRow?.userId === userA.data.user.id);

  console.log(`\n合计: ${pass} 通过 / ${fail} 失败\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('冒烟执行异常:', e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
