/**
 * 三模态配置解析断言 (2026-10-20)。
 *
 * 为什么必须实测而不能靠类型检查: 存量键回落的方向写反 (新键优先还是旧键优先)
 * 是**编译期完全合法**的错误, 且症状极隐蔽 —— 配置看起来生效了,
 * 只是读的是错误的键。type-check 与单测都不会红, 只有跑起来才知道。
 */

process.env.GATEWAY_BASE_URL = '';
delete process.env.GATEWAY_TOKEN;
delete process.env.GATEWAY_MODEL;
delete process.env.GATEWAY_PROVIDER;
delete process.env.GATEWAY_TEXT_BASE_URL;
delete process.env.GATEWAY_IMAGE_BASE_URL;
delete process.env.GATEWAY_VIDEO_BASE_URL;

import {
  resolveGatewayConfig,
  invalidateGatewayConfigCache,
  setGatewayConfigOverrides,
  gatewayConfig,
  gatewayConfigOf,
} from '../src/providers/gateway.config';
import { CONFIG_DEFS } from '../src/providers/channel-config.defs';
import { protocolSupports, presetsFor, defaultModelFor } from '../src/providers/provider-presets';
import { CAPABILITIES } from '../src/capabilities/capability.registry';

let pass = 0;
const fails: string[] = [];

function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass += 1;
  } else {
    fails.push(`${name}${detail !== undefined ? ` — 实际 ${JSON.stringify(detail)}` : ''}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown) {
  ok(name, Object.is(actual, expected), actual);
}

// ── 1. 零配置: 三模态全部未启用 ────────────────────────────────────
setGatewayConfigOverrides({});
invalidateGatewayConfigCache();
{
  const raw = resolveGatewayConfig();
  eq('image 默认未启用', raw.modalities.image.enabled, false);
  eq('text 默认未启用', raw.modalities.text.enabled, false);
  eq('video 默认未启用', raw.modalities.video.enabled, false);
  eq('image 默认协议 openai', raw.modalities.image.provider, 'openai');
  eq('text 默认协议 openai-chat', raw.modalities.text.provider, 'openai-chat');
}

// ── 2. 新键: 各模态互不干扰 ────────────────────────────────────────
setGatewayConfigOverrides({
  'gateway.image.baseUrl': 'https://img.example.com',
  'gateway.text.baseUrl': 'https://txt.example.com',
  'gateway.video.baseUrl': 'https://vid.example.com',
});
invalidateGatewayConfigCache();
{
  const raw = resolveGatewayConfig();
  eq('image 基址', raw.modalities.image.baseUrl, 'https://img.example.com');
  eq('text 基址', raw.modalities.text.baseUrl, 'https://txt.example.com');
  eq('video 基址', raw.modalities.video.baseUrl, 'https://vid.example.com');
  eq('配了基址即启用 image', raw.modalities.image.enabled, true);
  eq('配了基址即启用 text', raw.modalities.text.enabled, true);
}

// ── 3. 存量键回落 (核心) ───────────────────────────────────────────
setGatewayConfigOverrides({
  // 只写改造前的旧单前缀键
  'gateway.baseUrl': 'https://legacy.example.com',
  'gateway.model': 'legacy-model',
  'gateway.provider': 'volcengine',
});
invalidateGatewayConfigCache();
{
  const cfg = gatewayConfig();
  eq('存量 baseUrl 回落生效', cfg.baseUrl, 'https://legacy.example.com');
  eq('存量 model 回落生效', cfg.model, 'legacy-model');
  eq('存量 provider 回落生效', cfg.provider, 'volcengine');
  eq('存量键启用 image', cfg.enabled, true);
  // 关键: 回落只影响 image, 不得污染 text
  eq('回落不污染 text', gatewayConfigOf('text').baseUrl, '');
  eq('回落不污染 video', gatewayConfigOf('video').baseUrl, '');
}

// ── 4. 新键优先于存量键 ────────────────────────────────────────────
setGatewayConfigOverrides({
  'gateway.baseUrl': 'https://legacy.example.com',
  'gateway.image.baseUrl': 'https://new.example.com',
});
invalidateGatewayConfigCache();
{
  const cfg = gatewayConfig();
  eq('新键优先于存量键', cfg.baseUrl, 'https://new.example.com');
  const sources = cfg.sourcesOf();
  eq('新键来源标为 db', sources['gateway.image.baseUrl'], 'db');
}

// ── 5. 来源标记: 回落项不能被标成 default ──────────────────────────
// 运营看到 default 会以为"没配", 从而反复改 DB 却不见效果 —— 这正是
// model-config 页要解决的核心困惑, 标错等于把问题退回去。
setGatewayConfigOverrides({ 'gateway.baseUrl': 'https://legacy.example.com' });
invalidateGatewayConfigCache();
{
  const sources = gatewayConfig().sourcesOf();
  eq('回落项来源仍是 db', sources['gateway.image.baseUrl'], 'db');
}

// ── 6. env 优先级最高 ───────────────────────────────────────────────
process.env.GATEWAY_IMAGE_BASE_URL = 'https://env.example.com';
setGatewayConfigOverrides({ 'gateway.image.baseUrl': 'https://db.example.com' });
invalidateGatewayConfigCache();
{
  const cfg = gatewayConfig();
  eq('env 压过 db', cfg.baseUrl, 'https://env.example.com');
  eq('env 来源标记', cfg.sourcesOf()['gateway.image.baseUrl'], 'env');
}
delete process.env.GATEWAY_IMAGE_BASE_URL;
invalidateGatewayConfigCache();

// ── 7. 路由表跨模态共享且不丢 ───────────────────────────────────────
setGatewayConfigOverrides({
  'gateway.route.matting': 'local',
  'gateway.route.free_create': 'remote',
});
invalidateGatewayConfigCache();
{
  eq('路由 local', gatewayConfigOf('text').routeOf('matting'), 'local');
  eq('路由 remote', gatewayConfigOf('image').routeOf('free_create'), 'remote');
  eq('未设路由回落 auto', gatewayConfigOf('image').routeOf('enhance'), 'auto');
}

// ── 8. 超时默认值: video 必须更长, 否则必然超时 ────────────────────
setGatewayConfigOverrides({});
invalidateGatewayConfigCache();
{
  const raw = resolveGatewayConfig();
  ok('video 超时 > image 超时', raw.modalities.video.timeoutMs > raw.modalities.image.timeoutMs, {
    image: raw.modalities.image.timeoutMs,
    video: raw.modalities.video.timeoutMs,
  });
  eq('image 超时默认 120s', raw.modalities.image.timeoutMs, 120000);
}

// ── 9. 协议白名单按模态隔离 ────────────────────────────────────────
ok('openai 协议支持文生图', protocolSupports('image', 'openai'));
ok('openai-chat 不支持文生图', !protocolSupports('image', 'openai-chat'));
ok('openai-chat 支持文生文', protocolSupports('text', 'openai-chat'));
ok('openai 不支持文生文', !protocolSupports('text', 'openai'));
ok('video 首批无可用协议', !protocolSupports('video', 'openai-video'));

// ── 10. 默认模型必须按 (模态, 协议) 取, 不能只按协议 ────────────────
// 只按 protocol 取会命中生图预设, 给文生文返回 gpt-image-2 这类图片模型名。
{
  const textModel = defaultModelFor('text', 'openai-chat');
  ok('文生文默认模型不是图片模型', !!textModel && !/image|seedream|flux/i.test(textModel), textModel);
}

// ── 11. 厂商预设按模态过滤, 同厂商可有多条 ──────────────────────────
{
  eq('文生文厂商数', presetsFor('text').length, 5);
  // ⚠️ 5 家: 硅基流动 / OpenAI / DeepSeek / Moonshot + 优云智算
  // (2026-10-20 实测 gpt-4o-mini 在优云智算下 200 且支持视觉识图)
  ok('文生图厂商不含 DeepSeek', !presetsFor('image').some((v) => v.key === 'deepseek'));
  ok('硅基流动图/文各一条', presetsFor('image').some((v) => v.key === 'siliconflow') &&
    presetsFor('text').some((v) => v.key === 'siliconflow-text'));
  ok('每条预设都有 modality', presetsFor('text').every((v) => v.modality === 'text'));
  // 文生文预设不应携带生图专属字段
  ok('文生文预设无 sizeStyle', presetsFor('text').every((v) => v.sizeStyle === undefined));
}

// ── 12. 基址必须归一化到根域 (拼 /v1 时不会成 /v1/v1) ──────────────
{
  for (const m of ['text', 'image', 'video'] as const) {
    for (const v of presetsFor(m)) {
      ok(`${v.key} 基址不含 /v1`, !/\/v1(\/|$)/.test(v.baseUrl), v.baseUrl);
      ok(`${v.key} 基址无尾斜杠`, !v.baseUrl.endsWith('/'), v.baseUrl);
    }
  }
}

// ── 13. 能力表每个能力都声明了模态 ─────────────────────────────────
{
  ok('全部能力已声明 modality', CAPABILITIES.every((c) => !!c.modality));
  eq('当前 15 项能力均为 image', CAPABILITIES.filter((c) => c.modality === 'image').length, 15);
}

// ── 14. 配置项键与 defs 声明一致 ───────────────────────────────────
{
  const imageBase = CONFIG_DEFS.filter((d) => d.group === 'base' && d.modality === 'image');
  ok('image base 项数为 6', imageBase.length === 6, imageBase.length);
  ok(
    'image base 项均有存量别名',
    imageBase.every((d) => !!d.legacyKey),
    imageBase.filter((d) => !d.legacyKey).map((d) => d.key),
  );
  // 默认值只允许存在于 defs 一处 —— resolver 全部从 defs 读
  ok(
    '路由项未被误加 legacyKey',
    CONFIG_DEFS.filter((d) => d.key.startsWith('gateway.route.')).every((d) => !d.legacyKey),
  );
  ok(
    'asset.publicBase 无模态归属',
    CONFIG_DEFS.find((d) => d.key === 'asset.publicBase')?.modality === undefined,
  );

  /*
   * 存量键的两条不变量 (回归防护):
   * 这批键**必须**留在 CONFIG_DEFS 里 —— 回落链用 findConfigDef 反查它们的
   * type 与 envName, 反查不到就静默跳过回落。第一条断言就是在防这个回归。
   */
  const legacy = CONFIG_DEFS.filter((d) => d.hidden);
  ok('存量键仍在 CONFIG_DEFS 中', legacy.length === 9, legacy.length);
  for (const d of CONFIG_DEFS) {
    if (!d.legacyKey) continue;
    ok(`${d.key} 的存量别名可反查`, CONFIG_DEFS.some((x) => x.key === d.legacyKey), d.legacyKey);
  }
  // 存量 env 名不得改 —— 已部署环境的 .env 里就是旧名, 改了等于要求同步改所有部署
  eq('存量 env 名保持 GATEWAY_BASE_URL', CONFIG_DEFS.find((d) => d.key === 'gateway.baseUrl')?.envName, 'GATEWAY_BASE_URL');
  ok('存量键不出现在界面 (hidden)', legacy.every((d) => d.hidden === true));

  // 存量 env 优先级链: GATEWAY_BASE_URL 仍须能配出通道
  process.env.GATEWAY_BASE_URL = 'https://legacy-env.example.com';
  setGatewayConfigOverrides({});
  invalidateGatewayConfigCache();
  eq('存量 env 仍可启用 image', gatewayConfig().baseUrl, 'https://legacy-env.example.com');
  delete process.env.GATEWAY_BASE_URL;
  invalidateGatewayConfigCache();
}

// ── 汇总 ───────────────────────────────────────────────────────────
console.log(`\n通过 ${pass} 项`);
if (fails.length) {
  console.error(`\n失败 ${fails.length} 项:`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('三模态配置解析断言全部通过');
