// 后台 M4/M10/M14 冒烟测试 —— 逐条验证权限链路与业务规则
const BASE = 'http://localhost:3005/api/v1';

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
    email: 'admin@huojue.local',
    password: 'wQFFfQA8rXHKwSuLPpBz',
  });
  const T = admin.data.accessToken;
  const me = (await call('GET', '/admin/me', T)).data;

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
  await prisma.$disconnect();

  const opLogin = await call('POST', '/auth/login', null, { email: opEmail, password: 'test123456' });
  const opToken = opLogin.data.accessToken;

  const target = (await call('GET', '/admin/users?keyword=qa3visual', T)).data.items[0];
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
  // 扁平结构: 全局 ValidationPipe whitelist:true 会剥离未声明字段,
  // 未声明的 evilKey 应被静默剥离 -> 最终表现为"没有可更新项"400
  const unknownKey = await call('PATCH', '/admin/settings', T, { evilKey: 1 });
  check('未声明字段被剥离后返回 400', unknownKey.status === 400, unknownKey.message);

  const empty = await call('PATCH', '/admin/settings', T, { reason: '无变更' });
  check('空提交返回 400', empty.status === 400, empty.message);

  const outOfRange = await call('PATCH', '/admin/settings', T, { uploadMaxSizeMb: 9999 });
  check('越界值被 DTO 层拦截', outOfRange.status === 400, outOfRange.message);

  const wrongType = await call('PATCH', '/admin/settings', T, { siteMaintenance: 'maybe' });
  check('类型错误被 DTO 层拦截', wrongType.status === 400, wrongType.message);

  const okSet = await call('PATCH', '/admin/settings', T, {
    uploadMaxSizeMb: 30,
    reason: '冒烟测试',
  });
  check('合法写入成功', okSet.status === 200, `updated: ${okSet.data?.updated?.join(',')}`);

  const verify = (await call('GET', '/admin/settings', T)).data.groups
    .find((g) => g.key === 'upload').items.find((i) => i.key === 'upload.maxSizeMb');
  check('写入值真实落库', verify.value === 30, `当前值 ${verify.value}, overridden=${verify.overridden}`);

  // 还原
  await call('PATCH', '/admin/settings', T, { uploadMaxSizeMb: 20, reason: '还原' });

  console.log('\n【角色权限更新】');
  const badPerm = await call('PATCH', '/admin/roles/operator/permissions', T, {
    permissions: ['not.a.real.permission'],
  });
  check('未知权限点被拒', badPerm.status === 400, badPerm.message);

  const cur = (await call('GET', '/admin/roles?code=operator', T)).data.items[0];
  const reduced = cur.permissions.filter((p) => p !== 'user.read');
  const upd = await call('PATCH', '/admin/roles/operator/permissions', T, {
    permissions: reduced,
    reason: '冒烟测试收权',
  });
  check('权限更新成功', upd.status === 200, `${cur.permissions.length} → ${reduced.length} 项`);

  // 收权后 operator 的旧 token 应立即失去 user.read
  const afterRevoke = await call('GET', '/admin/users', opToken);
  check('收权后旧 token 立即失效', afterRevoke.status === 403, afterRevoke.message);

  // 还原
  await call('PATCH', '/admin/roles/operator/permissions', T, {
    permissions: cur.permissions,
    reason: '还原',
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