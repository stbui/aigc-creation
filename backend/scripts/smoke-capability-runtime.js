/**
 * 能力运行时真相冒烟 (B6, 2026-10-21)。
 *
 * 覆盖三件事：
 *   1. GET /capabilities 每项都带 runtime；2026-10-25 起本地生成算法已删除，
 *      localQuality 恒为 none、effective 不得为 local，没模型通道时必须是 unavailable
 *   2. 后台能力管控：下线无原因被拒、下线后 C 端不可提交（40005）、恢复后复原
 *   3. 限时免费：进行中的活动把生效价压到 0，活动停用后自动恢复原价
 *
 * 用法:
 *   API_BASE=http://127.0.0.1:4100/api/v1 NODE_ENV=test node scripts/smoke-capability-runtime.js
 *
 * ⚠ 必须指向**测试环境**：本脚本会建用户 / 建项目 / 开关能力 / 建活动，
 * 全都在清理段回收，但跑在开发库上仍属污染。
 */
// API_BASE 约定填**主机根**(与其它冒烟一致); 顺手兼容带了 /api/v1 的写法,
// 免得因为多打一段前缀得到一句 "Cannot POST /api/v1/api/v1/..." 这种误导性报错
const BASE =
  (process.env.API_BASE || 'http://localhost:4100')
    .replace(/\/$/, '')
    .replace(/\/api\/v1$/, '') + '/api/v1';
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

const VALID_EFFECTIVE = ['remote', 'disabled', 'unavailable'];

(async () => {
  const admin = await call('POST', '/auth/login', null, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (admin.status >= 400 || !admin.data?.accessToken) {
    console.error('后台登录失败，无法继续（检查 ADMIN_EMAIL / ADMIN_PASSWORD）:', admin.message);
    process.exit(1);
  }
  const T = admin.data.accessToken;

  // ── 1. 公开接口的 runtime 字段 ──
  console.log('\n【GET /capabilities · runtime】');
  const caps = (await call('GET', '/capabilities', null)).data;
  const items = caps.items || [];
  check('能力清单非空', items.length > 0, `${items.length} 项`);
  check('每项都带 runtime', items.every((c) => !!c.runtime));

  const badEffective = items.filter((c) => !VALID_EFFECTIVE.includes(c.runtime?.effective));
  check('effective 取值合法', badEffective.length === 0, badEffective.map((c) => c.id).join(',') || '全部合法');

  const noReason = items.filter((c) => !c.runtime?.reason);
  check('每项都有可读的 reason', noReason.length === 0, noReason.map((c) => c.id).join(',') || '全部有');

  // 本地生成算法已删除。localQuality 仅为兼容旧前端保留，必须恒为 none。
  const qualityWrong = items.filter((c) => c.runtime.localQuality !== 'none');
  check(
    'localQuality 恒为 none',
    qualityWrong.length === 0,
    qualityWrong.map((c) => `${c.id}=${c.runtime.localQuality}`).join(',') || `${items.length} 项`,
  );
  const legacyFields = items.filter(
    (c) => Object.prototype.hasOwnProperty.call(c, 'localImpl') ||
      Object.prototype.hasOwnProperty.call(c, 'localFallback'),
  );
  check('能力定义不再下发本地实现字段', legacyFields.length === 0, legacyFields.map((c) => c.id).join(','));

  /*
   * 没有模型通道时必须是 unavailable/disabled，绝不能预告有产出；
   * 有模型通道时才允许 remote。出现 local 说明旧兜底语义漏回来了。
   */
  const misleading = items.filter(
    (c) => !c.runtime.remoteAvailable && !['unavailable', 'disabled'].includes(c.runtime.effective),
  );
  check(
    '无模型通道的能力不预告产出',
    misleading.length === 0,
    misleading.map((c) => `${c.id}=${c.runtime.effective}`).join(',') || `${items.length} 项`,
  );

  // 视频同样只能由模型产出。
  const videoItems = items.filter((c) => c.modality === 'video');
  const videoLeak = videoItems.filter((c) => c.runtime?.effective === 'local');
  check(
    '视频能力不谎报本地产出',
    videoLeak.length === 0,
    videoItems.map((c) => `${c.id}=${c.runtime.effective}`).join(',') || '无视频能力',
  );

  /*
   * 2026-10-22 起清理完成：**不存在 mock 实现程度**，全部能力要么 real 要么 planned。
   * 断言写在脚本里是防回归：有人再塞一个只画占位图的能力进来，这条会红，
   * 而不是等着用户在界面上看到占位图才发现。
   */
  const mockCount = items.filter((c) => c.mode === 'mock').length;
  const realCount = items.filter((c) => c.mode === 'real').length;
  check('不存在 mock 实现程度', mockCount === 0, `${realCount} real / ${mockCount} mock`);

  // ── 2. 后台上下线 ──
  console.log('\n【后台能力管控】');
  const list = (await call('GET', '/admin/capabilities', T)).data;
  check('后台列表条数与能力清单一致', Array.isArray(list) && list.length === items.length, `${list?.length} 项`);
  check('后台列表带 runtime', Array.isArray(list) && list.every((r) => !!r.runtime));

  const TARGET = 'remove_watermark';
  /*
   * 先把目标能力置于**已知状态**：上一轮冒烟若中断在清理段之前，
   * 库里会残留一条 enabled=false 的记录，此时"复位"断言比较的就是错误基线。
   * 这一步是幂等的（PUT 语义），不会掩盖真实问题。
   */
  await call('PUT', `/admin/capabilities/${TARGET}`, T, { enabled: true });
  const before = (await call('GET', '/capabilities', null)).data.items.find((c) => c.id === TARGET);
  const beforeEffective = before?.runtime?.effective;

  const rejectNoReason = await call('PUT', `/admin/capabilities/${TARGET}`, T, { enabled: false });
  check('下线不填原因被拒', rejectNoReason.status === 400, rejectNoReason.message);

  const offline = await call('PUT', `/admin/capabilities/${TARGET}`, T, {
    enabled: false,
    reason: '冒烟验证：通道维护中',
  });
  check('下线成功', offline.status < 400 && offline.data?.enabled === false, JSON.stringify(offline.data));

  const afterOff = (await call('GET', '/capabilities', null)).data.items.find((c) => c.id === TARGET);
  check('C 端 runtime 变 disabled', afterOff?.runtime?.effective === 'disabled', afterOff?.runtime?.effective);
  check('下线原因下发到 C 端', afterOff?.runtime?.reason === '冒烟验证：通道维护中', afterOff?.runtime?.reason);

  // 生成接口必须拦在扣费之前。项目与输入素材用假的即可 —— 校验顺序保证
  // availability 在素材校验之前，正是为了让"下线"优先于"参数不对"。
  const email = `smoke-runtime-${Date.now()}@test.com`;
  // 注册 DTO 的昵称字段名是 name（不是 nickname）——写错会被 MaxLength 之外的校验兜住，
  // 但报错信息会误导成「昵称最多 20 个字符」，故这里按 DTO 原样传。
  const reg = await call('POST', '/auth/register', null, { email, password: 'test123456', name: '运行时冒烟' });
  check('临时用户注册', reg.status < 400 && !!reg.data?.accessToken, reg.message || '');
  if (!reg.data?.accessToken) {
    console.error('无法继续：临时用户注册失败');
    process.exit(1);
  }
  const U = reg.data.accessToken;
  const project = await call('POST', '/projects', U, { name: '运行时冒烟' });
  const projectId = project.data?.id;
  check('临时项目创建', !!projectId, project.message || '');

  const gen = await call('POST', '/generate', U, {
    projectId,
    inputAssetIds: ['no-such-asset'],
    capability: TARGET,
    params: {},
  });
  check('下线能力提交返回 40005', gen.code === 40005, `code=${gen.code} ${gen.message}`);
  check('错误信息带下线原因', String(gen.message || '').includes('通道维护中'), gen.message || '');

  const online = await call('PUT', `/admin/capabilities/${TARGET}`, T, { enabled: true });
  check('恢复上线', online.status < 400 && online.data?.enabled === true, JSON.stringify(online.data));

  const afterOn = (await call('GET', '/capabilities', null)).data.items.find((c) => c.id === TARGET);
  check('上线后结论复位', afterOn?.runtime?.effective === beforeEffective, `${beforeEffective} → ${afterOn?.runtime?.effective}`);

  // ── 3. 限时免费 ──
  console.log('\n【限时免费活动】');
  const FREE_TARGET = 'main_image';
  const priceBefore = (await call('GET', '/capabilities', null)).data.items.find((c) => c.id === FREE_TARGET)?.creditCost;
  const now = Date.now();
  const created = await call('POST', '/admin/campaigns', T, {
    name: `冒烟限时免费-${now}`,
    type: 'limited_free',
    payload: { capabilityIds: [FREE_TARGET] },
    startAt: new Date(now - 60_000).toISOString(),
    endAt: new Date(now + 3_600_000).toISOString(),
    status: 'active',
  });
  const campaignId = created.data?.id;
  check('活动创建成功', !!campaignId, created.message || '');

  // 价格缓存 3s：活动写入后最多 3 秒生效，冒烟等一次 TTL 再断言
  await new Promise((r) => setTimeout(r, 3200));
  const priceDuring = (await call('GET', '/capabilities', null)).data.items.find((c) => c.id === FREE_TARGET)?.creditCost;
  check('活动期内生效价为 0', priceDuring === 0, `${priceBefore} → ${priceDuring}`);

  const adminPrices = (await call('GET', '/admin/credit-prices', T)).data;
  const row = adminPrices.find((r) => r.capabilityId === FREE_TARGET);
  check('改价页标出 campaign 来源', row?.source === 'campaign' && row?.freeCampaign === true, JSON.stringify(row));

  if (campaignId) await call('PATCH', `/admin/campaigns/${campaignId}/toggle`, T);
  await new Promise((r) => setTimeout(r, 3200));
  const priceAfter = (await call('GET', '/capabilities', null)).data.items.find((c) => c.id === FREE_TARGET)?.creditCost;
  check('活动停用后自动恢复原价', priceAfter === priceBefore, `${priceDuring} → ${priceAfter}`);

  // ── 清理 ──
  const { PrismaClient } = require('@prisma/client');
  const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
  const { resolveDbUrl } = require('./db-url');
  const prisma = new PrismaClient({ adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }) });
  try {
    if (projectId) await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    if (reg.data?.user?.id) await prisma.user.delete({ where: { id: reg.data.user.id } }).catch(() => undefined);
    // 管控记录归零：无行 = 启用，删掉这一段就跑回了默认态
    await prisma.capabilityControl.deleteMany({ where: { capabilityId: TARGET } }).catch(() => undefined);
    if (campaignId) await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => undefined);
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\n通过 ${pass} 项 / 失败 ${fail} 项 → ${fail === 0 ? 'ALL PASS' : 'FAIL'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SMOKE FAIL:', e);
  process.exit(1);
});
