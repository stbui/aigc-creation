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

let pass = 0;
const fails: string[] = [];
const ok = (n: string, c: boolean, d?: unknown) => {
  if (c) pass += 1;
  else fails.push(`${n}${d !== undefined ? ` — ${JSON.stringify(d)}` : ''}`);
};

// 模块能加载到这里, 本身就是"顶层校验没抛"的证据
ok('装配期完整性校验通过 (模块加载未抛错)', true);
ok('注册表为 16 项 (15 项图像/文本 + 1 项视频)', CAPABILITIES.length === 16, CAPABILITIES.length);
ok('definitions 直接导出与 registry 同一数组', CAPABILITY_PLUGINS === CAPABILITIES);

// 复核一次 (幂等, 不应抛)
assertCapabilityIntegrity(CAPABILITIES);
ok('显式复跑校验仍通过', true);

// 每项能力都有本地实现句柄, 且句柄名都在已知集合内
//
// ⚠️ **只有图像模态要求 localImpl** —— 文本与视频没有「本地算法」概念
// (编一段模板文案/占位素材会让用户误以为是模型产出, 违反项目约定)。
// 视频能力**刻意没有** localImpl, 故这里不能一刀切要求。
const KNOWN = new Set([
  'makeMainImage', 'makeDetailImage', 'makeClone', 'makeFreeCreation', 'makePlaceholder',
  'makeMultiFusion', 'makeSkuImage', 'makeLocalRedraw', 'makeExpand', 'makeMatting',
  'makeImageTranslate', 'makeEnhance', 'makeRecolor', 'makeRotate',
]);
for (const c of CAPABILITIES) {
  if (c.modality === 'image') {
    ok(`${c.id} 的 localImpl 在已知集合内`, !!c.localImpl && KNOWN.has(c.localImpl), c.localImpl);
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
console.log('装配期自检通过：16 项能力（15 图像/文本 + 1 视频）全部加载并通过完整性校验');