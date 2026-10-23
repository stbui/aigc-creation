/**
 * 存储抽象层与素材管理冒烟测试 (admin-prd.md §3.4 B-21~27/ §3.11 B-62/63)。
 *
 * 重点验证**多后端语义**的正确性:
 *   - 按 storageBackend 读取/删除, 而非当前默认后端
 *   - 路径穿越被拦截
 *   - 下架不等于删除(可恢复)
 */
// 可用 API_BASE 覆盖: 端口被其它进程占用时, 冒烟必须能指向目标实例
const BASE = (process.env.API_BASE || 'http://localhost:4100').replace(/\/$/, '') + '/api/v1';
// 后台凭据: seed:admin 只在首次运行打印一次性密码, 故允许环境变量覆盖
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@huojue.local';
// 密码没有默认值: seed:admin 只打印一次, 硬编码等于把后台口令写进仓库
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PASSWORD) {
  console.error('缺少 ADMIN_PASSWORD: 先 npm run seed:admin, 再用它打印的一次性密码运行本脚本。');
  process.exit(1);
}
const { PrismaClient } = require('@prisma/client');
const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
const { resolveDbUrl } = require('./db-url');
const { ensureTestUser } = require('./lib/test-user');
const prisma = new PrismaClient({ adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }) });

/**
 * 自建一个「有素材的 C 端账号」。
 *
 * 2026-10-22 起不再借用预置账号的素材：旧写法假设库里第 2 条素材的属主
 * 有一个已知密码，既依赖内置演示账号，又让断言取决于库里的历史数据。
 * 现在现场注册 + 上传，样本归属明确。
 */
async function seedOwnedAsset(token) {
  const pj = await call('POST', '/projects', token, { name: `存储冒烟-${Date.now()}` });
  const projectId = pj.data?.id;
  const { Jimp } = require('jimp');
  const png = await new Jimp({ width: 32, height: 32, color: 0x3366ffff }).getBuffer('image/png');
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), `storage-probe-${Date.now()}.png`);
  fd.append('projectId', projectId);
  const res = await fetch(`${BASE}/assets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const json = await res.json().catch(() => ({}));
  return { projectId, asset: json.data ?? json, status: res.status };
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
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 150) }; }
  return { status: res.status, ...json };
}

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  const login = await call('POST', '/auth/login', null, {
    email: ADMIN_EMAIL, password: ADMIN_PASSWORD,
  });
  const T = login.data.accessToken;

  // 自建 C 端账号 + 一条自有素材，后续「下架 / 用户端过滤」都用它当样本
  const owner = await ensureTestUser(BASE, { prefix: 'storage' });
  const seeded = await seedOwnedAsset(owner.token);
  check('自建素材上传成功', seeded.status === 201 && !!seeded.asset?.id,
    `实际 ${seeded.status} ${JSON.stringify(seeded.asset).slice(0, 160)}`);

  console.log('\n【存储后端状态 B-63】');
  const st = await call('GET', '/admin/storage/status', T);
  check('状态接口可用', st.status === 200, `active=${st.data?.active}`);
  check('本地后端已注册', st.data?.backends?.some(b => b.backend === 'local'));
  check('本地连通正常', st.data?.backends?.find(b => b.backend === 'local')?.available === true);
  check('凭据不可编辑(PRD约束)', st.data?.editable === false, st.data?.credentialSource);
  check('OSS 未配置时不出现在列表', !st.data?.backends?.some(b => b.backend === 'oss' && b.configured));

  console.log('\n【连通性测试 B-62】');
  const probe = await call('POST', '/admin/storage/probe?backend=local', T);
  check('探测接口可用', probe.status === 200 || probe.status === 201, probe.data?.message);
  const badProbe = await call('POST', '/admin/storage/probe?backend=oss', T);
  check('探测未启用后端返回 404', badProbe.status === 404, badProbe.message);

  console.log('\n【素材列表 B-23】');
  const list = await call('GET', '/admin/assets?pageSize=5', T);
  check('素材列表可用', list.status === 200, `total=${list.data?.total}`);
  /*
   * 取**有 storageKey 的那一条**做样本：storageKey 是后加的字段，历史素材
   * 允许为 null（迁移脚本只处理仍在线上的文件）。用 items[0] 会让断言
   * 取决于库里恰好是哪条老数据，而不是接口有没有返回该字段。
   */
  // 优先用刚上传的那条：它的 storeKey / 属主都是确定的，断言不再依赖历史数据
  const sample =
    list.data?.items?.find((i) => i.id === seeded.asset?.id) ??
    list.data?.items?.find((i) => i.storageKey) ??
    list.data?.items?.[0];
  check('返回存储后端字段', sample?.storageBackend !== undefined, `后端=${sample?.storageBackend}`);
  check('返回 storageKey', !!sample?.storageKey, sample?.storageKey ?? '(无)');
  check('返回所属项目与用户', !!sample?.projectName && !!sample?.ownerEmail,
    `${sample?.projectName} / ${sample?.ownerEmail}`);

  console.log('\n【素材统计】');
  const stats = await call('GET', '/admin/assets/stats', T);
  check('统计可用', stats.status === 200, `total=${stats.data?.total}, ${stats.data?.totalMb}MB`);
  check('按后端分组', stats.data?.byBackend?.local !== undefined, JSON.stringify(stats.data?.byBackend));

  console.log('\n【项目列表 B-21】');
  const projects = await call('GET', '/admin/projects', T);
  check('项目列表可用', projects.status === 200, `total=${projects.data?.total}`);
  check('含素材数与任务数', projects.data?.items?.[0]?.assetCount !== undefined,
    `项目「${projects.data?.items?.[0]?.name}」素材 ${projects.data?.items?.[0]?.assetCount} 任务 ${projects.data?.items?.[0]?.taskCount}`);

  console.log('\n【下架 ≠ 删除 B-26】');
  // 沿用上面选出的样本：下架后文件必须还在，没有 storageKey 的老数据验证不了这一点
  const hidden = await call('PATCH', `/admin/assets/${sample.id}/status`, T, { status: 'hidden' });
  check('下架成功', hidden.status === 200 || hidden.status === 201, `status=${hidden.data?.status}`);

  const afterHide = await prisma.asset.findUnique({ where: { id: sample.id } });
  check('记录仍存在(可恢复)', !!afterHide, `status=${afterHide?.status}`);
  check('文件未被删除', !!afterHide?.storageKey, afterHide?.storageKey ?? '(无)');

  // 恢复
  const restore = await call('PATCH', `/admin/assets/${sample.id}/status`, T, { status: 'visible' });
  check('可恢复上架', restore.status === 200 || restore.status === 201);

  console.log('\n【用户端过滤已下架素材】');
  // 用自建素材做样本：下架它，属主自己列表里必须看不到
  const testAsset = seeded.asset;
  await call('PATCH', `/admin/assets/${testAsset.id}/status`, T, { status: 'hidden' });
  const userList = await call('GET', '/assets?limit=100', owner.token);
  const visible = userList.data?.items ?? [];
  const containsHidden = visible.some(a => a.id === testAsset.id);
  check('用户端列表不含已下架素材', !containsHidden,
    `用户端 ${visible.length} 条中含下架素材: ${containsHidden}`);
  await call('PATCH', `/admin/assets/${testAsset.id}/status`, T, { status: 'visible' });

  console.log('\n【管理端不过滤下架素材】');
  const adminList = await call('GET', '/admin/assets?status=hidden', T);
  check('管理端可筛选 hidden', adminList.status === 200, `hidden 状态 ${adminList.data?.total} 条`);

  console.log('\n【批量下架 B-87】');
  const batch = await call('POST', '/admin/assets/batch-status', T, {
    ids: list.data.items.slice(0, 2).map(a => a.id), status: 'hidden',
  });
  check('批量下架成功', batch.status === 200 || batch.status === 201, `影响 ${batch.data?.count} 条`);
  await call('POST', '/admin/assets/batch-status', T, {
    ids: list.data.items.slice(0, 2).map(a => a.id), status: 'visible',
  });
  const empty = await call('POST', '/admin/assets/batch-status', T, { ids: [], status: 'hidden' });
  check('空选择被拒', empty.status === 400, empty.message);

  console.log('\n【删除影响预览】');
  const impact = await call('GET', `/admin/assets/${sample.id}/impact`, T);
  check('影响预览可用', impact.status === 200,
    `${impact.data?.tasks} 个任务, ${impact.data?.sizeBytes} 字节, ${impact.data?.storageBackend}`);

  console.log('\n【切换默认后端】');
  const sw = await call('POST', '/admin/storage/active?backend=local', T);
  check('切换到 local 成功', sw.status === 200 || sw.status === 201, sw.data?.note);
  const badSw = await call('POST', '/admin/storage/active?backend=s3', T);
  check('非法后端被拒', badSw.status === 400, badSw.message);
  const notEnabled = await call('POST', '/admin/storage/active?backend=minio', T);
  check('未启用后端不可切换', notEnabled.status === 500 || notEnabled.status === 400,
    notEnabled.message?.slice(0, 50));

  console.log('\n【参数校验】');
  const badStatus = await call('PATCH', `/admin/assets/${sample.id}/status`, T, { status: 'deleted' });
  check('非法 status 被拒', badStatus.status === 400, badStatus.message);

  console.log('\n【路径穿越防护】');
  const { assertSafeKey } = require('../dist/storage/storage.provider');
  check('拒绝 .. 穿越', (() => { try { assertSafeKey('../../etc/passwd'); return false; } catch { return true; } })());
  check('拒绝绝对路径', (() => { try { assertSafeKey('/etc/passwd'); return false; } catch { return true; } })());
  check('拒绝反斜杠', (() => { try { assertSafeKey('a\\b'); return false; } catch { return true; } })());
  check('接受正常 key', (() => { try { assertSafeKey('original/202610/abc.jpg'); return true; } catch { return false; } })());

  // operator 在权限矩阵里明确有 asset.read/hide/delete (运营负责内容处置),
  // 所以这里应验证「有权限且能操作」, 越权验证交给 finance 角色(无运营类权限)
  console.log('\n【operator 的素材权限(应有)】');
  const bcrypt = require('bcryptjs');
  const email = `as-op-${Date.now()}@test.com`;
  await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash('test123456', 10), name: '素材运营', role: 'operator' },
  });
  const opLogin = await call('POST', '/auth/login', null, { email, password: 'test123456' });
  const opT = opLogin.data.accessToken;
  const opList = await call('GET', '/admin/assets', opT);
  check('operator 可读素材', opList.status === 200, `HTTP ${opList.status}`);
  const opHide = await call('PATCH', `/admin/assets/${sample.id}/status`, opT, { status: 'hidden' });
  check('operator 可下架(内容职责)', opHide.status === 200 || opHide.status === 201, `HTTP ${opHide.status}`);
  await call('PATCH', `/admin/assets/${sample.id}/status`, T, { status: 'visible' });
  await prisma.user.delete({ where: { email } }).catch(() => {});

  console.log('\n【越权: finance 无运营类素材权限】');
  const finEmail = `as-fin-${Date.now()}@test.com`;
  await prisma.user.create({
    data: { email: finEmail, passwordHash: await bcrypt.hash('test123456', 10), name: '素材财务', role: 'finance' },
  });
  const finLogin = await call('POST', '/auth/login', null, { email: finEmail, password: 'test123456' });
  const finT = finLogin.data.accessToken;
  const finList = await call('GET', '/admin/assets', finT);
  check('finance 无 asset.read', finList.status === 403, finList.message);
  const finDel = await call('DELETE', `/admin/assets/${sample.id}`, finT);
  check('finance 无 asset.delete', finDel.status === 403, finDel.message);
  await prisma.user.delete({ where: { email: finEmail } }).catch(() => {});

  console.log(`\n${'='.repeat(52)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log('='.repeat(52));
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})();