/**
 * 账户自助 + 法务同意冒烟测试 (B4)。
 *
 * 守住六条承诺:
 *   1. `/me` 只认令牌身份 —— 路径里没有别人的 id, 越权无从谈起
 *   2. 资料更正只放行昵称, 空昵称 / 超长昵称一律拒绝
 *   3. 改密后**该账号全部旧 token 立即失效**（含当前这把）, 新密码可登录
 *   4. 数据导出给出可携带的 JSON, 且**绝不包含 passwordHash**
 *   5. 注销需密码 + 确认词, 且订单等法定留存数据必须保留
 *   6. 法务文本公开可读; 注册携带 consentVersion 时落 ConsentRecord
 *
 * 用法（测试档, 禁止指向开发库）:
 *   API_BASE=http://127.0.0.1:4200 NODE_ENV=test node scripts/smoke-account.js
 */
const { PrismaClient } = require('@prisma/client');
const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
const { resolveDbUrl } = require('./db-url');

const BASE = (process.env.API_BASE || 'http://127.0.0.1:4100').replace(/\/$/, '') + '/api/v1';
const prisma = new PrismaClient({ adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }) });

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
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

(async () => {
  const stamp = Date.now();
  const email = `acct-${stamp}@test.com`;
  const password = 'test123456';
  const newPassword = 'test654321';

  console.log('\n【注册 · 同意记录】');
  const reg = await call('POST', '/auth/register', null, {
    email,
    password,
    name: '账户测试',
    consentVersion: 'v1',
  });
  check('注册成功', reg.status === 200 || reg.status === 201, `status=${reg.status} ${reg.message || ''}`);
  const userId = reg.data?.user?.id;
  let token = reg.data?.accessToken;

  const consent = userId
    ? await prisma.consentRecord.findFirst({ where: { userId, kind: 'register' } })
    : null;
  check(
    '带 consentVersion 时落同意记录',
    Boolean(consent) && consent.slug === 'user-agreement' && consent.version === 'v1',
    consent ? `${consent.slug}@${consent.version}` : '无记录',
  );

  console.log('\n【法务文档 · 公开读取】');
  const index = await call('GET', '/legal', null);
  check('三类文档概览可匿名读取', index.status === 200 && Array.isArray(index.data) && index.data.length === 3,
    `status=${index.status} n=${Array.isArray(index.data) ? index.data.length : '?'}`);
  check('概览带发布版本号', Array.isArray(index.data) && index.data.every((d) => d.version));

  const doc = await call('GET', '/legal/privacy-policy', null);
  check('取到最新已发布正文', doc.status === 200 && doc.data?.slug === 'privacy-policy' && Boolean(doc.data?.content),
    doc.data ? `v${doc.data.version} len=${String(doc.data.content || '').length}` : `status=${doc.status}`);

  const unknown = await call('GET', '/legal/not-a-real-doc', null);
  check('未知 slug 返回 404', unknown.status === 404, `status=${unknown.status}`);

  console.log('\n【我的资料】');
  const me = await call('GET', '/me', token);
  check('读取账号资料', me.status === 200 && me.data?.email === email, `status=${me.status}`);
  check(
    '资料含统计计数与未读数',
    typeof me.data?.counts?.projects === 'number' && typeof me.data?.unread === 'number',
    JSON.stringify(me.data?.counts ?? {}),
  );
  check('接口不回显密码哈希', me.data?.passwordHash === undefined);

  const anon = await call('GET', '/me', null);
  check('未登录访问 /me 必须 401', anon.status === 401, `status=${anon.status}`);

  const renamed = await call('PATCH', '/me', token, { name: '  改名后  ' });
  check('昵称更新并 trim', renamed.status === 200 && renamed.data?.name === '改名后',
    `status=${renamed.status} name=${renamed.data?.name}`);

  const emptyName = await call('PATCH', '/me', token, { name: '   ' });
  check('空昵称拒绝', emptyName.status === 400, `status=${emptyName.status} ${emptyName.message || ''}`);

  const longName = await call('PATCH', '/me', token, { name: 'x'.repeat(30) });
  check('超长昵称拒绝', longName.status === 400, `status=${longName.status}`);

  const emailChange = await call('PATCH', '/me', token, { email: `other-${stamp}@test.com` });
  check(
    '不能通过 PATCH 改邮箱（DTO 白名单剥掉）',
    (await prisma.user.findUnique({ where: { id: userId } }))?.email === email,
    `status=${emailChange.status}`,
  );

  console.log('\n【数据导出】');
  const exported = await call('POST', '/me/export', token);
  const dump = JSON.stringify(exported.data ?? {});
  check(
    '导出成功且为对象',
    (exported.status === 200 || exported.status === 201) && exported.data?.account?.email === email,
    `status=${exported.status}`,
  );
  check('导出不含 passwordHash', !dump.includes('passwordHash') && !dump.includes('$2a$') && !dump.includes('$2b$'));
  check('导出含账号 / 项目 / 素材 / 任务 / 订单字段',
    Array.isArray(exported.data?.projects) && Array.isArray(exported.data?.assets)
    && Array.isArray(exported.data?.tasks) && Array.isArray(exported.data?.orders));

  console.log('\n【修改密码】');
  const wrongOld = await call('POST', '/me/password', token, { oldPassword: 'wrong-pass', newPassword });
  check('旧密码错误必须拒绝', wrongOld.status === 400, `status=${wrongOld.status}`);

  const samePass = await call('POST', '/me/password', token, { oldPassword: password, newPassword: password });
  check('新旧密码相同必须拒绝', samePass.status === 400, `status=${samePass.status}`);

  const changed = await call('POST', '/me/password', token, { oldPassword: password, newPassword });
  check('改密成功', changed.status === 200 || changed.status === 201, `status=${changed.status} ${changed.message || ''}`);

  const stale = await call('GET', '/me', token);
  check('改密后旧 token 立即失效', stale.status === 401, `status=${stale.status}`);

  const oldLogin = await call('POST', '/auth/login', null, { email, password });
  check('旧密码不能登录', oldLogin.status === 401, `status=${oldLogin.status}`);

  const relogin = await call('POST', '/auth/login', null, { email, password: newPassword });
  check('新密码可登录', (relogin.status === 200 || relogin.status === 201) && Boolean(relogin.data?.accessToken));
  token = relogin.data?.accessToken;

  console.log('\n【注销影响面】');
  // 造一条订单: 注销后必须保留（法定留存）
  await prisma.order.create({
    data: {
      orderNo: `SMOKE-ACCT-${stamp}`,
      userId,
      // 幂等键与超时时间都是必填（模型层无默认值）
      idempotencyKey: `smoke-acct-${stamp}`,
      status: 'paid',
      totalCents: 990,
      paidCents: 990,
      paidAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  }).catch(() => undefined);

  const preview = await call('GET', '/me/deletion-preview', token);
  check('影响面预览可读', preview.status === 200 && typeof preview.data?.orders === 'number',
    `orders=${preview.data?.orders}`);
  check('预览中订单数为 1', preview.data?.orders === 1, `orders=${preview.data?.orders}`);

  console.log('\n【自助注销】');
  const badWord = await call('DELETE', '/me', token, { password: newPassword, confirm: '确认' });
  check('确认词错误必须拒绝', badWord.status === 400, `status=${badWord.status} ${badWord.message || ''}`);

  const badPass = await call('DELETE', '/me', token, { password: 'nope-nope', confirm: '注销' });
  check('密码错误必须拒绝', badPass.status === 400, `status=${badPass.status}`);

  const del = await call('DELETE', '/me', token, { password: newPassword, confirm: '注销' });
  check('注销成功', (del.status === 200 || del.status === 201) && del.data?.deleted === true,
    `status=${del.status} ${del.message || ''}`);

  const after = await prisma.user.findUnique({ where: { id: userId } });
  check('账号状态置 deleted', after?.status === 'deleted', `status=${after?.status}`);
  check('邮箱已匿名化', Boolean(after?.email?.startsWith('deleted_')), after?.email);
  check('密码哈希已清空', after?.passwordHash === '');
  check('旧 token 已失效', (await call('GET', '/me', token)).status === 401);

  const loginAfterDelete = await call('POST', '/auth/login', null, { email, password: newPassword });
  check('注销后不能登录', loginAfterDelete.status === 401 || loginAfterDelete.status === 403,
    `status=${loginAfterDelete.status} ${loginAfterDelete.message || ''}`);

  const keptOrder = await prisma.order.findFirst({ where: { userId } });
  check('订单按法定留存要求保留', Boolean(keptOrder), keptOrder?.orderNo);
  check('通知已随账号清除', (await prisma.notification.count({ where: { userId } })) === 0);

  // 清理
  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.consentRecord.deleteMany({ where: { userId } }),
    prisma.accountToken.deleteMany({ where: { userId } }),
    prisma.loginLog.deleteMany({ where: { userId } }),
    prisma.creditLedger.deleteMany({ where: { userId } }),
    prisma.creditLot.deleteMany({ where: { userId } }),
    prisma.orderItem.deleteMany({ where: { order: { userId } } }),
    prisma.order.deleteMany({ where: { userId } }),
    prisma.project.deleteMany({ where: { ownerId: userId } }),
    prisma.asset.deleteMany({ where: { ownerId: userId } }),
    prisma.generationTask.deleteMany({ where: { ownerId: userId } }),
    prisma.user.deleteMany({ where: { id: userId } }),
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
