/**
 * 工单 / 全局搜索 / 批量与 CSV 导入导出冒烟测试 (B7)。
 *
 * 守住的承诺:
 *   1. 工单按用户隔离 —— 别人点开我的工单是 404, 不是 403（不泄露 id 存在）
 *   2. 状态机只有 open → processing → resolved/closed 这几条边, 跳步被拒
 *   3. 用户回复会让 resolved 回落 open; closed 后用户不能回复但后台能重开
 *   4. 客服回复会认领工单并推送站内消息
 *   5. 全局搜索只对 data.search 开放, 且单字符不放大成全表扫描
 *   6. 批量启停逐条返回结果; CSV 导入按邮箱匹配并逐行报告
 *
 * 用法（测试档, 禁止指向开发库）:
 *   NODE_ENV=test API_BASE=http://127.0.0.1:4200 node scripts/smoke-tickets-search.js
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

/** 原样返回响应, 不做 JSON 解析（CSV / 二进制用） */
async function rawCall(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { Authorization: `Bearer ${token}`, ...body.headers } : { Authorization: `Bearer ${token}` },
    body: body ? body.body : undefined,
  });
  /*
   * 必须按字节读, 不能用 res.text():
   * fetch 的 text() 会按 UTF-8 解码并**吞掉 BOM**, 于是「导出是否带 BOM」
   * 这条断言永远为假 —— 而 BOM 正是 Excel 不乱码的前提。
   */
  const bytes = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    bytes,
    text: bytes.toString('utf8'),
  };
}

/** 后台角色必须有对应权限点（权限来自 AdminRole 表，不在代码里兜底） */
const NEED_PERMS = [
  'ticket.read',
  'ticket.handle',
  'data.search',
  'data.export',
  'data.import',
  'data.batch',
  'user.read',
  'user.disable',
  'credit.adjust',
];

async function ensureAdminRole() {
  const record = await prisma.adminRole.findUnique({ where: { code: 'admin' } });
  if (!record) {
    await prisma.adminRole.create({
      data: { code: 'admin', name: '超级管理员', permissions: JSON.stringify(NEED_PERMS) },
    });
    return;
  }
  let perms = [];
  try {
    perms = JSON.parse(record.permissions);
  } catch {
    perms = [];
  }
  const missing = NEED_PERMS.filter((p) => !perms.includes(p));
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
  const createdTicketIds = [];
  let adminToken = null;

  await ensureAdminRole();

  console.log('\n【准备账号】');
  const adminReg = await call('POST', '/auth/register', null, {
    email: `smoke-ticket-admin-${stamp}@test.com`,
    password: pwd,
    name: '冒烟客服',
  });
  const adminId = adminReg.data?.user?.id;
  createdUserIds.push(adminId);
  await prisma.user.update({ where: { id: adminId }, data: { role: 'admin' } });
  // 角色实时读库，注册时拿到的 token 直接可用（守卫每次请求都查一次身份）
  adminToken = adminReg.data?.accessToken;

  const u1 = await call('POST', '/auth/register', null, {
    email: `smoke-ticket-u1-${stamp}@test.com`,
    password: pwd,
    name: '提工单的人',
  });
  const u2 = await call('POST', '/auth/register', null, {
    email: `smoke-ticket-u2-${stamp}@test.com`,
    password: pwd,
    name: '无关的人',
  });
  const u1Id = u1.data?.user?.id;
  const u2Id = u2.data?.user?.id;
  const t1 = u1.data?.accessToken;
  const t2 = u2.data?.accessToken;
  createdUserIds.push(u1Id, u2Id);
  check('三个测试账号就绪', Boolean(adminToken && t1 && t2));

  const adminMe = await call('GET', '/admin/me', adminToken);
  check(
    '临时后台身份生效',
    adminMe.status === 200 && adminMe.data?.role === 'admin',
    `status=${adminMe.status} role=${adminMe.data?.role}`,
  );

  console.log('\n【C 端工单】');
  const tooShort = await call('POST', '/tickets', t1, {
    type: 'bug',
    subject: 'a',
    content: '太短了',
  });
  check('标题过短被拒', tooShort.status === 400, tooShort.message);

  const created = await call('POST', '/tickets', t1, {
    type: 'bug',
    subject: `冒烟工单 ${stamp}`,
    content: '生成的主图保存后是空白，请协助排查。',
    priority: 'high',
  });
  const ticket = created.data;
  if (ticket?.id) createdTicketIds.push(ticket.id);
  check(
    '创建工单成功',
    created.status === 200 || created.status === 201,
    `status=${created.status} ${ticket?.ticketNo || created.message || ''}`,
  );
  check('工单初始状态 open', ticket?.status === 'open', `status=${ticket?.status}`);
  check('工单号已生成', Boolean(ticket?.ticketNo), ticket?.ticketNo);

  const mine = await call('GET', '/tickets', t1);
  check(
    '本人列表包含新工单',
    mine.status === 200 && (mine.data?.items ?? []).some((x) => x.id === ticket?.id),
  );

  const otherRead = await call('GET', `/tickets/${ticket?.id}`, t2);
  check('他人读工单详情返回 404', otherRead.status === 404, otherRead.message);

  const otherReply = await call('POST', `/tickets/${ticket?.id}/replies`, t2, { content: '路过' });
  check('他人回复工单返回 404', otherReply.status === 404, otherReply.message);

  console.log('\n【后台处理】');
  const stats = await call('GET', '/admin/tickets/stats', adminToken);
  check(
    '状态计数可读',
    stats.status === 200 && typeof stats.data?.open === 'number',
    `open=${stats.data?.open}`,
  );

  const adminList = await call('GET', `/admin/tickets?q=${encodeURIComponent(ticket?.ticketNo ?? '')}`, adminToken);
  check(
    '按工单号筛选命中',
    adminList.status === 200 && (adminList.data?.items ?? []).some((x) => x.id === ticket?.id),
  );

  const adminDetail = await call('GET', `/admin/tickets/${ticket?.id}`, adminToken);
  check(
    '后台详情带用户与回复',
    adminDetail.status === 200 &&
      adminDetail.data?.user?.email === u1.data?.user?.email &&
      Array.isArray(adminDetail.data?.replies),
  );

  const replyRes = await call('POST', `/admin/tickets/${ticket?.id}/replies`, adminToken, {
    content: '已收到，正在排查，稍后反馈。',
  });
  check('客服回复成功', replyRes.status === 200 || replyRes.status === 201, `status=${replyRes.status}`);
  check('客服回复即受理 open → processing', replyRes.data?.status === 'processing', `status=${replyRes.data?.status}`);
  check('未指派时由回复者认领', replyRes.data?.assigneeId === adminId, `assignee=${replyRes.data?.assigneeId}`);

  // notify 是 fire-and-forget, 给 Handler 一点时间落地
  await new Promise((r) => setTimeout(r, 500));
  const notifs = await call('GET', '/notifications', t1);
  check(
    '用户收到工单回复站内消息',
    (notifs.data?.items ?? []).some((n) => n.type === 'ticket_reply'),
    `count=${(notifs.data?.items ?? []).length}`,
  );

  const userReply = await call('POST', `/tickets/${ticket?.id}/replies`, t1, { content: '补充：用的是 Chrome。' });
  check(
    '用户回复进入线程',
    userReply.status === 200 || userReply.status === 201,
    `replies=${userReply.data?.replies?.length}`,
  );

  const toResolved = await call('PATCH', `/admin/tickets/${ticket?.id}`, adminToken, { status: 'resolved' });
  check('processing → resolved', toResolved.data?.status === 'resolved', `status=${toResolved.data?.status}`);

  const backToOpen = await call('POST', `/tickets/${ticket?.id}/replies`, t1, { content: '问题还在。' });
  check(
    '用户回复使 resolved 回落 open',
    backToOpen.data?.status === 'open',
    `status=${backToOpen.data?.status}`,
  );

  const badTransition = await call('PATCH', `/admin/tickets/${ticket?.id}`, adminToken, { status: 'resolved' });
  check('open → resolved 允许（直接解决）', badTransition.data?.status === 'resolved');

  const illegal = await call('PATCH', `/admin/tickets/${ticket?.id}`, adminToken, { status: 'processing' });
  check('resolved → processing 非法跳步被拒', illegal.status === 400, illegal.message);

  const assignToUser = await call('PATCH', `/admin/tickets/${ticket?.id}`, adminToken, { assigneeId: u2Id });
  check('指派给普通用户被拒', assignToUser.status === 400, assignToUser.message);

  const unassign = await call('PATCH', `/admin/tickets/${ticket?.id}`, adminToken, { assigneeId: null });
  check('显式 null 取消指派', unassign.status === 200 && unassign.data?.assigneeId === null);

  const closed = await call('PATCH', `/admin/tickets/${ticket?.id}`, adminToken, { status: 'closed' });
  check('resolved → closed', closed.data?.status === 'closed', `status=${closed.data?.status}`);

  const replyClosed = await call('POST', `/tickets/${ticket?.id}/replies`, t1, { content: '还能回吗' });
  check('已关闭工单用户不能回复', replyClosed.status === 400, replyClosed.message);

  const reopen = await call('PATCH', `/admin/tickets/${ticket?.id}`, adminToken, { status: 'open' });
  check('后台可以重开已关闭工单', reopen.data?.status === 'open', `status=${reopen.data?.status}`);

  console.log('\n【全局搜索】');
  const short = await call('GET', '/admin/search?q=%E5%95%86', adminToken);
  check(
    '单个字符返回空结果而不是全表',
    short.status === 200 && short.data?.total === 0 && (short.data?.groups ?? []).length === 5,
    `total=${short.data?.total}`,
  );

  const byTicket = await call('GET', `/admin/search?q=${encodeURIComponent(ticket?.ticketNo ?? '')}`, adminToken);
  const ticketGroup = (byTicket.data?.groups ?? []).find((g) => g.key === 'tickets');
  check(
    '按工单号搜到工单',
    Boolean(ticketGroup?.items?.some((i) => i.id === ticket?.id)),
    `total=${byTicket.data?.total}`,
  );
  check(
    '工单搜索落点直达后台详情',
    (ticketGroup?.items?.[0]?.link ?? '').startsWith('/admin/tickets?id='),
    ticketGroup?.items?.[0]?.link,
  );

  const byEmail = await call('GET', `/admin/search?q=${encodeURIComponent(u1.data?.user?.email ?? '')}`, adminToken);
  const userGroup = (byEmail.data?.groups ?? []).find((g) => g.key === 'users');
  check(
    '按邮箱搜到用户',
    Boolean(userGroup?.items?.some((i) => i.id === u1Id)),
    `count=${userGroup?.total}`,
  );

  const assetGroup = (byEmail.data?.groups ?? []).find((g) => g.key === 'assets');
  check('素材搜索落点带 q 参数', Boolean(assetGroup), '分组存在即通过（当前账号无素材时应为空）');

  const forbiddenSearch = await call('GET', '/admin/search?q=abc', t2);
  check('普通用户不能调用全局搜索', forbiddenSearch.status === 403, forbiddenSearch.message);

  console.log('\n【批量与导入导出】');
  const disabled = await call('POST', '/admin/users/batch', adminToken, { ids: [u2Id], action: 'disable' });
  check(
    '批量禁用逐条返回',
    disabled.status === 200 || disabled.status === 201
      ? disabled.data?.results?.[0]?.ok === true
      : false,
    JSON.stringify(disabled.data?.results?.[0] ?? disabled.message),
  );

  const enabled = await call('POST', '/admin/users/batch', adminToken, { ids: [u2Id], action: 'enable' });
  check('批量启用恢复账号', enabled.data?.results?.[0]?.ok === true);

  const batchForbidden = await call('POST', '/admin/users/batch', t2, { ids: [u2Id], action: 'disable' });
  check('普通用户不能批量启停', batchForbidden.status === 403, batchForbidden.message);

  const exportUsers = await rawCall('GET', '/admin/users/export?keyword=smoke-ticket', adminToken);
  check(
    '用户 CSV 导出返回 text/csv',
    exportUsers.status === 200 && exportUsers.contentType.includes('text/csv'),
    `${exportUsers.status} ${exportUsers.contentType}`,
  );
  check('导出含 UTF-8 BOM（Excel 打开中文不乱码）', exportUsers.text.charCodeAt(0) === 0xfeff);

  const exportTickets = await rawCall('GET', '/admin/tickets/export', adminToken);
  check(
    '工单 CSV 导出返回 text/csv',
    exportTickets.status === 200 && exportTickets.contentType.includes('text/csv'),
    `${exportTickets.status} ${exportTickets.contentType}`,
  );

  const balanceBefore = await call('GET', '/credits/balance', t1);
  const csv = `email,delta,reason\n${u1.data?.user?.email},120,冒烟 CSV 导入\n`;
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'credits.csv');
  form.append('reason', '冒烟批量补贴');
  const imported = await fetch(`${BASE}/admin/credits/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: form,
  });
  const importedBody = await imported.json().catch(() => ({}));
  const importedData = importedBody.data ?? importedBody;
  check(
    'CSV 导入按邮箱命中',
    imported.status === 200 || imported.status === 201
      ? importedData?.succeeded === 1
      : false,
    JSON.stringify(importedData?.results?.[0] ?? importedBody.message ?? imported.status),
  );

  const balanceAfter = await call('GET', '/credits/balance', t1);
  check(
    '导入后余额真实增加',
    (balanceAfter.data?.balance ?? 0) === (balanceBefore.data?.balance ?? 0) + 120,
    `${balanceBefore.data?.balance} → ${balanceAfter.data?.balance}`,
  );

  const badCsv = `email,delta\nno-such-user-${stamp}@test.com,10\n`;
  const form2 = new FormData();
  form2.append('file', new Blob([badCsv], { type: 'text/csv' }), 'credits.csv');
  const importFail = await fetch(`${BASE}/admin/credits/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: form2,
  });
  const failBody = await importFail.json().catch(() => ({}));
  const failData = failBody.data ?? failBody;
  check(
    '未知邮箱逐行报失败而不是整批中止',
    (importFail.status === 200 || importFail.status === 201) && failData?.failed === 1,
    JSON.stringify(failData?.results?.[0] ?? failBody.message),
  );

  const importForbidden = await fetch(`${BASE}/admin/credits/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t2}` },
    body: form,
  });
  check('普通用户不能导入积分', importForbidden.status === 403, String(importForbidden.status));

  console.log('\n【清理】');
  await prisma.ticketReply.deleteMany({ where: { ticketId: { in: createdTicketIds } } });
  await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } });
  await prisma.creditLot.deleteMany({ where: { userId: u1Id } });
  await prisma.creditLedger.deleteMany({ where: { userId: u1Id } });
  await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  console.log('  已清理测试工单与测试账号');

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('冒烟脚本异常:', e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
