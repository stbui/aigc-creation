/**
 * 装配期自检（2026-10-25，模型-only）。
 *
 * 验证能力定义能加载、完整性校验生效，并明确断言没有任何能力再声明
 * 本地图像生成实现。装配期校验会随模块加载同步执行，因此能加载到本行
 * 本身就是“注册表合法”的证据。
 */

import { CAPABILITIES } from '../src/capabilities/capability.registry';
import { CAPABILITY_PLUGINS } from '../src/capabilities/definitions';
import { assertCapabilityIntegrity } from '../src/capabilities/capability-plugin.type';

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) pass += 1;
  else fails.push(`${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
};

ok('装配期完整性校验通过 (模块加载未抛错)', true);
ok('注册表为 16 项 (15 项图像 + 1 项视频)', CAPABILITIES.length === 16, CAPABILITIES.length);
ok('definitions 直接导出与 registry 同一数组', CAPABILITY_PLUGINS === CAPABILITIES);

assertCapabilityIntegrity(CAPABILITIES);
ok('显式复跑校验仍通过', true);

for (const c of CAPABILITIES) {
  ok(
    `${c.id} 不再声明本地生成字段`,
    !Object.prototype.hasOwnProperty.call(c, 'localImpl') &&
      !Object.prototype.hasOwnProperty.call(c, 'localFallback'),
  );
  const prompt = c.buildPrompt({}, 0);
  ok(`${c.id} 提示词非空`, typeof prompt === 'string' && prompt.trim().length > 0);
  ok(`${c.id} 声明了产出模态`, Boolean(c.modality), c.modality);
  ok(`${c.id} 声明了积分价`, typeof c.creditCost === 'number', c.creditCost);
}

console.log(`\n通过 ${pass} 项`);
if (fails.length) {
  console.error(`\n失败 ${fails.length} 项:`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('装配期自检通过：16 项能力模型-only，无本地生成入口');
