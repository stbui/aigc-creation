/** 主图四变体冒烟: 直接调 provider, 校验产出 magic bytes / 尺寸 / 耗时 */
const fs = require('fs');
const path = require('path');
const { Jimp, JimpMime } = require('jimp');
const { LocalImageProvider } = require('../dist/providers/local-image.provider');

const OUT = '/tmp/pk-variants';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const img = new Jimp({ width: 900, height: 900, color: 0xf1f5f9ff });
  img.composite(new Jimp({ width: 520, height: 70, color: 0x00000018 }), 190, 700);
  img.composite(new Jimp({ width: 340, height: 560, color: 0x2563ebff }), 280, 160);
  img.composite(new Jimp({ width: 170, height: 70, color: 0x1e3a8aff }), 365, 100);
  img.composite(new Jimp({ width: 300, height: 220, color: 0xffffffff }), 300, 340);
  const input = path.join(OUT, 'input.png');
  fs.writeFileSync(input, await img.getBuffer(JimpMime.png));

  const provider = new LocalImageProvider();
  const base = {
    productName: 'Summer Fan', brand: 'ACME', platform: 'taobao',
    language: 'zh-CN', description: '3 speed quiet USB powered', ratio: '1:1', size: '1k',
  };
  for (const variant of ['white_background', 'scene', 'selling_point', 'other']) {
    const t0 = Date.now();
    const { buffer, format } = await provider.generate('main_image', [input], { ...base, variant });
    const p = path.join(OUT, `${variant}.jpg`);
    fs.writeFileSync(p, buffer);
    const out = await Jimp.read(p);
    const magic = buffer.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'jpeg-ok' : 'BAD';
    console.log(`${variant.padEnd(18)} ${magic} ${out.bitmap.width}x${out.bitmap.height} ${format} ${Date.now() - t0}ms ${(buffer.length / 1024).toFixed(0)}KB`);
  }
  const { buffer } = await provider.generate('main_image', [input], { ...base, variant: 'scene', size: '2k', ratio: '3:4' });
  const p2 = path.join(OUT, 'scene-2k-34.jpg');
  fs.writeFileSync(p2, buffer);
  const tall = await Jimp.read(p2);
  console.log(`scene 2k/3:4       jpeg-ok ${tall.bitmap.width}x${tall.bitmap.height}`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
