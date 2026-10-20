/**
 * 厂商层聚合等价性断言 (2026-10-20 架构重构)。
 *
 * ## 为什么必须逐项比对
 *
 * 这次把厂商数据源从「9 条模态级预设」换成「7 家厂商目录 + 派生视图」,
 * 视图的 key 命名规则也变了 (单模态厂商用裸 key, 跨模态厂商用
 * `<vendor>-<modality>`)。若映射错了, 会出现:
 *   - 后台已存的 `gateway.image.vendor = 'siliconflow'` 找不到对应视图
 *   - 某厂商的参考图上限、尺寸写法被悄悄改掉, 而界面**照常显示**旧值
 *
 * 后者是资损与功能双重问题: 用户以为能传 10 张参考图, 实际被截断成 1 张。
 *
 * 故本文件固定了**重构前的 9 条预设快照**, 与派生视图逐字段比对。
 */

import { VENDOR_CATALOG, baseUrlOf, findVendor, specOf, vendorsFor } from '../src/providers/vendors/vendor.catalog';
import { VENDOR_PRESETS, presetsFor, protocolSupports } from '../src/providers/vendors/vendor.presets';
import { PROTOCOL_SPECS, protocolSpec } from '../src/providers/protocols/protocol.spec';
import { collectCatalogIssues, collectViewDriftIssues } from '../src/providers/vendors/vendor.integrity';

let pass = 0;
const fails: string[] = [];
const ok = (n: string, c: boolean, d?: unknown) => {
  if (c) pass += 1;
  else fails.push(`${n}${d !== undefined ? ` — ${JSON.stringify(d)}` : ''}`);
};
const eq = (n: string, a: unknown, e: unknown) => ok(n, Object.is(a, e), a);

// ── 基线: 重构前的 9 条模态级预设 ───────────────────────────────────
interface BaselinePreset {
  key: string;
  vendorKey: string;
  modality: string;
  protocol: string;
  baseUrl: string;
  sizeStyle?: string;
  maxRefImages?: number;
  refStyle?: string;
  models: string[];
}
const BASELINE: BaselinePreset[] = [
  {
    key: 'modelverse', vendorKey: 'modelverse', modality: 'image', protocol: 'openai',
    baseUrl: 'https://api.modelverse.cn',
    sizeStyle: 'openai-wh', maxRefImages: 3, refStyle: 'base64',
    models: ['qwen-image-3.0', 'qwen-image-3.0-pro', 'doubao-seedream-5-0-pro-260628', 'flux-2-pro', 'gpt-image-2'],
  },
  {
    key: 'siliconflow', vendorKey: 'siliconflow', modality: 'image', protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn',
    sizeStyle: 'openai-wh', maxRefImages: 3, refStyle: 'base64',
    models: ['Kwai-Kolors/Kolors', 'Tongyi-MAI/Z-Image-Turbo', 'Qwen/Qwen-Image-Edit-2509', 'black-forest-labs/FLUX.1-schnell'],
  },
  {
    key: 'openai', vendorKey: 'openai', modality: 'image', protocol: 'openai',
    baseUrl: 'https://api.openai.com',
    sizeStyle: 'openai-wh', maxRefImages: 3, refStyle: 'base64',
    models: ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1'],
  },
  {
    key: 'volcengine', vendorKey: 'volcengine', modality: 'image', protocol: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    sizeStyle: 'volc-tier', maxRefImages: 10, refStyle: 'url',
    models: ['doubao-seedream-5-0-pro-260628', 'doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828'],
  },
  {
    key: 'minimax', vendorKey: 'minimax', modality: 'image', protocol: 'minimax',
    baseUrl: 'https://api.minimax.io',
    sizeStyle: 'ratio-only', maxRefImages: 1, refStyle: 'url',
    models: ['image-01'],
  },
  {
    key: 'deepseek', vendorKey: 'deepseek', modality: 'text', protocol: 'openai-chat',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    key: 'moonshot', vendorKey: 'moonshot', modality: 'text', protocol: 'openai-chat',
    baseUrl: 'https://api.moonshot.cn',
    models: ['kimi-k2.5', 'moonshot-v1-8k'],
  },
  {
    // ⚠️ 跨模态厂商: key 从 'siliconflow-text' 变为 'siliconflow-text' (同)
    key: 'siliconflow-text', vendorKey: 'siliconflow', modality: 'text', protocol: 'openai-chat',
    baseUrl: 'https://api.siliconflow.cn',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-32B', 'moonshotai/Kimi-K2-Instruct'],
  },
  {
    key: 'openai-text', vendorKey: 'openai', modality: 'text', protocol: 'openai-chat',
    baseUrl: 'https://api.openai.com',
    models: ['gpt-4o', 'gpt-4o-mini'],
  },
];

// ── 1. 派生视图与基线逐字段一致 ───────────────────────────────────
/*
 * ⚠️ 基线是「重构前的 9 条预设」—— 断言它们**逐字未变**是**回归防护**。
 *
 * 但基线**不锁死总数**: 厂商目录是活的, 后续接入新厂商/新模态通道时
 * 视图条数会增加 (如 2026-10-20 并发会话为优云智算补了实测可用的
 * 文生文通道 gpt-4o-mini, 视图从 9 条变 10 条)。
 *
 * 故规则是: 基线 9 条必须**全部存在且逐字一致** (防漂移),
 * 而多出来的条目必须**显式列在 ADDED_PRESETS 里** —— 加了不说,
 * 断言会红, 强制补记。这比"锁死总数"更合理: 既不放过漂移, 也不阻止扩展。
 */
const ADDED_PRESETS: string[] = ['modelverse-text', 'minimax-video'];

eq(
  '基线 9 条预设全部存在 (未被改名/删除)',
  BASELINE.filter((b) => VENDOR_PRESETS.some((x) => x.key === b.key)).length,
  BASELINE.length,
);
eq(
  '新增的预设已在 ADDED_PRESETS 显式登记',
  VENDOR_PRESETS.filter((x) => !BASELINE.some((b) => b.key === x.key))
    .map((x) => x.key)
    .sort()
    .join(','),
  [...ADDED_PRESETS].sort().join(','),
);
for (const b of BASELINE) {
  const p = VENDOR_PRESETS.find((x) => x.key === b.key);
  if (!p) {
    fails.push(`基线预设 ${b.key} 在派生视图中不存在`);
    continue;
  }
  eq(`${b.key}.vendorKey`, p.vendorKey, b.vendorKey);
  eq(`${b.key}.modality`, p.modality, b.modality);
  eq(`${b.key}.protocol`, p.protocol, b.protocol);
  eq(`${b.key}.baseUrl`, p.baseUrl, b.baseUrl);
  eq(`${b.key}.sizeStyle`, p.sizeStyle, b.sizeStyle);
  eq(`${b.key}.maxRefImages`, p.maxRefImages, b.maxRefImages);
  eq(`${b.key}.refStyle`, p.refStyle, b.refStyle);
  eq(`${b.key}.models`, p.models.map((m) => m.id).join(','), b.models.join(','));
}

// ── 2. 厂商目录是 7 家 (视图条数随通道数变化) ────────────────────
eq('厂商目录为 7 家', VENDOR_CATALOG.length, 7);
eq(
  '厂商 key 唯一',
  new Set(VENDOR_CATALOG.map((v) => v.key)).size,
  VENDOR_CATALOG.length,
);

// ── 3. 跨模态厂商确实共享基址与控制台 (这是聚合的核心收益) ────────
{
  const sf = findVendor('siliconflow')!;
  const oa = findVendor('openai')!;
  eq('硅基流动两通道同基址', sf.channels[0].baseUrl ?? sf.baseUrl, sf.channels[1].baseUrl ?? sf.baseUrl);
  eq('OpenAI 两通道同基址', oa.channels[0].baseUrl ?? oa.baseUrl, oa.channels[1].baseUrl ?? oa.baseUrl);
  ok('硅基流动两通道共用一个控制台地址', typeof sf.consoleUrl === 'string' && sf.consoleUrl.length > 0);
}

// ── 4. 能力字段单一来源: 视图的每个字段都能在协议层找到出处 ───────
eq('派生视图无漂移', collectViewDriftIssues().length, 0);
for (const p of VENDOR_PRESETS) {
  const spec = protocolSpec(p.protocol)!;
  if (p.modality === 'image') {
    // 图像模态: 三个字段必须逐字来自协议层
    eq(`${p.key} 的 sizeStyle 源自协议层`, p.sizeStyle, spec.sizeStyle);
    eq(`${p.key} 的 maxRefImages 源自协议层`, p.maxRefImages, spec.maxRefImages);
    eq(`${p.key} 的 refStyle 源自协议层`, p.refStyle, spec.refStyle);
  } else {
    // 文本模态: 这些字段必须留空 (无尺寸档位/参考图概念)
    // ⚠️ 若这里透出了协议层的值, 后台会给文生文显示「像素尺寸 1024x1024」
    // 这种根本不存在的选项, 运营会以为配错了
    eq(`${p.key} 的 sizeStyle 留空(文本模态)`, p.sizeStyle, undefined);
    eq(`${p.key} 的 maxRefImages 留空(文本模态)`, p.maxRefImages, undefined);
    eq(`${p.key} 的 refStyle 留空(文本模态)`, p.refStyle, undefined);
  }
}

// ── 5. 目录完整性 (悬空协议 / 模态不符 / key 重复) ─────────────────
eq('目录完整性无问题', collectCatalogIssues().length, 0);

// ── 6. 协议层: 标识唯一、模态正确、base64/url 传法齐备 ───────────
{
  eq('协议条数', PROTOCOL_SPECS.length, 5);
  eq('协议标识唯一', new Set(PROTOCOL_SPECS.map((p) => p.protocol)).size, PROTOCOL_SPECS.length);
  for (const p of PROTOCOL_SPECS) {
    ok(`${p.protocol} 有 mode 声明`, p.mode === 'sync' || p.mode === 'async');
    /*
     * ⚠️ 端点**应当**含 /v1 (那是协议层补的版本段);
     * 真正的不变量是**不得出现 /v1/v1** —— 那是"基址没归一化"的症状。
     * (厂商基址不含 /v1 这一点由 collectCatalogIssues 单独校验)
     */
    const ep = p.endpoint('https://x.test');
    ok(`${p.protocol} 端点不产生 /v1/v1`, !ep.includes('/v1/v1'), ep);
  }
  // 端点拼接正确性
  eq(
    'openai 生图端点',
    protocolSpec('openai')!.endpoint('https://api.modelverse.cn'),
    'https://api.modelverse.cn/v1/images/generations',
  );
  eq(
    'openai-chat 文本端点',
    protocolSpec('openai-chat')!.endpoint('https://api.deepseek.com'),
    'https://api.deepseek.com/v1/chat/completions',
  );
  eq(
    'minimax 端点',
    protocolSpec('minimax')!.endpoint('https://api.minimax.io'),
    'https://api.minimax.io/v1/image_generation',
  );
  eq(
    'volcengine 端点',
    protocolSpec('volcengine')!.endpoint('https://ark.cn-beijing.volces.com/api/v3'),
    'https://ark.cn-beijing.volces.com/api/v3/images/generations',
  );
}

// ── 7. 模态过滤: 前端下拉只出现该模态真实可用的厂商 ─────────────
{
  eq('文生图厂商数', vendorsFor('image').length, 5);
  // ⚠️ 文生文厂商数为 5: 硅基流动/OpenAI/DeepSeek/Moonshot + 优云智算
  // (2026-10-20 实测 gpt-4o-mini 在优云智算下 200 且支持视觉)
  eq('文生文厂商数', vendorsFor('text').length, 5);
  eq('文生图预设数', presetsFor('image').length, 5);
  eq('文生文预设数', presetsFor('text').length, 5);
  ok('文生文不含 DeepSeek 的图像通道', !presetsFor('image').some((p) => p.vendorKey === 'deepseek'));
  ok('文生图不含 Moonshot', !presetsFor('image').some((p) => p.vendorKey === 'moonshot'));
}

// ── 8. 协议白名单按模态隔离 ───────────────────────────────────────
ok('openai 支持文生图', protocolSupports('image', 'openai'));
ok('openai-chat 不支持文生图', !protocolSupports('image', 'openai-chat'));
ok('openai-chat 支持文生文', protocolSupports('text', 'openai-chat'));
ok('openai 不支持文生文', !protocolSupports('text', 'openai'));

// ── 9. 通道解析: 厂商 × 模态 → 通道 → 协议形状 ───────────────────
{
  const ch = findVendor('volcengine')!.channels[0];
  const spec = specOf(ch)!;
  eq('火山通道解析到 volcengine 协议', spec.protocol, 'volcengine');
  eq('火山通道的参考图上限来自协议层', spec.maxRefImages, 10);
  eq('厂商级基址归一化', baseUrlOf(findVendor('volcengine')!, ch), 'https://ark.cn-beijing.volces.com/api/v3');
}

// ── 汇总 ───────────────────────────────────────────────────────────
console.log(`\n通过 ${pass} 项`);
if (fails.length) {
  console.error(`\n失败 ${fails.length} 项:`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('厂商层聚合等价性断言全部通过（与重构前 9 条预设逐字段一致）');