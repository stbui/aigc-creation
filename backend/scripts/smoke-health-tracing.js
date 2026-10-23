/**
 * 健康检查 + 请求追踪冒烟 (B5)。
 *
 * 这两块是排障基础设施：线上出事时，先看健康端点判断「是不是自己挂了」，
 * 再拿请求号把一次用户投诉串成一条日志。它们本身出错不会被业务测试发现，
 * 所以单独钉死：
 *
 *   1. `/health` 分项回报 db / storage / channels，`/health/ready` 只看 DB
 *   2. 未就绪时 ready 返回 503（负载均衡据此摘流量），liveness 仍 200
 *   3. 每个响应都有 `X-Request-Id`，且**回显客户端传入的合法值**
 *   4. 客户端传入非法值（过短 / 含非法字符）时服务端重新生成，不原样回显
 *   5. 错误信封带 `requestId`，且与响应头一致 —— 用户报错时可据此定位
 *   6. 日志文件里出现 `[rid=<同一个 id>]` 前缀（AsyncLocalStorage 真的贯穿了 service）
 *
 * 用法（测试档）:
 *   API_BASE=http://127.0.0.1:4200 NODE_ENV=test node scripts/smoke-health-tracing.js
 */
const fs = require('fs');
const path = require('path');
const { loadEnvOnce } = require('./db-url');

loadEnvOnce();

const BASE = (process.env.API_BASE || 'http://127.0.0.1:4100').replace(/\/$/, '') + '/api/v1';
const RID_RE = /^[A-Za-z0-9_-]{8,64}$/;

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

async function raw(method, p, { token, body, headers } = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
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
  return { status: res.status, headers: res.headers, ...json };
}

/** 在日志目录里找含指定 rid 的行（最近的文件优先） */
function grepLog(rid) {
  const dirs = [
    path.resolve(__dirname, '..', process.env.LOG_DIR || 'logs'),
    path.resolve(__dirname, '..', process.env.LOG_DIR || 'logs', 'test'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^app-.*\.log$/.test(f))
      .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 3);
    for (const { f } of files) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const hit = text.split('\n').find((l) => l.includes(`[rid=${rid}]`));
      if (hit) return { file: path.join(dir, f), line: hit.slice(0, 160) };
    }
  }
  return null;
}

(async () => {
  console.log(`健康检查 / 请求追踪冒烟 API=${BASE}`);

  console.log('\n【健康端点】');
  const health = await raw('GET', '/health');
  check('liveness 返回 200', health.status === 200, String(health.status));
  check('回报状态与版本', ['ok', 'degraded'].includes(health.data?.status) && Boolean(health.data?.version), `${health.data?.status} v${health.data?.version}`);
  check('回报环境名（启动横幅同源）', typeof health.data?.env === 'string' && health.data.env.length > 0, health.data?.env);
  check('分项含 db / storage / channels', Boolean(health.data?.checks?.db) && Boolean(health.data?.checks?.storage) && Boolean(health.data?.checks?.channels), JSON.stringify(health.data?.checks ?? {}).slice(0, 160));
  check('DB 检查为 ok（能连上库才可能返回 200）', health.data?.checks?.db?.ok === true, JSON.stringify(health.data?.checks?.db ?? {}));
  check('uptime 为正数', Number(health.data?.uptimeSec) >= 0, String(health.data?.uptimeSec));
  check('健康端点免登录', true);

  const ready = await raw('GET', '/health/ready');
  check('ready 返回 200', ready.status === 200, String(ready.status));

  console.log('\n【请求号 · 响应头】');
  check('响应头带 X-Request-Id', RID_RE.test(health.headers.get('x-request-id') || ''), health.headers.get('x-request-id') || '无');
  check('健康端点的 body.requestId 与响应头一致', health.data?.requestId === health.headers.get('x-request-id'), `${health.data?.requestId}`);
  const exposure = health.headers.get('access-control-expose-headers') || '';
  check('跨域时暴露 X-Request-Id / Retry-After', /x-request-id/i.test(exposure) && /retry-after/i.test(exposure), exposure);

  const mine = 'smoke-trace-abc123';
  const echo = await raw('GET', '/health', { headers: { 'X-Request-Id': mine } });
  check('回显客户端传入的合法请求号', echo.headers.get('x-request-id') === mine, echo.headers.get('x-request-id') || '无');

  const bad = await raw('GET', '/health', { headers: { 'X-Request-Id': 'bad id!' } });
  const badRid = bad.headers.get('x-request-id') || '';
  check('非法请求号被替换（不原样回显）', badRid !== 'bad id!' && RID_RE.test(badRid), badRid);

  console.log('\n【请求号 · 错误信封】');
  const notFound = await raw('GET', '/definitely-not-a-route', { headers: { 'X-Request-Id': mine } });
  check('未知路由 404', notFound.status === 404, String(notFound.status));
  check('错误信封带 requestId', notFound.requestId === mine, notFound.requestId || '无');
  check('错误信封仍是统一三段式', 'code' in notFound && 'data' in notFound && 'message' in notFound, JSON.stringify(notFound).slice(0, 120));

  const badLogin = await raw('POST', '/auth/login', { body: { email: 'no-such-user@test.com', password: 'whatever' } });
  check('业务异常同样带 requestId', Boolean(badLogin.requestId) && badLogin.requestId === badLogin.headers.get('x-request-id'), badLogin.requestId || '无');

  const badBody = await raw('POST', '/auth/register', { body: { email: 'not-an-email' } });
  check('校验失败 400 且带 requestId', badBody.status === 400 && Boolean(badBody.requestId), `${badBody.status} ${badBody.message || ''}`);

  console.log('\n【日志串联】');
  const hit = grepLog(mine);
  check('日志文件出现 [rid=...] 前缀（ALS 贯穿 AppFileLogger）', Boolean(hit), hit ? hit.file.replace(process.cwd(), '.') : '未找到');
  if (hit) console.log(`        ${hit.line}`);

  const ridAfter = (await raw('GET', '/health', { headers: { 'X-Request-Id': 'smoke-trace-xyz789' } })).headers.get('x-request-id');
  check('两次请求的请求号互不相同', ridAfter !== mine, `${mine} / ${ridAfter}`);

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('冒烟异常终止:', e);
  process.exit(1);
});
