/**
 * 装配期自检（2026-10-25，模型-only）。
 *
 * 验证能力定义能加载、完整性校验生效，并明确断言没有任何能力再声明
 * 本地图像生成实现。装配期校验会随模块加载同步执行，因此能加载到本行
 * 本身就是“注册表合法”的证据。
 */

import { CAPABILITIES } from '../src/capabilities/capability.registry';
import { CAPABILITY_PLUGINS } from '../src/capabilities/definitions';
import { PLATFORMS } from '../src/capabilities/definitions/param-options';
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

/*
 * 平台 / 语言必须真正进入提示词 (2026-11-01)。
 *
 * 此前 `language` 只在参数表里声明，没有任何 buildPrompt 读取 —— 用户选
 * 「English」出图仍是中文；`platform` 则把 `taobao` 这类英文键直接拼进
 * 中文句子。这里按真实提交参数断言提示词里出现的是展示名与平台规格。
 */
const PLATFORM_LANGUAGE_CASES = [
  { id: 'main_image', params: { platform: 'jd', language: 'en-US' }, specText: '（主图常规 1:1、边长 ≥800px）' },
  { id: 'detail_image', params: { platform: 'jd', language: 'en-US' }, specText: '（详情长图建议宽度 750px）' },
  { id: 'hot_remake', params: { platform: 'jd', language: 'en-US' }, specText: '（主图常规 1:1、边长 ≥800px）' },
];
for (const { id, params, specText } of PLATFORM_LANGUAGE_CASES) {
  const def = CAPABILITIES.find((c) => c.id === id);
  const prompt = def?.buildPrompt(params, 1) ?? '';
  ok(`${id} 平台进入提示词`, prompt.includes('适配京东平台'), prompt);
  ok(`${id} 语言进入提示词`, prompt.includes('画面内文字使用 English'), prompt);
  ok(`${id} 包含平台规格`, prompt.includes(specText), prompt);
}

for (const option of PLATFORMS) {
  ok(
    `平台 ${option.value} 声明主图规格`,
    Boolean(option.meta?.ratio && option.meta?.size && option.meta?.minPx && option.meta?.spec),
    option.meta,
  );
  ok(
    `平台 ${option.value} 声明详情图规格`,
    Boolean(option.meta?.detail?.size && option.meta?.detail?.widthPx && option.meta?.detail?.spec),
    option.meta?.detail,
  );
}

const mainImage = CAPABILITIES.find((c) => c.id === 'main_image');
const conflictPrompt = mainImage?.buildPrompt(
  { platform: 'xiaohongshu', ratio: '16:9', size: '1k', language: 'zh-CN' },
  1,
) ?? '';
ok(
  '显式比例与平台常规冲突时不补规格',
  conflictPrompt.includes('适配小红书平台') && !conflictPrompt.includes('竖版封面常规'),
  conflictPrompt,
);
const lowQualityPrompt = mainImage?.buildPrompt(
  { platform: 'amazon', ratio: '1:1', size: '1k', language: 'zh-CN' },
  1,
) ?? '';
ok(
  '画质低于平台建议时不补规格',
  lowQualityPrompt.includes('适配Amazon平台') && !lowQualityPrompt.includes('最短边 ≥1600px'),
  lowQualityPrompt,
);

const detailImage = CAPABILITIES.find((c) => c.id === 'detail_image');
const lowDetailPrompt = detailImage?.buildPrompt(
  { platform: 'amazon', size: '1k', language: 'zh-CN' },
  1,
) ?? '';
ok(
  '详情画质低于平台建议时不补规格',
  lowDetailPrompt.includes('适配Amazon平台') && !lowDetailPrompt.includes('详情图建议宽度'),
  lowDetailPrompt,
);

const translate = CAPABILITIES.find((c) => c.id === 'image_translate');
const translatePrompt = translate?.buildPrompt({ targetLang: 'en-US' }, 1) ?? '';
ok(
  'image_translate 目标语言使用展示名',
  translatePrompt.includes('English') && !translatePrompt.includes('en-US'),
  translatePrompt,
);

console.log(`\n通过 ${pass} 项`);
if (fails.length) {
  console.error(`\n失败 ${fails.length} 项:`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('装配期自检通过：16 项能力模型-only，无本地生成入口');
