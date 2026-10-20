/** 详情图冒烟: 模块选择 → 区块数量/版面差异, 画质 → 尺寸 */
const fs = require('fs');
const path = require('path');
const { Jimp, JimpMime } = require('jimp');
const { MockImageProvider } = require('../dist/providers/mock-image.provider');
const registry = require('../dist/capabilities/capability.registry');

const OUT = '/tmp/pd-variants';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const img = new Jimp({ width: 900, height: 900, color: 0xf1f5f9ff });
  img.composite(new Jimp({ width: 340, height: 560, color: 0x2563ebff }), 280, 160);
  img.composite(new Jimp({ width: 300, height: 220, color: 0xffffffff }), 300, 340);
  const input = path.join(OUT, 'input.png');
  fs.writeFileSync(input, await img.getBuffer(JimpMime.png));

  const provider = new MockImageProvider();
  const base = {
    productName: 'Summer Fan',
    brand: 'ACME',
    platform: 'taobao',
    language: 'zh-CN',
    description: '3 speed quiet USB powered',
    sku: 'SKU-001',
    size: '1k',
  };
  const cases = [
    ['default-6', registry.DETAIL_SECTION_DEFAULTS.join(',')],
    ['single-hero', 'hero'],
    ['ten-modules', registry.DETAIL_SECTIONS.slice(0, 10).map((s) => s.value).join(',')],
    ['unknown-filtered', 'hero,bogus_key,after_sale'],
  ];
  for (const [label, sections] of cases) {
    const { buffer } = await provider.generate('detail_image', [input], { ...base, sections });
    const p = path.join(OUT, `${label}.jpg`);
    fs.writeFileSync(p, buffer);
    const out = await Jimp.read(p);
    const n = registry.parseDetailSections(sections).length;
    const magic = buffer.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'jpeg-ok' : 'BAD';
    console.log(`${label.padEnd(18)} ${magic} ${out.bitmap.width}x${out.bitmap.height} blocks=${n} ${(buffer.length / 1024).toFixed(0)}KB`);
  }
  const { buffer } = await provider.generate('detail_image', [input], { ...base, sections: 'hero', size: '2k' });
  fs.writeFileSync(path.join(OUT, 'hero-2k.jpg'), buffer);
  const big = await Jimp.read(path.join(OUT, 'hero-2k.jpg'));
  console.log(`hero-2k           jpeg-ok ${big.bitmap.width}x${big.bitmap.height}`);
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
