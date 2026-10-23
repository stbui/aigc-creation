/**
 * 端到端验证: 三个新功能的真实链路 (2026-10-20)
 *
 * 跑法: cd backend && node scripts/verify-prompt-tools.js
 * 前置: 后端已在 4100 端口运行
 *
 * 验证项:
 *   1. AI润色        POST /api/v1/prompt-tools/polish
 *   2. 图片转提示词  POST /api/v1/prompt-tools/image-to-prompt  (含多模态识图)
 *   3. 手机上传      POST /mobile-upload/sessions → 手机端上传 → 电脑端轮询取回
 *   4. 未登录访问    三个接口均应 401
 *
 * ⚠️ 断言要独立于实现: 期望值来自"接口契约 + 参考站实拍文案", 不是从代码反推。
 */
const BASE = process.env.VERIFY_BASE || 'http://localhost:4100/api/v1';
// 素材地址要打回**同一个实例**：硬写开发档端口会让脚本在测试档 4200 上跑时
// 一律 404，看起来像上传失败，实际只是问错了端口。
const ORIGIN = BASE.replace(/\/api\/v1\/?$/, '');
const { ensureTestUser } = require('./lib/test-user');

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
 * 带重试的 fetch。
 *
 * ⚠️ **为什么需要重试**: 长时间运行的脚本在沙箱/受限网络下, 偶发
 * `ECONNRESET` (连接被对端或中间层重置)。这不是服务端缺陷 ——
 * 同一接口连续请求 10 次全 200 —— 而是长时间进程的连接保活问题。
 *
 * ⚠️ **重试只针对网络层失败** (fetch 抛异常), 不重试 HTTP 4xx/5xx ——
 * 后者是有意义的业务结果 (断言该看到它), 重试会掩盖真实失败。
 */
async function fetchRetry(url, options, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, options);
    } catch (e) {
      lastErr = e;
      // 退避后重试 (网络层瞬时故障)
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * 现场注册一个账号（不再依赖库里预置的演示账号），见 lib/test-user.js。
 *
 * ⚠️ 断言必须写死 accessToken 字段名（与前端 AuthResponse 一致）,
 * 否则字段改名了脚本还"通过", 就抓不到真实回归 —— test-user 里已按此校验。
 */
async function login() {
  const { token } = await ensureTestUser(BASE, { prefix: 'prompt-tools' });
  return token;
}

async function main() {
  console.log('\n═══ 1. 登录 ═══');
  const token = await login();
  const auth = { Authorization: `Bearer ${token}` };
  check('登录拿到 token', !!token);

  console.log('\n═══ 2. 未登录访问应 401 ═══');
  for (const [name, path, body] of [
    ['润色', '/prompt-tools/polish', { text: '测试' }],
    ['图片转提示词', '/prompt-tools/image-to-prompt', { assetId: 'x' }],
  ]) {
    const res = await fetchRetry(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    check(`${name} 未登录 → 401`, res.status === 401, `实际 ${res.status}`);
  }
  const resS = await fetchRetry(`${BASE}/mobile-upload/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'x' }),
  });
  check('建会话 未登录 → 401', resS.status === 401, `实际 ${resS.status}`);

  console.log('\n═══ 3. AI 润色 ═══');
  const polishRes = await fetchRetry(`${BASE}/prompt-tools/polish`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '把这款产品放在未来感厨房场景中，清晨自然光' }),
  });
  const polishJson = await polishRes.json();
  const polish = polishJson.data ?? polishJson;
  // ⚠️ POST 成功是 **201 Created** (NestJS 默认语义), 不是 200。
  // 断言写成 200 会把正确实现判成失败 —— 基线必须按 HTTP 语义独立抄录。
  check('润色返回 201', polishRes.status === 201, `实际 ${polishRes.status} ${JSON.stringify(polishJson).slice(0, 300)}`);
  check('润色产出非空文本', typeof polish.text === 'string' && polish.text.length > 5, `长度 ${polish?.text?.length}`);
  check('润色产出明显长于原文 (扩写)', (polish.text || '').length > 20, `长度 ${polish?.text?.length}`);
  check('来源标记为 gateway', polish.source === 'gateway', `实际 ${polish.source}`);
  check('回报了模型名', typeof polish.model === 'string' && polish.model.length > 0, `实际 ${polish.model}`);
  check('回报了 token 用量', !!polish.usage, `实际 ${JSON.stringify(polish.usage)}`);
  console.log(`     产出: ${String(polish.text).slice(0, 90)}…`);

  console.log('\n═══ 4. 仅润色文字 (textOnly) ═══');
  const onlyRes = await fetchRetry(`${BASE}/prompt-tools/polish`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '红杯子在桌上', textOnly: true }),
  });
  const onlyJson = await onlyRes.json();
  const only = onlyJson.data ?? onlyJson;
  check('textOnly 返回 201', onlyRes.status === 201, `实际 ${onlyRes.status}`);
  check('textOnly 产出非空', typeof only.text === 'string' && only.text.length > 0, `长度 ${only?.text?.length}`);
  console.log(`     产出: ${String(only.text).slice(0, 90)}…`);

  console.log('\n═══ 5. 图片转提示词 (多模态识图) ═══');
  // 造一张有明确视觉特征的图: 纯红 64x64 PNG
  // ⚠️ **必须用 Jimp 生成, 不能手写 base64** —— 手写的那张只有 87 字节,
  // PNG 数据块不完整, 网关会拒收 (image_parse_error)。
  // 这个坑很隐蔽: 字节头是对的 (魔数 \\x89PNG), 但流不完整。
  const { Jimp: JimpCtor } = require('jimp');
  const png = await new JimpCtor({ width: 64, height: 64, color: 0xff0000ff }).getBuffer('image/png');
  // 新注册账号没有项目 —— 没有就建一个（上传必须挂项目）
  let projectId = (await (await fetchRetry(`${BASE}/projects`, { headers: auth })).json()).data?.[0]?.id;
  if (!projectId) {
    const created = await (
      await fetchRetry(`${BASE}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ name: '验证项目' }),
      })
    ).json();
    projectId = (created.data ?? created).id;
  }
  check('取到项目 id', !!projectId);

  // 先上传图片成素材
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'probe.png');
  fd.append('projectId', projectId);
  const upRes = await fetchRetry(`${BASE}/assets/upload`, { method: 'POST', headers: auth, body: fd });
  const upJson = await upRes.json();
  const asset = upJson.data ?? upJson;
  check('图片上传成功', upRes.status === 201 && !!asset.id, `实际 ${upRes.status} ${JSON.stringify(upJson).slice(0, 200)}`);

  const i2pRes = await fetchRetry(`${BASE}/prompt-tools/image-to-prompt`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId: asset.id }),
  });
  const i2pJson = await i2pRes.json();
  const i2p = i2pJson.data ?? i2pJson;
  check('图片转提示词返回 201', i2pRes.status === 201, `实际 ${i2pRes.status} ${JSON.stringify(i2pJson).slice(0, 300)}`);
  check('产出非空文本', typeof i2p.text === 'string' && i2p.text.length > 5, `长度 ${i2p?.text?.length}`);
  check('来源标记为 gateway', i2p.source === 'gateway', `实际 ${i2p.source}`);
  // 关键: 纯红图, 模型应提到红/色 —— 证明它真的看了图而非凭空编
  check('输出与图像内容相关 (提到颜色)', /红|色|颜色|red/i.test(String(i2p.text)), `输出: ${String(i2p.text).slice(0, 120)}`);
  console.log(`     产出: ${String(i2p.text).slice(0, 120)}…`);

  console.log('\n═══ 6. 越权读取他人素材应 404 ═══');
  const badRes = await fetchRetry(`${BASE}/prompt-tools/image-to-prompt`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId: 'not-exist-asset-id' }),
  });
  check('不存在的素材 → 404', badRes.status === 404, `实际 ${badRes.status}`);

  console.log('\n═══ 7. 手机上传全链路 ═══');
  const createRes = await fetchRetry(`${BASE}/mobile-upload/sessions`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  });
  const createJson = await createRes.json();
  const session = createJson.data ?? createJson;
  check('创建会话返回 201', createRes.status === 201, `实际 ${createRes.status} ${JSON.stringify(createJson).slice(0, 200)}`);
  check('拿到 sessionId', !!session.sessionId);
  check('拿到 token', !!session.token);
  check('有过期时间', session.expiresAt > Date.now(), `实际 ${session.expiresAt}`);

  // 初始状态应为 waiting
  const st0 = await (await fetchRetry(`${BASE}/mobile-upload/sessions/${session.sessionId}`, { headers: auth })).json();
  check('初始状态 waiting', (st0.data ?? st0).status === 'waiting', `实际 ${JSON.stringify(st0)}`);

  // 错误令牌应被拒
  const badTok = await fetchRetry(`${BASE}/mobile-upload/sessions/${session.sessionId}/receive`, {
    method: 'POST',
    body: (() => {
      const f = new FormData();
      f.append('file', new Blob([png], { type: 'image/png' }), 'bad.png');
      f.append('token', 'wrong-token');
      return f;
    })(),
  });
  check('错误令牌 → 403', badTok.status === 403, `实际 ${badTok.status}`);

  // 手机端上传 (免登录, 不带 Authorization) —— **一次多张** (2026-10-20 对齐参考站)
  const fd2 = new FormData();
  fd2.append('file', new Blob([png], { type: 'image/png' }), 'phone.png');
  fd2.append('file', new Blob([png], { type: 'image/png' }), 'phone2.png');
  fd2.append('token', session.token);
  const recvRes = await fetchRetry(`${BASE}/mobile-upload/sessions/${session.sessionId}/receive`, {
    method: 'POST',
    body: fd2,
  });
  const recvJson = await recvRes.json();
  check('手机端上传返回 201', recvRes.status === 201, `实际 ${recvRes.status} ${JSON.stringify(recvJson).slice(0, 200)}`);

  // 电脑端轮询应拿到 received + assetId + assetUrl
  const st1 = await (await fetchRetry(`${BASE}/mobile-upload/sessions/${session.sessionId}`, { headers: auth })).json();
  const s1 = st1.data ?? st1;
  check('轮询状态为 received', s1.status === 'received', `实际 ${JSON.stringify(s1)}`);
  check('拿到 assets 数组 (多图)', Array.isArray(s1.assets) && s1.assets.length === 2, `实际 ${JSON.stringify(s1.assets)}`);
  check('assets 顺序即提交顺序', s1.assets?.[0]?.filename === 'phone.png' && s1.assets?.[1]?.filename === 'phone2.png', JSON.stringify(s1.assets?.map(a=>a.filename)));
  check('每个 asset 都有可访问地址', s1.assets?.every((a) => typeof a.url === 'string' && a.url.startsWith('/uploads/')), JSON.stringify(s1.assets?.map(a=>a.url)));
  check('兼容字段 assetId = 第一张', !!s1.assetId && s1.assetId === s1.assets?.[0]?.id, `实际 ${s1.assetId}`);
  check('拿到 assetUrl (真实可访问地址)', typeof s1.assetUrl === 'string' && s1.assetUrl.startsWith('/uploads/'), `实际 ${s1.assetUrl}`);
  check('保留原文件名', s1.originalFilename === 'phone.png', `实际 ${s1.originalFilename}`);

  // 素材应真的进了素材库
  const listRes = await fetchRetry(`${BASE}/assets?kind=original&limit=20`, { headers: auth });
  const listJson = await listRes.json();
  const items = (listJson.data ?? listJson).items ?? [];
  check('素材进了用户素材库', items.some((a) => a.id === s1.assetId), `素材数 ${items.length}`);
  check('两张素材都在素材库里', s1.assets?.every((a) => items.some((x) => x.id === a.id)), `素材数 ${items.length}`);

  // assetUrl 应可访问
  const imgRes = await fetchRetry(`${ORIGIN}${s1.assetUrl}`);
  check('素材地址可访问 (200)', imgRes.status === 200, `实际 ${imgRes.status}`);

  console.log('\n═══ 8. 取消会话 ═══');
  const cancelRes = await fetchRetry(`${BASE}/mobile-upload/sessions/${session.sessionId}`, {
    method: 'DELETE',
    headers: auth,
  });
  check('取消返回 200', cancelRes.status === 200, `实际 ${cancelRes.status}`);
  const st2 = await fetchRetry(`${BASE}/mobile-upload/sessions/${session.sessionId}`, { headers: auth });
  check('取消后会话不可查 (404)', st2.status === 404, `实际 ${st2.status}`);

  console.log(`\n═══ 汇总: ${pass} 通过 / ${fail} 失败 ═══\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\n✗ 验证脚本异常:', e.message);
  process.exit(1);
});
