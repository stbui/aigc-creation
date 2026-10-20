/**
 * 商品SKU图冒烟: 模板图 + 变体区域 + SKU 颜色/名称 → 参数化批量渲染。
 * 验证: 区域填充色真实生效 / 位置差异 (center vs top vs bottom) /
 *       参考站色板 (白/浅蓝/蓝/红/深红) / 比例与画质 / 参数收敛。
 * 用法: node scripts/smoke-sku.js
 */
const fs = require('fs');
const { Jimp, JimpMime } = require('jimp');
const { MockImageProvider } = require('../dist/providers/mock-image.provider');
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

(async () => {
  const provider = new MockImageProvider();
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

  // ── 1. center 区域 + 红色 SKU ──
  const base = registry.defaultParamsFor('sku_image');
  const r1 = await provider.generate('sku_image', [tplPath], { ...base, region: 'center', skuColor: '#FF0B22', skuName: 'CLASSIC RED / M' });
  const p1 = `${OUT}/sku-red.jpg`;
  fs.writeFileSync(p1, r1.buffer);
  const img1 = await Jimp.read(p1);
  const center = px(img1, 512, 512);
  check(img1.bitmap.width === 1024 && img1.bitmap.height === 1024, '默认 1K 输出 1024x1024', `${img1.bitmap.width}x${img1.bitmap.height}`);
  // 区域填充 alpha=235 叠加在白底上: 期望接近参考红 (允许混合偏差)
  check(dist(center, REF.red) < 60, 'center 区域填充为参考红色', JSON.stringify(center));

  // ── 2. 色板遍历: 每个颜色都真实改变区域像素 ──
  const swatches = [
    ['#FFFFFF', REF.white],
    ['#82CEF3', REF.lightBlue],
    ['#3988E9', REF.blue],
    ['#FF0B22', REF.red],
    ['#A8001B', REF.darkRed],
  ];
  let colorOk = 0;
  for (const [hex, ref] of swatches) {
    const r = await provider.generate('sku_image', [tplPath], { ...base, region: 'center', skuColor: hex });
    const p = `${OUT}/sku-${hex.slice(1)}.jpg`;
    fs.writeFileSync(p, r.buffer);
    const c = px(await Jimp.read(p), 512, 512);
    if (dist(c, ref) < 60) colorOk++;
  }
  check(colorOk === swatches.length, '参考站 5 色板全部真实填充', `${colorOk}/${swatches.length}`);

  // ── 3. 位置差异: top / bottom / center 填充区不同 ──
  const gen = async (region) => {
    const r = await provider.generate('sku_image', [tplPath], { ...base, region });
    const p = `${OUT}/sku-pos-${region}.jpg`;
    fs.writeFileSync(p, r.buffer);
    return Jimp.read(p);
  };
  const imgTop = await gen('top');
  const imgBottom = await gen('bottom');
  const topZone = px(imgTop, 512, 1024 * 0.23); // top 区域中心 (fy 0.08 + fh 0.3/2)
  const bottomZone = px(imgBottom, 512, 1024 * 0.77); // bottom 区域中心 (fy 0.62 + fh 0.3/2)
  const topCenterUntouched = px(imgTop, 512, 512); // top 模式下 center 应保持模板深蓝
  check(dist(topZone, REF.white) < 70, 'top 位置: 填充出现在画面上方', JSON.stringify(topZone));
  check(dist(bottomZone, REF.white) < 70, 'bottom 位置: 填充出现在画面下方', JSON.stringify(bottomZone));
  check(dist(topCenterUntouched, { r: 30, g: 58, b: 138 }) < 70, 'top 位置: 中心区域保持模板原色', JSON.stringify(topCenterUntouched));

  // ── 4. 16:9 比例 ──
  const r4 = await provider.generate('sku_image', [tplPath], { ...base, ratio: '16:9' });
  const p4 = `${OUT}/sku-169.jpg`;
  fs.writeFileSync(p4, r4.buffer);
  const img4 = await Jimp.read(p4);
  check(img4.bitmap.width === 1024 && img4.bitmap.height === 576, '16:9 → 1024x576', `${img4.bitmap.width}x${img4.bitmap.height}`);

  // ── 5. 参数收敛: 非法区域回落 center, 非法画质回落 1k ──
  const bad = registry.sanitizeParams('sku_image', { region: 'hacked', size: 99999, skuColor: 'nope' });
  check(bad.region === 'center' && bad.size === '1k' && bad.skuColor === '#FFFFFF', '参数收敛', JSON.stringify(bad));

  console.log(`\nSKU 冒烟: ${fail === 0 ? 'ALL PASS' : fail + ' 项失败'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SMOKE FAIL:', e);
  process.exit(1);
});
