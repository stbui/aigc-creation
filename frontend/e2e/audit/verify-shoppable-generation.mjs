/**
 * 本站 AI 带货图文真实生成链路端到端验证（验收用）。
 *
 * 步骤: 登录 → 取/建项目 → 上传真实可解码图片 → 提交一次生成 (6 张)
 *       → 轮询任务 → 核对产出张数 / 计费 / batchId 归组 / 失败语义。
 *
 * 走的是站内的真实接口与真实模型链路（本机仿真网关）,
 * 不是 mock —— 页面若调不通这里, 页面上也是调不通的。
 */
import zlib from 'node:zlib';

const BASE = 'http://127.0.0.1:4100/api/v1';

const EMAIL = 'sc-e2e@test.local';
const PASSWORD = 'Sctest123456';

async function call(path, { method = 'GET', body, token, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  if (raw) return { status: res.status, json };
  const data = json?.data ?? json;
  if (!res.ok || (json?.code !== undefined && json.code !== 0)) {
    const err = new Error(json?.message || `HTTP ${res.status}`);
    err.code = json?.code;
    err.payload = data;
    throw err;
  }
  return data;
}

/** 造一张真实可解码的 PNG (16x16 纯色) —— 上传校验按字节魔数与像素解码 */
function makePng() {
  const width = 32;
  const height = 32;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y += 1) {
    raw[o] = 0;
    o += 1;
    for (let x = 0; x < width; x += 1) {
      raw[o] = 90 + ((x * 4) % 120);
      raw[o + 1] = 110 + ((y * 4) % 100);
      raw[o + 2] = 180;
      o += 3;
    }
  }
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  const out = {};

  // 1. 登录
  const auth = await call('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  const token = auth.accessToken;
  out.login = { ok: true, userId: auth.user.id };

  // 2. 余额
  const credits = await call('/credits/balance', { token });
  out.balanceBefore = credits.balance ?? credits.available ?? null;

  // 3. 项目
  const projects = await call('/projects', { token });
  const list = projects.items || projects.projects || projects;
  let projectId = Array.isArray(list) && list.length ? list[0].id : null;
  if (!projectId) {
    const created = await call('/projects', { method: 'POST', token, body: { name: '带货图文E2E' } });
    projectId = created.id ?? created.project?.id;
  }
  out.projectId = projectId;

  // 4. 上传
  const png = makePng();
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'product.png');
  form.append('projectId', projectId);
  const asset = await call('/assets/upload', { method: 'POST', token, body: form });
  out.asset = { id: asset.id, format: asset.format, projectId: asset.projectId };

  // 5. 解析前台模型
  const models = await call('/models', { token });
  const mlist = models.items || models.models || models;
  const logical = Array.isArray(mlist)
    ? mlist.find((m) => m.capability === 'shoppable_carousel')
    : null;
  out.logicalModel = logical ? { id: logical.id, name: logical.name, capability: logical.capability } : null;
  if (!logical) throw new Error('未找到 shoppable_carousel 的前台模型');

  // 6. 提交
  const submitted = await call('/generate', {
    method: 'POST',
    token,
    body: {
      projectId,
      capability: 'shoppable_carousel',
      logicalModelId: logical.id,
      inputAssetIds: [asset.id],
      params: {
        templateId: 'accessories-01',
        templateName: '沉浸开箱试穿',
        sellingPoints: '轻量便携，续航 12 小时，通勤首选',
        platform: 'tiktok',
        market: 'us',
        language: 'en',
        ratio: '3:4',
        size: '1k',
        count: 6,
        mode: 'template',
        noText: false,
        socialCaption: true,
        batchId: 'e2e-batch-1',
        batchIndex: 1,
        batchSize: 6,
      },
    },
  });
  out.submitted = { taskId: submitted.id ?? submitted.taskId, status: submitted.status };

  // 7. 轮询
  const taskId = out.submitted.taskId;
  let final = null;
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 1500));
    const t = await call(`/tasks/${taskId}`, { token });
    if (['succeeded', 'failed', 'cancelled'].includes(t.status)) {
      final = t;
      break;
    }
  }
  out.final = final
    ? {
        status: final.status,
        errorCode: final.errorCode ?? null,
        errorMessage: final.errorMessage ?? null,
        outputAssets: (final.outputAssets ?? []).map((a) => ({ id: a.id, format: a.format, w: a.width, h: a.height })),
        creditCost: final.creditCost ?? null,
        prompt: (final.prompt ?? '').slice(0, 400),
      }
    : { status: 'timeout' };

  // 8. 同批次的其它任务 (outputPlan 拆出来的 N 张)
  const tasks = await call('/tasks?limit=50', { token });
  const tlist = tasks.items || tasks.tasks || tasks;
  const mine = (Array.isArray(tlist) ? tlist : []).filter((t) => t.capability === 'shoppable_carousel');
  out.batchTasks = mine.map((t) => ({
    id: t.id,
    status: t.status,
    errorCode: t.errorCode ?? null,
    beatIndex: t.params?.beatIndex ?? null,
    shotIndex: t.params?.shotIndex ?? null,
    batchIndex: t.params?.batchIndex ?? null,
    batchSize: t.params?.batchSize ?? null,
    creditCost: t.creditCost ?? null,
    hasOutput: Boolean(t.outputAssets?.length || t.outputAsset),
  }));

  // 9. 余额
  const creditsAfter = await call('/credits/balance', { token });
  out.balanceAfter = creditsAfter.balance ?? creditsAfter.available ?? null;

  console.log(JSON.stringify(out, null, 1));
}

main().catch((e) => {
  console.error('FAILED:', e.message, e.code ? `(code ${e.code})` : '');
  if (e.payload) console.error(JSON.stringify(e.payload).slice(0, 500));
  process.exit(1);
});
