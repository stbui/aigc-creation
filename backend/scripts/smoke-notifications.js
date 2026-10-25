/**
 * 站内消息 + 后台法务管理冒烟测试 (B4)。
 *
 * 守住五条承诺:
 *   1. 站内消息按用户隔离 —— 只能读/标自己的
 *   2. 支付成功后**真的**产生 payment_success 消息（不是"代码里写了"）
 *   3. 后台广播扩散到所有活跃账号, 普通用户无权调用
 *   4. 模板可增改, 停用后不影响主流程（通知服务有内置兜底）
 *   5. 法务已发布版本不可原地覆盖; 发布新版本会把旧版本归档
 *
 * 用法（测试档, 禁止指向开发库）:
 *   API_BASE=http://127.0.0.1:4100 NODE_ENV=test node scripts/smoke-notifications.js
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

/** 后台角色必须有对应权限点（权限来自 AdminRole 表，不在代码里兜底） */
async function ensureAdminRole() {
  const record = await prisma.adminRole.findUnique({ where: { code: 'admin' } });
  if (!record) {
    await prisma.adminRole.create({
      data: { code: 'admin', name: '超级管理员', permissions: JSON.stringify(['message.write', 'legal.write', 'legal.read']) },
    });
    return;
  }
  let perms = [];
  try {
    perms = JSON.parse(record.permissions);
  } catch {
    perms = [];
  }
  const missing = ['message.write', 'legal.write', 'legal.read'].filter((p) => !perms.includes(p));
  if (missing.length) {
    // 只在缺权限时补写，不覆盖管理员在后台调过的矩阵
    await prisma.adminRole.update({
      where: { code: 'admin' },
      data: { permissions: JSON.stringify([...perms, ...missing]) },
    });
  }
}

(async () => {
  const stamp = Date.now();
  const pwd = 'test123456';
  const createdUserIds = [];

  await ensureAdminRole();

  console.log('\n【准备账号】');
  const adminReg = await call('POST', '/auth/register', null, {
    email: `smoke-notif-admin-${stamp}@test.com`,
    password: pwd,
    name: '冒烟管理员',
  });
  const adminId = adminReg.data?.user?.id;
  createdUserIds.push(adminId);
  await prisma.user.update({ where: { id: adminId }, data: { role: 'admin' } });
  // role 实时读库，重新登录拿到的 token 与旧 token 等价；这里直接用注册返回的 token
  const adminToken = adminReg.data?.accessToken;

  const u1 = await call('POST', '/auth/register', null, {
    email: `smoke-notif-u1-${stamp}@test.com`,
    password: pwd,
    name: '消息用户一',
  });
  const u2 = await call('POST', '/auth/register', null, {
    email: `smoke-notif-u2-${stamp}@test.com`,
    password: pwd,
    name: '消息用户二',
  });
  const u1Id = u1.data?.user?.id;
  const u2Id = u2.data?.user?.id;
  const t1 = u1.data?.accessToken;
  const t2 = u2.data?.accessToken;
  createdUserIds.push(u1Id, u2Id);
  check('三个测试账号就绪', Boolean(adminToken && t1 && t2));

  const adminMe = await call('GET', '/admin/me', adminToken);
  check('临时管理员身份生效', adminMe.status === 200 && adminMe.data?.role === 'admin',
    `status=${adminMe.status} role=${adminMe.data?.role}`);

  console.log('\n【模板管理】');
  const probeCode = `smoke_probe_${stamp}`;
  const saved = await call('POST', '/admin/notifications/templates', adminToken, {
    code: probeCode,
    channel: 'inapp',
    subject: '冒烟模板',
    body: '你好 {name}，这是一条测试。',
    enabled: true,
  });
  check('新建模板成功', saved.status === 200 || saved.status === 201, `status=${saved.status} ${saved.message || ''}`);

  const listTpl = await call('GET', '/admin/notifications/templates', adminToken);
  check('模板列表包含新建项',
    listTpl.status === 200 && Array.isArray(listTpl.data) && listTpl.data.some((t) => t.code === probeCode));

  const updated = await call('POST', '/admin/notifications/templates', adminToken, {
    code: probeCode,
    channel: 'inapp',
    subject: '冒烟模板（停用）',
    body: '改过的正文',
    enabled: false,
  });
  check('按 code 更新模板', (updated.status === 200 || updated.status === 201) && updated.data?.enabled === false);

  /*
   * 邮件 / 短信通道状态: 「填了真实 provider 但缺凭据」会静默回落 console,
   * 只有这条接口能把「其实没在发」暴露出来, 所以它自己也必须有断言。
   */
  const chStatus = await call('GET', '/admin/notifications/channels', adminToken);
  check(
    '通道状态可读',
    chStatus.status === 200 && Boolean(chStatus.data?.email) && Boolean(chStatus.data?.sms),
    `status=${chStatus.status}`,
  );
  check(
    '通道状态如实报告是否真实投递',
    typeof chStatus.data?.email?.delivers === 'boolean' &&
      typeof chStatus.data?.sms?.delivers === 'boolean' &&
      typeof chStatus.data?.email?.configured === 'boolean',
  );
  check(
    '通道状态不含凭据',
    !/ACCESS_KEY|SECRET|PRIVATE KEY|apiKey|api_key/i.test(JSON.stringify(chStatus.data ?? {})),
  );

  console.log('\n【权限边界】');
  const forbidden = await call('POST', '/admin/notifications/broadcast', t1, { title: 'x', body: 'y' });
  check('普通用户不能广播', forbidden.status === 403, `status=${forbidden.status}`);
  const forbiddenTpl = await call('GET', '/admin/notifications/templates', t1);
  check('普通用户不能读后台模板', forbiddenTpl.status === 403, `status=${forbiddenTpl.status}`);
  const forbiddenCh = await call('GET', '/admin/notifications/channels', t1);
  check('普通用户不能读通道状态', forbiddenCh.status === 403, `status=${forbiddenCh.status}`);

  console.log('\n【全站广播】');
  const broadcastTitle = `冒烟公告-${stamp}`;
  const bc = await call('POST', '/admin/notifications/broadcast', adminToken, {
    title: broadcastTitle,
    body: '这是一条广播正文',
    link: '/packages',
  });
  check('广播成功', (bc.status === 200 || bc.status === 201) && bc.data?.sent >= 3,
    `status=${bc.status} sent=${bc.data?.sent} users=${bc.data?.users}`);

  const list1 = await call('GET', '/notifications', t1);
  const items1 = list1.data?.items ?? [];
  const bcItem = items1.find((n) => n.title === broadcastTitle);
  check('用户收到广播', Boolean(bcItem), `items=${items1.length}`);
  check('广播带跳转链接', bcItem?.link === '/packages', bcItem?.link ?? '—');
  check('未读数与列表一致', typeof list1.data?.unread === 'number' && list1.data.unread >= 1,
    `unread=${list1.data?.unread}`);

  const unreadBefore = list1.data?.unread ?? 0;
  const read = await call('POST', `/notifications/${bcItem?.id}/read`, t1);
  check('标记单条已读', read.status === 200 || read.status === 201, `status=${read.status}`);
  check('已读后未读数减一', read.data?.unread === unreadBefore - 1, `${unreadBefore} → ${read.data?.unread}`);

  const cross = await call('POST', `/notifications/${bcItem?.id}/read`, t2);
  check('不能标记他人的消息', cross.data?.read === false, JSON.stringify(cross.data));

  const u1After = await call('GET', '/notifications', t1);
  check('他人误操作不影响本人未读数', u1After.data?.unread === unreadBefore - 1,
    `unread=${u1After.data?.unread}`);

  const readAll = await call('POST', '/notifications/read-all', t1);
  check('全部已读', (readAll.status === 200 || readAll.status === 201) && readAll.data?.unread === 0);
  const afterAll = await call('GET', '/notifications', t1);
  check('全部已读后未读归零', afterAll.data?.unread === 0 && afterAll.data?.items.every((n) => n.readAt));

  console.log('\n【支付成功通知】');
  const product = await prisma.product.findFirst({ where: { status: 'active' }, orderBy: { priceCents: 'asc' } });
  check('存在可购买商品', Boolean(product), product?.sku);
  const order = await call('POST', '/orders', t1, {
    idempotencyKey: `smoke-notif-${stamp}`,
    productId: product?.id,
    quantity: 1,
  });
  check('创建订单成功', order.status === 200 || order.status === 201, `status=${order.status} ${order.message || ''}`);
  const orderId = order.data?.id;
  const orderNo = order.data?.orderNo;

  const pay = await call('POST', `/orders/${orderId}/pay`, t1, { scenario: 'success' });
  check('沙箱支付成功', pay.status === 200 || pay.status === 201, `status=${pay.status} ${pay.message || ''}`);

  // markPaid 里的通知是同步 await 的（失败只吞异常），支付返回后消息应已落库
  const paidMsgs = await call('GET', '/notifications', t1);
  const payMsg = (paidMsgs.data?.items ?? []).find((n) => n.type === 'payment_success');
  check('支付成功产生站内消息', Boolean(payMsg), payMsg?.title);
  check(
    '消息正文带订单号',
    Boolean(payMsg && (String(payMsg.body || '').includes(orderNo) || String(payMsg.title).includes(orderNo))),
    payMsg ? `body=${String(payMsg.body).slice(0, 40)}` : '—',
  );

  console.log('\n【法务版本化】');
  /*
   * 法务数据不由 seed:all 预置（seed:legal 是单独命令，且只建草稿）。
   * 脚本自己备一份「已发布基线」，否则后面几条断言测的是「库里没有数据」，
   * 而不是「已发布版本不可覆盖 / 发布后旧版归档」。基线用 smoke- 前缀，
   * 收尾时与其它临时版本一起删除。
   */
  const adminLegal0 = await call('GET', '/admin/legal', adminToken);
  let legalDocs = Array.isArray(adminLegal0.data) ? adminLegal0.data : [];
  let published = legalDocs.find((d) => d.slug === 'user-agreement' && d.status === 'published');
  const baselineVersion = `smoke-baseline-${stamp}`;
  if (!published) {
    await prisma.legalDocument.create({
      data: {
        slug: 'user-agreement',
        version: baselineVersion,
        title: '冒烟基线用户协议',
        content: '## 冒烟基线\n\n用于验证版本化的已发布基线文本。',
        status: 'published',
        publishedAt: new Date(),
      },
    });
    const reread = await call('GET', '/admin/legal', adminToken);
    legalDocs = Array.isArray(reread.data) ? reread.data : [];
    published = legalDocs.find((d) => d.slug === 'user-agreement' && d.status === 'published');
  }
  check(
    '后台可读全部版本 (legal.read)',
    adminLegal0.status === 200 && legalDocs.length >= 1,
    `n=${legalDocs.length}${published ? '' : ' (基线创建失败)'}`,
  );
  check('存在已发布版本', Boolean(published), published?.version);

  const overwrite = await call('PUT', '/admin/legal', adminToken, {
    slug: 'user-agreement',
    version: published?.version ?? 'v1',
    title: '试图覆盖',
    content: '试图覆盖已发布正文',
    status: 'draft',
    reason: '冒烟: 验证已发布版本不可覆盖',
  });
  check('已发布版本不可原地覆盖', overwrite.status === 409, `status=${overwrite.status} ${overwrite.message || ''}`);

  const draftVersion = `smoke-${stamp}`;
  const draft = await call('PUT', '/admin/legal', adminToken, {
    slug: 'user-agreement',
    version: draftVersion,
    title: '冒烟版本',
    content: '## 冒烟条款\n\n这是一份用于验证版本化的临时文本。',
    status: 'draft',
    reason: '冒烟: 新建草稿',
  });
  check('新建草稿版本', draft.status === 200 || draft.status === 201, `status=${draft.status} ${draft.message || ''}`);

  const beforePublish = await call('GET', '/legal/user-agreement', null);
  check('草稿不影响线上生效版本', beforePublish.data?.version !== draftVersion, `current=${beforePublish.data?.version}`);

  const pub = await call('POST', `/admin/legal/user-agreement/${draftVersion}/publish`, adminToken, {
    reason: '冒烟: 发布草稿验证归档',
  });
  check('发布草稿', pub.status === 200 || pub.status === 201, `status=${pub.status} ${pub.message || ''}`);

  const afterPub = await call('GET', '/legal/user-agreement', null);
  check('新版本成为当前版本', afterPub.data?.version === draftVersion, `current=${afterPub.data?.version}`);

  const archived = await prisma.legalDocument.findFirst({
    where: { slug: 'user-agreement', version: published?.version ?? 'v1' },
  });
  check('旧版本自动归档', archived?.status === 'archived', `status=${archived?.status}`);

  // 还原: 把原版本重新发布, 保证测试库可重复运行
  const restore = await call('POST', `/admin/legal/user-agreement/${published?.version ?? 'v1'}/publish`, adminToken, {
    reason: '冒烟: 还原演示文本',
  });
  check('可还原原版本', restore.status === 200 || restore.status === 201, `status=${restore.status}`);

  const reasonLogged = await prisma.adminAuditLog.findFirst({
    where: { action: 'legal.publish', reason: { contains: '冒烟' } },
    orderBy: { createdAt: 'desc' },
  });
  check('高危动作原因写入审计', Boolean(reasonLogged), reasonLogged?.reason);

  // 清理: 逐个模型删并各自 catch —— 任何一张表漏删都只影响残留, 不该让脚本崩在收尾
  const cleanup = [
    () => prisma.legalDocument.deleteMany({ where: { version: { startsWith: 'smoke-' } } }),
    () => prisma.messageTemplate.deleteMany({ where: { code: probeCode } }),
    () => prisma.payment.deleteMany({ where: { order: { userId: { in: createdUserIds } } } }),
    () => prisma.refund.deleteMany({ where: { order: { userId: { in: createdUserIds } } } }),
    () => prisma.orderItem.deleteMany({ where: { order: { userId: { in: createdUserIds } } } }),
    () => prisma.order.deleteMany({ where: { userId: { in: createdUserIds } } }),
    () => prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } }),
    () => prisma.consentRecord.deleteMany({ where: { userId: { in: createdUserIds } } }),
    () => prisma.accountToken.deleteMany({ where: { userId: { in: createdUserIds } } }),
    () => prisma.loginLog.deleteMany({ where: { userId: { in: createdUserIds } } }),
    () => prisma.adminAuditLog.deleteMany({ where: { operatorId: { in: createdUserIds } } }),
    () => prisma.creditLedger.deleteMany({ where: { userId: { in: createdUserIds } } }),
    () => prisma.creditLot.deleteMany({ where: { userId: { in: createdUserIds } } }),
    () => prisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } }),
    () => prisma.project.deleteMany({ where: { ownerId: { in: createdUserIds } } }),
    () => prisma.asset.deleteMany({ where: { ownerId: { in: createdUserIds } } }),
    () => prisma.generationTask.deleteMany({ where: { ownerId: { in: createdUserIds } } }),
    () => prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }),
  ];
  for (const step of cleanup) {
    await step().catch(() => undefined);
  }
  const leftover = await prisma.user.count({ where: { id: { in: createdUserIds } } });
  if (leftover > 0) console.log(`  (清理残留 ${leftover} 个测试账号, 通常是新增了引用 User 的表未加入清理列表)`);

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
