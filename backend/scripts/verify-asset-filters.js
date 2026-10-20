/**
 * 素材库筛选能力验证 (2026-10-20)
 *
 * 跑法: cd backend && node scripts/verify-asset-filters.js
 * 前置: 后端已在 3001 端口运行
 *
 * 覆盖 assets 列表的 keyword / from / to 三个新增筛选维度。
 *
 * ⚠️ 断言基线独立于实现: 期望值来自「接口契约 + HTTP 语义」,
 * 不是从实现反推 (项目记忆里的老坑: 基线同源推导就抓不出真实回归)。
 */
const BASE = process.env.VERIFY_BASE || 'http://localhost:3001/api/v1';
const EMAIL = 'admin@demo.com';
const PASSWORD = 'demo1234';

let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

/**
 * 带重试的 fetch —— 只重试网络层失败 (fetch 抛异常), 不重试 HTTP 4xx/5xx。
 * 理由见 verify-prompt-tools.js 里同名函数的注释。
 */
async function fetchRetry(url, options, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, options);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

async function login() {
  const res = await fetchRetry(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const json = await res.json();
  const data = json.data ?? json;
  if (!data.accessToken) throw new Error(`登录失败: ${JSON.stringify(json).slice(0, 200)}`);
  return data.accessToken;
}

/** 造一张纯色 PNG (用 Jimp 生成 —— 手写 base64 可能是残缺流, 网关会拒收) */
async function makePng() {
  const { Jimp } = require('jimp');
  return new Jimp({ width: 32, height: 32, color: 0xff00ffff }).getBuffer('image/png');
}

async function main() {
  console.log('\n═══ 1. 登录 ═══');
  const token = await login();
  const auth = { Authorization: `Bearer ${token}` };
  check('登录拿到 token', !!token);

  const projects = await (await fetchRetry(`${BASE}/projects`, { headers: auth })).json();
  const projectId = (projects.data ?? projects)[0]?.id;
  check('取到项目 id', !!projectId);
  if (!projectId) throw new Error('无项目, 无法上传');

  console.log('\n═══ 2. 上传带可辨识名字的素材 ═══');
  const png = await makePng();
  const marker = `filterprobe${Date.now().toString(36)}`;
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), `${marker}.png`);
  fd.append('projectId', projectId);
  const up = await fetchRetry(`${BASE}/assets/upload`, { method: 'POST', headers: auth, body: fd });
  const upJson = await up.json();
  const asset = upJson.data ?? upJson;
  // 上传是 POST → 201 Created
  check('上传返回 201', up.status === 201, `实际 ${up.status}`);
  check('拿到素材 id', !!asset?.id, JSON.stringify(upJson).slice(0, 200));

  const listAll = await (
    await fetchRetry(`${BASE}/assets?limit=200`, { headers: auth })
  ).json();
  const all = (listAll.data ?? listAll).items ?? [];
  check('列表含新素材', all.some((a) => a.id === asset.id), `总数 ${all.length}`);

  console.log('\n═══ 3. keyword 筛选 ═══');
  // keyword 搜的是 sourceUrl (存储 key), 而非原始文件名 —— 见 assets.service.ts 注释
  const keyPart = asset.sourceUrl.split('/').pop().split('.')[0];
  const hit = await (
    await fetchRetry(`${BASE}/assets?keyword=${encodeURIComponent(keyPart)}&limit=200`, { headers: auth })
  ).json();
  const hitItems = (hit.data ?? hit).items ?? [];
  check('按存储 key 片段能搜到', hitItems.some((a) => a.id === asset.id), `命中 ${hitItems.length}`);

  const miss = await (
    await fetchRetry(`${BASE}/assets?keyword=zzz-definitely-not-exist-xyz&limit=200`, { headers: auth })
  ).json();
  const missItems = (miss.data ?? miss).items ?? [];
  check('搜不存在的串 → 0 条', missItems.length === 0, `命中 ${missItems.length}`);

  console.log('\n═══ 4. from / to 时间范围筛选 ═══');
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;

  const todayRes = await (
    await fetchRetry(`${BASE}/assets?from=${todayStr}&to=${todayStr}&limit=200`, { headers: auth })
  ).json();
  const todayItems = (todayRes.data ?? todayRes).items ?? [];
  check('今天区间含新素材', todayItems.some((a) => a.id === asset.id), `命中 ${todayItems.length}`);

  const pastRes = await (
    await fetchRetry(`${BASE}/assets?from=2000-01-01&to=2000-01-02&limit=200`, { headers: auth })
  ).json();
  const pastItems = (pastRes.data ?? pastRes).items ?? [];
  check('2000 年区间 → 0 条', pastItems.length === 0, `命中 ${pastItems.length}`);

  const fromOnly = await (
    await fetchRetry(`${BASE}/assets?from=${todayStr}&limit=200`, { headers: auth })
  ).json();
  const fromOnlyItems = (fromOnly.data ?? fromOnly).items ?? [];
  check('只给 from 也能命中 (含当天整天)', fromOnlyItems.some((a) => a.id === asset.id), `命中 ${fromOnlyItems.length}`);

  const toOnly = await (
    await fetchRetry(`${BASE}/assets?to=${todayStr}&limit=200`, { headers: auth })
  ).json();
  const toOnlyItems = (toOnly.data ?? toOnly).items ?? [];
  check('只给 to 也能命中', toOnlyItems.some((a) => a.id === asset.id), `命中 ${toOnlyItems.length}`);

  console.log('\n═══ 5. 非法输入不致 500 ═══');
  for (const [label, qs] of [
    ['非法日期', 'from=not-a-date'],
    ['空日期', 'from=&to='],
    ['未来区间', 'from=2099-01-01&to=2099-12-31'],
  ]) {
    const res = await fetchRetry(`${BASE}/assets?${qs}&limit=10`, { headers: auth });
    check(`${label} → 200`, res.status === 200, `实际 ${res.status}`);
  }

  console.log('\n═══ 6. 越权与鉴权 ═══');
  const noAuth = await fetchRetry(`${BASE}/assets?keyword=x`);
  check('未登录 → 401', noAuth.status === 401, `实际 ${noAuth.status}`);

  console.log('\n═══ 7. kind 维度 (原始/生成) ═══');
  const origRes = await (
    await fetchRetry(`${BASE}/assets?kind=original&limit=200`, { headers: auth })
  ).json();
  const origItems = (origRes.data ?? origRes).items ?? [];
  check('kind=original 全部是 original', origItems.every((a) => a.kind === 'original'), `共 ${origItems.length}`);

  const genRes = await (
    await fetchRetry(`${BASE}/assets?kind=generated&limit=200`, { headers: auth })
  ).json();
  const genItems = (genRes.data ?? genRes).items ?? [];
  check('kind=generated 全部是 generated', genItems.every((a) => a.kind === 'generated'), `共 ${genItems.length}`);

  console.log(`\n═══ 汇总: ${pass} 通过 / ${fail} 失败 ═══\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\n✗ 验证脚本异常:', e.message);
  process.exit(1);
});
