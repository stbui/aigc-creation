/**
 * 装配期自检 (2026-10-20 抽离): 验证能力定义能被真实加载并通过完整性校验。
 *
 * 为什么必须单独验: assertCapabilityIntegrity 是在 definitions/index.ts 的
 * **模块顶层**执行的 —— 任何一处漏声明能力字段, 都会让整个进程启动即崩。
 * 这道断言保证它确实能加载通过, 且 15 项能力全部在册。
 */

import { CAPABILITIES } from '../src/capabilities/capability.registry';
import { CAPABILITY_PLUGINS } from '../src/capabilities/definitions';
import { assertCapabilityIntegrity } from '../src/capabilities/capability-plugin.type';
import { LocalImageProvider } from '../src/providers/local-image.provider';

let pass = 0;
const fails: string[] = [];
const ok = (n: string, c: boolean, d?: unknown) => {
  if (c) pass += 1;
  else fails.push(`${n}${d !== undefined ? ` — ${JSON.stringify(d)}` : ''}`);
};

// 模块能加载到这里, 本身就是"顶层校验没抛"的证据
ok('装配期完整性校验通过 (模块加载未抛错)', true);
ok('注册表为 16 项 (15 项图像 + 1 项视频)', CAPABILITIES.length === 16, CAPABILITIES.length);
ok('definitions 直接导出与 registry 同一数组', CAPABILITY_PLUGINS === CAPABILITIES);

// 复核一次 (幂等, 不应抛)
assertCapabilityIntegrity(CAPABILITIES);
ok('显式复跑校验仍通过', true);

// 本地实现句柄: 声明了就必须真实存在; 没声明就必须显式关掉本地兜底
//
// ⚠️ **2026-10-22 起图像能力有两种合法形态**:
//   1. 声明 localImpl —— 本地是真实像素算法, 云端失败可回落;
//   2. 不声明 localImpl 但 `localFallback: false` —— 必须由真实模型完成,
//      没通道就 failed/42204 并退款 (创意生图 / 局部重绘 / 图片翻译 / 自由创作)。
// 「既没有 localImpl 也没关掉兜底」在装配期就被 assertCapabilityIntegrity 拦下,
// 这里再复核一遍, 因为闸口要能在装配期断言被绕过时仍报出来。
//
// 文本与视频模态本就该没有 localImpl (编模板文案/占位素材会冒充模型产出)。
// 句柄集合直接从 provider 原型上取, 不再手抄一份:
// 手抄清单曾漏掉 2026-10-21 新增的 makeRemoveWatermark, 导致定义改对了、
// 闸口却按旧快照报红 —— 校验对象应当是会漂的实现, 不是第二份名单。
const KNOWN = new Set(Object.getOwnPropertyNames(LocalImageProvider.prototype));
for (const c of CAPABILITIES) {
  if (c.localImpl) {
    ok(`${c.id} 的 localImpl 在已知集合内`, KNOWN.has(c.localImpl), c.localImpl);
  } else if (c.modality === 'image') {
    ok(`${c.id} 无本地实现时显式关闭本地兜底`, c.localFallback === false, c.localFallback);
  } else {
    ok(`${c.id} (${c.modality}) 无本地兜底 (刻意)`, c.localImpl === undefined, c.localImpl);
  }
}

// 提示词构造器都能产出非空串
for (const c of CAPABILITIES) {
  const p = c.buildPrompt({}, 0);
  ok(`${c.id} 提示词非空`, typeof p === 'string' && p.length > 0);
}

console.log(`\n通过 ${pass} 项`);
if (fails.length) {
  console.error(`\n失败 ${fails.length} 项:`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('装配期自检通过：16 项能力（15 图像 + 1 视频）全部加载并通过完整性校验');