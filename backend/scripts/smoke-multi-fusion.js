/**
 * 多图融合冒烟: 主体图 + 多张搭配图 → 场景版式合成 (contact sheet)。
 * 验证: 变体张数联络图格数 / 场景版式差异 (表面附着=四角, 空间摆放=底部排布) /
 *       主体与搭配图真实参与像素 / 2K 尺寸 / 参数收敛。
 * 用法: node scripts/smoke-multi-fusion.js
 */
const fs = require('fs');
const path = require('path');
const { Jimp, JimpMime, rgbaToInt } = require('jimp');
const { LocalImageProvider } = require('../dist/providers/local-image.provider');
const registry = require('../dist/capabilities/capability.registry');

const OUT = '/tmp/fusion-smoke';
fs.mkdirSync(OUT, { recursive: true });

function px(img, x, y) {
  const i = (Math.round(y) * img.bitmap.width + Math.round(x)) * 4;
  const d = img.bitmap.data;
  return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
}

function dist(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

(async () => {
  const provider = new LocalImageProvider();
  let fail = 0;
  const check = (ok, label, extra = '') => {
    console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
    if (!ok) fail++;
  };

  // 主体图: 灰底 + 居中橙色圆盘 (模拟商品)
  const subject = new Jimp({ width: 800, height: 800, color: 0xd1d5dbff });
  for (let y = 250; y < 550; y++) {
    for (let x = 250; x < 550; x++) {
      const dx = x - 400;
      const dy = y - 400;
      if (dx * dx + dy * dy <= 150 * 150) subject.setPixelColor(0xf97316ff, x, y);
    }
  }
  const subjPath = `${OUT}/subject.png`;
  fs.writeFileSync(subjPath, await subject.getBuffer(JimpMime.png));

  // 搭配图: 蓝/绿/红/紫 四张纯色方图
  const accentColors = [0x3b82f6ff, 0x22c55eff, 0xef4444ff, 0xa855f7ff];
  const accentPaths = [];
  for (let i = 0; i < accentColors.length; i++) {
    const acc = new Jimp({ width: 400, height: 400, color: accentColors[i] });
    const p = `${OUT}/accent${i}.png`;
    fs.writeFileSync(p, await acc.getBuffer(JimpMime.png));
    accentPaths.push(p);
  }

  // ── 1. 默认 (print_pattern 表面附着, 4 变体) ──
  const r1 = await provider.generate('multi_fusion', [subjPath, ...accentPaths], registry.defaultParamsFor('multi_fusion'));
  const p1 = `${OUT}/fusion-default.jpg`;
  fs.writeFileSync(p1, r1.buffer);
  const img1 = await Jimp.read(p1);
  check(img1.bitmap.width === 1024 && img1.bitmap.height === 1024, '默认 1K 输出 1024x1024', `${img1.bitmap.width}x${img1.bitmap.height}`);

  // 联络图 2x2: 四个格中心都应有主体橙色 (主体真实参与)
  const cellW = 1024 / 2;
  const cellH = 1024 / 2;
  let orangeCells = 0;
  for (let v = 0; v < 4; v++) {
    const cx = (v % 2) * cellW + cellW / 2;
    const cy = Math.floor(v / 2) * cellH + cellH / 2;
    const c = px(img1, cx, cy);
    if (dist(c, { r: 249, g: 116, b: 22 }) < 90) orangeCells++;
  }
  check(orangeCells === 4, '4 个变体格中心均为主体橙色', `${orangeCells}/4`);

  // 表面附着: 搭配图在四角 → 左上格内左上角附近应出现某张搭配图颜色
  const corner = px(img1, cellW * 0.12, cellH * 0.12);
  const isAccent = accentColors.some((col) => {
    const r = (col >>> 24) & 255;
    const g = (col >>> 16) & 255;
    const b = (col >>> 8) & 255;
    return dist(corner, { r, g, b }) < 90;
  });
  check(isAccent, '表面附着版式: 搭配图位于格内四角', JSON.stringify(corner));

  // ── 2. 空间摆放场景 (table_display): 搭配图改到格内底部横排 ──
  const r2 = await provider.generate('multi_fusion', [subjPath, ...accentPaths], { ...registry.defaultParamsFor('multi_fusion'), scene: 'table_display' });
  const p2 = `${OUT}/fusion-space.jpg`;
  fs.writeFileSync(p2, r2.buffer);
  const img2 = await Jimp.read(p2);
  const corner2 = px(img2, cellW * 0.12, cellH * 0.12);
  const cornerStillAccent = accentColors.some((col) => {
    const r = (col >>> 24) & 255;
    const g = (col >>> 16) & 255;
    const b = (col >>> 8) & 255;
    return dist(corner2, { r, g, b }) < 90;
  });
  // 底部横排带 (格内 y≈0.88 处) 的 4 个搭配图中心: 至少 3 个命中搭配图色
  let bottomHits = 0;
  for (const ax of [93, 203, 313, 423]) {
    const c = px(img2, ax, cellH * 0.88);
    if (
      accentColors.some((col) => {
        const r = (col >>> 24) & 255;
        const g = (col >>> 16) & 255;
        const b = (col >>> 8) & 255;
        return dist(c, { r, g, b }) < 90;
      })
    ) {
      bottomHits++;
    }
  }
  check(!cornerStillAccent && bottomHits >= 3, '空间摆放版式: 四角无搭配图, 底部横排有', `corner=${JSON.stringify(corner2)} bottomHits=${bottomHits}/4`);

  // ── 3. 变体张数 1: 单格铺满 ──
  const r3 = await provider.generate('multi_fusion', [subjPath, accentPaths[0]], { ...registry.defaultParamsFor('multi_fusion'), variantCount: '1' });
  const p3 = `${OUT}/fusion-1.jpg`;
  fs.writeFileSync(p3, r3.buffer);
  const img3 = await Jimp.read(p3);
  const c3 = px(img3, 512, 512);
  check(img3.bitmap.width === 1024 && dist(c3, { r: 249, g: 116, b: 22 }) < 90, '1 变体: 单格铺满且主体居中', JSON.stringify(c3));

  // ── 4. 2K + 16:9 ──
  const r4 = await provider.generate('multi_fusion', [subjPath, ...accentPaths], { ...registry.defaultParamsFor('multi_fusion'), size: '2k', ratio: '16:9' });
  const p4 = `${OUT}/fusion-2k.jpg`;
  fs.writeFileSync(p4, r4.buffer);
  const img4 = await Jimp.read(p4);
  check(img4.bitmap.width === 2048 && img4.bitmap.height === 1152, '2K + 16:9 → 2048x1152', `${img4.bitmap.width}x${img4.bitmap.height}`);

  // ── 5. 输入不足 2 张应拒绝 ──
  let rejected = false;
  try {
    await provider.generate('multi_fusion', [subjPath], registry.defaultParamsFor('multi_fusion'));
  } catch {
    rejected = true;
  }
  check(rejected, '仅主体图(缺搭配图)按预期拒绝');

  console.log(`\n多图融合冒烟: ${fail === 0 ? 'ALL PASS' : fail + ' 项失败'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SMOKE FAIL:', e);
  process.exit(1);
});
