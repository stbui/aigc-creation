/**
 * 爆款复刻冒烟: 参考图真实参与 + 两档复刻程度可见差异 + 商品参与 + 尺寸/容错。
 *
 * 合成输入:
 *   product   = 浅灰底 + 居中橙盘 (可验证"商品是主体")
 *   reference = 8x8 棋盘(深蓝/琥珀)放大 —— 高频结构, 可验证
 *               "高度复刻保留参考结构" vs "参考风格重建场景(双线性平滑化)"
 */
const fs = require('fs');
const path = require('path');
const { Jimp, JimpMime } = require('jimp');
const { MockImageProvider } = require('../dist/providers/mock-image.provider');

const OUT = '/tmp/vc-variants';
fs.mkdirSync(OUT, { recursive: true });

const REF_A = 0x1e3a8aff; // 深蓝
const REF_B = 0xfbbf24ff; // 琥珀
const PRODUCT = 0xf97316ff; // 橙 (商品)

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** 采样一条水平带的亮度标准差 (棋盘高频结构 → 高方差; 平滑重建 → 低方差) */
function stripStddev(img, yFrac, xFromFrac, xToFrac) {
  const y = Math.round(img.bitmap.height * yFrac);
  const x0 = Math.round(img.bitmap.width * xFromFrac);
  const x1 = Math.round(img.bitmap.width * xToFrac);
  const vals = [];
  for (let x = x0; x < x1; x += 8) {
    const c = img.getPixelColor(x, y);
    vals.push(luma((c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255));
  }
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  return Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
}

(async () => {
  // 商品图: 浅灰底 + 居中橙盘 (600x600)
  const product = new Jimp({ width: 600, height: 600, color: 0xe5e7ebff });
  for (let y = 150; y < 450; y++) {
    for (let x = 150; x < 450; x++) {
      const dx = x - 300;
      const dy = y - 300;
      if (dx * dx + dy * dy <= 150 * 150) product.setPixelColor(PRODUCT, x, y);
    }
  }
  const productPath = path.join(OUT, 'product.png');
  fs.writeFileSync(productPath, await product.getBuffer(JimpMime.png));

  // 参考图: 8x8 棋盘放大到 600x600 (最近邻, 保留硬边)
  const ref = new Jimp({ width: 600, height: 600, color: 0x000000ff });
  for (let y = 0; y < 600; y++) {
    for (let x = 0; x < 600; x++) {
      const cx = Math.floor((x / 600) * 8);
      const cy = Math.floor((y / 600) * 8);
      ref.setPixelColor((cx + cy) % 2 === 0 ? REF_A : REF_B, x, y);
    }
  }
  const refPath = path.join(OUT, 'reference.png');
  fs.writeFileSync(refPath, await ref.getBuffer(JimpMime.png));

  const provider = new MockImageProvider();
  const base = {
    productName: 'Summer Fan',
    brand: 'ACME',
    platform: 'taobao',
    language: 'zh-CN',
    requirement: 'keep English copy only',
    size: '1k',
  };

  const results = {};
  for (const degree of ['high_replica', 'reference_style']) {
    const { buffer } = await provider.generate('hot_remake', [productPath, refPath], { ...base, degree });
    const p = path.join(OUT, `${degree}.jpg`);
    fs.writeFileSync(p, buffer);
    const out = await Jimp.read(p);
    const magic = buffer.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'jpeg-ok' : 'BAD';
    results[degree] = { out, buffer, p };
    console.log(
      `${degree.padEnd(16)} ${magic} ${out.bitmap.width}x${out.bitmap.height} ${(buffer.length / 1024).toFixed(0)}KB`,
    );
  }

  // ── 断言 1: 参考图真实参与 (高度复刻以参考图为底, 顶部带保留棋盘高频结构) ──
  // 采样带选在行中心 (棋盘被双线性平滑后对比度归零的位置), 并绕开左上/右上的标注浮层
  const hiStd = stripStddev(results.high_replica.out, 1 / 16, 0.28, 0.7);
  const refStd = stripStddev(results.reference_style.out, 1 / 16, 0.28, 0.7);
  console.log(`strip-stddev   high_replica=${hiStd.toFixed(1)}  reference_style=${refStd.toFixed(1)}`);
  if (!(hiStd > 8)) throw new Error('参考图未参与: 高度复刻顶部带无高频结构');

  // ── 断言 2: 两档程度可见差异 (输出不同 + 参考风格档场景被重建平滑化) ──
  if (results.high_replica.buffer.equals(results.reference_style.buffer)) {
    throw new Error('两档复刻程度输出完全相同');
  }
  if (!(hiStd > refStd * 2)) {
    throw new Error(`参考风格档未见场景重建平滑化: ${hiStd.toFixed(1)} vs ${refStd.toFixed(1)}`);
  }

  // ── 断言 3: 商品真实参与 (两档中心都应为商品橙) ──
  for (const degree of ['high_replica', 'reference_style']) {
    const img = results[degree].out;
    const c = img.getPixelColor(Math.round(img.bitmap.width / 2), Math.round(img.bitmap.height / 2));
    const r = (c >>> 24) & 255;
    const g = (c >>> 16) & 255;
    const b = (c >>> 8) & 255;
    const isOrange = r > 180 && g > 60 && g < 190 && b < 110;
    console.log(`${degree.padEnd(16)} center=rgb(${r},${g},${b}) orange=${isOrange}`);
    if (!isOrange) throw new Error(`${degree} 中心不是商品色`);
  }

  // ── 断言 4: 画质/比例 (2K + 16:9) ──
  const { buffer: big } = await provider.generate('hot_remake', [productPath, refPath], {
    ...base,
    size: '2k',
    ratio: '16:9',
  });
  fs.writeFileSync(path.join(OUT, '2k-16x9.jpg'), big);
  const bigImg = await Jimp.read(path.join(OUT, '2k-16x9.jpg'));
  console.log(`2k-16x9        jpeg-ok ${bigImg.bitmap.width}x${bigImg.bitmap.height}`);
  if (bigImg.bitmap.width !== 2048 || bigImg.bitmap.height !== 1152) throw new Error('2K/16:9 尺寸不符');

  // ── 断言 5: 容错 (仅一张图时参考图回落商品图; 中文复刻要求被 ASCII 剥离不崩溃) ──
  const { buffer: solo } = await provider.generate('hot_remake', [productPath], {
    ...base,
    requirement: '文案统一用英文、模特保持完全不变、参考图不变只替换商品',
  });
  fs.writeFileSync(path.join(OUT, 'solo-fallback.jpg'), solo);
  const soloImg = await Jimp.read(path.join(OUT, 'solo-fallback.jpg'));
  console.log(`solo-fallback  jpeg-ok ${soloImg.bitmap.width}x${soloImg.bitmap.height}`);

  console.log('ALL PASS');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
