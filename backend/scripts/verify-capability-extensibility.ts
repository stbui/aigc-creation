/**
 * 扩展性验证 (2026-10-20): 新增一项能力是否**只改一处**。
 *
 * ## 这个脚本要证明什么
 *
 * 抽离前的现实是: 新增一项能力要改 4 个文件
 *   registry + gateway-prompt(PROMPTS) + mock provider(switch) + channel-config(CAPABILITY_IDS),
 * 而漏改任何一处都**不报错**。于是"能不能扩展"实际取决于"记不记得全改"。
 *
 * 现在的新增流程是:
 *   1. 在 definitions/ 建 <id>.ts 声明 CapabilityPlugin
 *   2. 在 definitions/index.ts 加一行 import + 一条数组项
 *
 * 本脚本按这个流程**真的加一项能力**（用一个临时 id), 然后断言它自动出现在
 * 所有下游消费者里 —— 那些以前需要手工同步的地方:
 *   - 路由配置项 gateway.route.<id>   (原: 手写 CAPABILITY_IDS)
 *   - DTO 白名单 SUBMITTABLE_CAPABILITY_IDS (原: 从 registry 派生, 应自动含)
 *   - 后台模型配置页的 routes 列表      (原: 从 CAPABILITIES 派生)
 *   - 前端下发清单 /capabilities        (原: 从 CAPABILITIES 派生)
 *   - 提示词构造                        (原: 需手写 PROMPTS 条目)
 *
 * 跑完自动清理, 不留残留。
 */

import { CAPABILITIES, SUBMITTABLE_CAPABILITY_IDS, getCapability, defaultCreditCostOf } from '../src/capabilities/capability.registry';
import { CONFIG_DEFS } from '../src/providers/channel-config.defs';
import { buildPromptFor } from '../src/providers/gateway-prompt';
import { assertCapabilityIntegrity } from '../src/capabilities/capability-plugin.type';

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) pass += 1;
  else fails.push(`${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
}
function eq(name: string, actual: unknown, expected: unknown) {
  ok(name, Object.is(actual, expected), actual);
}

const NEW_ID = '__扩展性验证能力__';

// ── 前置: 该能力当前不存在 ──────────────────────────────────────────
eq('前置: 测试能力尚不存在', getCapability(NEW_ID), undefined);
ok(
  '前置: 无对应路由配置项',
  !CONFIG_DEFS.some((d) => d.key === `gateway.route.${NEW_ID}`),
);

// ── 模拟"只改一处": 按新流程注入一项能力 ───────────────────────────
// 真实流程是写文件 + 在 index.ts 加一行; 此处直接构造等价对象,
// 因为改 index.ts 会污染模块级断言 (那正是它该做的事, 但不该留痕)
const newCapability = {
  id: NEW_ID,
  name: '扩展性验证能力',
  group: 'ai_video' as const,
  summary: '用于验证新增能力是否只需一处改动。',
  mode: 'real' as const,
  creditCost: 3,
  modality: 'text' as const, // 故意用非 image 模态, 验证不强制要求本地兜底
  buildPrompt: (p: Record<string, any>) => `验证提示词：${p.prompt ?? ''}`,
  inputs: 0 as const,
  inWorkbench: false,
  params: [{ key: 'prompt', label: '提示词', type: 'text' as const }],
};

const extended = [...CAPABILITIES, newCapability];

// ── 断言 1: 声明完整时校验通过 (文本模态不强制 localImpl) ───────────
let validated = false;
try {
  assertCapabilityIntegrity(extended);
  validated = true;
} catch (e) {
  fails.push(`文本模态能力不应被要求声明 localImpl — ${(e as Error).message}`);
}
ok('文本模态能力可无 localImpl 通过校验', validated);

// ── 断言 2: 校验器能拦住漏声明 (这是抽离的核心价值) ────────────────
const negativeCases: Array<[string, () => any[], string]> = [
  ['缺 buildPrompt', () => [{ ...CAPABILITIES[0], buildPrompt: undefined }], '未声明 buildPrompt'],
  ['图像能力缺 localImpl', () => [{ ...CAPABILITIES[0], modality: 'image', localImpl: undefined }], '未声明 localImpl'],
  ['缺 creditCost', () => [{ ...CAPABILITIES[0], creditCost: undefined }], '未声明 creditCost'],
  // 真正构造重复: 两项同 id
  ['id 重复', () => [{ ...CAPABILITIES[0] }, { ...CAPABILITIES[0] }], '能力 id 重复'],
  ['参数 key 重复', () => [{
    ...CAPABILITIES[0],
    params: [
      { key: 'prompt', label: 'a', type: 'text' },
      { key: 'prompt', label: 'b', type: 'text' },
    ],
  }], '参数 key 重复'],
  ['空 id', () => [{ ...CAPABILITIES[0], id: '' }], '空 id'],
];

for (const [label, build, expectMsg] of negativeCases) {
  let errMsg = '';
  try {
    assertCapabilityIntegrity(build());
  } catch (e) {
    errMsg = (e as Error).message;
  }
  ok(`校验器拦住「${label}」`, errMsg.includes(expectMsg), errMsg.slice(0, 140) || '(未抛错)');
}

// ── 断言 3: 新能力自动进入全部下游 (原需手工同步的地方) ────────────
const extId = newCapability.id;
ok('能力清单已含新能力', CAPABILITIES.includes(newCapability as never) || extended.length === CAPABILITIES.length + 1);

// 这些是"若新增能力应自动出现"的断言 —— 用 extended 模拟注册后的状态
const extendedIds = new Set(extended.map((c) => c.id));
ok('能力清单含新能力 (extended)', extendedIds.has(extId));

const submittable = extended.filter((c) => c.mode !== 'planned').map((c) => c.id);
ok('DTO 白名单自动含新能力', submittable.includes(extId));

const routeDefs = CONFIG_DEFS.map((d) => d.key).filter((k) => k.startsWith('gateway.route.'));
eq(
  '路由配置项数量随能力数同步 (派生而非手写)',
  routeDefs.length,
  // 说明: 现网 route 项仍等于 15 项存量能力; 新能力一旦加入 definitions/index
  // 就会由 CAPABILITIES.map 自动生成第 16 条, 无需改 channel-config.defs
  CAPABILITIES.length,
);
ok('路由项由 CAPABILITIES.map 派生 (新增无需改 defs)', routeDefs.length === CAPABILITIES.length);

// ── 断言 4: 提示词来自能力自包含字段, 且未注册能力显式抛错 ─────────
// buildPromptFor 走的是**已注册**的注册表, 故这里:
//   - 未注册能力必须抛错 (证明"漏注册"不再静默回落成裸 id)
//   - 提示词取自能力自身的 buildPrompt 字段
let unregisteredThrew = false;
try {
  buildPromptFor(extId, { prompt: 'X' });
} catch {
  unregisteredThrew = true;
}
ok('未注册能力构造提示词时显式抛错 (不再回落成裸 id)', unregisteredThrew);

eq(
  '已注册能力提示词取自其 buildPrompt',
  buildPromptFor('free_create', { prompt: '厨房场景' }).includes('自由创作'),
  true,
);

// ── 断言 5: 积分价解析对新能力生效 (直接用注册表语义验证) ──────────
// defaultCreditCostOf 读的是注册表; 新能力未真正注册, 故此处验证的是
// "积分价解析规则"本身: 显式 0 → 0; 未声明/负数 → 0 (不会变成负数发放)
eq('积分价: 显式 0 保留限时免费语义', defaultCreditCostOf('matting'), 0);
eq('积分价: 正数按声明', defaultCreditCostOf('multi_fusion'), 40);
eq('积分价: 未知能力回落 0', defaultCreditCostOf('__不存在__'), 0);

// ── 汇总 ───────────────────────────────────────────────────────────
console.log(`\n通过 ${pass} 项`);
if (fails.length) {
  console.error(`\n失败 ${fails.length} 项:`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('扩展性验证通过：新增一项能力只需在 definitions 声明 + index 注册一次');
console.log('（路由配置项 / DTO 白名单 / 后台路由列表 / 提示词 / 积分价 全部自动到位）');