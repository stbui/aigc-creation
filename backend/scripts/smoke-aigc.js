/**
 * AIGC 内容标识冒烟 (B5)。
 *
 * 依据《人工智能生成合成内容标识办法》与 GB 45438-2025，生成的图片必须带
 * **显式标识**（用户可见的「AI 生成」角标）与**隐式标识**（文件内 XMP /
 * IPTC `DigitalSourceType = trainedAlgorithmicMedia`）。
 *
 * 本脚本钉死六条：
 *   1. PNG 产出：IEND 之前插入 tEXt / iTXt，**每个 chunk 的 CRC32 正确**
 *   2. JPEG 产出：SOI 之后出现 APP1 XMP 段，且段长自洽
 *   3. 元数据里必须出现 `trainedAlgorithmicMedia`（合规字段，不是可选项）
 *   4. 显式角标**真的改了像素**（右下角区域与未标识版本存在差异）
 *   5. 标识不改尺寸、不改可解码性（还能被 Jimp 读出来）
 *   6. 端到端：走 API 生成一张图，`Asset.aigcMeta` 与磁盘文件都对得上
 *   7. 角标样式可配：位置 / 不透明度 / 自定义位图真的改变合成结果，
 *      越界值被夹紧而非抛错，`specKey` 只跟渲染字段走
 *
 * 用法（测试档，禁止指向开发库）:
 *   API_BASE=http://127.0.0.1:4100 NODE_ENV=test node scripts/smoke-aigc.js
 *
 * 只跑离线部分（不需要后端）:
 *   node scripts/smoke-aigc.js --offline
 */
const fs = require('fs');
const path = require('path');
const { Jimp, JimpMime } = require('jimp');
const { loadEnvOnce, resolveDbUrl } = require('./db-url');
const { labelGeneratedImage, inspectAigcLabel, crc32 } = require('../dist/common/aigc-label');
const {
  AIGC_LABEL_DEFAULTS,
  aigcLabelSpecKey,
  sanitizeAigcLabelSpec,
} = require('../dist/common/aigc-label.config');

const OFFLINE = process.argv.includes('--offline');
const BASE = (process.env.API_BASE || 'http://127.0.0.1:4100').replace(/\/$/, '') + '/api/v1';

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

/** 逐 chunk 校验 PNG 结构：长度自洽 + CRC32 正确 */
function walkPngChunks(buf) {
  const out = [];
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('latin1');
    const data = buf.subarray(off + 8, off + 8 + len);
    const crc = buf.readUInt32BE(off + 8 + len);
    out.push({ type, len, crcOk: crc === crc32(Buffer.concat([buf.subarray(off + 4, off + 8), data])) });
    off += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

/** 指定区域（按宽高比例划分）与基线图的平均像素差 */
async function regionDiff(a, b, x0Ratio, y0Ratio, x1Ratio = 1, y1Ratio = 1) {
  const A = await Jimp.read(a);
  const B = await Jimp.read(b);
  const w = Math.min(A.bitmap.width, B.bitmap.width);
  const h = Math.min(A.bitmap.height, B.bitmap.height);
  const x0 = Math.floor(w * x0Ratio);
  const y0 = Math.floor(h * y0Ratio);
  const x1 = Math.floor(w * x1Ratio);
  const y1 = Math.floor(h * y1Ratio);
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const ca = A.getPixelColor(x, y);
      const cb = B.getPixelColor(x, y);
      for (const shift of [24, 16, 8]) {
        sum += Math.abs(((ca >>> shift) & 255) - ((cb >>> shift) & 255));
        n += 1;
      }
    }
  }
  return n ? sum / n : 0;
}

/** 右下角区域与基线图的平均像素差（用来证明角标真的画上去了） */
function cornerDiff(a, b) {
  return regionDiff(a, b, 0.6, 0.8);
}


async function makeImage(color, w = 640, h = 480) {
  const img = new Jimp({ width: w, height: h, color });
  img.composite(new Jimp({ width: Math.round(w * 0.4), height: Math.round(h * 0.3), color: 0xffffff88 }), 20, 20);
  return img;
}

async function offline() {
  console.log('\n【离屏 · PNG】');
  const pngSrc = await (await makeImage(0x3b5bdbff)).getBuffer(JimpMime.png);
  const pngOut = await labelGeneratedImage(pngSrc, 'image/png', { capability: 'main_image', taskId: 'smoke-task' });
  const pngChunks = walkPngChunks(pngOut.buffer);
  const types = pngChunks.map((c) => c.type);
  const pngInfo = inspectAigcLabel(pngOut.buffer);
  const pngImg = await Jimp.read(pngOut.buffer);

  check('PNG 返回格式仍是 image/png', pngOut.format === 'image/png', pngOut.format);
  check('PNG 有 tEXt 软标记', types.includes('tEXt'), types.filter((t) => t === 'tEXt').length + ' 个');
  check('PNG 有 iTXt XMP', types.includes('iTXt'), types.includes('iTXt') ? 'ok' : '缺失');
  check('PNG 全部 chunk CRC 正确', pngChunks.every((c) => c.crcOk), `${pngChunks.length} chunks`);
  check('iTXt 插在 IEND 之前', types.lastIndexOf('iTXt') < types.lastIndexOf('IEND'));
  check('PNG 读到 XMP', pngInfo.hasXmp && pngInfo.hasDigitalSourceType, JSON.stringify(pngInfo));
  check('PNG 尺寸未变', pngImg.bitmap.width === 640 && pngImg.bitmap.height === 480, `${pngImg.bitmap.width}x${pngImg.bitmap.height}`);
  check('PNG meta 自述一致', pngOut.meta.labeled && pngOut.meta.metadata && pngOut.meta.visible && pngOut.meta.method === 'png-text+xmp', JSON.stringify(pngOut.meta));
  check('PNG 右下角像素被改动（显式角标）', (await cornerDiff(pngSrc, pngOut.buffer)) > 2, `平均差 ${(await cornerDiff(pngSrc, pngOut.buffer)).toFixed(1)}`);

  console.log('\n【离屏 · JPEG】');
  const jpgSrc = await (await makeImage(0x12b886ff)).getBuffer(JimpMime.jpeg, { quality: 92 });
  const jpgOut = await labelGeneratedImage(jpgSrc, 'image/jpeg', { capability: 'main_image', taskId: 'smoke-task' });
  const jpgInfo = inspectAigcLabel(jpgOut.buffer);
  const jpgImg = await Jimp.read(jpgOut.buffer);
  // APP1 段必须紧跟 SOI（或 APP0）之后：把 APP1 放在 SOS 之后解码器不会读
  const app1At = jpgOut.buffer.indexOf(Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'));
  check('JPEG 返回 image/jpeg', jpgOut.format === 'image/jpeg', jpgOut.format);
  check('JPEG 含 APP1 XMP 标记', jpgOut.buffer[0] === 0xff && jpgOut.buffer[1] === 0xd8 && app1At > 0, `偏移 ${app1At}`);
  check('JPEG XMP 位于文件头 4KB 内', app1At > 0 && app1At < 4096, `${app1At}B`);
  check('JPEG 读到 XMP + DigitalSourceType', jpgInfo.hasXmp && jpgInfo.hasDigitalSourceType, JSON.stringify(jpgInfo));
  check('JPEG 尺寸未变', jpgImg.bitmap.width === 640 && jpgImg.bitmap.height === 480, `${jpgImg.bitmap.width}x${jpgImg.bitmap.height}`);
  check('JPEG meta 自述一致', jpgOut.meta.labeled && jpgOut.meta.metadata && jpgOut.meta.method === 'jpeg-xmp', JSON.stringify(jpgOut.meta));
  check('JPEG 右下角像素被改动（显式角标）', (await cornerDiff(jpgSrc, jpgOut.buffer)) > 2);

  console.log('\n【离屏 · 可配置角标】');
  // 位置: 左上角应真的画到左上, 且右下角保持原样
  const topLeftOut = await labelGeneratedImage(pngSrc, 'image/png', {
    capability: 'main_image',
    taskId: 'smoke-task',
    visible: { spec: { position: 'top-left' }, badgePng: null },
  });
  const tlDiff = await regionDiff(pngSrc, topLeftOut.buffer, 0, 0, 0.3, 0.2);
  const brDiff = await regionDiff(pngSrc, topLeftOut.buffer, 0.6, 0.8);
  check('position=top-left 时左上角有角标', tlDiff > 2, `平均差 ${tlDiff.toFixed(1)}`);
  check('position=top-left 时右下角不被改动', brDiff < 0.5, `平均差 ${brDiff.toFixed(2)}`);

  // 整体不透明度: 20 应比默认 100 明显更淡
  const faintOut = await labelGeneratedImage(pngSrc, 'image/png', {
    capability: 'main_image',
    taskId: 'smoke-task',
    visible: { spec: { opacity: 20 }, badgePng: null },
  });
  const faintDiff = await cornerDiff(pngSrc, faintOut.buffer);
  const fullDiff = await cornerDiff(pngSrc, pngOut.buffer);
  check('opacity=20 比默认更淡', faintDiff > 0.5 && faintDiff < fullDiff, `${faintDiff.toFixed(1)} < ${fullDiff.toFixed(1)}`);

  // 自定义位图: 服务端只缩放/定位, 传什么就合成什么
  const customBadge = await new Jimp({ width: 16, height: 16, color: 0xff0000ff }).getBuffer(JimpMime.png);
  const customOut = await labelGeneratedImage(pngSrc, 'image/png', {
    capability: 'main_image',
    taskId: 'smoke-task',
    visible: { spec: { position: 'bottom-left' }, badgePng: customBadge },
  });
  check('自定义位图被合成（左下角像素改动）', (await regionDiff(pngSrc, customOut.buffer, 0, 0.8)) > 2);
  check('自定义位图仍走同一份元数据写入', inspectAigcLabel(customOut.buffer).hasDigitalSourceType);

  // 非法值收敛: 越界夹紧而不是抛错
  const clamped = sanitizeAigcLabelSpec({ fontSize: 999, opacity: 5, fontWeight: 650, text: 'x'.repeat(40) });
  check('越界字号夹紧到 120', clamped.fontSize === 120, String(clamped.fontSize));
  check('越界不透明度夹到下限 20', clamped.opacity === 20, String(clamped.opacity));
  check('字重按 100 取整', clamped.fontWeight === 700, String(clamped.fontWeight));
  check('长文案截断到 20 字', clamped.text.length === 20, String(clamped.text.length));
  check('非法位置回落默认', sanitizeAigcLabelSpec({ position: 'middle' }).position === AIGC_LABEL_DEFAULTS.position);

  // 关闭可见角标：像素不变，但隐式标识必须照写
  const offOut = await labelGeneratedImage(pngSrc, 'image/png', {
    capability: 'main_image',
    taskId: 'smoke-task',
    visible: { spec: { enabled: false }, badgePng: null },
  });
  check('enabled=false 时像素不被改动', (await cornerDiff(pngSrc, offOut.buffer)) < 0.5);
  check('enabled=false 仍写入隐式标识', offOut.meta.metadata === true && offOut.meta.visible === false, JSON.stringify(offOut.meta));
  check('enabled=false 的产出仍含 DigitalSourceType', inspectAigcLabel(offOut.buffer).hasDigitalSourceType);
  check('enabled=false 带说明 warning', Boolean(offOut.meta.warning), offOut.meta.warning || '缺失');
  check('缺省时 enabled 为 true', AIGC_LABEL_DEFAULTS.enabled === true);
  check('仅显式 false 才关闭', sanitizeAigcLabelSpec({ enabled: 'off' }).enabled === true);

  // specKey 只跟渲染字段走: 位置/缩放变了不需要重画位图
  const keyBase = aigcLabelSpecKey(AIGC_LABEL_DEFAULTS);
  check('specKey 稳定', aigcLabelSpecKey({ ...AIGC_LABEL_DEFAULTS }) === keyBase);
  check('改文案使 specKey 变化', aigcLabelSpecKey({ ...AIGC_LABEL_DEFAULTS, text: 'AI 生成内容' }) !== keyBase);
  check('改位置/缩放不使 specKey 变化', aigcLabelSpecKey({ ...AIGC_LABEL_DEFAULTS, position: 'top-left', scalePercent: 30 }) === keyBase);

  console.log('\n【离屏 · 边界】');
  const tiny = await (await makeImage(0x845ef7ff, 60, 40)).getBuffer(JimpMime.png);
  const tinyOut = await labelGeneratedImage(tiny, 'image/png');
  check('小图不因角标越界而崩', tinyOut.meta.visible === true);
  const nonImage = await labelGeneratedImage(Buffer.from('not an image'), 'text/plain');
  check('非图像如实回报 unsupported', nonImage.meta.method === 'unsupported' && nonImage.meta.labeled === false);
}

async function api() {
  loadEnvOnce();
  const { PrismaClient } = require('@prisma/client');
  const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
  const prisma = new PrismaClient({ adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }) });
  const { resolveUploadsDir } = require('../dist/config/env-files');
  const run = `${Date.now()}`;
  const email = `aigc-${run}@test.com`;
  const password = 'test123456';

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

  const labelCfg = await call('GET', '/aigc-label', null);
  check('公开角标参数可读（免登录）', Boolean(labelCfg.data?.text), JSON.stringify(labelCfg.data ?? null));
  check('公开角标带 enabled 开关', typeof labelCfg.data?.enabled === 'boolean', String(labelCfg.data?.enabled));
  check('公开角标不含位图', !JSON.stringify(labelCfg.data ?? {}).includes('png'), '无 png 字段');

  const reg = await call('POST', '/auth/register', null, { email, password, name: 'AIGC冒烟' });
  const token = reg.data?.accessToken;
  const userId = reg.data?.user?.id;
  if (!token || !userId) throw new Error(`注册失败: ${JSON.stringify(reg).slice(0, 200)}`);

  // 直接发一批积分：本脚本只验证标识链路，不想把订单/支付也拖进来
  await prisma.creditLot.create({ data: { userId, source: 'grant', totalCredits: 50, remainingCredits: 50 } });

  const project = await call('POST', '/projects', token, { name: `aigc-${run}` });
  const projectId = project.data?.id;
  if (!projectId) throw new Error(`建项目失败: ${JSON.stringify(project).slice(0, 200)}`);

  const srcImg = await makeImage(0x2f9e44ff, 720, 720);
  const fd = new FormData();
  fd.append('file', new Blob([await srcImg.getBuffer(JimpMime.png)], { type: 'image/png' }), 'input.png');
  fd.append('projectId', projectId);
  const upRes = await fetch(`${BASE}/assets/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  const up = await upRes.json();
  const sourceAssetId = up?.data?.id;
  if (!sourceAssetId) throw new Error(`上传失败: ${JSON.stringify(up).slice(0, 200)}`);

  const created = await call('POST', '/generate', token, {
    projectId,
    capability: 'main_image',
    inputAssetIds: [sourceAssetId],
    params: { platform: 'taobao', size: '1k', ratio: '1:1' },
  });
  const taskId = created.data?.taskId;
  check('创建生成任务', Boolean(taskId), `status=${created.httpStatus} ${created.message || ''}`);

  let task = null;
  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const r = await call('GET', `/tasks/${taskId}`, token);
    task = r.data;
    if (task && (task.status === 'succeeded' || task.status === 'failed')) break;
  }
  check('任务终态为成功', task?.status === 'succeeded', `status=${task?.status} err=${task?.errorCode ?? ''}`);

  const asset = task?.outputAsset;
  check('任务详情带 aigc 标识结果', Boolean(asset?.aigc?.labeled), JSON.stringify(asset?.aigc ?? null));
  check('标识结果声明元数据已写', asset?.aigc?.metadata === true);
  check('未开启签名时 signedUrl 为 null', asset?.signedUrl === null || asset?.signedUrl === undefined, String(asset?.signedUrl));
  check('sourceUrl 仍为干净路径（网关拉图依赖它）', typeof asset?.sourceUrl === 'string' && !asset.sourceUrl.includes('sig='), asset?.sourceUrl);

  const dbAsset = asset ? await prisma.asset.findUnique({ where: { id: asset.id } }) : null;
  check('库中 aigcMeta 已落盘', Boolean(dbAsset?.aigcMeta && dbAsset.aigcMeta !== '{}'), dbAsset?.aigcMeta ?? '');
  check('库中 aigcLabeledAt 有值', Boolean(dbAsset?.aigcLabeledAt));

  if (dbAsset?.sourceUrl) {
    const key = dbAsset.sourceUrl.replace(/^\/uploads\//, '');
    const abs = path.join(resolveUploadsDir(), key);
    const bytes = fs.existsSync(abs) ? fs.readFileSync(abs) : null;
    check('磁盘产出文件存在', Boolean(bytes), abs);
    if (bytes) {
      const info = inspectAigcLabel(bytes);
      check('磁盘文件含 XMP + DigitalSourceType', info.hasXmp && info.hasDigitalSourceType, JSON.stringify(info));
      const img = await Jimp.read(bytes);
      check('产出仍可解码且尺寸有效', img.bitmap.width > 0 && img.bitmap.height > 0, `${img.bitmap.width}x${img.bitmap.height}`);
    }
  }

  // 清理：只删本脚本造的数据
  await prisma.creditLedger.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.creditLot.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.generationTask.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.asset.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.project.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();
}

(async () => {
  console.log(`AIGC 标识冒烟 ${OFFLINE ? '(仅离屏)' : `API=${BASE}`}`);
  await offline();
  if (!OFFLINE) {
    console.log('\n【端到端 · 生成链路】');
    await api();
  }
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('冒烟异常终止:', e);
  process.exit(1);
});
