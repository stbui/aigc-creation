/**
 * 扫码登录冒烟 (B8)。
 *
 * 覆盖状态机全路径与三条安全约束:
 *   1. 扫码 ≠ 授权: scan 只到 scanned, 不签发会话
 *   2. 票据一次性: 兑换成功后票据转 consumed, 再轮询拿不到 token
 *   3. 过期即失效: 超时会话轮询返回 expired, scan 直接 409
 * 另验证拒绝分支 (cancelled)、未登录不能扫码、登录审计记 'qr'。
 *
 * 用法 (测试档, 禁止指向开发库):
 *   NODE_ENV=test API_BASE=http://127.0.0.1:4100 node scripts/smoke-qr-login.js
 */
const { createHash } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
const { loadEnvOnce, resolveDbUrl } = require('./db-url');

/** 与服务端同口径的票据摘要, 用于断言/清理时定位会话行 */
const hashOf = (ticket) => createHash('sha256').update(String(ticket ?? '')).digest('hex');

loadEnvOnce();

const BASE = (process.env.API_BASE || 'http://127.0.0.1:4100').replace(/\/$/, '') + '/api/v1';

/**
 * 读库重试: 脚本直连的同时后端在写库, SQLite 单写者必然撞 "database is locked"。
 * 与 smoke-marketing.js 同一处理。报 SQLITE_BUSY 时语句未提交, 重试安全。
 */
const base = new PrismaClient({
  adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
});
const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        let lastErr;
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            return await query(args);
          } catch (e) {
            if (e?.code !== 'P2039' && !/database is locked/i.test(e?.message ?? '')) throw e;
            lastErr = e;
            await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
          }
        }
        throw lastErr;
      },
    },
  },
});

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

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

(async () => {
  const bcrypt = require('bcryptjs');
  const stamp = Date.now();
  const email = `smoke-qr-${stamp}@test.com`;
  const user = await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash('test123456', 10), name: '扫码冒烟' },
  });
  const login = await call('POST', '/auth/login', null, { email, password: 'test123456' });
  const M = { token: login.data?.accessToken };

  check('测试账号就绪', Boolean(M.token), email);

  // ── 建码与轮询 ──────────────────────────────────────────────────────
  console.log('\n【建码与初始状态】');
  const created = await call('POST', '/auth/qr/create', null);
  const ticket = created.data?.ticket;
  check(
    '建码返回 64 位十六进制票据与有效期',
    created.httpStatus === 201 &&
      typeof ticket === 'string' &&
      /^[0-9a-f]{64}$/.test(ticket) &&
      created.data.ttlSeconds > 0,
    `ttl=${created.data?.ttlSeconds}s poll=${created.data?.pollIntervalMs}ms`,
  );

  const pending = await call('GET', `/auth/qr/status?ticket=${ticket}`, null);
  check('未扫码时状态为 pending 且不签发会话', pending.data?.status === 'pending' && !pending.data?.accessToken);

  const badTicket = await call('GET', '/auth/qr/status?ticket=short', null);
  check('过短的票据被参数校验拦下 (400)', badTicket.httpStatus === 400, `${badTicket.httpStatus}`);

  const unknown = await call('GET', `/auth/qr/status?ticket=${'f'.repeat(64)}`, null);
  check(
    '不存在的票据返回 404',
    unknown.httpStatus === 404 && unknown.code === 40400,
    `${unknown.httpStatus} ${unknown.message ?? ''}`,
  );

  // ── 扫码 / 确认 ────────────────────────────────────────────────────
  console.log('\n【扫码与确认】');
  const anonScan = await call('POST', '/auth/qr/scan', null, { ticket });
  check('未登录不能扫码 (401)', anonScan.httpStatus === 401, `${anonScan.httpStatus}`);

  const scanned = await call('POST', '/auth/qr/scan', M.token, { ticket });
  check(
    '扫码后状态为 scanned 且**不**签发会话',
    scanned.data?.status === 'scanned' && !scanned.data?.accessToken,
  );
  check(
    '扫码响应带回发起端信息 (手机端据此展示设备)',
    typeof scanned.data?.desktop === 'object' && scanned.data.desktop !== null,
    JSON.stringify(scanned.data?.desktop ?? {}),
  );

  const afterScan = await call('GET', `/auth/qr/status?ticket=${ticket}`, null);
  check(
    '桌面轮询看到 scanned 但仍无 token',
    afterScan.data?.status === 'scanned' && !afterScan.data?.accessToken,
  );

  const confirmed = await call('POST', '/auth/qr/confirm', M.token, { ticket, approve: true });
  check('手机确认后状态为 confirmed', confirmed.data?.status === 'confirmed');

  const redeemed = await call('GET', `/auth/qr/status?ticket=${ticket}`, null);
  check(
    '轮询兑换到 accessToken 与用户信息',
    redeemed.data?.status === 'confirmed' &&
      typeof redeemed.data?.accessToken === 'string' &&
      redeemed.data?.user?.id === user.id,
  );

  const me = await call('GET', '/me', redeemed.data?.accessToken);
  check(
    '扫出的 token 可正常访问受保护接口',
    me.httpStatus === 200 && me.data?.id === user.id,
    `用户=${me.data?.email ?? me.message}`,
  );

  const replay = await call('GET', `/auth/qr/status?ticket=${ticket}`, null);
  check(
    '票据一次性: 再次轮询为 consumed 且不重复签发',
    replay.data?.status === 'consumed' && !replay.data?.accessToken,
  );

  const scanAfterConsume = await call('POST', '/auth/qr/scan', M.token, { ticket });
  check(
    '已兑换的票据不能再被扫码 (409)',
    scanAfterConsume.httpStatus === 409 && scanAfterConsume.code === 40908,
    `${scanAfterConsume.httpStatus} ${scanAfterConsume.message ?? ''}`,
  );

  // ── 拒绝分支 ────────────────────────────────────────────────────────
  console.log('\n【拒绝授权】');
  const c2 = await call('POST', '/auth/qr/create', null);
  const t2 = c2.data?.ticket;
  await call('POST', '/auth/qr/scan', M.token, { ticket: t2 });
  const denied = await call('POST', '/auth/qr/confirm', M.token, { ticket: t2, approve: false });
  check('拒绝后状态为 cancelled', denied.data?.status === 'cancelled');
  const deniedPoll = await call('GET', `/auth/qr/status?ticket=${t2}`, null);
  check(
    '桌面端看到 cancelled 且拿不到会话',
    deniedPoll.data?.status === 'cancelled' && !deniedPoll.data?.accessToken,
  );

  // ── 过期 ────────────────────────────────────────────────────────────
  console.log('\n【过期】');
  const c3 = await call('POST', '/auth/qr/create', null);
  const t3 = c3.data?.ticket;
  const target = await prisma.loginSession.findUnique({ where: { tokenHash: hashOf(t3) } });
  check('新建会话落库为 pending', target?.status === 'pending');
  await prisma.loginSession.update({
    where: { id: target.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

  const expiredPoll = await call('GET', `/auth/qr/status?ticket=${t3}`, null);
  check('超时会话轮询返回 expired', expiredPoll.data?.status === 'expired');
  const expiredScan = await call('POST', '/auth/qr/scan', M.token, { ticket: t3 });
  check(
    '超时会话扫码返回 409',
    expiredScan.httpStatus === 409 && expiredScan.code === 40908,
    `${expiredScan.httpStatus} ${expiredScan.message ?? ''}`,
  );

  // ── 审计 ────────────────────────────────────────────────────────────
  console.log('\n【登录审计】');
  const log = await prisma.loginLog.findFirst({
    where: { userId: user.id, reason: 'qr' },
    orderBy: { createdAt: 'desc' },
  });
  check('扫码登录写入 LoginLog 且 reason=qr', Boolean(log), log ? `${log.ip ?? '-'} ${log.success}` : '');

  // ── 清理 ────────────────────────────────────────────────────────────
  console.log('\n【清理】');
  // 只删本次脚本建的会话, 不误伤同一库里的其他数据
  await prisma.loginSession.deleteMany({
    where: { tokenHash: { in: [hashOf(ticket), hashOf(t2), hashOf(t3)] } },
  });
  await prisma.loginLog.updateMany({ where: { userId: user.id }, data: { userId: null } });
  await prisma.notification.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
  console.log('  已清理扫码会话与测试账号');

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('冒烟脚本异常:', e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
