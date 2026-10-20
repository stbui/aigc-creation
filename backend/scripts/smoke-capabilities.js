/**
 * 全能力冒烟: registry 里每个可提交能力都用真实输入跑一遍, 校验产出的 magic bytes。
 * 用法: node scripts/smoke-capabilities.js
 */
const fs = require('fs');
const path = require('path');
const { Jimp, JimpMime } = require('jimp');
const { MockImageProvider } = require('../dist/providers/mock-image.provider');
const registry = require('../dist/capabilities/capability.registry');

const OUT = '/tmp/cap-smoke';
fs.mkdirSync(OUT, { recursive: true });

async function makeInput() {
  const W = 900;
  const H = 900;
  const img = new Jimp({ width: W, height: H, color: 0xf1f5f9ff });
  img.composite(new Jimp({ width: 520, height: 70, color: 0x00000018 }), 190, 700);
  img.composite(new Jimp({ width: 340, height: 560, color: 0x2563ebff }), 280, 160);
  img.composite(new Jimp({ width: 170, height: 70, color: 0x1e3a8aff }), 365, 100);
  img.composite(new Jimp({ width: 300, height: 220, color: 0xffffffff }), 300, 340);
  const p = `${OUT}/input.png`;
  fs.writeFileSync(p, await img.getBuffer(JimpMime.png));
  return p;
}

(async () => {
  const input = await makeInput();
  const ref = `${OUT}/ref.png`;
  fs.writeFileSync(ref, fs.readFileSync(input));
  const provider = new MockImageProvider();

  const defs = registry.CAPABILITIES;
  let fail = 0;
  let real = 0;
  let mock = 0;

  for (const def of defs) {
    if (def.mode === 'planned') {
      console.log(`⏭  ${def.name.padEnd(12)} planned (不提交, 提交应被拒)`);
      continue;
    }
    // ⚠️ **只冒烟图像模态** (2026-10-20)。
    // 本脚本用 MockImageProvider (Jimp 本地算法) 跑能力, 产出必须是图片字节。
    // 视频能力 (modality='video', 如 image_to_video) **按设计没有 localImpl** ——
    // 本地不存在「本地算法生成视频」, 编一段占位素材当视频会欺骗用户。
    // 故视频能力不走本冒烟, 它由视频通道的独立冒烟覆盖。
    // (此前未按模态过滤 → 视频能力落到 MockImageProvider → 报
    //  「未声明 localImpl」, 看起来像能力定义坏了, 实为冒烟脚本与能力模型不同步。)
    if (def.modality && def.modality !== 'image') {
      console.log(`⏭  ${def.name.padEnd(12)} ${def.modality} 模态 (无本地算法兜底, 不走本冒烟)`);
      continue;
    }
    const inputs = def.inputs === 2 ? [input, ref] : [input];
    const params = registry.defaultParamsFor(def.id);
    const t0 = Date.now();
    try {
      const { buffer, format } = await provider.generate(def.id, inputs, params);
      const isJpeg = buffer.subarray(0, 3).toString('hex') === 'ffd8ff';
      const isPng = buffer.subarray(0, 4).toString('hex') === '89504e47';
      const magicOk = isJpeg || isPng;
      const ext = format === 'image/png' ? 'png' : 'jpg';
      const out = `${OUT}/${def.id}.${ext}`;
      fs.writeFileSync(out, buffer);
      const { width, height } = (await Jimp.read(out)).bitmap;
      const label = def.mode === 'real' ? '真做' : 'mock';
      if (def.mode === 'real') real++;
      else mock++;
      console.log(
        `${magicOk ? '✅' : '❌'} ${def.name.padEnd(12)} ${label} ${String(width).padStart(4)}x${String(height).padEnd(4)} ${String(buffer.length).padStart(7)}B ${format.padEnd(10)} ${Date.now() - t0}ms`,
      );
      if (!magicOk) fail++;
    } catch (e) {
      console.log(`❌ ${def.name.padEnd(12)} ${def.mode} 失败: ${e.message}`);
      fail++;
    }
  }

  // 参数越界收敛检查 (size/ratio/platform 均为 enum: 越界值回落默认, 不放行离谱输入)
  const bad = registry.sanitizeParams('main_image', { size: 99999, ratio: 'evil', platform: 'hacked' });
  const clamped = bad.size === '1k' && bad.ratio === '1:1' && bad.platform === 'taobao';
  console.log(`${clamped ? '✅' : '❌'} 参数收敛: ${JSON.stringify(bad)}`);
  if (!clamped) fail++;

  // 修图系工具默认"原比例" (参考站高级设置): sanitize 后 ratio 应保持 original
  const orig = registry.sanitizeParams('matting', { bgColor: 'nope' });
  const origOk = orig.bgColor === 'transparent' && orig.ratio === 'original';
  console.log(`${origOk ? '✅' : '❌'} 修图默认原比例: ${JSON.stringify(orig)}`);
  if (!origOk) fail++;

  console.log(`\n真做 ${real} 项 / mock ${mock} 项 / 失败 ${fail} 项 → ${fail === 0 ? 'ALL PASS' : 'FAIL'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SMOKE FAIL:', e);
  process.exit(1);
});
