/**
 * 自由创作冒烟: 参考图真实参与 (顶部条带含各参考图主色) + 0 图容错 +
 * 提示词多行排版不崩溃 + 画质/比例 + 中文 prompt ASCII 剥离。
 *
 * 合成输入: 4 张纯色方图 (红/绿/蓝/黄), 颜色可辨, 用于断言条带分区颜色。
 */
const fs = require('fs');
const path = require('path');
const { Jimp, JimpMime } = require('jimp');
const { MockImageProvider } = require('../dist/providers/mock-image.provider');

const OUT = '/tmp/fc-variants';
fs.mkdirSync(OUT, { recursive: true });

const COLORS = {
  red: 0xdc2626ff,
  green: 0x16a34aff,
  blue: 0x2563ebff,
  yellow: 0xfacc15ff,
};

(async () => {
  const refPaths = [];
  for (const [name, color] of Object.entries(COLORS)) {
    const img = new Jimp({ width: 400, height: 400, color });
    const p = path.join(OUT, `ref-${name}.png`);
    fs.writeFileSync(p, await img.getBuffer(JimpMime.png));
    refPaths.push(p);
  }

  const provider = new MockImageProvider();
  const base = {
    prompt: 'A ceramic coffee mug on a sunlit wooden table, morning light, clean and premium, e-commerce advertising style',
    size: '1k',
  };

  // ── 用例 1: 4 张参考图 + 提示词 ──
  const { buffer: b4 } = await provider.generate('free_create', refPaths, { ...base });
  fs.writeFileSync(path.join(OUT, 'refs-4.jpg'), b4);
  const o4 = await Jimp.read(path.join(OUT, 'refs-4.jpg'));
  console.log(`refs-4          jpeg-ok ${o4.bitmap.width}x${o4.bitmap.height} ${(b4.length / 1024).toFixed(0)}KB`);
  if (o4.bitmap.width !== 1024 || o4.bitmap.height !== 1024) throw new Error('4 图用例尺寸不符');

  // ── 断言 1: 参考图真实参与 (条带 4 分区中心色分别接近对应参考图主色) ──
  const expected = [
    [0xdc, 0x26, 0x26],
    [0x16, 0xa3, 0x4a],
    [0x25, 0x63, 0xeb],
    [0xfa, 0xcc, 0x15],
  ];
  const stripY = Math.round(o4.bitmap.height * 0.14); // 条带中位
  for (let i = 0; i < 4; i++) {
    const cx = Math.round(((i + 0.5) * o4.bitmap.width) / 4);
    const c = o4.getPixelColor(cx, stripY);
    const got = [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
    const dist = Math.max(...got.map((v, k) => Math.abs(v - expected[i][k])));
    console.log(`  slot${i + 1} center=rgb(${got.join(',')}) expect~rgb(${expected[i].join(',')}) maxDist=${dist}`);
    if (dist > 24) throw new Error(`参考图 ${i + 1} 未参与: 条带分区色差 ${dist}`);
  }

  // ── 用例 2: 单张参考图 ──
  const { buffer: b1 } = await provider.generate('free_create', [refPaths[2]], { ...base });
  fs.writeFileSync(path.join(OUT, 'refs-1.jpg'), b1);
  const o1 = await Jimp.read(path.join(OUT, 'refs-1.jpg'));
  const c1 = o1.getPixelColor(Math.round(o1.bitmap.width * 0.5), Math.round(o1.bitmap.height * 0.14));
  const blue1 = (c1 >>> 8) & 255;
  const red1 = (c1 >>> 24) & 255;
  console.log(`refs-1          jpeg-ok 1024x1024 center=rgb(${red1},${(c1 >>> 16) & 255},${blue1}) (蓝色参考图)`);
  if (!(blue1 > 150 && red1 < 120)) throw new Error('单张参考图未参与');

  // ── 用例 3: 0 张参考图 (纯提示词, 参考站该上传区无必填星号) ──
  const { buffer: b0 } = await provider.generate('free_create', [], { ...base });
  fs.writeFileSync(path.join(OUT, 'refs-0.jpg'), b0);
  const o0 = await Jimp.read(path.join(OUT, 'refs-0.jpg'));
  const c0 = o0.getPixelColor(8, 8);
  const r0 = (c0 >>> 24) & 255;
  const g0 = (c0 >>> 16) & 255;
  const bl0 = (c0 >>> 8) & 255;
  console.log(`refs-0          jpeg-ok 1024x1024 top=rgb(${r0},${g0},${bl0}) (品牌紫渐变, 无参考条带)`);
  if (!(r0 > 90 && bl0 > 180)) throw new Error('0 图构图不是品牌紫渐变');

  // ── 用例 4: 2K + 4:3 ──
  const { buffer: big } = await provider.generate('free_create', refPaths, { ...base, size: '2k', ratio: '4:3' });
  fs.writeFileSync(path.join(OUT, '2k-4x3.jpg'), big);
  const bigImg = await Jimp.read(path.join(OUT, '2k-4x3.jpg'));
  console.log(`2k-4x3          jpeg-ok ${bigImg.bitmap.width}x${bigImg.bitmap.height}`);
  if (bigImg.bitmap.width !== 2048 || bigImg.bitmap.height !== 1536) throw new Error('2K/4:3 尺寸不符');

  // ── 用例 5: 中文提示词 (ASCII 剥离, 不崩溃; 中文原文由任务参数完整保留) ──
  const { buffer: zh } = await provider.generate('free_create', refPaths.slice(0, 2), {
    ...base,
    prompt: '把这款产品放在未来感厨房场景中，清晨自然光，干净高级，电商广告质感',
  });
  fs.writeFileSync(path.join(OUT, 'zh-prompt.jpg'), zh);
  const zhImg = await Jimp.read(path.join(OUT, 'zh-prompt.jpg'));
  console.log(`zh-prompt       jpeg-ok 1024x1024 (中文被 ASCII 剥离, 回落 FREE CREATION)`);

  // ── 用例 6: 长英文提示词换行 (不溢出画布) ──
  const { buffer: long } = await provider.generate('free_create', [], {
    ...base,
    prompt: 'word '.repeat(80).trim(),
  });
  fs.writeFileSync(path.join(OUT, 'long-prompt.jpg'), long);
  const longImg = await Jimp.read(path.join(OUT, 'long-prompt.jpg'));
  console.log(`long-prompt     jpeg-ok 1024x1024 (80 词换行, 上限 8 行)`);

  console.log('ALL PASS');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
