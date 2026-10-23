/**
 * 模型线路（多渠道）HTTP 冒烟。
 *
 * 需要后端已启动，且用一个有 channel.route / channel.test 权限的管理员登录。
 * 连接与凭据通过环境变量提供：
 *   SMOKE_BASE         默认 http://localhost:3005/api/v1
 *   ADMIN_EMAIL        默认 admin@huojue.local
 *   ADMIN_PASSWORD     必填（seed:admin 只打印一次，脚本不猜密码）
 *
 * 覆盖：线路 CRUD、token 保持/清除、排序、测试响应形状、sourceAfter、未登录 401。
 * 探测目标固定为不可达地址，不消耗任何模型额度。
 */

const BASE = process.env.SMOKE_BASE || 'http://localhost:3005/api/v1';
const EMAIL = process.env.ADMIN_EMAIL || 'admin@huojue.local';
const PASSWORD = process.env.ADMIN_PASSWORD;

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

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

(async () => {
  if (!PASSWORD) {
    console.error('缺少 ADMIN_PASSWORD。先 npm run seed:admin，再用它打印的一次性密码运行本脚本。');
    process.exit(1);
  }

  const login = await call('POST', '/auth/login', null, { email: EMAIL, password: PASSWORD });
  if (login.status >= 400 || !login.data?.accessToken) {
    console.error(`登录失败: ${login.status} ${login.message ?? ''}`);
    process.exit(1);
  }
  const T = login.data.accessToken;

  console.log('\n【鉴权】');
  const anon = await call('GET', '/admin/model-channels', null);
  check('未登录访问线路列表返回 401', anon.status === 401, `status=${anon.status}`);

  console.log('\n【列表】');
  const list0 = await call('GET', '/admin/model-channels', T);
  check('线路快照返回三模态', list0.status === 200 && list0.data?.modalities?.image, `status=${list0.status}`);
  const imageSource = list0.data?.modalities?.image?.source;
  check('图像模态含调度来源', ['channels', 'legacy', 'none'].includes(imageSource), imageSource);

  console.log('\n【创建】');
  const created = await call('POST', '/admin/model-channels', T, {
    modality: 'image',
    name: `smoke-${Date.now()}`,
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:9',
    token: 'sk-smoke-123456',
    model: 'gpt-image-2',
    enabled: true,
    reason: 'smoke-model-channels',
  });
  check('创建线路成功', created.status === 201 || created.status === 200, `status=${created.status}`);
  const ch = created.data?.channel;
  check('返回线路 id', Boolean(ch?.id), ch?.id);
  check('令牌不回显明文', ch?.hasToken === true && ch?.tokenMasked !== 'sk-smoke-123456', ch?.tokenMasked);
  check('返回是否固化了旧配置', typeof created.data?.materialized === 'boolean', created.data?.materialized);

  if (!ch?.id) {
    console.log('\n无法继续：创建未返回 id');
    process.exit(1);
  }

  try {
    console.log('\n【更新：token 语义】');
    const rename = await call('PATCH', `/admin/model-channels/${ch.id}`, T, { name: `${ch.name}-改名` });
    check('改名成功', rename.status === 200 && rename.data?.channel?.name?.endsWith('-改名'), rename.message);

    const keep = await call('PATCH', `/admin/model-channels/${ch.id}`, T, { token: '' });
    check('传空串保持令牌', keep.data?.channel?.hasToken === true, keep.data?.channel?.hasToken);

    const clear = await call('PATCH', `/admin/model-channels/${ch.id}`, T, { clearToken: true });
    check('clearToken 清除令牌', clear.data?.channel?.hasToken === false, clear.data?.channel?.hasToken);

    const conflict = await call('PATCH', `/admin/model-channels/${ch.id}`, T, {
      token: 'sk-new',
      clearToken: true,
    });
    check('同时改令牌与清除被拒绝', conflict.status === 400, `status=${conflict.status}`);

    const badProtocol = await call('PATCH', `/admin/model-channels/${ch.id}`, T, { protocol: 'not-a-protocol' });
    check('未知协议被拒绝', badProtocol.status === 400, badProtocol.message);

    console.log('\n【排序】');
    const down = await call('POST', `/admin/model-channels/${ch.id}/move`, T, { dir: 'down' });
    check('下移接口可用（边界允许失败但形状正确）', [200, 400].includes(down.status), `status=${down.status}`);

    console.log('\n【测试】');
    const tested = await call('POST', `/admin/model-channels/${ch.id}/test`, T, {});
    // POST 在 Nest 下默认 201，不是 200
    check('已保存线路测试返回形状', [200, 201].includes(tested.status) && 'ok' in (tested.data ?? {}), `status=${tested.status}`);
    check('测试结果带 testedAt', typeof tested.data?.testedAt === 'string', tested.data?.testedAt);
    check('测试目标为 saved', tested.data?.target === 'saved', tested.data?.target);

    const draft = await call('POST', '/admin/model-channels/test', T, {
      modality: 'image',
      protocol: 'openai',
      baseUrl: 'http://127.0.0.1:9',
      token: 'sk-draft',
      enabled: true,
    });
    check('草稿测试返回形状', [200, 201].includes(draft.status) && draft.data?.target === 'draft', `status=${draft.status}`);
    check('草稿测试不回显令牌', !JSON.stringify(draft.data ?? {}).includes('sk-draft'));

    console.log('\n【删除】');
    const removed = await call('DELETE', `/admin/model-channels/${ch.id}`, T, { reason: 'smoke cleanup' });
    check('删除成功', removed.status === 200 && removed.data?.deleted === true, removed.message);
    check('返回剩余线路数与回退来源', typeof removed.data?.remaining === 'number' && Boolean(removed.data?.sourceAfter), removed.data);
  } finally {
    // 失败中途也尽量清理，避免留下测试线路
    await call('DELETE', `/admin/model-channels/${ch.id}`, T, { reason: 'smoke cleanup' }).catch(() => undefined);
  }

  console.log(`\n通过 ${pass} 项 / 失败 ${fail} 项`);
  if (fail > 0) process.exit(1);
  console.log('模型线路冒烟通过');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
