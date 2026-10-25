/**
 * 限流冒烟 (B5)。
 *
 * 限流保护的都是**有真实成本**的接口：密码哈希是 CPU、短信是真金白银、
 * 生成是模型调用与积分、上传是磁盘。本脚本钉死四条：
 *
 *   1. 超限返回 `429` + 信封 `code=42901` + `Retry-After`（秒，正整数）
 *   2. 多窗口规则同时生效（短信「1 次/分钟」先于「5 次/天」触发）
 *   3. 伪造 `X-Forwarded-For` **不能**绕开限流（默认不信任代理头）
 *   4. 未超限时回写 `X-RateLimit-Limit` / `X-RateLimit-Remaining`，前端据此提前禁用
 *
 * ⚠️ 短信发送是「1 次/分钟」，同一分钟内重跑本脚本时第一条就会是 429。
 * 这不是失败：脚本会把它记为「窗口未过期，直接验证拒绝形态」，仍然断言
 * 第二条 429 与头部形态。**每个窗口只能证明一次「放行」**，这是固定窗口的
 * 固有特性，不是脚本缺陷。
 *
 * 用法（测试档）:
 *   API_BASE=http://127.0.0.1:4100 NODE_ENV=test node scripts/smoke-rate-limit.js
 */
const { loadEnvOnce } = require('./db-url');

loadEnvOnce();

const BASE = (process.env.API_BASE || 'http://127.0.0.1:4100').replace(/\/$/, '') + '/api/v1';
const SMS_LIMIT = 1;

let pass = 0;
let fail = 0;
let skip = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}
function note(msg) {
  skip += 1;
  console.log(`  SKIP  ${msg}`);
}

/**
 * 清空限流计数（仅测试档、需 RATE_LIMIT_RESET_TOKEN）。
 *
 * 短信「5 次/天」与找回密码「3 次/小时」是**进程级**计数，同一天重跑冒烟时
 * 上一次的残留会把这一轮挡在门外 —— 那不是通道坏了，是窗口还没过。
 * 开始前清一次，断言仍然打在同一个 guard 上（限流没被测掉，只是窗口从
 * 「进程生命周期」收窄成「脚本作用域」）。
 */
async function resetRateLimit() {
  const token = process.env.RATE_LIMIT_RESET_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`${BASE}/test/rate-limit/reset`, {
      method: 'POST',
      headers: { 'x-test-token': token },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return {
    status: res.status,
    headers: res.headers,
    ...json,
  };
}

/** 429 的统一形态：状态码 + 信封 code + Retry-After */
function assertThrottled(label, res, windowSec) {
  const retry = Number(res.headers.get('retry-after'));
  check(
    `${label} 返回 429 / 42901`,
    res.status === 429 && res.code === 42901,
    `status=${res.status} code=${res.code ?? '-'} ${res.message || ''}`,
  );
  check(
    `${label} 带 Retry-After 且落在窗口内`,
    Number.isFinite(retry) && retry >= 1 && retry <= windowSec,
    `Retry-After=${res.headers.get('retry-after')}`,
  );
  check(
    `${label} 文案给出可执行等待时间`,
    typeof res.message === 'string' && /秒/.test(res.message),
    res.message || '',
  );
}

(async () => {
  console.log(`限流冒烟 API=${BASE}`);
  // 开始与结束各清一次：本脚本会刻意打满短信/找回密码的严格配额，
  // 不清的话同一天的第二遍用例（含 smoke-auth）会被自己的残留挡住
  const resetAtStart = await resetRateLimit();
  console.log(`限流计数重置: ${resetAtStart ? '已清空' : '跳过（未配置 RATE_LIMIT_RESET_TOKEN 或非测试档）'}`);

  console.log('\n【短信发送 · 1 次/分钟】');
  const phone = `139${String(Date.now()).slice(-8)}`;
  const first = await call('POST', '/auth/sms/send', { phone, purpose: 'verify' });
  const firstIsLimit = first.status === 429;

  if (firstIsLimit) {
    note('本分钟窗口已被上一次运行用掉，直接验证拒绝形态');
  } else {
    check('首次发送放行', first.status === 200 || first.status === 201, `status=${first.status} ${first.message || ''}`);
  }

  const second = await call('POST', '/auth/sms/send', { phone, purpose: 'verify' });
  assertThrottled('同分钟第二次发送', second, 60);

  // 换手机号不换 IP：限流维度是 IP，换目标号码不该获得新配额
  const otherPhone = await call('POST', '/auth/sms/send', {
    phone: `138${String(Date.now()).slice(-8)}`,
    purpose: 'verify',
  });
  check('换手机号不能重置配额（按 IP 计数）', otherPhone.status === 429, String(otherPhone.status));

  // 伪造 XFF：RATE_LIMIT_TRUST_PROXY 默认关闭，req.ip 取 TCP 对端
  const spoofed = await call('POST', '/auth/sms/send', { phone, purpose: 'verify' }, { 'X-Forwarded-For': '203.0.113.7' });
  check('伪造 X-Forwarded-For 不能绕开限流', spoofed.status === 429, String(spoofed.status));

  console.log('\n【登录 · 未超限时的响应头】');
  const login = await call('POST', '/auth/login', { email: `nobody-${Date.now()}@test.com`, password: 'wrong-pass-123' });
  const limitHeader = login.headers.get('x-ratelimit-limit');
  const remainingHeader = login.headers.get('x-ratelimit-remaining');
  if (login.status === 429) {
    // 测试档把登录配额抬到 RATE_LIMIT_AUTH_PER_MIN（默认 200），正常不会撞上
    note('登录本分钟配额已用尽（可能是并发压测），跳过头部断言');
  } else {
    check('登录失败仍是 401（限流未误伤正常请求）', login.status === 401, String(login.status));
    check('回写 X-RateLimit-Limit', Number(limitHeader) > 0, `Limit=${limitHeader}`);
    check('回写 X-RateLimit-Remaining', Number(remainingHeader) >= 0, `Remaining=${remainingHeader}`);
    const expect = Number(process.env.RATE_LIMIT_AUTH_PER_MIN);
    if (Number.isFinite(expect) && expect > 0) {
      check('Limit 与 RATE_LIMIT_AUTH_PER_MIN 一致（测试档放宽生效）', Number(limitHeader) === expect, `${limitHeader} vs ${expect}`);
    } else {
      check('Limit 为默认 10', Number(limitHeader) === 10, String(limitHeader));
    }
  }

  console.log('\n【找回密码 · 3 次/小时】');
  const forgotResults = [];
  for (let i = 0; i < 4; i += 1) {
    // 每次换目标邮箱：限流按 IP，换目标不应获得新配额
    forgotResults.push(await call('POST', '/auth/password/forgot', { email: `rl-${Date.now()}-${i}@test.com` }));
  }
  const firstThrottledAt = forgotResults.findIndex((r) => r.status === 429);
  check(
    '连续请求会在第 4 次之前触发拒绝',
    firstThrottledAt > 0 && firstThrottledAt <= 3,
    `首次 429 出现在第 ${firstThrottledAt + 1} 次（状态 ${forgotResults.map((r) => r.status).join(',')}）`,
  );
  if (firstThrottledAt >= 0) {
    assertThrottled('找回密码超限', forgotResults[firstThrottledAt], 3600);
  }
  check(
    '限流生效前的请求恒返回成功（防账号枚举）',
    forgotResults.slice(0, Math.max(0, firstThrottledAt)).every((r) => r.status === 200 || r.status === 201),
  );

  console.log('\n【生成 · 按用户计数】');
  const noAuth = await call('POST', '/generate', { projectId: 'x', capability: 'main_image', inputAssetIds: [] });
  check('未登录时生成接口先返回 401（限流不替代鉴权）', noAuth.status === 401, String(noAuth.status));

  await resetRateLimit();
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败 / ${skip} 跳过`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('冒烟异常终止:', e);
  process.exit(1);
});
