/**
 * 冒烟 / 验证脚本共用的 C 端测试账号工厂。
 *
 * 存在的理由（2026-10-22）：项目不再内置演示账号，所有脚本改成
 * **现场注册一个唯一账号**，跑完即弃。这样脚本之间不再互相依赖「库里必须
 * 有某个人事先 seed 好的账号」，也不会因为有人改了那个账号的密码而集体失效。
 *
 * 为什么放在 scripts/lib/ 而不是每个脚本里复制一遍：
 *   注册要拼唯一邮箱、要处理「邮箱已存在」、要统一错误文案。
 *   复制 10 份的下一步就是 10 份各自漂移。
 *
 * 用法（CJS，.js 与 ts-node -T 的 .ts 都能 require）：
 *   const { apiBase, ensureTestUser, ensureSecondaryUser } = require('./lib/test-user');
 *   const BASE = apiBase(process.env.API_BASE);          // http://localhost:4100/api/v1
 *   const { token, email } = await ensureTestUser(BASE);
 *   const other = await ensureSecondaryUser(BASE);       // 越权用例的"另一个人"
 *
 * 想复用固定账号（例如自己造好的带积分的号）时设：
 *   TEST_EMAIL / TEST_PASSWORD   或   SEED_USER_EMAIL / SEED_USER_PASSWORD
 * 设置了就登录，不再注册。
 */

/** 把 origin / 带前缀的地址统一成 `<origin>/api/v1`，避免拼出 /api/v1/api/v1 */
function apiBase(input) {
  const raw = (input || process.env.API_BASE || 'http://localhost:4100').replace(/\/+$/, '');
  return /\/api\/v1$/.test(raw) ? raw : `${raw}/api/v1`;
}

/** 随机密码：满足后端 min 6，也够长不至于撞上弱口令校验 */
function randomPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 16; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** 网络层重试（只重试 fetch 抛异常，不重试 4xx/5xx —— 那是有意义的业务结果） */
async function fetchRetry(url, options, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fetch(url, options);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

async function postJson(url, body) {
  const res = await fetchRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/** 登录，返回 accessToken；失败抛错并带上后端原话 */
async function loginUser(base, email, password) {
  const { status, json } = await postJson(`${apiBase(base)}/auth/login`, { email, password });
  const data = json.data ?? json;
  if (!data?.accessToken) {
    throw new Error(`登录失败(${status}): ${(json.message || json.msg || '').slice(0, 200) || JSON.stringify(json).slice(0, 200)}`);
  }
  return { token: data.accessToken, user: data.user, email, password };
}

/**
 * 注册一个唯一账号并返回 token。
 *
 * `prefix` 只用于让邮箱在人眼里可读（`smoke-fusion-1730...@test.local`），
 * 真正的唯一性靠时间戳 + 随机后缀。
 */
async function registerUser(base, { prefix = 'test', name } = {}) {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const email = `${prefix}-${stamp}@test.local`;
  const password = randomPassword();
  const displayName = name || `测试${stamp.slice(-4)}`;
  const { status, json } = await postJson(`${apiBase(base)}/auth/register`, {
    email,
    password,
    name: displayName,
  });
  const data = json.data ?? json;
  if (!data?.accessToken) {
    throw new Error(`注册失败(${status}): ${(json.message || json.msg || '').slice(0, 200) || JSON.stringify(json).slice(0, 200)}`);
  }
  return { token: data.accessToken, user: data.user, email, password };
}

/**
 * 拿一个可用账号：优先用环境变量指定的固定账号，否则现场注册。
 * 返回值统一为 `{ token, user, email, password }`。
 */
async function ensureTestUser(base, options = {}) {
  const email = process.env.TEST_EMAIL || process.env.SEED_USER_EMAIL || '';
  const password = process.env.TEST_PASSWORD || process.env.SEED_USER_PASSWORD || '';
  if (email && password) return loginUser(base, email, password);
  return registerUser(base, options);
}

/** 第二个账号 —— 越权断言必须用「另一个人」，不能复用自己的 token */
async function ensureSecondaryUser(base, options = {}) {
  return registerUser(base, { prefix: 'other', ...options });
}

module.exports = {
  apiBase,
  fetchRetry,
  loginUser,
  registerUser,
  ensureTestUser,
  ensureSecondaryUser,
};
