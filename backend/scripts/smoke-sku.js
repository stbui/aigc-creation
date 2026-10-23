/**
 * 商品SKU图冒烟: 模板图 + 变体区域 + SKU 颜色/名称 → 参数化渲染。
 *
 * 断言的是**当前实现**（2026-10-21 升级后的版式）：
 *   · 规格区色卡真实取 SKU 颜色，5 色板逐个生效；
 *   · 变体条按基色 / 提亮 / 压暗三档真实改变像素；
 *   · region 的五个位置**都能区分**（水平与垂直分别验证）——
 *     此前垂直位置被写死，选「画面上方」与「画面下方」产出完全一样；
 *   · 比例与画质、非法参数收敛。
 *
 * 旧版断言的是「区域被 SKU 色实底填充」，那套版式已被模板版式取代，
 * 故此脚本随实现一并更新；断言仍打在用户可见的像素结果上，不看内部变量。
 */
const fs = require('fs');
const { Jimp, JimpMime } = require('jimp');
const { LocalImageProvider } = require('../dist/providers/local-image.provider');
const registry = require('../dist/capabilities/capability.registry');

const OUT = '/tmp/sku-smoke';
fs.mkdirSync(OUT, { recursive: true });

function px(img, x, y) {
  const i = (Math.round(y) * img.bitmap.width + Math.round(x)) * 4;
  const d = img.bitmap.data;
  return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
}

function dist(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

const REF = {
  white: { r: 255, g: 255, b: 255 },
  lightBlue: { r: 130, g: 206, b: 243 },
  blue: { r: 57, g: 136, b: 233 },
  red: { r: 255, g: 11, b: 34 },
  darkRed: { r: 168, g: 0, b: 27 },
};

/** 找出内容带内接近某颜色的像素包围盒; 找不到返回 null */
function bbox(img, target, tol, y0, y1) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
  for (let y = Math.max(0, y0); y < Math.min(img.bitmap.height, y1); y += 2) {
    for (let x = 0; x < img.bitmap.width; x += 2) {
      if (dist(px(img, x, y), target) <= tol) {
        n++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!n) return null;
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, n };
}

(async () => {
  const provider = new LocalImageProvider();
  let fail = 0;
  const check = (ok, label, extra = '') => {
    console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
    if (!ok) fail++;
  };

  // 模板图: 白底 + 中央深蓝方块 (模拟"结构最完整的成品图")
  const tpl = new Jimp({ width: 900, height: 900, color: 0xffffffff });
  tpl.composite(new Jimp({ width: 360, height: 360, color: 0x1e3a8aff }), 270, 270);
  const tplPath = `${OUT}/template.png`;
  fs.writeFileSync(tplPath, await tpl.getBuffer(JimpMime.png));

  // 版式几何（与实现同源的公开常量）: 内容带之外是标题条与规格区
  const W = 1024;
  const H = 1024;
  const pad = Math.round(W * 0.05);
  const headH = Math.round(H * 0.09);
  const footH = Math.round(H * 0.34);
  const contentY = headH + pad;
  const contentY1 = H - footH;
  const chip = Math.round(W * 0.07);
  const chipX = pad;
  const chipY = H - footH + Math.round(footH * 0.14);
  const chipCenter = () => [chipX + chip / 2, chipY + chip / 2];
  const sw = Math.round(W * 0.035);
  const swGap = Math.round(W * 0.012);
  const swatchCenter = (i) => [W - pad - (3 - i) * (sw + swGap) + sw / 2, chipY + sw / 2];
  const TEMPLATE_BLUE = { r: 30, g: 58, b: 138 };

  const base = registry.defaultParamsFor('sku_image');
  const gen = async (params, name) => {
    const r = await provider.generate('sku_image', [tplPath], { ...base, ...params });
    const p = `${OUT}/${name}.jpg`;
    fs.writeFileSync(p, r.buffer);
    return Jimp.read(p);
  };

  // ── 1. center 区域 + 红色 SKU: 尺寸与色卡 ──
  const img1 = await gen({ region: 'center', skuColor: '#FF0B22', skuName: 'CLASSIC RED / M' }, 'sku-red');
  check(img1.bitmap.width === 1024 && img1.bitmap.height === 1024, '默认 1K 输出 1024x1024',
    `${img1.bitmap.width}x${img1.bitmap.height}`);

  // ── 2. 色板遍历: 色卡像素逐个等于所选 SKU 色 ──
  const swatches = [
    ['#FFFFFF', REF.white],
    ['#82CEF3', REF.lightBlue],
    ['#3988E9', REF.blue],
    ['#FF0B22', REF.red],
    ['#A8001B', REF.darkRed],
  ];
  const [ccx, ccy] = chipCenter();
  let colorOk = 0;
  for (const [hex, ref] of swatches) {
    const img = await gen({ region: 'center', skuColor: hex }, `sku-${hex.slice(1)}`);
    const c = px(img, ccx, ccy);
    if (dist(c, ref) < 45) colorOk++;
    else console.log(`   ! ${hex} → ${JSON.stringify(c)}`);
  }
  check(colorOk === swatches.length, '色卡 5 色板逐个生效', `${colorOk}/${swatches.length}`);

  // ── 3. 变体条: 基色 / 提亮 / 压暗 三档 ──
  const imgR = await gen({ region: 'center', skuColor: '#FF0B22' }, 'sku-variants');
  const v0 = px(imgR, ...swatchCenter(0));
  const v1 = px(imgR, ...swatchCenter(1));
  const v2 = px(imgR, ...swatchCenter(2));
  const lum = (c) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  check(lum(v1) > lum(v0) && lum(v0) > lum(v2), '变体条三档明度: 基色 / 提亮 / 压暗',
    `${Math.round(lum(v1))} > ${Math.round(lum(v0))} > ${Math.round(lum(v2))}`);
  check(dist(v0, REF.red) < 45, '变体条第 1 档为 SKU 基色', JSON.stringify(v0));

  // ── 4. region 位置真实生效: 垂直 (top / center / bottom) ──
  const vertical = {};
  for (const region of ['top', 'center', 'bottom']) {
    const img = await gen({ region, skuColor: '#FFFFFF' }, `sku-pos-${region}`);
    vertical[region] = bbox(img, TEMPLATE_BLUE, 50, contentY, contentY1);
  }
  const vy = (r) => (vertical[r] ? vertical[r].cy : NaN);
  check(
    vy('top') < vy('center') && vy('center') < vy('bottom'),
    '垂直位置: 上方 / 居中 / 下方依次下移',
    `top=${Math.round(vy('top'))} center=${Math.round(vy('center'))} bottom=${Math.round(vy('bottom'))}`,
  );

  // ── 5. region 位置真实生效: 水平 (left / center / right) ──
  const horizontal = {};
  for (const region of ['left', 'center', 'right']) {
    const img = await gen({ region, skuColor: '#FFFFFF' }, `sku-pos-${region}`);
    horizontal[region] = bbox(img, TEMPLATE_BLUE, 50, contentY, contentY1);
  }
  const vx = (r) => (horizontal[r] ? horizontal[r].cx : NaN);
  check(
    vx('left') < vx('center') && vx('center') < vx('right'),
    '水平位置: 左侧 / 居中 / 右侧依次右移',
    `left=${Math.round(vx('left'))} center=${Math.round(vx('center'))} right=${Math.round(vx('right'))}`,
  );

  // ── 6. 16:9 比例 ──
  const img4 = await gen({ ratio: '16:9' }, 'sku-169');
  check(img4.bitmap.width === 1024 && img4.bitmap.height === 576, '16:9 → 1024x576',
    `${img4.bitmap.width}x${img4.bitmap.height}`);

  // ── 7. 参数收敛: 非法区域回落 center, 非法画质回落 1k ──
  const bad = registry.sanitizeParams('sku_image', { region: 'hacked', size: 99999, skuColor: 'nope' });
  check(bad.region === 'center' && bad.size === '1k' && bad.skuColor === '#FFFFFF', '参数收敛', JSON.stringify(bad));

  console.log(`\nSKU 冒烟: ${fail === 0 ? 'ALL PASS' : fail + ' 项失败'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SMOKE FAIL:', e);
  process.exit(1);
});
