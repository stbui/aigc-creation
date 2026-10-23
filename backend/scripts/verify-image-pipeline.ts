/**
 * 图像产出链路冒烟测试 (2026-10-20 架构重构后)。
 *
 * ## 为什么需要它
 *
 * 架构重构给所有图像产出加了 `kind: 'image'` 判别式, 并把 mock provider 的
 * 15 处 return 语句批量改写。那次批量改写**真的破坏过语法**(正则吞掉了方法
 * 闭合括号), 靠 tsc 才发现。
 *
 * 但 tsc 只能保证**类型**正确, 保证不了「本地算法仍能真的出图」——
 * 比如某个方法被误删、某个分支被跳过, 类型照样通过, 却是功能回归。
 * 故本脚本实际跑一遍本地算法, 验证产出是真的图片字节。
 */

import { LocalImageProvider } from '../src/providers/local-image.provider';
import { Jimp } from 'jimp';

let pass = 0;
const fails: string[] = [];
const ok = (n: string, c: boolean, d?: unknown) => {
  if (c) pass += 1;
  else fails.push(`${n}${d !== undefined ? ` — ${JSON.stringify(d)}` : ''}`);
};

/** 造一张 64x64 的测试输入图 */
async function makeInput(): Promise<string> {
  const img = new Jimp({ width: 64, height: 64, color: 0x336699ff });
  const p = `/tmp/mock-provider-input-${Date.now()}.png`;
  await img.write(p);
  return p;
}

/** 魔数判定 —— 与后端 sniffImageFormat 同规则, 独立实现以免同源推导 */
function isPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}
function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

const provider = new LocalImageProvider();

// ── 1. 全部 11 项**有本地实现**的图像能力都能真的产出图片字节 ──────
//
// 2026-10-22: 创意生图 / 局部重绘 / 图片翻译 / 自由创作 已删除本地占位实现,
// 它们没有本地路径可验 (无通道即 42204 退款, 由 smoke-gateway-channel.js 覆盖)。
const CAPS: Array<{ id: string; inputs: number; params: Record<string, any> }> = [
  { id: 'main_image', inputs: 1, params: { productName: 'Test', ratio: '1:1', size: '1k' } },
  { id: 'detail_image', inputs: 1, params: { productName: 'Test', ratio: '1:1', size: '1k' } },
  { id: 'hot_remake', inputs: 2, params: { ratio: '1:1', size: '1k' } },
  { id: 'multi_fusion', inputs: 2, params: { scene: 'texture', ratio: '1:1', size: '1k' } },
  { id: 'sku_image', inputs: 1, params: { skuName: 'S1', skuColor: '#FFFFFF', ratio: '1:1', size: '1k' } },
  { id: 'expand', inputs: 1, params: { occupy: 80, position: 'center', ratio: 'original', size: '1k' } },
  { id: 'matting', inputs: 1, params: { bgColor: 'transparent', ratio: 'original' } },
  { id: 'remove_watermark', inputs: 1, params: { mode: 'auto', region: 'bottom_right' } },
  { id: 'enhance', inputs: 1, params: { mode: 'comprehensive', ratio: 'original', size: '1k' } },
  { id: 'recolor', inputs: 1, params: { color: '#FFFFFF', ratio: 'original', size: '1k' } },
  { id: 'rotate', inputs: 1, params: { yaw: 10, pitch: 5, zoom: 1, ratio: 'original', size: '1k' } },
];

async function main() {
const input = await makeInput();

for (const cap of CAPS) {
  const paths = Array.from({ length: cap.inputs }, () => input);
  try {
    const r = await provider.generate(cap.id, paths, cap.params);
    ok(`${cap.id} 产出有字节`, r.buffer.length > 0, r.buffer.length);
    ok(`${cap.id} 产出带 kind 判别式`, r.kind === 'image', r.kind);
    ok(
      `${cap.id} 产出是合法图片`,
      isPng(r.buffer) || isJpeg(r.buffer),
      { format: r.format, head: r.buffer.subarray(0, 4).toString('hex') },
    );
    ok(`${cap.id} mime 与魔数一致`, r.format === 'image/png' ? isPng(r.buffer) : isJpeg(r.buffer), r.format);
  } catch (e) {
    fails.push(`${cap.id} 本地算法抛错 — ${(e as Error).message}`);
  }
}

// ── 2. 产出可被 Jimp 解析 (即真的是图片, 不是任意字节) ───────────
try {
  const r = await provider.generate('main_image', [input], { productName: 'T' });
  const img = await Jimp.read(r.buffer);
  ok('产出可被 Jimp 解析', img.bitmap.width > 0 && img.bitmap.height > 0, {
    w: img.bitmap.width,
    h: img.bitmap.height,
  });
} catch (e) {
  fails.push(`Jimp 解析产出失败 — ${(e as Error).message}`);
}

// ── 3. 未知能力显式报错, 不静默产出 ─────────────────────────────
let threw = false;
try {
  await provider.generate('__不存在的能力__', [input], {});
} catch {
  threw = true;
}
ok('未知能力显式抛错', threw);

// ── 4. planned 能力拒绝执行 ─────────────────────────────────────
{
  let plannedThrew = false;
  try {
    // 当前无 planned 能力, 用本地 provider 的 mode 判定路径验证:
    // 传一个真实但未在 registry 的 id 应当抛错
    await provider.generate('planned_test', [input], {});
  } catch {
    plannedThrew = true;
  }
  ok('未注册能力抛错 (等价于 planned 保护)', plannedThrew);
}

console.log(`\n通过 ${pass} 项`);
if (fails.length) {
  console.error(`\n失败 ${fails.length} 项:`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('图像产出链路冒烟测试通过：11 项能力的本地算法均产出合法图片');
}

void main();