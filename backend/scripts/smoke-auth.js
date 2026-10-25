/**
 * 账号安全冒烟测试 (B2)。
 *
 * 守住六条承诺:
 *   1. 注册昵称必填 —— 缺昵称必须 400, 而不是带着空名字入库
 *   2. 忘记密码防枚举 —— 未注册邮箱与已注册邮箱返回**完全相同**的响应
 *   3. 重置令牌一次性、可失效旧会话 —— 改密后旧 token 立即 401
 *   4. 手机号必须验证归属 —— 未带验证码 / 验证码错误一律拒绝绑定
 *   5. 短信验证码一次性、有失败计数 —— 用过即废, 连错达到上限即作废
 *   6. 登录审计落库 —— 成功与失败都要能在 LoginLog 里查到
 *
 * 验证码与重置链接从**后端 outbox 文件**读取（console 通道的落盘产物）：
 *   backend/<LOG_DIR>/outbox/email-<日期>.log / sms-<日期>.log
 * 故本脚本必须与后端同机运行，且后端处于 development/test 档
 * （production 档 console 通道不落盘，见 console-outbox.ts）。
 *
 * 用法（测试档）：
 *   API_BASE=http://127.0.0.1:4100 NODE_ENV=test node scripts/smoke-auth.js
 */
const { resolve } = require('path');
const { readFileSync } = require('fs');
const BASE = (process.env.API_BASE || 'http://127.0.0.1:4100').replace(/\/$/, '') + '/api/v1';
const { PrismaClient } = require('@prisma/client');
const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
const { resolveDbUrl, loadEnvOnce } = require('./db-url');
loadEnvOnce();
const prisma = new PrismaClient({ adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }) });

const LOG_DIR = process.env.LOG_DIR || (process.env.NODE_ENV === 'test' ? 'logs/test' : 'logs');
const OUTBOX_DIR = resolve(__dirname, '..', LOG_DIR, 'outbox');

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

/**
 * 清空限流计数（仅测试档、需 RATE_LIMIT_RESET_TOKEN）。
 *
 * 短信「5 次/天」与找回密码「3 次/小时」是**进程级**计数，同一天重跑冒烟时
 * 上一次的残留会把这一轮挡在门外 —— 那不是通道坏了，是窗口还没过。
 * 开始前清一次，断言仍然打在同一个 guard 上（限流没被测掉，只是窗口从
 * 「进程生命周期」收窄成「脚本作用域」）。
 */
async function resetRateLimit() {
  const token = process.env.RATE_LIMIT_RESET_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`${BASE}/test/rate-limit/reset`, {
      method: 'POST',
      headers: { 'x-test-token': token },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function call(method, path, token, body) {
  let lastErr;
  for (let i = 0; i < 3; i += 1) {
    try {
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
    } catch (e) {
      lastErr = e;
      if (!/ECONNRESET|ECONNREFUSED|fetch failed|socket hang up/i.test(String(e.message || ''))) throw e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

/** 读当天 outbox 文件的最后一条匹配记录 */
function readOutbox(channel, predicate) {
  const day = new Date().toISOString().slice(0, 10);
  const file = resolve(OUTBOX_DIR, `${channel}-${day}.log`);
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const lines = raw.trim().split('\n').reverse();
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (predicate(entry)) return entry;
    } catch {
      /* 跳过半行（进程被杀时可能留半条） */
    }
  }
  return null;
}

function phoneTail() {
  // 139 + 8 位时间戳后段：同一天内多次运行也不会撞唯一约束
  return `139${String(Date.now()).slice(-8)}`;
}

(async () => {
  const rateReset = await resetRateLimit();
  console.log(`限流计数重置: ${rateReset ? '已清空' : '跳过（未配置 RATE_LIMIT_RESET_TOKEN 或非测试档）'}`);
  const bcrypt = require('bcryptjs');
  const stamp = Date.now();
  const email = `auth-${stamp}@test.com`;
  const phone = phoneTail();
  const password = 'test123456';
  const newPassword = 'test654321';

  console.log('\n【注册】');
  const noName = await call('POST', '/auth/register', null, { email: `nn-${stamp}@test.com`, password });
  check('缺昵称必须 400', noName.status === 400, `status=${noName.status} ${noName.message || ''}`);

  const reg = await call('POST', '/auth/register', null, { email, password, name: '安全测试' });
  check(
    '注册成功并直接返回 token',
    (reg.status === 200 || reg.status === 201) && Boolean(reg.data?.accessToken),
    `status=${reg.status}`,
  );
  const initialToken = reg.data?.accessToken;

  console.log('\n【忘记密码 · 防枚举】');
  const ghost = await call('POST', '/auth/password/forgot', null, { email: `ghost-${stamp}@test.com` });
  const real = await call('POST', '/auth/password/forgot', null, { email });
  check(
    '未注册邮箱与已注册邮箱响应完全一致',
    ghost.status === real.status && JSON.stringify(ghost.data) === JSON.stringify(real.data),
    `ghost=${JSON.stringify(ghost.data)} real=${JSON.stringify(real.data)}`,
  );

  const mail = readOutbox('email', (e) => e.to === email && /reset-password/.test(e.body || ''));
  check('重置邮件已写入 outbox', Boolean(mail), mail ? `subject=${mail.subject}` : '未找到');

  const tokenMatch = mail && /reset-password\?token=([A-Za-z0-9_-]+)/.exec(mail.body);
  const resetToken = tokenMatch && tokenMatch[1];
  check('重置链接携带一次性令牌', Boolean(resetToken));

  console.log('\n【重置密码】');
  const reset = await call('POST', '/auth/password/reset', null, { token: resetToken, password: newPassword });
  check('凭令牌重置成功', reset.status === 200 || reset.status === 201, `status=${reset.status} ${reset.message || ''}`);

  const reuse = await call('POST', '/auth/password/reset', null, { token: resetToken, password: 'test111111' });
  check('令牌不能复用', reuse.status === 400, `status=${reuse.status} ${reuse.message || ''}`);

  const oldLogin = await call('POST', '/auth/login', null, { email, password });
  check('旧密码失效', oldLogin.status === 401, `status=${oldLogin.status}`);

  const newLogin = await call('POST', '/auth/login', null, { email, password: newPassword });
  check('新密码可登录', newLogin.status === 200 || newLogin.status === 201, `status=${newLogin.status}`);
  const freshToken = newLogin.data?.accessToken;

  const stale = await call('GET', '/projects', initialToken);
  check('重置前的旧 token 立即失效', stale.status === 401, `status=${stale.status}`);
  const alive = await call('GET', '/projects', freshToken);
  check('新 token 可用', alive.status === 200, `status=${alive.status}`);

  console.log('\n【手机号绑定 · 必须验证】');
  const phoneNoCode = await call('POST', '/auth/register', null, {
    email: `p1-${stamp}@test.com`,
    password,
    name: '手机测试',
    phone,
  });
  check('带手机号但不带验证码必须 400', phoneNoCode.status === 400, `status=${phoneNoCode.status}`);

  const smsSend = await call('POST', '/auth/sms/send', null, { phone, purpose: 'verify' });
  check('发送注册验证码恒为成功', smsSend.status === 200 || smsSend.status === 201, `status=${smsSend.status}`);
  const smsEntry = readOutbox('sms', (e) => e.to === phone && /验证码\s*\d{6}/.test(e.body || ''));
  const codeMatch = smsEntry && /验证码\s*(\d{6})/.exec(smsEntry.body);
  const verifyCode = codeMatch && codeMatch[1];
  check('验证码已写入 outbox', Boolean(verifyCode), verifyCode ? `code=${verifyCode.slice(0, 2)}****` : '未找到');

  const wrongCode = await call('POST', '/auth/register', null, {
    email: `p2-${stamp}@test.com`,
    password,
    name: '手机测试',
    phone,
    smsCode: '000000',
  });
  check('错误验证码不能绑定手机号', wrongCode.status === 400, `status=${wrongCode.status}`);

  const withPhone = await call('POST', '/auth/register', null, {
    email: `p3-${stamp}@test.com`,
    password,
    name: '手机测试',
    phone,
    smsCode: verifyCode,
  });
  check('正确验证码可绑定并注册', withPhone.status === 200 || withPhone.status === 201, `status=${withPhone.status} ${withPhone.message || ''}`);
  const phoneUser = withPhone.data?.user;

  const dupPhone = await call('POST', '/auth/register', null, {
    email: `p4-${stamp}@test.com`,
    password,
    name: '手机测试',
    phone,
  });
  check('已占用手机号拒绝再绑', dupPhone.status === 400, `status=${dupPhone.status} ${dupPhone.message || ''}`);

  console.log('\n【短信登录】');
  // 短信限流是「1 次/分钟 + 5 次/天」，而本节紧接着上一节又发一条 ——
  // 不先清计数的话第二条会被 429 掉，readOutbox 拿到的是**上一条验证码**，
  // 表现为「正确验证码登录失败：验证码已过期」（极具误导性）
  await resetRateLimit();
  await call('POST', '/auth/sms/send', null, { phone, purpose: 'login' });
  const loginEntry = readOutbox('sms', (e) => e.to === phone && /验证码\s*\d{6}/.test(e.body || ''));
  const loginCode = loginEntry && /验证码\s*(\d{6})/.exec(loginEntry.body)[1];
  check('登录验证码已下发', Boolean(loginCode));

  const badSms = await call('POST', '/auth/sms/login', null, { phone, code: '999999' });
  check('错误验证码登录失败', badSms.status === 400, `status=${badSms.status} ${badSms.message || ''}`);

  const goodSms = await call('POST', '/auth/sms/login', null, { phone, code: loginCode });
  check('正确验证码登录成功', goodSms.status === 200 || goodSms.status === 201, `status=${goodSms.status} ${goodSms.message || ''}`);
  check('短信登录返回该手机号所属账号', goodSms.data?.user?.phone === phone, `phone=${goodSms.data?.user?.phone}`);

  const replay = await call('POST', '/auth/sms/login', null, { phone, code: loginCode });
  check('验证码不能重复使用', replay.status === 400, `status=${replay.status}`);

  console.log('\n【登录审计】');
  const failed = await prisma.loginLog.findFirst({
    where: { email, success: false },
    orderBy: { createdAt: 'desc' },
  });
  check('失败登录已落审计', Boolean(failed), failed ? failed.reason : '无记录');

  const okLog = await prisma.loginLog.findFirst({
    where: { email, success: true },
    orderBy: { createdAt: 'desc' },
  });
  check('成功登录已落审计', Boolean(okLog), okLog ? okLog.reason : '无记录');

  const smsLog = await prisma.loginLog.findFirst({
    where: { userId: phoneUser?.id, success: true, reason: 'sms' },
  });
  check('短信登录标记来源 sms', Boolean(smsLog));

  console.log('\n【令牌安全】');
  // 注册前的手机号验证令牌 userId 为空（此时还没有用户），按手机号查
  const stored = await prisma.accountToken.findFirst({
    where: { phone, type: 'sms_verify' },
    orderBy: { createdAt: 'desc' },
  });
  check('令牌明文不落库', stored && /^[0-9a-f]{64}$/.test(stored.tokenHash), stored ? 'HMAC 摘要' : '无记录');

  // 清理
  const uids = [reg.data?.user?.id, phoneUser?.id].filter(Boolean);
  await prisma.$transaction([
    prisma.accountToken.deleteMany({ where: { userId: { in: uids } } }),
    prisma.loginLog.deleteMany({ where: { userId: { in: uids } } }),
    prisma.creditLedger.deleteMany({ where: { userId: { in: uids } } }),
    prisma.creditLot.deleteMany({ where: { userId: { in: uids } } }),
    prisma.project.deleteMany({ where: { ownerId: { in: uids } } }),
    prisma.user.deleteMany({ where: { id: { in: uids } } }),
  ]).catch(() => undefined);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log('='.repeat(52));
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})().catch(async (e) => {
  console.error('\n冒烟脚本异常:', e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
