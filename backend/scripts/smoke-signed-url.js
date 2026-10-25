/**
 * 签名资源 URL 冒烟 (B5)。
 *
 * `/uploads/<key>` 是 Express 静态直出 —— 只要路径泄漏，任何人都能取走别人的
 * 生成结果。打开 `ASSET_SIGNING_SECRET` 后要求 `?exp=&sig=`（可选 `&uid=`）。
 *
 * 本脚本按**两段**跑：
 *
 *   A. 单元 / 中间件：签名串正确性、篡改、过期、uid 绑定、关闭时放行
 *   B. 真实服务：在另一个端口拉起一个**带密钥**的后端实例，走完整链路
 *      （上传 → 列表拿到 signedUrl → 无签名 403 → 带签名 200 → 篡改 403 →
 *       过期 410），跑完自动停掉
 *
 * B 段必须真起进程：签名校验发生在 Express 中间件里，只测单元函数证明不了
 * 「静态中间件之前确实挂了这一层」—— 而这正是最容易漏接的地方。
 *
 * 用法（测试档，禁止指向开发库）:
 *   API_BASE=http://127.0.0.1:4100 NODE_ENV=test node scripts/smoke-signed-url.js
 *   node scripts/smoke-signed-url.js --offline   # 只跑 A 段
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { Jimp, JimpMime } = require('jimp');
const { loadEnvOnce, resolveDbUrl } = require('./db-url');
const {
  signAssetUrl,
  verifyAssetUrl,
  assetKeyOf,
} = require('../dist/common/signed-url.service');
const { createSignedAssetMiddleware } = require('../dist/common/signed-asset.middleware');

const OFFLINE = process.argv.includes('--offline');
const SECRET = 'smoke-signing-secret-please-rotate-0123456789';
const PORT = Number(process.env.SIGNED_SMOKE_PORT || 3211);
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const ROOT = `http://127.0.0.1:${PORT}`;

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

// ── A. 单元 + 中间件 ─────────────────────────────────────────────────────

function unit() {
  console.log('\n【签名串】');
  const key = 'generated/2026-10-21/abc123.png';
  const url = signAssetUrl(SECRET, `/uploads/${key}`, { expiresInSec: 60, userId: 'u1' });
  check('生成 /uploads 路径 + exp + sig + uid', url.startsWith(`/uploads/${key}?`) && url.includes('sig=') && url.includes('uid=u1'), url);
  const q = Object.fromEntries(new URLSearchParams(url.split('?')[1]));
  check('原文可验签', verifyAssetUrl(SECRET, key, q).ok);
  check('绝对 URL 同样能剥出 key', assetKeyOf(`https://cdn.example.com/uploads/${key}?x=1`) === key);
  check('换密钥验签失败', verifyAssetUrl(`${SECRET}x`, key, q).ok === false);
  check('篡改 key 验签失败', verifyAssetUrl(SECRET, key.replace('abc', 'zzz'), q).ok === false);
  check('篡改 uid 验签失败', verifyAssetUrl(SECRET, key, { ...q, uid: 'u2' }).reason === 'bad-signature');
  check('缺参数报 missing', verifyAssetUrl(SECRET, key, {}).reason === 'missing');
  const expired = signAssetUrl(SECRET, key, { now: Date.now() - 10 * 3600 * 1000, expiresInSec: 60 });
  const eq = Object.fromEntries(new URLSearchParams(expired.split('?')[1]));
  check('过期链接报 expired', verifyAssetUrl(SECRET, key, eq).reason === 'expired');

  console.log('\n【中间件】');
  const calls = [];
  function fakeRes() {
    const res = {
      statusCode: 0,
      headers: {},
      body: '',
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(obj) {
        this.body = JSON.stringify(obj);
        return this;
      },
      end() {},
    };
    return res;
  }
  function run(mw, req) {
    const res = fakeRes();
    let nexted = false;
    mw(req, res, () => {
      nexted = true;
    });
    calls.push({ res, nexted });
    return { res, nexted };
  }

  const pub = createSignedAssetMiddleware('');
  const r1 = run(pub, { method: 'GET', path: '/uploads/a.png', url: '/uploads/a.png', query: {}, headers: {} });
  check('未配置密钥时一律放行', r1.nexted === true);

  const mw = createSignedAssetMiddleware(SECRET);
  const r2 = run(mw, { method: 'GET', path: '/api/v1/health', url: '/api/v1/health', query: {}, headers: {} });
  check('非 /uploads 路径不拦截', r2.nexted === true);
  const r3 = run(mw, { method: 'POST', path: '/uploads/a.png', url: '/uploads/a.png', query: {}, headers: {} });
  check('非 GET/HEAD 不拦截（静态中间件本来也只服务 GET）', r3.nexted === true);
  const good = Object.fromEntries(new URLSearchParams(signAssetUrl(SECRET, key, { expiresInSec: 60 }).split('?')[1]));
  const r4 = run(mw, { method: 'GET', path: `/uploads/${key}`, url: `/uploads/${key}`, query: good, headers: {} });
  check('验签通过时放行', r4.nexted === true);
  const r5 = run(mw, { method: 'GET', path: `/uploads/${key}`, url: `/uploads/${key}`, query: { ...good, sig: 'x' }, headers: {} });
  check('验签失败返回 403 / 40103', r5.nexted === false && r5.res.statusCode === 403 && r5.res.body.includes('40103'), `${r5.res.statusCode} ${r5.res.body}`);
  const r6 = run(mw, { method: 'GET', path: `/uploads/${key}`, url: `/uploads/${key}`, query: eq, headers: {} });
  check('过期返回 410 / 40104', r6.nexted === false && r6.res.statusCode === 410 && r6.res.body.includes('40104'), `${r6.res.statusCode} ${r6.res.body}`);
}

// ── B. 真实服务 ─────────────────────────────────────────────────────────

function waitPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => {
        sock.destroy();
        resolve(true);
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

async function signedServer() {
  console.log(`\n【真实服务 · 端口 ${PORT}（带密钥实例）】`);
  loadEnvOnce();
  const { PrismaClient } = require('@prisma/client');
  const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
  const prisma = new PrismaClient({ adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }) });

  const logFile = path.join(require('os').tmpdir(), `smoke-signed-${Date.now()}.log`);
  const fd = fs.openSync(logFile, 'w');
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'test',
      PORT: String(PORT),
      // 显式打开签名：这是本段的前提
      ASSET_SIGNING_SECRET: SECRET,
      // 关闭限流，避免并发用例互相顶掉配额（限流另有专属冒烟）
      RATE_LIMIT_ENABLED: 'false',
    },
    stdio: ['ignore', fd, fd],
  });

  const run = `${Date.now()}`;
  const email = `sign-${run}@test.com`;
  let userId = null;

  try {
    const up = await waitPort(PORT);
    check('带密钥实例已监听', up, up ? `:${PORT}` : `超时，日志 ${logFile}`);
    if (!up) return;

    async function call(method, p, token, body) {
      const res = await fetch(`${BASE}${p}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

    const reg = await call('POST', '/auth/register', null, { email, password: 'test123456', name: '签名冒烟' });
    const token = reg.data?.accessToken;
    userId = reg.data?.user?.id;
    check('注册并拿到令牌', Boolean(token), `status=${reg.httpStatus}`);
    if (!token) return;

    const project = await call('POST', '/projects', token, { name: `sign-${run}` });
    const projectId = project.data?.id;

    const img = new Jimp({ width: 300, height: 200, color: 0x5546d8ff });
    const form = new FormData();
    form.append('file', new Blob([await img.getBuffer(JimpMime.png)], { type: 'image/png' }), 'signed.png');
    form.append('projectId', projectId);
    const upRes = await fetch(`${BASE}/assets/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    const upJson = await upRes.json();
    const asset = upJson?.data;
    check('上传返回 signedUrl', typeof asset?.signedUrl === 'string' && asset.signedUrl.includes('sig='), asset?.signedUrl ?? 'null');
    check('上传同时保留干净 sourceUrl', typeof asset?.sourceUrl === 'string' && !asset.sourceUrl.includes('sig='), asset?.sourceUrl);

    const list = await call('GET', '/assets?limit=5', token);
    const listed = Array.isArray(list.data?.items) ? list.data.items.find((a) => a.id === asset?.id) : null;
    check('素材列表带 signedUrl', Boolean(listed?.signedUrl?.includes('sig=')), listed?.signedUrl ?? 'null');

    if (asset?.sourceUrl && asset?.signedUrl) {
      const plain = await fetch(`${ROOT}${asset.sourceUrl}`);
      const plainBody = await plain.text();
      check('无签名访问 /uploads 被拒 403', plain.status === 403 && plainBody.includes('40103'), `${plain.status} ${plainBody.slice(0, 80)}`);
      const signedRes = await fetch(`${ROOT}${asset.signedUrl}`);
      const signedType = signedRes.headers.get('content-type') || '';
      check('带签名可正常取图', signedRes.status === 200 && signedType.startsWith('image/'), `${signedRes.status} ${signedType}`);
      const tampered = asset.signedUrl.replace(/sig=[^&]+/, 'sig=deadbeef');
      const tamperedRes = await fetch(`${ROOT}${tampered}`);
      check('篡改签名被拒 403', tamperedRes.status === 403, String(tamperedRes.status));
      const staleKey = assetKeyOf(asset.sourceUrl);
      const stale = signAssetUrl(SECRET, staleKey, { now: Date.now() - 10 * 3600 * 1000, expiresInSec: 60 });
      const staleRes = await fetch(`${ROOT}${stale}`);
      check('过期链接被拒 410', staleRes.status === 410, String(staleRes.status));
      const headRes = await fetch(`${ROOT}${asset.signedUrl}`, { method: 'HEAD' });
      check('HEAD 也受同一套校验', headRes.status === 200, String(headRes.status));
    }

    // 后台缩略图走 displayUrl：开启签名后必须可直接渲染
    const stats = await call('GET', '/stats/overview', token);
    const recent = Array.isArray(stats.data?.recentTasks) ? stats.data.recentTasks[0] : null;
    if (recent?.thumbnailUrl) {
      check('数据中心缩略图已签名', String(recent.thumbnailUrl).includes('sig='), recent.thumbnailUrl);
    } else {
      console.log('  SKIP  数据中心缩略图（本账号暂无产出任务）');
    }
  } finally {
    child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 300));
    fs.closeSync(fd);
    if (userId) {
      await prisma.project.deleteMany({ where: { ownerId: userId } }).catch(() => {});
      await prisma.asset.deleteMany({ where: { ownerId: userId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    }
    await prisma.$disconnect();
    console.log(`  日志: ${logFile}`);
  }
}

(async () => {
  console.log(`签名资源 URL 冒烟 ${OFFLINE ? '(仅单元)' : `(密钥实例 :${PORT})`}`);
  unit();
  if (!OFFLINE) await signedServer();
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('冒烟异常终止:', e);
  process.exit(1);
});
