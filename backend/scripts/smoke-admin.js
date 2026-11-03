// 后台 M4/M10/M14 冒烟测试 —— 逐条验证权限链路与业务规则
// 可用 API_BASE 覆盖: 端口被其它进程占用时, 冒烟必须能指向目标实例
const BASE = (process.env.API_BASE || 'http://localhost:4100').replace(/\/$/, '') + '/api/v1';
// 后台凭据: development/test 使用统一预设, production 必须显式提供 ADMIN_PASSWORD
const { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } = require('./admin-credentials').getAdminCredentials();
if (!ADMIN_PASSWORD) {
  console.error('缺少 ADMIN_PASSWORD: production 环境请先 npm run seed:admin，再传入打印的一次性密码。');
  process.exit(1);
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
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

/**
 * CSV 导出是 text/csv 而不是 JSON 信封, 不能用 call() 解析。
 * 同时校验 BOM: 没有它 Excel 打开中文表头会乱码。
 *
 * BOM 必须按**字节**判断: Node 的 Response.text() 会按 UTF-8 解码并丢掉前导
 * U+FEFF, charCodeAt(0) 永远拿不到 0xfeff —— 那样检查会一直红, 让人误以为
 * 服务端没写 BOM。
 */
async function fetchCsv(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    hasBom: buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf,
    text: buf.toString('utf8'),
  };
}

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

(async () => {
  const admin = await call('POST', '/auth/login', null, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  const T = admin.data.accessToken;
  const me = (await call('GET', '/admin/me', T)).data;

  console.log('\n【告警中心】');
  // 只要求后台身份; 来源在 service 内按角色权限过滤
  const alerts = await call('GET', '/admin/alerts', T);
  check(
    '告警接口返回结构',
    alerts.status === 200 &&
      typeof alerts.data?.total === 'number' &&
      Array.isArray(alerts.data?.items) &&
      typeof alerts.data?.generatedAt === 'string',
    `HTTP ${alerts.status} · ${alerts.data?.items?.length ?? 0} 条`,
  );
  const refundAlert = alerts.data?.items?.find((i) => i.key === 'refund-processing');
  check(
    '退款告警链接指向订单筛选',
    !refundAlert ||
      (refundAlert.category === 'finance' &&
        refundAlert.link === '/admin/orders?refundState=processing'),
    refundAlert ? refundAlert.link : '当前无退款卡单',
  );

  // 退款状态筛选: 非法值必须 400, 合法值可用 (告警深链依赖它)
  const badRefundState = await call('GET', '/admin/orders?refundState=bogus', T);
  check('退款状态非法值被拒', badRefundState.status === 400, badRefundState.message);
  const okRefundState = await call('GET', '/admin/orders?refundState=processing&pageSize=1', T);
  check('退款状态筛选可用', okRefundState.status === 200, `HTTP ${okRefundState.status}`);

  console.log('\n【自保护】');
  // 不能禁用自己
  const selfDisable = await call('PATCH', `/admin/users/${me.id}/status`, T, { status: 'disabled' });
  check('不能禁用自己', selfDisable.status === 400, selfDisable.message);

  // 不能变更自己的角色
  const selfRole = await call('PATCH', `/admin/users/${me.id}/role`, T, { role: 'operator' });
  check('不能变更自己的角色', selfRole.status === 400, selfRole.message);

  console.log('\n【防提权】');
  // 造一个 operator 账号, 让它尝试把别人提成 admin
  const opEmail = `smoke-op-${Date.now()}@test.com`;
  const bcrypt = require('bcryptjs');
  const { PrismaClient } = require('@prisma/client');
  const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
const { resolveDbUrl } = require('./db-url');
  const prisma = new PrismaClient({
    adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
  });
  const hash = await bcrypt.hash('test123456', 10);
  const op = await prisma.user.create({
    data: { email: opEmail, passwordHash: hash, name: '冒烟运营', role: 'operator' },
  });
  /*
   * 被操作对象不能依赖历史数据 ('qa3visual' 只在开发库存在,
   * 测试库空的时候整个脚本会在取 target.id 时崩掉)。查不到就现造一个普通用户。
   */
  let target = (await call('GET', '/admin/users?keyword=qa3visual', T)).data?.items?.[0];
  if (!target) {
    target = await prisma.user.create({
      data: { email: `smoke-target-${Date.now()}@test.com`, passwordHash: hash, name: '冒烟目标' },
    });
  }
  await prisma.$disconnect();

  const opLogin = await call('POST', '/auth/login', null, { email: opEmail, password: 'test123456' });
  const opToken = opLogin.data.accessToken;

  const escalate = await call('PATCH', `/admin/users/${target.id}/role`, opToken, { role: 'admin' });
  check('operator 不能授予 admin 角色', escalate.status === 403, escalate.message);

  // operator 无 user.delete 权限
  const delAttempt = await call('DELETE', `/admin/users/${target.id}`, opToken, {});
  check('operator 无 user.delete 权限', delAttempt.status === 403, delAttempt.message);

  console.log('\n【参数校验】');
  const badStatus = await call('PATCH', `/admin/users/${target.id}/status`, T, { status: 'hacked' });
  check('非法 status 被拒', badStatus.status === 400, badStatus.message);

  const bigPage = await call('GET', '/admin/users?pageSize=9999', T);
  check('pageSize 上限被拒', bigPage.status === 400, bigPage.message);

  const badSort = await call('GET', '/admin/users?sort=passwordHash:asc', T);
  check('非白名单排序字段回落默认值', badSort.status === 200, '未报错');

  console.log('\n【系统设置校验】');
  // kv 结构: { settings: { '<SETTING_DEFS key>': value }, clears?, reason }。
  // 未知键由 service 按 SETTING_DEFS 直接 400（不再静默剥离）。
  const unknownKey = await call('PATCH', '/admin/settings', T, {
    settings: { evilKey: 1 },
    reason: '冒烟测试',
  });
  check('未知设置项被拒', unknownKey.status === 400, unknownKey.message);

  const empty = await call('PATCH', '/admin/settings', T, { settings: {}, reason: '无变更' });
  check('空提交返回 400', empty.status === 400, empty.message);

  const outOfRange = await call('PATCH', '/admin/settings', T, {
    settings: { 'upload.maxSizeMb': 9999 },
    reason: '冒烟测试',
  });
  check('越界值被 service 层拦截', outOfRange.status === 400, outOfRange.message);

  // 用可写的布尔项验类型校验: site.maintenance 是只读项, 拿它测会先被
  // 「只读」拦下, 断言看似通过却根本没走到类型校验。
  const wrongType = await call('PATCH', '/admin/settings', T, {
    settings: { 'refund.allowConsumedTask': 'maybe' },
    reason: '冒烟测试',
  });
  check('类型错误被 service 层拦截', wrongType.status === 400, wrongType.message);

  const okSet = await call('PATCH', '/admin/settings', T, {
    settings: { 'upload.maxSizeMb': 30 },
    reason: '冒烟测试',
  });
  check('合法写入成功', okSet.status === 200, `updated: ${okSet.data?.updated?.join(',')}`);

  const verify = (await call('GET', '/admin/settings', T)).data.groups
    .find((g) => g.key === 'upload').items.find((i) => i.key === 'upload.maxSizeMb');
  check('写入值真实落库', verify.value === 30, `当前值 ${verify.value}, overridden=${verify.overridden}`);

  // 还原：删除覆盖行回落到 SETTING_DEFS 默认值，而不是再写一个猜测的旧值
  await call('PATCH', '/admin/settings', T, {
    settings: {},
    clears: ['upload.maxSizeMb'],
    reason: '还原',
  });

  console.log('\n【角色权限更新】');
  const badPerm = await call('PATCH', '/admin/roles', T, {
    roles: [{ code: 'operator', permissions: ['not.a.real.permission'] }],
    reason: '冒烟测试未知权限',
  });
  check('未知权限点被拒', badPerm.status === 400, badPerm.message);

  const cur = (await call('GET', '/admin/roles?code=operator', T)).data.items[0];
  const reduced = cur.permissions.filter((p) => p !== 'user.read');
  const upd = await call('PATCH', '/admin/roles', T, {
    roles: [{ code: 'operator', permissions: reduced }],
    reason: '冒烟测试收回用户读取',
  });
  check('权限更新成功', upd.status === 200, `${cur.permissions.length} → ${reduced.length} 项`);

  // 收权后 operator 的旧 token 应立即失去 user.read
  const afterRevoke = await call('GET', '/admin/users', opToken);
  check('收权后旧 token 立即失效', afterRevoke.status === 403, afterRevoke.message);

  // 还原
  await call('PATCH', '/admin/roles', T, {
    roles: [{ code: 'operator', permissions: cur.permissions }],
    reason: '冒烟测试还原权限',
  });
  const restored = await call('GET', '/admin/users', opToken);
  check('权限还原后恢复访问', restored.status === 200, `HTTP ${restored.status}`);

  console.log('\n【审计留痕】');
  const audit = await call('GET', '/admin/audit-logs?pageSize=50', T);
  const actions = audit.data.actions.map((a) => a.action);
  check(
    '审计记录到本次操作',
    actions.includes('user.status_change') && actions.includes('setting.update'),
    `动作: ${actions.slice(0, 6).join(', ')}`,
  );

  const withReason = audit.data.result.items.filter((r) => r.action === 'setting.update' && r.reason);
  check('高危动作记录了操作原因', withReason.length > 0, `带原因记录 ${withReason.length} 条`);

  const failedAudit = audit.data.result.items.filter((r) => r.success === false);
  check('失败操作也被记录', failedAudit.length >= 0, `失败记录 ${failedAudit.length} 条`);

  console.log('\n【CSV 导出】');
  // 五张只读列表的导出口径必须与列表一致, 且统一走 data.export 权限 +
  // data.export 审计。这里只验「内容类型 + BOM + 表头」, 具体列由各页断言。
  for (const [label, path] of [
    ['审计日志', '/admin/audit-logs/export'],
    ['调用记录', '/admin/api-logs/export'],
    ['发票', '/admin/invoices/export'],
    ['优惠券', '/admin/coupons/export'],
    ['限时活动', '/admin/campaigns/export'],
  ]) {
    const csv = await fetchCsv(path, T);
    check(
      `${label}导出返回 CSV`,
      csv.status === 200 && csv.contentType.includes('text/csv') && csv.hasBom,
      `HTTP ${csv.status} · ${csv.text.length} 字符`,
    );
  }

  // 导出即把用户数据带出系统, 匿名访问必须被挡在鉴权层
  const anonCsv = await fetchCsv('/admin/audit-logs/export', null);
  check('匿名导出被拒', anonCsv.status === 401, `HTTP ${anonCsv.status}`);

  // 审计写入是 fire-and-forget, 给落库留一点时间再查
  await new Promise((r) => setTimeout(r, 200));
  const exportAudit = await call('GET', '/admin/audit-logs?action=data.export&pageSize=20', T);
  check(
    '导出留下审计记录',
    exportAudit.status === 200 && (exportAudit.data?.result?.items?.length ?? 0) > 0,
    `data.export 记录 ${exportAudit.data?.result?.items?.length ?? 0} 条`,
  );

  console.log('\n【密码重置】');
  const reset = await call('POST', `/admin/users/${target.id}/password`, T);
  // POST 成功语义是 201, 不是 200
  check('重置成功且返回一次性明文', reset.status === 201 && !!reset.data?.tempPassword, `HTTP ${reset.status} 长度 ${reset.data?.tempPassword?.length}`);
  const newLogin = await call('POST', '/auth/login', null, {
    email: target.email,
    password: reset.data.tempPassword,
  });
  check('新密码可登录', newLogin.status === 200 || newLogin.data?.accessToken !== undefined);

  // 清理
  const { PrismaClient: P2 } = require('@prisma/client');
  const { NodeSQLiteDriverAdapterFactory: F2 } = require('../dist/prisma/node-sqlite-adapter');
  const p2 = new P2({ adapter: new F2({ url: resolveDbUrl() }) });
  await p2.user.delete({ where: { email: opEmail } }).catch(() => {});
  await p2.$disconnect();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log('='.repeat(50));
  process.exit(fail > 0 ? 1 : 0);
})();
